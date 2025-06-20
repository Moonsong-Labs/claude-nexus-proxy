import { Pool } from 'pg'
import NodeCache from 'node-cache'
import { logger } from '../middleware/logger.js'
import { getErrorMessage } from '@claude-nexus/shared'

interface ApiRequest {
  request_id: string
  domain: string
  timestamp: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  duration_ms: number
  error?: string
  request_type?: string
  tool_call_count: number
  conversation_id?: string
  current_message_hash?: string
  parent_message_hash?: string
  branch_id?: string
  message_count?: number
}

interface RequestDetails {
  request: ApiRequest | null
  request_body: any
  response_body: any
  chunks: StreamingChunk[]
}

interface StreamingChunk {
  chunk_index: number
  timestamp: string
  data: string
  token_count: number
}

interface StorageStats {
  total_requests: number
  total_tokens: number
  total_input_tokens: number
  total_output_tokens: number
  total_tool_calls: number
  avg_response_time_ms: number
  error_count: number
  unique_domains: number
  requests_by_model: Record<string, number>
  requests_by_type: Record<string, number>
}

/**
 * Storage reader service for retrieving data from the database
 * Read-only operations for the dashboard service
 */
export class StorageReader {
  private cache: NodeCache
  private readonly SLOW_QUERY_THRESHOLD_MS: number

  constructor(private pool: Pool) {
    // Cache TTL from environment or default to 30 seconds
    const cacheTTL = parseInt(process.env.DASHBOARD_CACHE_TTL || '30')
    this.cache = new NodeCache({ stdTTL: cacheTTL, checkperiod: Math.max(10, cacheTTL / 3) })

    // Slow query threshold from environment or default to 5 seconds
    this.SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '5000')
  }

  /**
   * Execute a query with performance logging
   */
  private async executeQuery<T>(query: string, params: any[], queryName: string): Promise<T[]> {
    const startTime = Date.now()

    try {
      const result = await this.pool.query(query, params)
      const duration = Date.now() - startTime

      if (duration > this.SLOW_QUERY_THRESHOLD_MS) {
        logger.warn('Slow SQL query detected', {
          metadata: {
            queryName,
            duration_ms: duration,
            query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
            params: params.length > 0 ? `${params.length} params` : 'no params',
            rowCount: result.rowCount,
          },
        })
      }

      return result.rows
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error('SQL query failed', {
        metadata: {
          queryName,
          duration_ms: duration,
          error: getErrorMessage(error),
          query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        },
      })
      throw error
    }
  }

  /**
   * Get requests by domain
   */
  async getRequestsByDomain(domain: string, limit: number = 100): Promise<ApiRequest[]> {
    const cacheKey = `requests:${domain}:${limit}`
    const cacheTTL = parseInt(process.env.DASHBOARD_CACHE_TTL || '30')

    // Only use cache if TTL > 0
    if (cacheTTL > 0) {
      const cached = this.cache.get<ApiRequest[]>(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      const query = domain
        ? `SELECT * FROM api_requests 
           WHERE domain = $1 
           ORDER BY timestamp DESC 
           LIMIT $2`
        : `SELECT * FROM api_requests 
           ORDER BY timestamp DESC 
           LIMIT $1`

      const values = domain ? [domain, limit] : [limit]
      const rows = await this.executeQuery<any>(query, values, 'getRequestsByDomain')

      const requests = rows.map(row => ({
        request_id: row.request_id,
        domain: row.domain,
        timestamp: row.timestamp,
        model: row.model,
        input_tokens: row.input_tokens || 0,
        output_tokens: row.output_tokens || 0,
        total_tokens: row.total_tokens || 0,
        duration_ms: row.duration_ms || 0,
        error: row.error,
        request_type: row.request_type,
        tool_call_count: row.tool_call_count || 0,
        conversation_id: row.conversation_id,
        current_message_hash: row.current_message_hash,
        parent_message_hash: row.parent_message_hash,
        branch_id: row.branch_id,
      }))

      // Only cache if TTL > 0
      if (cacheTTL > 0) {
        this.cache.set(cacheKey, requests)
      }
      return requests
    } catch (error) {
      logger.error('Failed to get requests by domain', {
        domain,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  /**
   * Get request details including body and chunks
   */
  async getRequestDetails(requestId: string): Promise<RequestDetails> {
    const cacheKey = `details:${requestId}`
    const cacheTTL = parseInt(process.env.DASHBOARD_CACHE_TTL || '30')

    // Only use cache if TTL > 0
    if (cacheTTL > 0) {
      const cached = this.cache.get<RequestDetails>(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      // Get request
      const requestQuery = `
        SELECT 
          request_id, domain, timestamp, model, input_tokens, output_tokens,
          total_tokens, duration_ms, error, request_type, tool_call_count,
          conversation_id, body, response_body
        FROM api_requests 
        WHERE request_id = $1
      `
      const requestRows = await this.executeQuery<any>(
        requestQuery,
        [requestId],
        'getRequestDetails-request'
      )

      if (requestRows.length === 0) {
        return { request: null, request_body: null, response_body: null, chunks: [] }
      }

      const row = requestRows[0]
      const request: ApiRequest = {
        request_id: row.request_id,
        domain: row.domain,
        timestamp: row.timestamp,
        model: row.model,
        input_tokens: row.input_tokens || 0,
        output_tokens: row.output_tokens || 0,
        total_tokens: row.total_tokens || 0,
        duration_ms: row.duration_ms || 0,
        error: row.error,
        request_type: row.request_type,
        tool_call_count: row.tool_call_count || 0,
        conversation_id: row.conversation_id,
      }

      // Get streaming chunks
      const chunksQuery = `
        SELECT chunk_index, timestamp, data, token_count
        FROM streaming_chunks 
        WHERE request_id = $1 
        ORDER BY chunk_index
      `
      const chunksRows = await this.executeQuery<any>(
        chunksQuery,
        [requestId],
        'getRequestDetails-chunks'
      )

      const details: RequestDetails = {
        request,
        request_body: row.body,
        response_body: row.response_body,
        chunks: chunksRows,
      }

      // Only cache if TTL > 0
      if (cacheTTL > 0) {
        this.cache.set(cacheKey, details)
      }
      return details
    } catch (error) {
      logger.error('Failed to get request details', {
        requestId,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  /**
   * Get aggregated statistics
   */
  async getStats(domain?: string, since?: Date): Promise<StorageStats> {
    const cacheKey = `stats:${domain || 'all'}:${since?.toISOString() || 'all'}`
    const cacheTTL = parseInt(process.env.DASHBOARD_CACHE_TTL || '30')

    // Only use cache if TTL > 0
    if (cacheTTL > 0) {
      const cached = this.cache.get<StorageStats>(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      const conditions = []
      const values = []
      let paramCount = 0

      if (domain) {
        conditions.push(`domain = $${++paramCount}`)
        values.push(domain)
      }

      if (since) {
        conditions.push(`timestamp > $${++paramCount}`)
        values.push(since)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const query = `
        SELECT
          COUNT(*) as total_requests,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(tool_call_count), 0) as total_tool_calls,
          COALESCE(AVG(duration_ms), 0) as avg_response_time_ms,
          COUNT(*) FILTER (WHERE error IS NOT NULL) as error_count,
          COUNT(DISTINCT domain) as unique_domains
        FROM api_requests
        ${whereClause}
      `

      const statsRows = await this.executeQuery<any>(query, values, 'getStats-base')
      const baseStats = statsRows[0]

      // Get model breakdown
      const modelQuery = `
        SELECT model, COUNT(*) as count
        FROM api_requests
        ${whereClause}
        GROUP BY model
      `
      const modelRows = await this.executeQuery<any>(modelQuery, values, 'getStats-models')
      const requestsByModel = Object.fromEntries(
        modelRows.map(row => [row.model, parseInt(row.count)])
      )

      // Get request type breakdown
      const typeQuery = `
        SELECT request_type, COUNT(*) as count
        FROM api_requests
        ${whereClause}
        AND request_type IS NOT NULL
        GROUP BY request_type
      `
      const typeRows = await this.executeQuery<any>(typeQuery, values, 'getStats-types')
      const requestsByType = Object.fromEntries(
        typeRows.map(row => [row.request_type, parseInt(row.count)])
      )

      const stats: StorageStats = {
        total_requests: parseInt(baseStats.total_requests),
        total_tokens: parseInt(baseStats.total_tokens),
        total_input_tokens: parseInt(baseStats.total_input_tokens),
        total_output_tokens: parseInt(baseStats.total_output_tokens),
        total_tool_calls: parseInt(baseStats.total_tool_calls),
        avg_response_time_ms: parseFloat(baseStats.avg_response_time_ms),
        error_count: parseInt(baseStats.error_count),
        unique_domains: parseInt(baseStats.unique_domains),
        requests_by_model: requestsByModel,
        requests_by_type: requestsByType,
      }

      // Only cache if TTL > 0
      if (cacheTTL > 0) {
        this.cache.set(cacheKey, stats)
      }
      return stats
    } catch (error) {
      logger.error('Failed to get storage stats', {
        domain,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  /**
   * Get conversations grouped by conversation_id
   */
  async getConversations(
    domain?: string,
    limit: number = 50
  ): Promise<
    {
      conversation_id: string
      message_count: number
      first_message: Date
      last_message: Date
      total_tokens: number
      branches: string[]
      requests: ApiRequest[]
    }[]
  > {
    const cacheKey = `conversations:${domain || 'all'}:${limit}`
    const cacheTTL = parseInt(process.env.DASHBOARD_CACHE_TTL || '30')

    // Only use cache if TTL > 0
    if (cacheTTL > 0) {
      const cached = this.cache.get<any[]>(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      // First get unique conversations with branch information
      const conversationQuery = domain
        ? `SELECT 
             conversation_id,
             COUNT(*) as request_count,
             MAX(message_count) as message_count,
             MIN(timestamp) as first_message,
             MAX(timestamp) as last_message,
             SUM(total_tokens) as total_tokens,
             array_agg(DISTINCT branch_id) FILTER (WHERE branch_id IS NOT NULL) as branches
           FROM api_requests
           WHERE domain = $1 AND conversation_id IS NOT NULL
           GROUP BY conversation_id
           ORDER BY MAX(timestamp) DESC
           LIMIT $2`
        : `SELECT 
             conversation_id,
             COUNT(*) as request_count,
             MAX(message_count) as message_count,
             MIN(timestamp) as first_message,
             MAX(timestamp) as last_message,
             SUM(total_tokens) as total_tokens,
             array_agg(DISTINCT branch_id) FILTER (WHERE branch_id IS NOT NULL) as branches
           FROM api_requests
           WHERE conversation_id IS NOT NULL
           GROUP BY conversation_id
           ORDER BY MAX(timestamp) DESC
           LIMIT $1`

      const conversationValues = domain ? [domain, limit] : [limit]
      const conversationRows = await this.executeQuery<any>(
        conversationQuery,
        conversationValues,
        'getConversations-conversations'
      )

      // Now get all requests for these conversations
      const conversationIds = conversationRows.map(row => row.conversation_id)
      if (conversationIds.length === 0) {
        return []
      }

      const requestsQuery = domain
        ? `SELECT 
             request_id, domain, timestamp, model, 
             input_tokens, output_tokens, total_tokens, duration_ms,
             error, request_type, tool_call_count, conversation_id,
             current_message_hash, parent_message_hash, branch_id, message_count
           FROM api_requests 
           WHERE domain = $1 AND conversation_id = ANY($2::uuid[])
           ORDER BY conversation_id, timestamp ASC`
        : `SELECT 
             request_id, domain, timestamp, model, 
             input_tokens, output_tokens, total_tokens, duration_ms,
             error, request_type, tool_call_count, conversation_id,
             current_message_hash, parent_message_hash, branch_id, message_count
           FROM api_requests 
           WHERE conversation_id = ANY($1::uuid[])
           ORDER BY conversation_id, timestamp ASC`

      const requestsValues = domain ? [domain, conversationIds] : [conversationIds]
      const requestsRows = await this.executeQuery<any>(
        requestsQuery,
        requestsValues,
        'getConversations-requests'
      )

      // Group requests by conversation
      const requestsByConversation: Record<string, ApiRequest[]> = {}
      requestsRows.forEach(row => {
        const request: ApiRequest = {
          request_id: row.request_id,
          domain: row.domain,
          timestamp: row.timestamp,
          model: row.model,
          input_tokens: row.input_tokens || 0,
          output_tokens: row.output_tokens || 0,
          total_tokens: row.total_tokens || 0,
          duration_ms: row.duration_ms || 0,
          error: row.error,
          request_type: row.request_type,
          tool_call_count: row.tool_call_count || 0,
          conversation_id: row.conversation_id,
          current_message_hash: row.current_message_hash,
          parent_message_hash: row.parent_message_hash,
          branch_id: row.branch_id,
          message_count: row.message_count || 0,
        }

        if (!requestsByConversation[row.conversation_id]) {
          requestsByConversation[row.conversation_id] = []
        }
        requestsByConversation[row.conversation_id].push(request)
      })

      // Combine conversation metadata with requests
      const conversations = conversationRows.map(row => ({
        conversation_id: row.conversation_id,
        message_count: parseInt(row.message_count),
        first_message: new Date(row.first_message),
        last_message: new Date(row.last_message),
        total_tokens: parseInt(row.total_tokens),
        branches: row.branches || [],
        requests: requestsByConversation[row.conversation_id] || [],
      }))

      // Only cache if TTL > 0
      if (cacheTTL > 0) {
        this.cache.set(cacheKey, conversations)
      }
      return conversations
    } catch (error) {
      logger.error('Failed to get conversations', {
        domain,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  /**
   * Get conversation summaries without fetching all requests
   * More efficient for displaying conversation lists
   */
  async getConversationSummaries(domain?: string, limit: number = 100): Promise<any[]> {
    const cacheKey = `conversation-summaries:${domain || 'all'}:${limit}`
    const cacheTTL = parseInt(process.env.DASHBOARD_CACHE_TTL || '30')

    // Only use cache if TTL > 0
    if (cacheTTL > 0) {
      const cached = this.cache.get<any[]>(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      // Get conversation summaries with branch information
      const query = domain
        ? `WITH conversation_summary AS (
             SELECT 
               conversation_id,
               domain,
               MIN(timestamp) as started_at,
               MAX(timestamp) as last_message_at,
               COUNT(*) as request_count,
               MAX(message_count) as total_messages,
               SUM(total_tokens) as total_tokens,
               COUNT(DISTINCT branch_id) as branch_count,
               array_agg(DISTINCT model) as models_used
             FROM api_requests
             WHERE domain = $1 AND conversation_id IS NOT NULL
             GROUP BY conversation_id, domain
           ),
           conversation_branches AS (
             SELECT 
               conversation_id,
               jsonb_agg(
                 jsonb_build_object(
                   'branch_id', branch_id,
                   'message_count', message_count,
                   'branch_tokens', branch_tokens,
                   'branch_start', branch_start,
                   'branch_end', branch_end,
                   'latest_request_id', latest_request_id
                 ) ORDER BY branch_start
               ) as branches
             FROM (
               SELECT 
                 conversation_id,
                 branch_id,
                 MIN(timestamp) as branch_start,
                 MAX(timestamp) as branch_end,
                 MAX(message_count) as message_count,
                 SUM(total_tokens) as branch_tokens,
                 (SELECT request_id FROM api_requests r2 
                  WHERE r2.conversation_id = api_requests.conversation_id 
                  AND r2.branch_id = api_requests.branch_id 
                  ORDER BY r2.timestamp DESC LIMIT 1) as latest_request_id
               FROM api_requests
               WHERE domain = $1 AND conversation_id IS NOT NULL
               GROUP BY conversation_id, branch_id
             ) b
             GROUP BY conversation_id
           )
           SELECT 
             cs.*,
             cb.branches
           FROM conversation_summary cs
           LEFT JOIN conversation_branches cb ON cs.conversation_id = cb.conversation_id
           ORDER BY cs.last_message_at DESC
           LIMIT $2`
        : `WITH conversation_summary AS (
             SELECT 
               conversation_id,
               domain,
               MIN(timestamp) as started_at,
               MAX(timestamp) as last_message_at,
               COUNT(*) as request_count,
               MAX(message_count) as total_messages,
               SUM(total_tokens) as total_tokens,
               COUNT(DISTINCT branch_id) as branch_count,
               array_agg(DISTINCT model) as models_used
             FROM api_requests
             WHERE conversation_id IS NOT NULL
             GROUP BY conversation_id, domain
           ),
           conversation_branches AS (
             SELECT 
               conversation_id,
               jsonb_agg(
                 jsonb_build_object(
                   'branch_id', branch_id,
                   'message_count', message_count,
                   'branch_tokens', branch_tokens,
                   'branch_start', branch_start,
                   'branch_end', branch_end,
                   'latest_request_id', latest_request_id
                 ) ORDER BY branch_start
               ) as branches
             FROM (
               SELECT 
                 conversation_id,
                 branch_id,
                 MIN(timestamp) as branch_start,
                 MAX(timestamp) as branch_end,
                 MAX(message_count) as message_count,
                 SUM(total_tokens) as branch_tokens,
                 (SELECT request_id FROM api_requests r2 
                  WHERE r2.conversation_id = api_requests.conversation_id 
                  AND r2.branch_id = api_requests.branch_id 
                  ORDER BY r2.timestamp DESC LIMIT 1) as latest_request_id
               FROM api_requests
               WHERE conversation_id IS NOT NULL
               GROUP BY conversation_id, branch_id
             ) b
             GROUP BY conversation_id
           )
           SELECT 
             cs.*,
             cb.branches
           FROM conversation_summary cs
           LEFT JOIN conversation_branches cb ON cs.conversation_id = cb.conversation_id
           ORDER BY cs.last_message_at DESC
           LIMIT $1`

      const values = domain ? [domain, limit] : [limit]
      const rows = await this.executeQuery<any>(query, values, 'getConversationSummaries')

      // Only cache if TTL > 0
      if (cacheTTL > 0) {
        this.cache.set(cacheKey, rows)
      }
      return rows
    } catch (error) {
      logger.error('Failed to get conversation summaries', {
        domain,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.flushAll()
  }
}
