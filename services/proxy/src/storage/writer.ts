import { Pool } from 'pg'
import { createHash } from 'crypto'
import { logger } from '../middleware/logger.js'

interface StorageRequest {
  requestId: string
  domain: string
  timestamp: Date
  method: string
  path: string
  headers: Record<string, string>
  body: any
  apiKey: string
  model: string
  requestType?: string
  currentMessageHash?: string
  parentMessageHash?: string | null
  conversationId?: string
  branchId?: string
  messageCount?: number
  parentTaskRequestId?: string
  isSubtask?: boolean
  taskToolInvocation?: any
}

interface StorageResponse {
  requestId: string
  statusCode: number
  headers: Record<string, string>
  body?: any
  streaming: boolean
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  usageData?: any
  firstTokenMs?: number
  durationMs: number
  error?: string
  toolCallCount?: number
}

interface StreamingChunk {
  requestId: string
  chunkIndex: number
  timestamp: Date
  data: string
  tokenCount?: number
}

/**
 * Storage writer service for persisting requests to the database
 * Write-only operations for the proxy service
 */
export class StorageWriter {
  private batchQueue: any[] = []
  private batchTimer?: NodeJS.Timeout
  private readonly BATCH_SIZE = 100
  private readonly BATCH_INTERVAL = 1000 // 1 second

  constructor(private pool: Pool) {
    this.startBatchProcessor()
  }

  /**
   * Store a request (write-only)
   */
  async storeRequest(request: StorageRequest): Promise<void> {
    try {
      // Mask sensitive headers instead of removing them
      const sanitizedHeaders = this.maskSensitiveHeaders(request.headers)

      // Check if this is a new conversation that matches a recent Task invocation
      let parentTaskRequestId = request.parentTaskRequestId
      let isSubtask = request.isSubtask || false

      // Check if this conversation is already marked as a sub-task
      if (request.conversationId && request.parentMessageHash) {
        // This is a continuation of an existing conversation
        const existingConv = await this.pool.query(
          'SELECT parent_task_request_id, is_subtask FROM api_requests WHERE conversation_id = $1 AND is_subtask = true LIMIT 1',
          [request.conversationId]
        )
        if (existingConv.rows.length > 0 && existingConv.rows[0].is_subtask) {
          parentTaskRequestId = existingConv.rows[0].parent_task_request_id
          isSubtask = true
          logger.debug('Continuing sub-task conversation', {
            metadata: {
              requestId: request.requestId,
              conversationId: request.conversationId,
              parentTaskRequestId,
            },
          })
        }
      } else if (!request.parentMessageHash && request.body?.messages?.length > 0) {
        // Only check for sub-task matching if this is the first message in a conversation
        const firstMessage = request.body.messages[0]
        if (firstMessage?.role === 'user') {
          const userContent = this.extractUserMessageContent(firstMessage)
          logger.debug('Extracted user content for sub-task matching', {
            metadata: {
              requestId: request.requestId,
              hasContent: !!userContent,
              contentLength: userContent?.length || 0,
              contentPreview: userContent?.substring(0, 100),
            },
          })
          if (userContent) {
            const match = await this.findMatchingTaskInvocation(userContent, request.timestamp)
            if (match) {
              parentTaskRequestId = match.request_id
              isSubtask = true
              logger.info('Found matching Task invocation for new conversation', {
                requestId: request.requestId,
                metadata: {
                  parentTaskRequestId: match.request_id,
                  contentLength: userContent.length,
                  timeGapSeconds: Math.round(
                    (request.timestamp.getTime() - new Date(match.timestamp).getTime()) / 1000
                  ),
                },
              })
            }
          }
        }
      }

      // Detect if this is a branch in the conversation
      let branchId = request.branchId || 'main'
      if (request.conversationId && request.parentMessageHash) {
        const detectedBranch = await this.detectBranch(
          request.conversationId,
          request.parentMessageHash
        )
        if (detectedBranch) {
          branchId = detectedBranch
        }
      }

      const query = `
        INSERT INTO api_requests (
          request_id, domain, timestamp, method, path, headers, body, 
          api_key_hash, model, request_type, current_message_hash, 
          parent_message_hash, conversation_id, branch_id, message_count,
          parent_task_request_id, is_subtask, task_tool_invocation
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (request_id) DO NOTHING
      `

      const values = [
        request.requestId,
        request.domain,
        request.timestamp,
        request.method,
        request.path,
        JSON.stringify(sanitizedHeaders),
        JSON.stringify(request.body),
        this.hashApiKey(request.apiKey),
        request.model,
        request.requestType,
        request.currentMessageHash || null,
        request.parentMessageHash || null,
        request.conversationId || null,
        branchId,
        request.messageCount || 0,
        parentTaskRequestId || null,
        isSubtask,
        request.taskToolInvocation ? JSON.stringify(request.taskToolInvocation) : null,
      ]

      await this.pool.query(query, values)
    } catch (error) {
      logger.error('Failed to store request', {
        requestId: request.requestId,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Store a response (write-only)
   */
  async storeResponse(response: StorageResponse): Promise<void> {
    try {
      const query = `
        UPDATE api_requests SET
          response_status = $2,
          response_headers = $3,
          response_body = $4,
          response_streaming = $5,
          input_tokens = $6,
          output_tokens = $7,
          total_tokens = $8,
          first_token_ms = $9,
          duration_ms = $10,
          error = $11,
          tool_call_count = $12,
          cache_creation_input_tokens = $13,
          cache_read_input_tokens = $14,
          usage_data = $15
        WHERE request_id = $1
      `

      const values = [
        response.requestId,
        response.statusCode,
        JSON.stringify(response.headers),
        response.body ? JSON.stringify(response.body) : null,
        response.streaming,
        response.inputTokens || 0,
        response.outputTokens || 0,
        response.totalTokens || 0,
        response.firstTokenMs,
        response.durationMs,
        response.error,
        response.toolCallCount || 0,
        response.cacheCreationInputTokens || 0,
        response.cacheReadInputTokens || 0,
        response.usageData ? JSON.stringify(response.usageData) : null,
      ]

      await this.pool.query(query, values)
    } catch (error) {
      logger.error('Failed to store response', {
        requestId: response.requestId,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Store streaming chunks (batch operation)
   */
  async storeStreamingChunk(chunk: StreamingChunk): Promise<void> {
    this.batchQueue.push(chunk)

    if (this.batchQueue.length >= this.BATCH_SIZE) {
      await this.flushBatch()
    }
  }

  /**
   * Start batch processor for streaming chunks
   */
  private startBatchProcessor(): void {
    this.batchTimer = setInterval(async () => {
      if (this.batchQueue.length > 0) {
        await this.flushBatch()
      }
    }, this.BATCH_INTERVAL)
  }

  /**
   * Flush batch of streaming chunks
   */
  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) {
      return
    }

    const chunks = [...this.batchQueue]
    this.batchQueue = []

    try {
      const values = chunks.map(chunk => [
        chunk.requestId,
        chunk.chunkIndex,
        chunk.timestamp,
        chunk.data,
        chunk.tokenCount || 0,
      ])

      // Use COPY for bulk insert
      const query = `
        INSERT INTO streaming_chunks (
          request_id, chunk_index, timestamp, data, token_count
        ) VALUES ${values
          .map(
            (_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
          )
          .join(', ')}
        ON CONFLICT DO NOTHING
      `

      await this.pool.query(query, values.flat())
    } catch (error) {
      logger.error('Failed to store streaming chunks batch', {
        metadata: {
          count: chunks.length,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Find conversation ID by parent message hash
   * When multiple conversations have the same parent hash, pick the one with fewer requests
   */
  async findConversationByParentHash(parentHash: string): Promise<string | null> {
    try {
      // First, find all conversations that have this parent hash
      const query = `
        WITH conversation_counts AS (
          SELECT 
            r.conversation_id,
            COUNT(*) as request_count
          FROM api_requests r
          WHERE r.conversation_id IN (
            SELECT DISTINCT conversation_id 
            FROM api_requests 
            WHERE current_message_hash = $1 
            AND conversation_id IS NOT NULL
          )
          GROUP BY r.conversation_id
        )
        SELECT 
          ar.conversation_id
        FROM api_requests ar
        JOIN conversation_counts cc ON ar.conversation_id = cc.conversation_id
        WHERE ar.current_message_hash = $1 
        AND ar.conversation_id IS NOT NULL
        ORDER BY cc.request_count ASC, ar.timestamp DESC
        LIMIT 1
      `

      const result = await this.pool.query(query, [parentHash])

      // Log if we're choosing between multiple conversations
      if (result.rows.length > 0) {
        // Check how many conversations actually have this parent hash
        const countResult = await this.pool.query(
          `SELECT COUNT(DISTINCT conversation_id) as count 
           FROM api_requests 
           WHERE current_message_hash = $1 
           AND conversation_id IS NOT NULL`,
          [parentHash]
        )

        if (countResult.rows[0].count > 1) {
          logger.info(
            'Multiple conversations found with same parent hash, selecting the one with fewer requests',
            {
              metadata: {
                parentHash,
                conversationCount: countResult.rows[0].count,
                selectedConversation: result.rows[0].conversation_id,
              },
            }
          )
        }
      }

      return result.rows[0]?.conversation_id || null
    } catch (error) {
      logger.error('Failed to find conversation by parent hash', {
        metadata: {
          parentHash,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      return null
    }
  }

  /**
   * Detect if this is a branch in an existing conversation
   * Returns the branch ID if this is a new branch, null otherwise
   */
  private async detectBranch(
    conversationId: string,
    parentMessageHash: string
  ): Promise<string | null> {
    try {
      // First, find the parent message to get its branch
      const parentResult = await this.pool.query(
        `SELECT branch_id, current_message_hash
         FROM api_requests 
         WHERE conversation_id = $1 
         AND current_message_hash = $2
         LIMIT 1`,
        [conversationId, parentMessageHash]
      )

      const parentBranch = parentResult.rows[0]?.branch_id || 'main'

      // Now check if there's already a child of this parent in the conversation
      const childrenResult = await this.pool.query(
        `SELECT COUNT(*) as count, array_agg(DISTINCT branch_id) as existing_branches
         FROM api_requests 
         WHERE conversation_id = $1 
         AND parent_message_hash = $2`,
        [conversationId, parentMessageHash]
      )

      const { count, existing_branches } = childrenResult.rows[0]

      // If there's already a message with this parent, we're creating a new branch
      if (parseInt(count) > 0) {
        logger.info('Creating new branch - parent already has children', {
          metadata: {
            conversationId,
            parentMessageHash,
            parentBranch,
            existingBranches: existing_branches,
            childCount: count,
          },
        })
        // Generate new branch ID based on current timestamp
        return `branch_${Date.now()}`
      }

      // If this is the first message with this parent, continue on the parent's branch
      logger.info('Continuing on parent branch', {
        metadata: {
          conversationId,
          parentMessageHash,
          parentBranch,
        },
      })
      return parentBranch
    } catch (error) {
      logger.error('Error detecting branch', {
        metadata: {
          conversationId,
          parentMessageHash,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      return 'main'
    }
  }

  /**
   * Hash API key for storage
   */
  private hashApiKey(apiKey: string): string {
    if (!apiKey) {
      return ''
    }
    // Use SHA-256 with a salt for secure hashing
    const salt = process.env.API_KEY_SALT || 'claude-nexus-proxy-default-salt'
    return createHash('sha256')
      .update(apiKey + salt)
      .digest('hex')
  }

  /**
   * Mask sensitive headers
   */
  private maskSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
    const masked = { ...headers }
    const sensitiveHeaders = ['authorization', 'x-api-key']

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveHeaders.includes(lowerKey) && typeof value === 'string') {
        if (value.length > 6) {
          // Show only last 6 characters
          masked[key] = '*'.repeat(Math.max(0, value.length - 6)) + value.slice(-6)
        } else {
          // For short values, mask entirely
          masked[key] = '***'
        }
      }
    }

    return masked
  }

  /**
   * Find Task tool invocations in a response
   */
  findTaskToolInvocations(responseBody: any): Array<{ id: string; name: string; input: any }> {
    const taskInvocations: Array<{ id: string; name: string; input: any }> = []

    if (!responseBody || !responseBody.content || !Array.isArray(responseBody.content)) {
      return taskInvocations
    }

    for (const content of responseBody.content) {
      if (content.type === 'tool_use' && content.name === 'Task') {
        taskInvocations.push({
          id: content.id,
          name: content.name,
          input: content.input,
        })
      }
    }

    return taskInvocations
  }

  /**
   * Mark requests that have Task tool invocations
   */
  async markTaskToolInvocations(requestId: string, taskInvocations: any[]): Promise<void> {
    if (taskInvocations.length === 0) {
      return
    }

    try {
      // Store task invocations in a separate tracking table or update the request
      const query = `
        UPDATE api_requests 
        SET task_tool_invocation = $2
        WHERE request_id = $1
      `

      await this.pool.query(query, [requestId, JSON.stringify(taskInvocations)])

      logger.info('Marked request with Task tool invocations', {
        requestId,
        metadata: {
          taskCount: taskInvocations.length,
        },
      })
    } catch (error) {
      logger.error('Failed to mark task tool invocations', {
        requestId,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  /**
   * Extract user message content from various message formats
   */
  private extractUserMessageContent(message: any): string | null {
    if (!message || message.role !== 'user') {
      return null
    }

    // Handle string content
    if (typeof message.content === 'string') {
      return message.content
    }

    // Handle array content
    if (Array.isArray(message.content)) {
      // Look for text content in the array, skipping system reminders
      for (const item of message.content) {
        if (item.type === 'text' && item.text) {
          // Skip system reminder messages
          if (item.text.includes('<system-reminder>')) {
            continue
          }
          return item.text
        }
      }

      // If all text items were system reminders, return the first text item
      for (const item of message.content) {
        if (item.type === 'text' && item.text) {
          return item.text
        }
      }
    }

    return null
  }

  /**
   * Find a matching Task invocation in the last 60 seconds
   */
  private async findMatchingTaskInvocation(
    userContent: string,
    timestamp: Date
  ): Promise<{ request_id: string; timestamp: Date } | null> {
    try {
      logger.debug('Looking for matching Task invocation', {
        metadata: {
          contentLength: userContent.length,
          contentPreview: userContent.substring(0, 100),
          timestamp: timestamp.toISOString(),
        },
      })

      // Look for Task invocations in the last 60 seconds
      const query = `
        SELECT request_id, timestamp
        FROM api_requests
        WHERE task_tool_invocation IS NOT NULL
        AND timestamp >= $1::timestamp - interval '60 seconds'
        AND timestamp <= $1::timestamp
        AND jsonb_path_exists(
          task_tool_invocation,
          '$[*] ? (@.input.prompt == $prompt || @.input.description == $prompt)',
          jsonb_build_object('prompt', $2::text)
        )
        ORDER BY timestamp DESC
        LIMIT 1
      `

      const result = await this.pool.query(query, [timestamp.toISOString(), userContent])

      if (result.rows.length > 0) {
        logger.debug('Found matching Task invocation', {
          metadata: {
            parentRequestId: result.rows[0].request_id,
            parentTimestamp: result.rows[0].timestamp,
            timeDiffSeconds: Math.round(
              (timestamp.getTime() - new Date(result.rows[0].timestamp).getTime()) / 1000
            ),
          },
        })
        return result.rows[0]
      }

      logger.debug('No matching Task invocation found', {
        metadata: {
          searchWindow: '60 seconds',
        },
      })

      return null
    } catch (error) {
      logger.error('Failed to find matching task invocation', {
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          query: error instanceof Error && 'message' in error ? error.message : undefined,
        },
      })
      return null
    }
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
    }
    await this.flushBatch()
  }
}

/**
 * Initialize database schema
 */
export async function initializeDatabase(pool: Pool): Promise<void> {
  try {
    // Check if tables exist
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'api_requests'
      )
    `)

    if (!result.rows[0].exists) {
      logger.info('Database tables not found, creating schema...')

      // Create tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_requests (
          request_id UUID PRIMARY KEY,
          domain VARCHAR(255) NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          method VARCHAR(10) NOT NULL,
          path VARCHAR(255) NOT NULL,
          headers JSONB,
          body JSONB,
          api_key_hash VARCHAR(50),
          model VARCHAR(100),
          request_type VARCHAR(50),
          response_status INTEGER,
          response_headers JSONB,
          response_body JSONB,
          response_streaming BOOLEAN DEFAULT false,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          cache_creation_input_tokens INTEGER DEFAULT 0,
          cache_read_input_tokens INTEGER DEFAULT 0,
          usage_data JSONB,
          first_token_ms INTEGER,
          duration_ms INTEGER,
          error TEXT,
          tool_call_count INTEGER DEFAULT 0,
          current_message_hash CHAR(64),
          parent_message_hash CHAR(64),
          conversation_id UUID,
          branch_id VARCHAR(255) DEFAULT 'main',
          message_count INTEGER DEFAULT 0,
          parent_task_request_id UUID REFERENCES api_requests(request_id),
          is_subtask BOOLEAN DEFAULT false,
          task_tool_invocation JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `)

      await pool.query(`
        CREATE TABLE IF NOT EXISTS streaming_chunks (
          id SERIAL PRIMARY KEY,
          request_id UUID NOT NULL,
          chunk_index INTEGER NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          data TEXT NOT NULL,
          token_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          FOREIGN KEY (request_id) REFERENCES api_requests(request_id) ON DELETE CASCADE,
          UNIQUE(request_id, chunk_index)
        )
      `)

      // Create indexes
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_api_requests_domain_timestamp 
        ON api_requests(domain, timestamp DESC)
      `)

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_api_requests_timestamp 
        ON api_requests(timestamp DESC)
      `)

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_streaming_chunks_request_id 
        ON streaming_chunks(request_id, chunk_index)
      `)

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_requests_current_message_hash 
        ON api_requests(current_message_hash)
      `)

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_requests_parent_message_hash 
        ON api_requests(parent_message_hash)
      `)

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_requests_conversation_id 
        ON api_requests(conversation_id)
      `)

      logger.info('Database schema created successfully')
    }
  } catch (error) {
    logger.error('Failed to initialize database', {
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }
}
