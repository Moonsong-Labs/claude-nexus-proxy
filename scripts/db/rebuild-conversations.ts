#!/usr/bin/env bun
/**
 * Script to retroactively compute conversation IDs and branches from existing requests
 * This analyzes message hashes to rebuild conversation relationships
 */

import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { config } from 'dotenv'
import { extractMessageHashes } from '../../packages/shared/dist/utils/conversation-hash.js'

// Load environment variables
config()

interface Request {
  request_id: string
  domain: string
  timestamp: Date
  current_message_hash: string | null
  parent_message_hash: string | null
  conversation_id: string | null
  branch_id: string | null
  body: any
  request_type: string | null
  message_count: number | null
}

interface ConversationNode {
  request_id: string
  timestamp: Date
  parent_message_hash: string | null
  current_message_hash: string | null
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

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl })
  }

  async rebuild() {
    console.log('Starting conversation rebuild...')

    try {
      // Step 1: Load all requests
      console.log('\n1. Loading all requests from database...')
      const requests = await this.loadRequests()
      console.log(`   Found ${requests.length} requests`)

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
      const trees = this.buildConversationTrees(requests)
      console.log(`   Found ${trees.length} conversation roots`)

      // Step 4: Assign conversation IDs and detect branches
      console.log('\n4. Assigning conversation IDs and detecting branches...')
      const updates = this.assignConversationsAndBranches(trees)
      console.log(`   Prepared ${updates.length} updates`)

      // Step 5: Update database
      console.log('\n5. Updating database...')
      await this.updateDatabase(updates)
      console.log('   Database updated successfully')

      // Step 6: Show statistics
      await this.showStatistics()
    } catch (error) {
      console.error('Error during rebuild:', error)
      throw error
    } finally {
      await this.pool.end()
    }
  }

  private async loadRequests(): Promise<Request[]> {
    const query = `
      SELECT 
        request_id,
        domain,
        timestamp,
        current_message_hash,
        parent_message_hash,
        conversation_id,
        branch_id,
        body,
        request_type,
        message_count
      FROM api_requests
      WHERE request_type IN ('inference', 'inference_streaming')
      ORDER BY timestamp ASC
    `

    const result = await this.pool.query(query)

    // Process requests to compute missing hashes and message counts
    let messageCountsComputed = 0
    const processedRequests = result.rows.map(row => {
      const request = { ...row }

      // If hashes are missing but we have a body with messages, compute them
      if (request.body?.messages) {
        try {
          const { currentMessageHash, parentMessageHash } = extractMessageHashes(
            request.body.messages,
            request.body.system
          )
          request.current_message_hash = currentMessageHash
          request.parent_message_hash = parentMessageHash
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

  private buildConversationTrees(requests: Request[]): ConversationNode[] {
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
        message_count: request.message_count,
        children: [],
      }
      nodeMap.set(request.request_id, node)
    }

    // Build parent-child relationships
    for (const request of requests) {
      const node = nodeMap.get(request.request_id)!

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

  private assignConversationsAndBranches(trees: ConversationNode[]): Array<{
    request_id: string
    conversation_id: string
    branch_id: string
    current_message_hash?: string
    parent_message_hash?: string
    message_count?: number
  }> {
    const updates: Array<{
      request_id: string
      conversation_id: string
      branch_id: string
      current_message_hash?: string
      parent_message_hash?: string
      message_count?: number
    }> = []

    for (const root of trees) {
      const conversationId = randomUUID()
      this.traverseAndAssign(root, conversationId, 'main', new Map(), updates)
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
      message_count?: number
    }>
  ) {
    // Assign conversation and branch to this node
    const update: any = {
      request_id: node.request_id,
      conversation_id: conversationId,
      branch_id: branchId,
    }

    // Include hashes if they exist
    if (node.current_message_hash) {
      update.current_message_hash = node.current_message_hash
    }
    if (node.parent_message_hash) {
      update.parent_message_hash = node.parent_message_hash
    }
    if (node.message_count !== null && node.message_count !== undefined) {
      update.message_count = node.message_count
    }

    updates.push(update)

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
      this.traverseAndAssign(sortedChildren[0], conversationId, branchId, branchPoints, updates)

      // Other children get new branches
      for (let i = 1; i < sortedChildren.length; i++) {
        const newBranchId = `branch_${new Date(sortedChildren[i].timestamp).getTime()}`
        this.traverseAndAssign(
          sortedChildren[i],
          conversationId,
          newBranchId,
          branchPoints,
          updates
        )
      }
    } else if (node.children.length === 1) {
      // Single child continues on the same branch
      this.traverseAndAssign(node.children[0], conversationId, branchId, branchPoints, updates)
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
      message_count?: number
    }>
  ) {
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

        const requestIds = batch.map(u => `'${u.request_id}'`).join(',')

        const query = `
          UPDATE api_requests
          SET 
            conversation_id = CASE request_id ${caseConversationId} END,
            branch_id = CASE request_id ${caseBranchId} END,
            current_message_hash = CASE request_id ${caseCurrentHash} END,
            parent_message_hash = CASE request_id ${caseParentHash} END,
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

    const stats = await this.pool.query(`
      SELECT 
        COUNT(DISTINCT conversation_id) as total_conversations,
        COUNT(DISTINCT branch_id) as total_branches,
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE branch_id != 'main') as branched_requests
      FROM api_requests
      WHERE conversation_id IS NOT NULL
    `)

    const domainStats = await this.pool.query(`
      SELECT 
        domain,
        COUNT(DISTINCT conversation_id) as conversations,
        COUNT(DISTINCT branch_id) as branches,
        COUNT(*) as requests
      FROM api_requests
      WHERE conversation_id IS NOT NULL
      GROUP BY domain
      ORDER BY requests DESC
      LIMIT 10
    `)

    console.log(`   Total conversations: ${stats.rows[0].total_conversations}`)
    console.log(`   Total branches: ${stats.rows[0].total_branches}`)
    console.log(`   Total requests with conversations: ${stats.rows[0].total_requests}`)
    console.log(`   Requests on non-main branches: ${stats.rows[0].branched_requests}`)

    console.log('\n   Top domains by request count:')
    for (const row of domainStats.rows) {
      console.log(
        `     ${row.domain}: ${row.conversations} conversations, ${row.branches} branches, ${row.requests} requests`
      )
    }
  }
}

// Main execution
async function main() {
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
  console.log('WARNING: This will update existing records in the database.')
  console.log('It is recommended to backup your database before proceeding.')
  console.log('')

  // Add a confirmation prompt
  const response = prompt('Do you want to continue? (yes/no): ')

  if (response?.toLowerCase() !== 'yes') {
    console.log('Operation cancelled.')
    process.exit(0)
  }

  const rebuilder = new ConversationRebuilder(databaseUrl)

  try {
    await rebuilder.rebuild()
    console.log('\n✅ Conversation rebuild completed successfully!')
  } catch (error) {
    console.error('\n❌ Conversation rebuild failed:', error)
    process.exit(1)
  }
}

// Run the script
main()
