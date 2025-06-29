#!/usr/bin/env bun
/**
 * Script to retroactively compute conversation IDs and branches from existing requests
 * This analyzes message hashes to rebuild conversation relationships
 *
 * Important: This script now preserves existing conversation IDs when the linkage
 * hasn't changed. Only requests whose parent-child relationships have changed will
 * receive new conversation IDs.
 */

import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { config } from 'dotenv'
import { extractMessageHashes } from '../../packages/shared/src/utils/conversation-hash'

// Load environment variables
config()

interface Request {
  request_id: string
  domain: string
  timestamp: Date
  current_message_hash: string | null
  parent_message_hash: string | null
  system_hash: string | null
  conversation_id: string | null
  branch_id: string | null
  body: any
  request_type: string | null
  message_count: number | null
  response_body?: any
}

interface ConversationNode {
  request_id: string
  timestamp: Date
  parent_message_hash: string | null
  current_message_hash: string | null
  system_hash?: string | null
  conversation_id?: string
  branch_id?: string
  message_count?: number | null
  children: ConversationNode[]
}

class ConversationRebuilder {
  private pool: Pool
  private requestsByHash: Map<string, Request[]> = new Map()
  private processedRequests: Set<string> = new Set()
  private conversationRoots: ConversationNode[] = []
  private dryRun: boolean
  private onlyOrphanConversations: boolean
  private domainFilter: string | null
  private limit: number | null
  private debugConversationChanges: boolean
  private existingRequests: Map<string, Request> = new Map()
  private existingConversationRequests: Map<string, Request[]> = new Map()
  // Track conversation request counts for verification
  private originalConversationCounts: Map<string, number> = new Map()
  private newConversationCounts: Map<string, number> = new Map()

  constructor(
    databaseUrl: string,
    dryRun: boolean = false,
    onlyOrphanConversations: boolean = false,
    domainFilter: string | null = null,
    limit: number | null = null,
    debugConversationChanges: boolean = false
  ) {
    this.pool = new Pool({ connectionString: databaseUrl })
    this.dryRun = dryRun
    this.onlyOrphanConversations = onlyOrphanConversations
    this.domainFilter = domainFilter
    this.limit = limit
    this.debugConversationChanges = debugConversationChanges
  }

  async rebuild() {
    console.log('Starting conversation rebuild...')
    console.log('\n⚠️  WARNING: This script loads ALL requests into memory at once.')
    console.log('For large databases, consider using rebuild-conversations-batched.ts instead.')
    console.log('')

    try {
      // Step 1: Load all requests
      console.log('\n1. Loading all requests from database...')
      const requests = await this.loadRequests()
      console.log(
        `   Found ${requests.length} requests${this.limit ? ` (limited to ${this.limit})` : ''}`
      )

      // Count how many needed hash computation
      const requestsWithHashes = requests.filter(r => r.current_message_hash).length
      const requestsNeedingHashes = requests.length - requestsWithHashes
      if (requestsNeedingHashes > 0) {
        console.log(
          `   Computed hashes for ${requestsNeedingHashes} requests that were missing them`
        )
      }

      // Step 2: Build hash index
      console.log('\n2. Building message hash index...')
      this.buildHashIndex(requests)
      console.log(`   Indexed ${this.requestsByHash.size} unique message hashes`)

      // Step 3: Build conversation trees
      console.log('\n3. Building conversation trees...')
      const trees = await this.buildConversationTrees(requests)
      console.log(`   Found ${trees.length} conversation roots`)

      // Step 4: Assign conversation IDs and detect branches
      console.log('\n4. Assigning conversation IDs and detecting branches...')
      const updates = this.assignConversationsAndBranches(trees)

      // Count how many conversation IDs were preserved
      const preservedConversations = new Set<string>()
      const changedConversations = new Set<string>()

      for (const update of updates) {
        const existing = this.existingRequests.get(update.request_id)
        if (existing?.conversation_id) {
          if (existing.conversation_id === update.conversation_id) {
            preservedConversations.add(update.conversation_id)
          } else {
            changedConversations.add(existing.conversation_id)
          }
        }
      }

      console.log(`   Prepared ${updates.length} updates`)
      console.log(`   Preserved ${preservedConversations.size} existing conversation IDs`)
      console.log(`   Changed ${changedConversations.size} conversation IDs due to linkage changes`)

      // Step 5: Update database
      console.log('\n5. Updating database...')
      await this.updateDatabase(updates)
      console.log('   Database updated successfully')

      // Step 6: Verify conversation integrity
      console.log('\n6. Verifying conversation integrity...')
      this.verifyConversationIntegrity()

      // Step 7: Show statistics
      await this.showStatistics()
    } catch (error) {
      console.error('Error during rebuild:', error)
      throw error
    } finally {
      await this.pool.end()
    }
  }

  private async loadRequests(): Promise<Request[]> {
    let query = `
      SELECT 
        request_id,
        domain,
        timestamp,
        current_message_hash,
        parent_message_hash,
        system_hash,
        conversation_id,
        branch_id,
        body,
        response_body,
        request_type,
        message_count
      FROM api_requests
      WHERE request_type IN ('inference')
    `
    const queryParams: any[] = []

    // Add domain filter if specified
    if (this.domainFilter) {
      queryParams.push(this.domainFilter)
      query += ` AND domain = $${queryParams.length}`
    }

    // Add filter for orphan requests if requested
    if (this.onlyOrphanConversations) {
      // First, find all conversation IDs that have at least one request with only 1 message
      let conversationsWithSingleMessageQuery = `
        SELECT DISTINCT conversation_id 
        FROM api_requests 
        WHERE request_type IN ('inference')
          AND conversation_id IS NOT NULL
          AND (message_count = 1 OR (message_count IS NULL AND jsonb_array_length(body->'messages') = 1))
      `
      const orphanQueryParams: any[] = []

      // Apply domain filter to the orphan check as well
      if (this.domainFilter) {
        orphanQueryParams.push(this.domainFilter)
        conversationsWithSingleMessageQuery += ` AND domain = $${orphanQueryParams.length}`
      }

      const conversationsWithSingleMessage = await this.pool.query(
        conversationsWithSingleMessageQuery,
        orphanQueryParams
      )
      const conversationIds = conversationsWithSingleMessage.rows.map(row => row.conversation_id)

      if (conversationIds.length > 0) {
        // Exclude these conversations from our query
        query += `
          AND (conversation_id IS NULL OR conversation_id NOT IN (${conversationIds.map(id => `'${id}'`).join(',')}))
        `
      }

      console.log(
        `   Filtering for orphan conversations (excluding ${conversationIds.length} conversations with single-message requests)`
      )
    }

    query += ' ORDER BY timestamp ASC'

    // Add limit if specified
    if (this.limit && this.limit > 0) {
      query += ` LIMIT ${this.limit}`
    }

    const result = await this.pool.query(query, queryParams)

    // Process requests to compute missing hashes and message counts
    let messageCountsComputed = 0
    const processedRequests = result.rows.map(row => {
      const request = { ...row }

      // Store original request data for comparison
      this.existingRequests.set(request.request_id, { ...request })

      // Build index of existing conversations
      if (request.conversation_id) {
        if (!this.existingConversationRequests.has(request.conversation_id)) {
          this.existingConversationRequests.set(request.conversation_id, [])
        }
        this.existingConversationRequests.get(request.conversation_id)!.push(request)

        // Track original conversation counts
        this.originalConversationCounts.set(
          request.conversation_id,
          (this.originalConversationCounts.get(request.conversation_id) || 0) + 1
        )
      }

      // If hashes are missing but we have a body with messages, compute them
      if (request.body?.messages) {
        try {
          const { currentMessageHash, parentMessageHash, systemHash } = extractMessageHashes(
            request.body.messages,
            request.body.system
          )
          request.current_message_hash = currentMessageHash
          request.parent_message_hash = parentMessageHash
          request.system_hash = systemHash
        } catch (error) {
          console.warn(`Failed to compute hashes for request ${request.request_id}:`, error)
        }
      }

      // Compute message count if missing
      if (request.body?.messages && Array.isArray(request.body.messages)) {
        request.message_count = request.body.messages.length
        messageCountsComputed++
      }

      return request
    })

    if (messageCountsComputed > 0) {
      console.log(
        `   Computed message counts for ${messageCountsComputed} requests that were missing them`
      )
    }

    return processedRequests
  }

  private buildHashIndex(requests: Request[]) {
    for (const request of requests) {
      if (request.current_message_hash) {
        if (!this.requestsByHash.has(request.current_message_hash)) {
          this.requestsByHash.set(request.current_message_hash, [])
        }
        this.requestsByHash.get(request.current_message_hash)!.push(request)
      }
    }
  }

  /**
   * Detects special conversation linking cases:
   * 1. Conversation summarization (system prompt contains "You are a helpful AI assistant tasked with summarizing conversations")
   * 2. Context overflow continuation (first message contains "This session is being continued...")
   */
  private detectSpecialLinking(request: Request): {
    isSummarization: boolean
    isContinuation: boolean
    continuationTarget?: string
  } {
    let isSummarization = false
    let isContinuation = false
    let continuationTarget: string | undefined

    // Check for summarization system prompt
    if (request.body?.system) {
      const systemContent =
        typeof request.body.system === 'string'
          ? request.body.system
          : request.body.system.map((item: any) => item.text || '').join(' ')

      if (
        systemContent.includes(
          'You are a helpful AI assistant tasked with summarizing conversations'
        )
      ) {
        isSummarization = true
      }
    }

    // Check for continuation message
    if (request.body?.messages?.[0]) {
      const firstMessage = request.body.messages[0]
      if (firstMessage.role === 'user' && firstMessage.content) {
        let messageContent = ''

        if (typeof firstMessage.content === 'string') {
          messageContent = firstMessage.content
        } else if (Array.isArray(firstMessage.content)) {
          // Check each content item
          for (const item of firstMessage.content) {
            if (item.type === 'text' && item.text) {
              messageContent += item.text + ' '
            }
          }
        }

        // Check for continuation pattern
        const continuationMatch = messageContent.match(
          /This session is being continued from a previous conversation that ran out of context.*?The conversation is summarized below:\s*(.+?)\s*(?:Please continue|Summary:|Analysis:|$)/s
        )

        if (continuationMatch) {
          isContinuation = true
          // Extract the summary text for matching
          continuationTarget = continuationMatch[1].trim()
        }
      }
    }

    return { isSummarization, isContinuation, continuationTarget }
  }

  /**
   * Finds a request whose response contains the continuation target text
   */
  private async findContinuationSource(
    targetText: string,
    beforeTimestamp: Date,
    domain: string
  ): Promise<Request | null> {
    // Clean up the target text for better matching
    const cleanTarget = targetText
      .replace(/^(Analysis|Summary):\s*/i, '')
      .trim()
      .substring(0, 200) // Use first 200 chars for matching

    const query = `
      SELECT request_id, domain, timestamp, current_message_hash, 
             parent_message_hash, system_hash, conversation_id, 
             branch_id, body, response_body, request_type, message_count
      FROM api_requests
      WHERE request_type = 'inference'
        AND domain = $1
        AND timestamp < $2
        AND response_body IS NOT NULL
        AND (
          response_body::text LIKE $3
          OR response_body::text LIKE $4
        )
      ORDER BY timestamp DESC
      LIMIT 10
    `

    const result = await this.pool.query(query, [
      domain,
      beforeTimestamp,
      '%' + cleanTarget.substring(0, 50) + '%',
      '%' + cleanTarget.replace(/\s+/g, '%') + '%',
    ])

    // Check each candidate for a good match
    for (const row of result.rows) {
      if (row.response_body?.content) {
        let responseText = ''

        if (typeof row.response_body.content === 'string') {
          responseText = row.response_body.content
        } else if (Array.isArray(row.response_body.content)) {
          responseText = row.response_body.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text || '')
            .join(' ')
        }

        // Check if this response contains our target text
        if (responseText.includes(cleanTarget.substring(0, 50))) {
          return row
        }
      }
    }

    return null
  }

  private async buildConversationTrees(requests: Request[]): Promise<ConversationNode[]> {
    const roots: ConversationNode[] = []
    const nodeMap = new Map<string, ConversationNode>()

    // Create nodes for all requests that have hashes
    for (const request of requests) {
      if (!request.current_message_hash) {
        console.warn(`Skipping request ${request.request_id} - no message hash`)
        continue
      }

      const node: ConversationNode = {
        request_id: request.request_id,
        timestamp: request.timestamp,
        parent_message_hash: request.parent_message_hash,
        current_message_hash: request.current_message_hash,
        system_hash: request.system_hash,
        message_count: request.message_count,
        children: [],
      }
      nodeMap.set(request.request_id, node)
    }

    // Build parent-child relationships
    for (const request of requests) {
      const node = nodeMap.get(request.request_id)!

      // Check for special linking cases
      const specialLinking = this.detectSpecialLinking(request)

      // Handle summarization requests - ignore system prompt for parent matching
      if (specialLinking.isSummarization && request.parent_message_hash) {
        // Find parent requests ignoring system hash differences
        const parentRequests = this.requestsByHash.get(request.parent_message_hash) || []

        if (parentRequests.length > 0) {
          const parent = this.findBestParent(parentRequests, request)

          if (parent) {
            const parentNode = nodeMap.get(parent.request_id)
            if (parentNode) {
              parentNode.children.push(node)
              console.log(
                `   Linked summarization request ${request.request_id} to parent ${parent.request_id} (ignoring system prompt)`
              )
              continue
            }
          }
        }
      }

      // Handle continuation requests - find the source conversation
      if (specialLinking.isContinuation && specialLinking.continuationTarget) {
        try {
          const sourceRequest = await this.findContinuationSource(
            specialLinking.continuationTarget,
            request.timestamp,
            request.domain
          )

          if (sourceRequest) {
            const sourceNode = nodeMap.get(sourceRequest.request_id)
            if (sourceNode) {
              // Add as child of the source
              sourceNode.children.push(node)

              // Mark this as a continuation branch
              node.branch_id = `compact_${new Date(request.timestamp)
                .toISOString()
                .replace(/[^0-9]/g, '')
                .substring(8, 14)}`

              console.log(
                `   Linked continuation request ${request.request_id} to source ${sourceRequest.request_id} with branch ${node.branch_id}`
              )
              continue
            }
          } else {
            console.log(`   Could not find source for continuation request ${request.request_id}`)
          }
        } catch (error) {
          console.warn(`   Error finding continuation source for ${request.request_id}:`, error)
        }
      }

      // Normal parent-child linking
      if (request.parent_message_hash) {
        // Find parent requests
        const parentRequests = this.requestsByHash.get(request.parent_message_hash) || []

        if (parentRequests.length > 0) {
          // When multiple parents exist, choose the one with the same domain and closest timestamp
          const parent = this.findBestParent(parentRequests, request)

          if (parent) {
            const parentNode = nodeMap.get(parent.request_id)
            if (parentNode) {
              parentNode.children.push(node)
            }
          } else {
            // No suitable parent found, this is a root
            roots.push(node)
          }
        } else {
          // No parent found, this is a root
          roots.push(node)
        }
      } else {
        // No parent hash, this is a root
        roots.push(node)
      }
    }

    return roots
  }

  private findBestParent(candidates: Request[], child: Request): Request | null {
    // Filter candidates by domain and timestamp (parent must be before child)
    const validCandidates = candidates.filter(
      c => c.domain === child.domain && new Date(c.timestamp) < new Date(child.timestamp)
    )

    if (validCandidates.length === 0) {
      return null
    }

    // Sort by timestamp (closest to child first)
    validCandidates.sort((a, b) => {
      const timeDiffA = Math.abs(
        new Date(child.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      const timeDiffB = Math.abs(
        new Date(child.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      return timeDiffA - timeDiffB
    })

    return validCandidates[0]
  }

  private findExistingConversationId(root: ConversationNode): string | null {
    // Get the existing request data
    const existingRequest = this.existingRequests.get(root.request_id)
    if (!existingRequest?.conversation_id) {
      return null
    }

    // Get all requests in the existing conversation
    const existingConvRequests =
      this.existingConversationRequests.get(existingRequest.conversation_id) || []

    // Build a set of all request IDs in the current tree
    const currentTreeRequestIds = new Set<string>()
    this.collectTreeRequestIds(root, currentTreeRequestIds)

    // Check if the conversation has the same requests
    const existingConvRequestIds = new Set(existingConvRequests.map(r => r.request_id))

    // If the sets are identical, the conversation structure hasn't changed
    if (
      currentTreeRequestIds.size === existingConvRequestIds.size &&
      [...currentTreeRequestIds].every(id => existingConvRequestIds.has(id))
    ) {
      // Verify parent-child relationships are the same
      if (this.verifyConversationStructure(root, existingRequest.conversation_id)) {
        return existingRequest.conversation_id
      }
    }

    return null
  }

  private collectTreeRequestIds(node: ConversationNode, requestIds: Set<string>) {
    requestIds.add(node.request_id)
    for (const child of node.children) {
      this.collectTreeRequestIds(child, requestIds)
    }
  }

  private verifyConversationStructure(root: ConversationNode, conversationId: string): boolean {
    // Get all requests in the existing conversation
    const existingRequests = this.existingConversationRequests.get(conversationId) || []
    const existingByRequestId = new Map(existingRequests.map(r => [r.request_id, r]))

    // Verify each node has the same parent-child relationships
    return this.verifyNodeStructure(root, existingByRequestId)
  }

  private verifyNodeStructure(
    node: ConversationNode,
    existingByRequestId: Map<string, Request>
  ): boolean {
    const existing = existingByRequestId.get(node.request_id)
    if (!existing) {
      return false
    }

    // Check if parent hash matches
    if (node.parent_message_hash !== existing.parent_message_hash) {
      return false
    }

    // Recursively check all children
    for (const child of node.children) {
      if (!this.verifyNodeStructure(child, existingByRequestId)) {
        return false
      }
    }

    return true
  }

  private assignConversationsAndBranches(trees: ConversationNode[]): Array<{
    request_id: string
    conversation_id: string
    branch_id: string
    current_message_hash?: string
    parent_message_hash?: string
    system_hash?: string | null
    message_count?: number
  }> {
    const updates: Array<{
      request_id: string
      conversation_id: string
      branch_id: string
      current_message_hash?: string
      parent_message_hash?: string
      system_hash?: string | null
      message_count?: number
    }> = []

    for (const root of trees) {
      // Check if this conversation already exists and has the same structure
      const existingConvId = this.findExistingConversationId(root)
      const conversationId = existingConvId || randomUUID()

      this.traverseAndAssign(
        root,
        conversationId,
        'main',
        new Map(),
        updates,
        existingConvId !== null
      )
    }

    return updates
  }

  private traverseAndAssign(
    node: ConversationNode,
    conversationId: string,
    branchId: string,
    branchPoints: Map<string, number>,
    updates: Array<{
      request_id: string
      conversation_id: string
      branch_id: string
      current_message_hash?: string
      parent_message_hash?: string
      system_hash?: string | null
      message_count?: number
    }>,
    isExistingConversation: boolean = false
  ) {
    // Track new conversation counts
    this.newConversationCounts.set(
      conversationId,
      (this.newConversationCounts.get(conversationId) || 0) + 1
    )
    // Use pre-assigned branch_id if available (for continuation nodes)
    const effectiveBranchId = node.branch_id || branchId

    // Get existing request data
    const existing = this.existingRequests.get(node.request_id)

    // Check if we need to update this request
    const needsUpdate =
      !existing ||
      existing.conversation_id !== conversationId ||
      existing.branch_id !== effectiveBranchId ||
      existing.current_message_hash !== node.current_message_hash ||
      existing.parent_message_hash !== node.parent_message_hash ||
      existing.system_hash !== node.system_hash ||
      existing.message_count !== node.message_count

    if (needsUpdate) {
      // Only create update if something has changed
      const update: any = {
        request_id: node.request_id,
        conversation_id: conversationId,
        branch_id: effectiveBranchId,
      }

      // Include hashes if they exist
      if (node.current_message_hash) {
        update.current_message_hash = node.current_message_hash
      }
      if (node.parent_message_hash) {
        update.parent_message_hash = node.parent_message_hash
      }
      if (node.system_hash !== undefined) {
        update.system_hash = node.system_hash
      }
      if (node.message_count !== null && node.message_count !== undefined) {
        update.message_count = node.message_count
      }

      updates.push(update)
    }

    // Check if this node creates a branch point
    if (node.children.length > 1) {
      // This is a branch point
      console.log(
        `   Branch point detected at ${node.request_id} with ${node.children.length} children`
      )

      // Sort children by timestamp to ensure consistent branch assignment
      const sortedChildren = [...node.children].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )

      // First child continues on the same branch
      this.traverseAndAssign(
        sortedChildren[0],
        conversationId,
        branchId,
        branchPoints,
        updates,
        isExistingConversation
      )

      // Other children get new branches
      for (let i = 1; i < sortedChildren.length; i++) {
        const newBranchId = `branch_${new Date(sortedChildren[i].timestamp).getTime()}`
        this.traverseAndAssign(
          sortedChildren[i],
          conversationId,
          newBranchId,
          branchPoints,
          updates,
          isExistingConversation
        )
      }
    } else if (node.children.length === 1) {
      // Single child continues on the same branch
      this.traverseAndAssign(
        node.children[0],
        conversationId,
        branchId,
        branchPoints,
        updates,
        isExistingConversation
      )
    }
    // If no children, traversal ends here
  }

  private async updateDatabase(
    updates: Array<{
      request_id: string
      conversation_id: string
      branch_id: string
      current_message_hash?: string
      parent_message_hash?: string
      system_hash?: string | null
      message_count?: number
    }>
  ) {
    if (this.dryRun) {
      console.log('\n   🔍 DRY RUN MODE - Showing what would be updated:')

      // Group updates by type of change
      const conversationUpdates = updates.filter(u => u.conversation_id)
      const hashUpdates = updates.filter(u => u.current_message_hash || u.parent_message_hash)
      const messageCountUpdates = updates.filter(u => u.message_count !== undefined)

      console.log(`   Would update ${updates.length} total requests:`)
      console.log(`     - ${conversationUpdates.length} conversation assignments`)
      console.log(`     - ${hashUpdates.length} hash updates`)
      console.log(`     - ${messageCountUpdates.length} message count updates`)

      // Show sample of changes
      if (updates.length > 0) {
        console.log('\n   Sample of changes (first 5):')
        updates.slice(0, 5).forEach(update => {
          const existing = this.existingRequests.get(update.request_id)
          const isPreserved = existing?.conversation_id === update.conversation_id

          console.log(`     Request ${update.request_id}:`)
          console.log(
            `       - conversation_id: ${update.conversation_id} ${isPreserved ? '(preserved)' : existing?.conversation_id ? `(was: ${existing.conversation_id})` : '(new)'}`
          )
          console.log(`       - branch_id: ${update.branch_id}`)
          if (update.current_message_hash) {
            console.log(
              `       - current_message_hash: ${update.current_message_hash.substring(0, 16)}...`
            )
          }
          if (update.parent_message_hash !== undefined) {
            console.log(
              `       - parent_message_hash: ${update.parent_message_hash ? update.parent_message_hash.substring(0, 16) + '...' : 'NULL'}`
            )
          }
          if (update.system_hash !== undefined) {
            console.log(
              `       - system_hash: ${update.system_hash ? update.system_hash.substring(0, 16) + '...' : 'NULL'}`
            )
          }
          if (update.message_count !== undefined) {
            console.log(`       - message_count: ${update.message_count}`)
          }
        })

        if (updates.length > 5) {
          console.log(`     ... and ${updates.length - 5} more requests`)
        }
      }

      return
    }

    // Debug logging for conversation ID changes
    if (this.debugConversationChanges) {
      console.log('\n   🔍 DEBUG: Conversation ID changes:')
      let conversationChangeCount = 0

      updates.forEach(update => {
        const existing = this.existingRequests.get(update.request_id)
        if (existing && existing.conversation_id !== update.conversation_id) {
          conversationChangeCount++
          console.log(`     [${conversationChangeCount}] Request ${update.request_id}:`)
          console.log(`       - Old conversation_id: ${existing.conversation_id || 'NULL'}`)
          console.log(`       - New conversation_id: ${update.conversation_id}`)
          console.log(`       - Branch: ${update.branch_id}`)
          if (existing.timestamp) {
            console.log(`       - Timestamp: ${existing.timestamp}`)
          }
          if (existing.domain) {
            console.log(`       - Domain: ${existing.domain}`)
          }
        }
      })

      if (conversationChangeCount === 0) {
        console.log('     No conversation ID changes detected')
      } else {
        console.log(`\n   Total requests with conversation ID changes: ${conversationChangeCount}`)
      }
    }

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // Update in batches of 1000
      const batchSize = 1000
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize)

        // Build the update query using CASE statements
        const caseConversationId = batch
          .map(u => `WHEN '${u.request_id}' THEN '${u.conversation_id}'::uuid`)
          .join(' ')

        const caseBranchId = batch
          .map(u => `WHEN '${u.request_id}' THEN '${u.branch_id}'`)
          .join(' ')

        const caseCurrentHash = batch
          .map(u =>
            u.current_message_hash
              ? `WHEN '${u.request_id}' THEN '${u.current_message_hash}'`
              : `WHEN '${u.request_id}' THEN current_message_hash`
          )
          .join(' ')

        const caseParentHash = batch
          .map(u =>
            u.parent_message_hash !== undefined
              ? `WHEN '${u.request_id}' THEN ${u.parent_message_hash ? `'${u.parent_message_hash}'` : 'NULL'}`
              : `WHEN '${u.request_id}' THEN parent_message_hash`
          )
          .join(' ')

        const caseMessageCount = batch
          .map(u =>
            u.message_count !== undefined
              ? `WHEN '${u.request_id}' THEN ${u.message_count}`
              : `WHEN '${u.request_id}' THEN message_count`
          )
          .join(' ')

        const caseSystemHash = batch
          .map(u =>
            u.system_hash !== undefined
              ? `WHEN '${u.request_id}' THEN ${u.system_hash ? `'${u.system_hash}'` : 'NULL'}`
              : `WHEN '${u.request_id}' THEN system_hash`
          )
          .join(' ')

        const requestIds = batch.map(u => `'${u.request_id}'`).join(',')

        const query = `
          UPDATE api_requests
          SET 
            conversation_id = CASE request_id ${caseConversationId} END,
            branch_id = CASE request_id ${caseBranchId} END,
            current_message_hash = CASE request_id ${caseCurrentHash} END,
            parent_message_hash = CASE request_id ${caseParentHash} END,
            system_hash = CASE request_id ${caseSystemHash} END,
            message_count = CASE request_id ${caseMessageCount} END
          WHERE request_id IN (${requestIds})
        `

        await client.query(query)

        if ((i + batch.length) % 10000 === 0) {
          console.log(`   Updated ${i + batch.length} / ${updates.length} requests...`)
        }
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async showStatistics() {
    console.log('\n6. Final statistics:')

    if (this.dryRun) {
      console.log('   (Statistics show current database state, not dry-run changes)')
    }

    // Build stats query with optional domain filter
    let statsQuery = `
      SELECT 
        COUNT(DISTINCT conversation_id) as total_conversations,
        COUNT(DISTINCT branch_id) as total_branches,
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE branch_id != 'main') as branched_requests
      FROM api_requests
      WHERE conversation_id IS NOT NULL
    `
    const statsParams: any[] = []

    if (this.domainFilter) {
      statsParams.push(this.domainFilter)
      statsQuery += ` AND domain = $${statsParams.length}`
    }

    const stats = await this.pool.query(statsQuery, statsParams)

    // Domain stats query
    let domainStatsQuery = `
      SELECT 
        domain,
        COUNT(DISTINCT conversation_id) as conversations,
        COUNT(DISTINCT branch_id) as branches,
        COUNT(*) as requests
      FROM api_requests
      WHERE conversation_id IS NOT NULL
    `
    const domainStatsParams: any[] = []

    if (this.domainFilter) {
      domainStatsParams.push(this.domainFilter)
      domainStatsQuery += ` AND domain = $${domainStatsParams.length}`
    }

    domainStatsQuery += `
      GROUP BY domain
      ORDER BY requests DESC
      LIMIT 10
    `

    const domainStats = await this.pool.query(domainStatsQuery, domainStatsParams)

    if (this.domainFilter) {
      console.log(`   (Showing statistics for domain: ${this.domainFilter})`)
    }

    console.log(`   Total conversations: ${stats.rows[0].total_conversations}`)
    console.log(`   Total branches: ${stats.rows[0].total_branches}`)
    console.log(`   Total requests with conversations: ${stats.rows[0].total_requests}`)
    console.log(`   Requests on non-main branches: ${stats.rows[0].branched_requests}`)

    if (this.domainFilter) {
      console.log('\n   Domain statistics:')
    } else {
      console.log('\n   Top domains by request count:')
    }

    for (const row of domainStats.rows) {
      console.log(
        `     ${row.domain}: ${row.conversations} conversations, ${row.branches} branches, ${row.requests} requests`
      )
    }
  }

  private verifyConversationIntegrity() {
    const warnings: string[] = []
    let conversationsWithFewerRequests = 0
    let conversationsWithMoreRequests = 0
    let conversationsUnchanged = 0

    // Check all conversations that existed before
    for (const [convId, originalCount] of this.originalConversationCounts) {
      const newCount = this.newConversationCounts.get(convId) || 0

      if (newCount < originalCount) {
        conversationsWithFewerRequests++
        warnings.push(
          `   ⚠️  Conversation ${convId}: ${originalCount} → ${newCount} requests (lost ${originalCount - newCount})`
        )
      } else if (newCount > originalCount) {
        conversationsWithMoreRequests++
      } else {
        conversationsUnchanged++
      }
    }

    // Check for new conversations that might have stolen requests
    const newConversations = [...this.newConversationCounts.keys()].filter(
      convId => !this.originalConversationCounts.has(convId)
    )

    console.log('\n   Conversation integrity check:')
    console.log(`   - Conversations unchanged: ${conversationsUnchanged}`)
    console.log(`   - Conversations with more requests: ${conversationsWithMoreRequests}`)
    console.log(`   - Conversations with fewer requests: ${conversationsWithFewerRequests}`)
    console.log(`   - New conversations created: ${newConversations.length}`)

    if (warnings.length > 0) {
      console.log('\n   ⚠️  WARNING: Some conversations lost requests!')
      console.log('   This may indicate an issue with the rebuild logic.')
      console.log('   Affected conversations (showing first 10):')
      warnings.slice(0, 10).forEach(warning => console.log(warning))
      if (warnings.length > 10) {
        console.log(`   ... and ${warnings.length - 10} more`)
      }

      if (!this.dryRun) {
        console.log('\n   ⚠️  These changes have been applied to the database!')
        console.log('   Consider reviewing the rebuild logic or restoring from backup.')
      }
    } else {
      console.log('\n   ✅ All conversations maintained or gained requests - integrity verified!')
    }
  }
}

// Parse command line arguments
function parseArgs(): {
  dryRun: boolean
  onlyOrphanConversations: boolean
  domain: string | null
  limit: number | null
  debugConversationChanges: boolean
  help: boolean
} {
  const args = process.argv.slice(2)
  const domainIndex = args.findIndex(arg => arg === '--domain')
  const domain = domainIndex !== -1 && args[domainIndex + 1] ? args[domainIndex + 1] : null

  const limitIndex = args.findIndex(arg => arg === '--limit')
  const limit =
    limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1], 10) : null

  return {
    dryRun: args.includes('--dry-run'),
    onlyOrphanConversations: args.includes('--only-orphan-conversations'),
    domain,
    limit: limit && !isNaN(limit) ? limit : null,
    debugConversationChanges: args.includes('--debug-conversation-changes'),
    help: args.includes('--help') || args.includes('-h'),
  }
}

// Display help message
function showHelp() {
  console.log(`
Usage: bun run scripts/db/rebuild-conversations.ts [options]

Options:
  --dry-run                   Run in dry-run mode (no database changes)
  --only-orphan-conversations Only process orphan conversations
  --domain <domain>           Filter by specific domain
  --limit <number>            Limit the number of requests to process
  --debug-conversation-changes Debug log all conversation ID changes
  --help, -h                  Show this help message

Examples:
  # Rebuild all conversations (loads all data into memory)
  bun run scripts/db/rebuild-conversations.ts

  # For large databases, use the batched version:
  bun run scripts/db/rebuild-conversations-batched.ts

  # Dry run for a specific domain
  bun run scripts/db/rebuild-conversations.ts --dry-run --domain example.com

  # Process only orphan conversations for a domain
  bun run scripts/db/rebuild-conversations.ts --only-orphan-conversations --domain myapp.com

  # Process first 100 requests with debug logging
  bun run scripts/db/rebuild-conversations.ts --limit 100 --debug-conversation-changes

  # Dry run with limit and conversation change debugging
  bun run scripts/db/rebuild-conversations.ts --dry-run --limit 50 --debug-conversation-changes
`)
}

// Main execution
async function main() {
  const { dryRun, onlyOrphanConversations, domain, limit, debugConversationChanges, help } =
    parseArgs()

  if (help) {
    showHelp()
    process.exit(0)
  }

  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required')
    process.exit(1)
  }

  console.log('===========================================')
  console.log('Conversation Rebuild Script')
  console.log('===========================================')
  console.log('This script will retroactively compute conversation IDs and branches')
  console.log('from existing requests in the database based on message hashes.')
  console.log('')

  if (dryRun) {
    console.log('🔍 Running in DRY RUN mode - no changes will be made to the database')
  } else {
    console.log('WARNING: This will update existing records in the database.')
    console.log('It is recommended to backup your database before proceeding.')
  }

  if (onlyOrphanConversations) {
    console.log(
      '🎯 Only processing orphan conversations (conversations without any single-message requests)'
    )
  }

  if (domain) {
    console.log(`🌐 Filtering by domain: ${domain}`)
  }

  if (limit) {
    console.log(`📊 Limiting to ${limit} requests`)
  }

  if (debugConversationChanges) {
    console.log(`🐛 Debug mode: Will log all conversation ID changes`)
  }

  console.log('')

  // Add a confirmation prompt unless in dry run mode
  if (!dryRun) {
    const response = prompt('Do you want to continue? (yes/no): ')

    if (response?.toLowerCase() !== 'yes') {
      console.log('Operation cancelled.')
      process.exit(0)
    }
  }

  const rebuilder = new ConversationRebuilder(
    databaseUrl,
    dryRun,
    onlyOrphanConversations,
    domain,
    limit,
    debugConversationChanges
  )

  try {
    await rebuilder.rebuild()
    if (dryRun) {
      console.log('\n✅ Dry run completed successfully! No changes were made.')
    } else {
      console.log('\n✅ Conversation rebuild completed successfully!')
    }
  } catch (error) {
    console.error('\n❌ Conversation rebuild failed:', error)
    process.exit(1)
  }
}

// Run the script
main()
