import { Pool } from 'pg'
import { StorageWriter } from './writer.js'
import { logger } from '../middleware/logger.js'
import { randomUUID } from 'crypto'

/**
 * Storage adapter that provides a simplified interface for MetricsService
 * Wraps the StorageWriter to handle request/response storage
 */
export class StorageAdapter {
  private writer: StorageWriter
  private requestIdMap: Map<string, string> = new Map() // Map nanoid to UUID

  constructor(pool: Pool) {
    this.writer = new StorageWriter(pool)
  }

  /**
   * Store request data
   */
  async storeRequest(data: {
    id: string
    domain: string
    timestamp: Date
    method: string
    path: string
    headers: Record<string, string>
    body: any
    request_type: string
    model: string
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    usage_data?: any
    tool_call_count?: number
    processing_time?: number
    status_code?: number
    currentMessageHash?: string
    parentMessageHash?: string | null
    conversationId?: string
    branchId?: string
    messageCount?: number
    parentTaskRequestId?: string
    isSubtask?: boolean
    taskToolInvocation?: any
  }): Promise<void> {
    try {
      // Generate a UUID for this request and store the mapping
      const uuid = randomUUID()
      this.requestIdMap.set(data.id, uuid)

      logger.debug('Stored request ID mapping', {
        metadata: {
          claudeId: data.id,
          uuid: uuid,
          mapSize: this.requestIdMap.size,
        },
      })

      await this.writer.storeRequest({
        requestId: uuid,
        domain: data.domain,
        timestamp: data.timestamp,
        method: data.method,
        path: data.path,
        headers: data.headers,
        body: data.body,
        apiKey: '', // Can be extracted from headers if needed
        model: data.model,
        requestType: data.request_type,
        currentMessageHash: data.currentMessageHash,
        parentMessageHash: data.parentMessageHash,
        conversationId: data.conversationId,
        branchId: data.branchId,
        messageCount: data.messageCount,
        parentTaskRequestId: data.parentTaskRequestId,
        isSubtask: data.isSubtask,
        taskToolInvocation: data.taskToolInvocation,
      })
    } catch (error) {
      logger.error('Failed to store request', {
        requestId: data.id,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  /**
   * Store response data
   */
  async storeResponse(data: {
    request_id: string
    status_code: number
    headers: Record<string, string>
    body: any
    timestamp: Date
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    usage_data?: any
    tool_call_count?: number
    processing_time?: number
  }): Promise<void> {
    try {
      // Get the UUID for this request ID
      const uuid = this.requestIdMap.get(data.request_id)
      if (!uuid) {
        logger.warn('No UUID mapping found for request ID', {
          requestId: data.request_id,
        })
        return
      }

      // The writer's storeResponse method will update the existing request
      await this.writer.storeResponse({
        requestId: uuid,
        statusCode: data.status_code,
        headers: data.headers,
        body: data.body,
        streaming: false, // Will be determined from the request
        inputTokens: data.input_tokens, // Use provided values
        outputTokens: data.output_tokens,
        totalTokens: data.total_tokens,
        cacheCreationInputTokens: data.cache_creation_input_tokens,
        cacheReadInputTokens: data.cache_read_input_tokens,
        usageData: data.usage_data,
        firstTokenMs: undefined,
        durationMs: data.processing_time || 0,
        error: undefined,
        toolCallCount: data.tool_call_count,
      })
    } catch (error) {
      logger.error('Failed to store response', {
        requestId: data.request_id,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  /**
   * Store streaming chunk
   */
  async storeStreamingChunk(requestId: string, chunkIndex: number, data: any): Promise<void> {
    try {
      // Get the UUID for this request ID
      const uuid = this.requestIdMap.get(requestId)
      if (!uuid) {
        logger.warn('No UUID mapping found for request ID in storeStreamingChunk', {
          requestId,
        })
        return
      }

      await this.writer.storeStreamingChunk({
        requestId: uuid,
        chunkIndex,
        timestamp: new Date(),
        data: JSON.stringify(data),
        tokenCount: data.usage?.output_tokens,
      })
    } catch (error) {
      logger.error('Failed to store streaming chunk', {
        requestId,
        metadata: {
          chunkIndex,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Find conversation ID by parent message hash
   */
  async findConversationByParentHash(parentHash: string): Promise<string | null> {
    return await this.writer.findConversationByParentHash(parentHash)
  }

  /**
   * Process Task tool invocations in a response
   */
  async processTaskToolInvocations(requestId: string, responseBody: any): Promise<void> {
    const taskInvocations = this.writer.findTaskToolInvocations(responseBody)

    if (taskInvocations.length > 0) {
      logger.info('Found Task tool invocations', {
        requestId,
        metadata: {
          taskCount: taskInvocations.length,
          tasks: taskInvocations.map(t => ({ id: t.id, name: t.name })),
        },
      })

      // Get the UUID for this request
      // First check if requestId is already a UUID
      const uuid = this.isValidUUID(requestId) ? requestId : this.requestIdMap.get(requestId)

      if (!uuid) {
        logger.warn('No UUID mapping found for request when processing task invocations', {
          requestId,
          metadata: {
            mapSize: this.requestIdMap.size,
            isUUID: this.isValidUUID(requestId),
          },
        })
        return
      }

      // Mark the request as having task invocations
      await this.writer.markTaskToolInvocations(uuid, taskInvocations)

      // Task invocations are now tracked in the database
      // Linking will happen when new conversations are stored
    }
  }

  /**
   * Check if a string is a valid UUID
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(str)
  }

  /**
   * Close the storage adapter
   */
  async close(): Promise<void> {
    await this.writer.cleanup()
  }
}
