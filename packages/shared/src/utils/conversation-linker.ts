import { createHash } from 'crypto'
import type { ClaudeMessage, ClaudeContent } from '../types/index.js'
import { hashSystemPrompt } from './conversation-hash.js'

// Constants
const BRANCH_MAIN = 'main'
const BRANCH_PREFIX = 'branch_'
const COMPACT_PREFIX = 'compact_'
const COMPACT_CONVERSATION_PREFIX =
  'This session is being continued from a previous conversation that ran out of context'
const SUMMARY_MARKER = 'The conversation is summarized below:'
const SUMMARY_SUFFIX_MARKER = 'Please continue the conversation'
const SUMMARIZATION_SYSTEM_PROMPT =
  'You are a helpful AI assistant tasked with summarizing conversations'
const COMPACT_SEARCH_DAYS = 7
// const QUERY_LIMIT = 10 // Reserved for future use0
const MIN_MESSAGES_FOR_PARENT_HASH = 3

export interface LinkingRequest {
  domain: string
  messages: ClaudeMessage[]
  systemPrompt?: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[]
  requestId: string
  messageCount: number
}

export interface LinkingResult {
  conversationId: string | null
  parentRequestId: string | null
  branchId: string
  currentMessageHash: string
  parentMessageHash: string | null
  systemHash: string | null
}

interface CompactInfo {
  isCompact: boolean
  summaryContent: string
}

export interface ParentQueryCriteria {
  domain: string
  messageCount?: number
  parentMessageHash?: string
  currentMessageHash?: string
  systemHash?: string | null
  excludeRequestId?: string
}

interface ParentRequest {
  request_id: string
  conversation_id: string
  branch_id: string
  current_message_hash: string
  system_hash: string | null
}

export type QueryExecutor = (criteria: ParentQueryCriteria) => Promise<ParentRequest[]>

export type CompactSearchExecutor = (
  domain: string,
  summaryContent: string,
  beforeTimestamp: Date
) => Promise<ParentRequest | null>

export class ConversationLinker {
  constructor(
    private queryExecutor: QueryExecutor,
    private compactSearchExecutor?: CompactSearchExecutor
  ) {}

  async linkConversation(request: LinkingRequest): Promise<LinkingResult> {
    const { domain, messages, systemPrompt, requestId } = request

    try {
      // Compute hashes with error handling
      const currentMessageHash = this.computeMessageHash(messages)

      // Convert system prompt to string if it's an array
      let systemPromptStr: string | undefined
      if (systemPrompt) {
        if (typeof systemPrompt === 'string') {
          systemPromptStr = systemPrompt
        } else if (Array.isArray(systemPrompt)) {
          systemPromptStr = systemPrompt.map(item => item.text).join('\n')
        }
      }

      const systemHash = systemPromptStr ? hashSystemPrompt(systemPromptStr) : null

      // Case 1: Single message handling
      if (messages.length === 1) {
        const compactInfo = this.detectCompactConversation(messages[0])
        if (compactInfo) {
          // Case a: Compact conversation continuation
          const parent = await this.findCompactParent(domain, compactInfo.summaryContent)
          if (parent) {
            return {
              conversationId: parent.conversation_id,
              parentRequestId: parent.request_id,
              branchId: this.generateCompactBranchId(),
              currentMessageHash,
              parentMessageHash: parent.current_message_hash,
              systemHash,
            }
          }
        }
        // Case b: Skip - no parent
        return {
          conversationId: null,
          parentRequestId: null,
          branchId: BRANCH_MAIN,
          currentMessageHash,
          parentMessageHash: null,
          systemHash,
        }
      }

      // Case 2: Multiple messages - compute parent hash
      let parentMessageHash: string
      try {
        parentMessageHash = this.computeParentHash(messages)
      } catch (error) {
        console.error('Failed to compute parent hash:', error)
        // Return as new conversation if parent hash computation fails
        return {
          conversationId: null,
          parentRequestId: null,
          branchId: BRANCH_MAIN,
          currentMessageHash,
          parentMessageHash: null,
          systemHash,
        }
      }

      // Priority matching system
      let parent: ParentRequest | null = null

      // Priority i: Exact match (parent hash + system hash)
      if (systemHash) {
        const exactMatches = await this.findParentByHash(
          domain,
          parentMessageHash,
          systemHash,
          requestId
        )
        parent = this.selectBestParent(exactMatches)
      }

      // Priority ii: Summarization request - ignore system hash
      if (!parent && this.isSummarizationRequest(systemPromptStr)) {
        const summarizationMatches = await this.findParentByHash(
          domain,
          parentMessageHash,
          null,
          requestId
        )
        parent = this.selectBestParent(summarizationMatches)
      }

      // Priority iii: Fallback - match by message hash only
      if (!parent) {
        const fallbackMatches = await this.findParentByHash(
          domain,
          parentMessageHash,
          null,
          requestId
        )
        parent = this.selectBestParent(fallbackMatches)
      }

      if (parent) {
        // Check if this creates a branch
        const existingChildren = await this.findChildrenOfParent(
          domain,
          parent.current_message_hash,
          requestId
        )
        const branchId = existingChildren.length > 0 ? this.generateBranchId() : parent.branch_id

        return {
          conversationId: parent.conversation_id,
          parentRequestId: parent.request_id,
          branchId,
          currentMessageHash,
          parentMessageHash,
          systemHash,
        }
      }

      // No parent found - new conversation
      return {
        conversationId: null,
        parentRequestId: null,
        branchId: BRANCH_MAIN,
        currentMessageHash,
        parentMessageHash,
        systemHash,
      }
    } catch (error) {
      console.error('Error in linkConversation:', error)
      // Return safe default on any error
      return {
        conversationId: null,
        parentRequestId: null,
        branchId: BRANCH_MAIN,
        currentMessageHash: '',
        parentMessageHash: null,
        systemHash: null,
      }
    }
  }

  public computeMessageHash(messages: ClaudeMessage[]): string {
    try {
      const hash = createHash('sha256')

      if (!messages || messages.length === 0) {
        throw new Error('Cannot compute hash for empty messages array')
      }

      for (const message of messages) {
        if (!message || !message.role) {
          throw new Error('Invalid message: missing role')
        }

        hash.update(message.role)
        hash.update('\n')

        const normalizedContent = this.normalizeMessageContent(message.content)
        hash.update(normalizedContent)
        hash.update('\n')
      }

      return hash.digest('hex')
    } catch (error) {
      console.error('Error in computeMessageHash:', error)
      throw new Error(
        `Failed to compute message hash: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private normalizeMessageContent(content: string | ClaudeContent[]): string {
    if (typeof content === 'string') {
      return this.normalizeStringContent(content)
    }

    // For array content, create a deterministic string representation
    const filteredContent = this.filterSystemReminders(content)
    const dedupedContent = this.deduplicateToolItems(filteredContent)
    return this.serializeContentItems(dedupedContent)
  }

  private normalizeStringContent(content: string): string {
    // Normalize string content to match array format for consistency
    return `[0]text:${content.trim().replace(/\r\n/g, '\n')}`
  }

  private filterSystemReminders(content: ClaudeContent[]): ClaudeContent[] {
    // Filter out system-reminder content items before processing
    return content.filter(item => {
      // Skip text items that start with <system-reminder>
      if (item.type === 'text' && typeof item.text === 'string') {
        return !item.text.trim().startsWith('<system-reminder>')
      }
      return true
    })
  }

  private deduplicateToolItems(content: ClaudeContent[]): ClaudeContent[] {
    // Deduplicate tool_use and tool_result items by their IDs
    const seenToolUseIds = new Set<string>()
    const seenToolResultIds = new Set<string>()

    return content.filter(item => {
      if (item.type === 'tool_use' && item.id) {
        if (seenToolUseIds.has(item.id)) {
          return false
        }
        seenToolUseIds.add(item.id)
      } else if (item.type === 'tool_result' && item.tool_use_id) {
        if (seenToolResultIds.has(item.tool_use_id)) {
          return false
        }
        seenToolResultIds.add(item.tool_use_id)
      }
      return true
    })
  }

  private serializeContentItems(content: ClaudeContent[]): string {
    return content.map((item, index) => this.serializeContentItem(item, index)).join('\n')
  }

  private serializeContentItem(item: ClaudeContent, index: number): string {
    switch (item.type) {
      case 'text':
        return this.serializeTextItem(item, index)
      case 'image':
        return this.serializeImageItem(item, index)
      case 'tool_use':
        return this.serializeToolUseItem(item, index)
      case 'tool_result':
        return this.serializeToolResultItem(item, index)
      default:
        return `[${index}]${item.type}:unknown`
    }
  }

  private serializeTextItem(item: ClaudeContent, index: number): string {
    const text = (item.text || '').trim().replace(/\r\n/g, '\n')
    return `[${index}]text:${text}`
  }

  private serializeImageItem(item: ClaudeContent, index: number): string {
    if (!item.source) {
      return `[${index}]image:no-source`
    }
    // Hash the image data to avoid massive strings
    const imageHash = createHash('sha256')
      .update(item.source.data || '')
      .digest('hex')
    return `[${index}]image:${item.source.media_type}:${imageHash}`
  }

  private serializeToolUseItem(item: ClaudeContent, index: number): string {
    return `[${index}]tool_use:${item.name}:${item.id}:${JSON.stringify(item.input)}`
  }

  private serializeToolResultItem(item: ClaudeContent, index: number): string {
    let contentStr = ''
    if (typeof item.content === 'string') {
      contentStr = item.content
    } else if (Array.isArray(item.content)) {
      contentStr = JSON.stringify(item.content)
    }
    return `[${index}]tool_result:${item.tool_use_id}:${contentStr}`
  }

  private computeParentHash(messages: ClaudeMessage[]): string {
    // Parent hash is all messages except the last 2
    if (messages.length < MIN_MESSAGES_FOR_PARENT_HASH) {
      throw new Error(
        `Cannot compute parent hash for less than ${MIN_MESSAGES_FOR_PARENT_HASH} messages`
      )
    }

    const parentMessages = messages.slice(0, -2)
    return this.computeMessageHash(parentMessages)
  }

  private detectCompactConversation(message: ClaudeMessage): CompactInfo | null {
    try {
      // Add null/undefined checks
      if (!message || !message.content) {
        return null
      }

      // Ensure content is iterable
      const contentArray = Array.isArray(message.content) ? message.content : [message.content]

      // Check all content items in the message
      for (const content of contentArray) {
        let textContent: string | null = null

        if (typeof content === 'string') {
          textContent = content
        } else if (
          content &&
          typeof content === 'object' &&
          content.type === 'text' &&
          typeof content.text === 'string'
        ) {
          textContent = content.text
        }

        if (textContent && textContent.includes(COMPACT_CONVERSATION_PREFIX)) {
          // Extract the summary content after the marker
          const summaryStart = textContent.indexOf(SUMMARY_MARKER)
          if (summaryStart > -1) {
            const summaryContent = this.extractSummaryContent(
              textContent,
              summaryStart + SUMMARY_MARKER.length
            )
            return {
              isCompact: true,
              summaryContent,
            }
          }
        }
      }

      return null
    } catch (error) {
      // Log error and return null to prevent crashes
      console.error('Error in detectCompactConversation:', error)
      return null
    }
  }

  private extractSummaryContent(content: string, startIndex: number): string {
    // Extract the core summary content, removing common suffixes
    let summary = content.substring(startIndex).trim()

    // Remove the "Please continue..." suffix if present
    const suffixIndex = summary.indexOf(SUMMARY_SUFFIX_MARKER)
    if (suffixIndex > -1) {
      summary = summary.substring(0, suffixIndex).trim()
    }

    // Remove trailing punctuation that might differ
    summary = summary.replace(/[.]+$/, '').trim()

    return summary
  }

  private async findCompactParent(
    domain: string,
    summaryContent: string
  ): Promise<ParentRequest | null> {
    try {
      if (!this.compactSearchExecutor) {
        // Without compact search capability, we can't find the parent
        return null
      }

      // Normalize the summary content for comparison
      const normalizedSummary = this.normalizeSummaryForComparison(summaryContent)

      // Search for a request whose response contains the summary
      // Look for requests within the last N days
      const beforeTimestamp = new Date()
      beforeTimestamp.setDate(beforeTimestamp.getDate() - COMPACT_SEARCH_DAYS)

      return await this.compactSearchExecutor(domain, normalizedSummary, beforeTimestamp)
    } catch (error) {
      console.error('Error finding compact parent:', error)
      return null
    }
  }

  private normalizeSummaryForComparison(summary: string): string {
    // Remove common variations in formatting
    return summary
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/<analysis>/g, '')
      .replace(/<\/analysis>/g, '')
      .replace(/<summary>/g, '')
      .replace(/<\/summary>/g, '')
      .replace(/analysis:/gi, '')
      .trim()
  }

  private async findParentByHash(
    domain: string,
    parentMessageHash: string,
    systemHash: string | null,
    excludeRequestId: string
  ): Promise<ParentRequest[]> {
    try {
      const criteria: ParentQueryCriteria = {
        domain,
        currentMessageHash: parentMessageHash,
        systemHash,
        excludeRequestId,
      }

      return await this.queryExecutor(criteria)
    } catch (error) {
      console.error('Error finding parent by hash:', error)
      return []
    }
  }

  private async findChildrenOfParent(
    domain: string,
    parentMessageHash: string,
    excludeRequestId: string
  ): Promise<ParentRequest[]> {
    try {
      const criteria: ParentQueryCriteria = {
        domain,
        parentMessageHash,
        excludeRequestId,
      }

      return await this.queryExecutor(criteria)
    } catch (error) {
      console.error('Error finding children of parent:', error)
      return []
    }
  }

  private selectBestParent(candidates: ParentRequest[]): ParentRequest | null {
    if (candidates.length === 0) {
      return null
    }

    // For now, return the first candidate
    // In the future, we might want to select based on:
    // - Recency
    // - Conversation size
    // - Branch preference
    return candidates[0]
  }

  private isSummarizationRequest(
    systemPrompt?: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[]
  ): boolean {
    if (!systemPrompt) {
      return false
    }

    let systemPromptStr: string
    if (typeof systemPrompt === 'string') {
      systemPromptStr = systemPrompt
    } else if (Array.isArray(systemPrompt)) {
      systemPromptStr = systemPrompt.map(item => item.text).join('\n')
    } else {
      return false
    }

    return systemPromptStr.includes(SUMMARIZATION_SYSTEM_PROMPT)
  }

  private generateBranchId(): string {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    return `${BRANCH_PREFIX}${timestamp}`
  }

  private generateCompactBranchId(): string {
    const now = new Date()
    const hours = now.getHours().toString().padStart(2, '0')
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const seconds = now.getSeconds().toString().padStart(2, '0')
    return `${COMPACT_PREFIX}${hours}${minutes}${seconds}`
  }
}
