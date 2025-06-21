import { Hono } from 'hono'
import { z } from 'zod'
import { Pool } from 'pg'
import { logger } from '../middleware/logger.js'
import { getErrorMessage, getErrorStack } from '@claude-nexus/shared'

// Query parameter schemas
const statsQuerySchema = z.object({
  domain: z.string().optional(),
  since: z.string().datetime().optional(),
})

const requestsQuerySchema = z.object({
  domain: z.string().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).default('100'),
  offset: z.string().regex(/^\d+$/).transform(Number).default('0'),
})

// Response types
interface StatsResponse {
  totalRequests: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  averageResponseTime: number
  errorCount: number
  activeDomains: number
  requestsByModel: Record<string, number>
  requestsByType: Record<string, number>
}

interface RequestSummary {
  requestId: string
  domain: string
  model: string
  timestamp: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  responseStatus: number
  error?: string
  requestType?: string
}

interface RequestDetails extends RequestSummary {
  requestBody: any
  responseBody: any
  usageData?: any
  streamingChunks: Array<{
    chunkIndex: number
    timestamp: string
    data: string
    tokenCount: number
  }>
}

export const apiRoutes = new Hono<{
  Variables: {
    pool?: Pool
  }
}>()

/**
 * GET /api/stats - Get aggregated statistics
 */
apiRoutes.get('/stats', async c => {
  let pool = c.get('pool')

  // Fallback: try to get pool from container if not in context
  if (!pool) {
    const { container } = await import('../container.js')
    pool = container.getDbPool()

    if (!pool) {
      logger.warn('API stats requested but pool is not available', {
        metadata: {
          hasPool: !!pool,
          poolType: typeof pool,
          path: c.req.path,
        },
      })
      return c.json({ error: 'Database not configured' }, 503)
    }
  }

  try {
    const query = c.req.query()
    const params = statsQuerySchema.parse(query)

    const conditions = []
    const values = []
    let paramCount = 0

    if (params.domain) {
      conditions.push(`domain = $${++paramCount}`)
      values.push(params.domain)
    }

    if (params.since) {
      conditions.push(`timestamp > $${++paramCount}`)
      values.push(params.since)
    } else {
      // Default to last 24 hours
      conditions.push(`timestamp > NOW() - INTERVAL '24 hours'`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get base statistics
    const statsQuery = `
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) as total_tokens,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_creation_input_tokens), 0) as total_cache_creation_tokens,
        COALESCE(SUM(cache_read_input_tokens), 0) as total_cache_read_tokens,
        COALESCE(AVG(duration_ms), 0) as avg_response_time,
        COUNT(*) FILTER (WHERE error IS NOT NULL) as error_count,
        COUNT(DISTINCT domain) as active_domains
      FROM api_requests
      ${whereClause}
    `

    const statsResult = await pool.query(statsQuery, values)
    const stats = statsResult.rows[0]

    // Get model breakdown
    const modelQuery = `
      SELECT model, COUNT(*) as count
      FROM api_requests
      ${whereClause}
      GROUP BY model
      ORDER BY count DESC
    `
    const modelResult = await pool.query(modelQuery, values)
    const requestsByModel = Object.fromEntries(
      modelResult.rows.map(row => [row.model, parseInt(row.count)])
    )

    // Get request type breakdown
    const typeQuery = `
      SELECT request_type, COUNT(*) as count
      FROM api_requests
      ${whereClause}
      AND request_type IS NOT NULL
      GROUP BY request_type
      ORDER BY count DESC
    `
    const typeResult = await pool.query(typeQuery, values)
    const requestsByType = Object.fromEntries(
      typeResult.rows.map(row => [row.request_type, parseInt(row.count)])
    )

    const response: StatsResponse = {
      totalRequests: parseInt(stats.total_requests) || 0,
      totalTokens: parseInt(stats.total_tokens) || 0,
      totalInputTokens: parseInt(stats.total_input_tokens) || 0,
      totalOutputTokens: parseInt(stats.total_output_tokens) || 0,
      totalCacheCreationTokens: parseInt(stats.total_cache_creation_tokens) || 0,
      totalCacheReadTokens: parseInt(stats.total_cache_read_tokens) || 0,
      averageResponseTime: parseFloat(stats.avg_response_time) || 0,
      errorCount: parseInt(stats.error_count) || 0,
      activeDomains: parseInt(stats.active_domains) || 0,
      requestsByModel,
      requestsByType,
    }

    return c.json(response)
  } catch (error) {
    logger.error('Failed to get stats', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to retrieve statistics' }, 500)
  }
})

/**
 * GET /api/requests - Get recent requests
 */
apiRoutes.get('/requests', async c => {
  let pool = c.get('pool')

  // Fallback: try to get pool from container if not in context
  if (!pool) {
    const { container } = await import('../container.js')
    pool = container.getDbPool()

    if (!pool) {
      return c.json({ error: 'Database not configured' }, 503)
    }
  }

  try {
    const query = c.req.query()
    const params = requestsQuerySchema.parse(query)

    const conditions = []
    const values = []
    let paramCount = 0

    if (params.domain) {
      conditions.push(`domain = $${++paramCount}`)
      values.push(params.domain)
    }

    // Add limit and offset
    values.push(params.limit)
    values.push(params.offset)

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const requestsQuery = `
      SELECT 
        request_id,
        domain,
        model,
        timestamp,
        COALESCE(input_tokens, 0) as input_tokens,
        COALESCE(output_tokens, 0) as output_tokens,
        COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) as total_tokens,
        COALESCE(duration_ms, 0) as duration_ms,
        COALESCE(response_status, 0) as response_status,
        error,
        request_type
      FROM api_requests
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `

    const result = await pool.query(requestsQuery, values)

    const requests: RequestSummary[] = result.rows.map(row => ({
      requestId: row.request_id,
      domain: row.domain,
      model: row.model,
      timestamp: row.timestamp,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      durationMs: row.duration_ms,
      responseStatus: row.response_status,
      error: row.error,
      requestType: row.request_type,
    }))

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM api_requests
      ${whereClause}
    `
    const countResult = await pool.query(countQuery, values.slice(0, -2)) // Exclude limit/offset
    const totalCount = parseInt(countResult.rows[0].total) || 0

    return c.json({
      requests,
      pagination: {
        total: totalCount,
        limit: params.limit,
        offset: params.offset,
        hasMore: params.offset + params.limit < totalCount,
      },
    })
  } catch (error) {
    logger.error('Failed to get requests', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to retrieve requests' }, 500)
  }
})

/**
 * GET /api/requests/:id - Get request details
 */
apiRoutes.get('/requests/:id', async c => {
  let pool = c.get('pool')

  // Fallback: try to get pool from container if not in context
  if (!pool) {
    const { container } = await import('../container.js')
    pool = container.getDbPool()

    if (!pool) {
      return c.json({ error: 'Database not configured' }, 503)
    }
  }

  const requestId = c.req.param('id')

  try {
    // Get request details
    const requestQuery = `
      SELECT 
        request_id,
        domain,
        model,
        timestamp,
        COALESCE(input_tokens, 0) as input_tokens,
        COALESCE(output_tokens, 0) as output_tokens,
        COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) as total_tokens,
        COALESCE(duration_ms, 0) as duration_ms,
        COALESCE(response_status, 0) as response_status,
        error,
        request_type,
        body as request_body,
        response_body,
        usage_data
      FROM api_requests 
      WHERE request_id = $1
    `
    const requestResult = await pool.query(requestQuery, [requestId])

    if (requestResult.rows.length === 0) {
      return c.json({ error: 'Request not found' }, 404)
    }

    const row = requestResult.rows[0]

    // Get streaming chunks if any
    const chunksQuery = `
      SELECT chunk_index, timestamp, data
      FROM streaming_chunks 
      WHERE request_id = $1 
      ORDER BY chunk_index
    `
    const chunksResult = await pool.query(chunksQuery, [requestId])

    const details: RequestDetails = {
      requestId: row.request_id,
      domain: row.domain,
      model: row.model,
      timestamp: row.timestamp,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      durationMs: row.duration_ms,
      responseStatus: row.response_status,
      error: row.error,
      requestType: row.request_type,
      requestBody: row.request_body,
      responseBody: row.response_body,
      usageData: row.usage_data,
      streamingChunks: chunksResult.rows.map(chunk => ({
        chunkIndex: chunk.chunk_index,
        timestamp: chunk.timestamp,
        data: chunk.data,
        tokenCount: 0, // token_count not in schema
      })),
    }

    return c.json(details)
  } catch (error) {
    logger.error('Failed to get request details', {
      error: getErrorMessage(error),
      stack: getErrorStack(error),
      requestId,
    })
    return c.json(
      {
        error: 'Failed to retrieve request details',
        details: getErrorMessage(error),
      },
      500
    )
  }
})

/**
 * GET /api/domains - Get list of active domains
 */
apiRoutes.get('/domains', async c => {
  let pool = c.get('pool')

  // Fallback: try to get pool from container if not in context
  if (!pool) {
    const { container } = await import('../container.js')
    pool = container.getDbPool()

    if (!pool) {
      // Return empty domains list when database is not configured
      logger.debug('Domains API called but database not configured')
      return c.json({ domains: [] })
    }
  }

  try {
    const query = `
      SELECT DISTINCT domain, COUNT(*) as request_count
      FROM api_requests
      WHERE timestamp > NOW() - INTERVAL '7 days'
      GROUP BY domain
      ORDER BY request_count DESC
    `

    const result = await pool.query(query)
    const domains = result.rows.map(row => ({
      domain: row.domain,
      requestCount: parseInt(row.request_count),
    }))

    return c.json({ domains })
  } catch (error) {
    logger.error('Failed to get domains', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to retrieve domains' }, 500)
  }
})

/**
 * GET /api/token-usage/current - Get current window token usage
 */
apiRoutes.get('/token-usage/current', async c => {
  const { container } = await import('../container.js')
  const tokenUsageService = container.getTokenUsageService()
  
  if (!tokenUsageService) {
    return c.json({ error: 'Token usage service not configured' }, 503)
  }
  
  try {
    const query = c.req.query()
    const domain = query.domain
    const model = query.model
    const windowSeconds = query.window ? parseInt(query.window) : 300 // Default 5 minutes
    
    if (!domain || !model) {
      return c.json({ error: 'Domain and model parameters are required' }, 400)
    }
    
    const usage = await tokenUsageService.getUsageInWindow(domain, model, windowSeconds)
    
    // Get configured limits
    const configs = await tokenUsageService.getRateLimitConfigs(domain, model)
    const matchingConfig = configs.find(cfg => cfg.windowSeconds === windowSeconds)
    
    return c.json({
      usage,
      limit: matchingConfig,
      percentUsed: matchingConfig?.tokenLimit 
        ? (usage.totalTokens / matchingConfig.tokenLimit) * 100 
        : null
    })
  } catch (error) {
    logger.error('Failed to get current token usage', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to retrieve token usage' }, 500)
  }
})

/**
 * GET /api/token-usage/history - Get historical token usage
 */
apiRoutes.get('/token-usage/history', async c => {
  const { container } = await import('../container.js')
  const tokenUsageService = container.getTokenUsageService()
  
  if (!tokenUsageService) {
    return c.json({ error: 'Token usage service not configured' }, 503)
  }
  
  try {
    const query = c.req.query()
    const domain = query.domain
    const startDate = query.start ? new Date(query.start) : new Date(Date.now() - 24 * 60 * 60 * 1000)
    const endDate = query.end ? new Date(query.end) : new Date()
    const granularity = query.granularity === 'day' ? 'day' : 'hour'
    
    if (!domain) {
      return c.json({ error: 'Domain parameter is required' }, 400)
    }
    
    const history = await tokenUsageService.getHistoricalUsage(domain, startDate, endDate, granularity)
    
    return c.json({ history })
  } catch (error) {
    logger.error('Failed to get historical token usage', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to retrieve historical usage' }, 500)
  }
})

/**
 * GET /api/rate-limits - Get configured rate limits
 */
apiRoutes.get('/rate-limits', async c => {
  const { container } = await import('../container.js')
  const pool = container.getDbPool()
  
  if (!pool) {
    return c.json({ error: 'Database not configured' }, 503)
  }
  
  try {
    const query = c.req.query()
    const domain = query.domain
    const model = query.model
    
    let conditions = ['is_active = true']
    let values: any[] = []
    let paramCount = 0
    
    if (domain) {
      conditions.push(`(domain = $${++paramCount} OR domain IS NULL)`)
      values.push(domain)
    }
    
    if (model) {
      conditions.push(`model = $${++paramCount}`)
      values.push(model)
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    
    const result = await pool.query(`
      SELECT 
        id, domain, model, window_seconds, token_limit, request_limit,
        fallback_model, priority, created_at, updated_at
      FROM rate_limit_configs
      ${whereClause}
      ORDER BY priority DESC, domain DESC NULLS LAST, window_seconds ASC
    `, values)
    
    const configs = result.rows.map(row => ({
      id: row.id,
      domain: row.domain,
      model: row.model,
      windowSeconds: row.window_seconds,
      tokenLimit: row.token_limit,
      requestLimit: row.request_limit,
      fallbackModel: row.fallback_model,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    
    return c.json({ configs })
  } catch (error) {
    logger.error('Failed to get rate limit configs', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to retrieve rate limit configurations' }, 500)
  }
})

/**
 * POST /api/rate-limits - Create or update rate limit configuration
 */
apiRoutes.post('/rate-limits', async c => {
  const { container } = await import('../container.js')
  const tokenUsageService = container.getTokenUsageService()
  
  if (!tokenUsageService) {
    return c.json({ error: 'Token usage service not configured' }, 503)
  }
  
  try {
    const body = await c.req.json()
    
    // Validate required fields
    if (!body.model || !body.windowSeconds) {
      return c.json({ error: 'Model and windowSeconds are required' }, 400)
    }
    
    if (!body.tokenLimit && !body.requestLimit) {
      return c.json({ error: 'At least one of tokenLimit or requestLimit must be specified' }, 400)
    }
    
    // If updating existing config
    if (body.id) {
      await tokenUsageService.updateRateLimitConfig({
        id: body.id,
        tokenLimit: body.tokenLimit,
        requestLimit: body.requestLimit,
        fallbackModel: body.fallbackModel,
      })
      
      return c.json({ success: true, message: 'Rate limit updated' })
    }
    
    // Create new config - would need to add this method to TokenUsageService
    return c.json({ error: 'Creating new rate limits not yet implemented' }, 501)
  } catch (error) {
    logger.error('Failed to update rate limit', { error: getErrorMessage(error) })
    return c.json({ error: 'Failed to update rate limit configuration' }, 500)
  }
})
