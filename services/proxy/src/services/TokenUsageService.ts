import { Pool } from 'pg'
import { logger } from '../middleware/logger'
import { ProxyRequest } from '../domain/entities/ProxyRequest'
import { TokenMetrics } from '../domain/value-objects/TokenMetrics'
import { LRUCache } from 'lru-cache'

export interface RateLimitConfig {
  id: number
  domain?: string
  model: string
  windowSeconds: number
  tokenLimit?: number
  requestLimit?: number
  fallbackModel?: string
  priority: number
}

export interface UsageWindow {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requestCount: number
  windowStart: Date
  windowEnd: Date
}

export interface RateLimitCheck {
  exceeded: boolean
  limit?: RateLimitConfig
  usage: UsageWindow
  percentUsed: number
  fallbackModel?: string
}

export class RateLimitExceededError extends Error {
  constructor(
    public readonly check: RateLimitCheck,
    message?: string
  ) {
    super(message || `Rate limit exceeded: ${check.usage.totalTokens}/${check.limit?.tokenLimit} tokens`)
    this.name = 'RateLimitExceededError'
  }
}

/**
 * Service for tracking token usage and enforcing rate limits
 * Uses a hybrid approach: in-memory cache for recent data, database for persistence
 */
export class TokenUsageService {
  private readonly usageCache: LRUCache<string, UsageWindow>
  private readonly configCache: LRUCache<string, RateLimitConfig[]>
  private readonly CACHE_TTL = 60 * 1000 // 1 minute
  private readonly SHORT_WINDOW_THRESHOLD = 300 // 5 minutes

  constructor(private pool: Pool) {
    // LRU cache for recent usage windows (up to 1000 entries)
    this.usageCache = new LRUCache<string, UsageWindow>({
      max: 1000,
      ttl: this.CACHE_TTL,
    })

    // Cache for rate limit configurations
    this.configCache = new LRUCache<string, RateLimitConfig[]>({
      max: 100,
      ttl: 5 * 60 * 1000, // 5 minutes
    })
  }

  /**
   * Track token usage for a request
   * Always writes to database, regardless of request type
   */
  async trackUsage(
    request: ProxyRequest,
    metrics: TokenMetrics,
    requestId?: string
  ): Promise<void> {
    try {
      // Write to database (async, don't wait)
      this.writeToDatabase(request, metrics, requestId).catch(error => {
        logger.error('Failed to write token usage to database', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        })
      })

      // Update in-memory cache for short windows
      this.updateCache(request.host, request.model, metrics)

    } catch (error) {
      logger.error('Failed to track token usage', {
        requestId,
        domain: request.host,
        model: request.model,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Check if rate limits are exceeded for a request
   */
  async checkRateLimits(domain: string, model: string): Promise<RateLimitCheck | null> {
    try {
      // Get applicable rate limit configs
      const configs = await this.getRateLimitConfigs(domain, model)
      if (configs.length === 0) {
        return null
      }

      // Check each configured limit
      for (const config of configs) {
        const usage = await this.getUsageInWindow(domain, model, config.windowSeconds)
        
        // Check token limit
        if (config.tokenLimit && usage.totalTokens >= config.tokenLimit) {
          return {
            exceeded: true,
            limit: config,
            usage,
            percentUsed: (usage.totalTokens / config.tokenLimit) * 100,
            fallbackModel: config.fallbackModel,
          }
        }

        // Check request limit
        if (config.requestLimit && usage.requestCount >= config.requestLimit) {
          return {
            exceeded: true,
            limit: config,
            usage,
            percentUsed: (usage.requestCount / config.requestLimit) * 100,
            fallbackModel: config.fallbackModel,
          }
        }
      }

      return null
    } catch (error) {
      logger.error('Failed to check rate limits', {
        domain,
        model,
        error: error instanceof Error ? error.message : String(error),
      })
      // On error, fail open (allow the request)
      return null
    }
  }

  /**
   * Get token usage within a time window
   */
  async getUsageInWindow(
    domain: string,
    model: string,
    windowSeconds: number
  ): Promise<UsageWindow> {
    const now = new Date()
    const windowStart = new Date(now.getTime() - windowSeconds * 1000)

    // For short windows, try cache first
    if (windowSeconds <= this.SHORT_WINDOW_THRESHOLD) {
      const cacheKey = `${domain}:${model}:${windowSeconds}`
      const cached = this.usageCache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      // Query database using the helper function
      const result = await this.pool.query(
        'SELECT * FROM get_token_usage_in_window($1, $2, $3)',
        [domain, model, windowSeconds]
      )

      const row = result.rows[0]
      const usage: UsageWindow = {
        inputTokens: parseInt(row.input_tokens),
        outputTokens: parseInt(row.output_tokens),
        totalTokens: parseInt(row.total_tokens),
        requestCount: parseInt(row.request_count),
        windowStart,
        windowEnd: now,
      }

      // Cache short windows
      if (windowSeconds <= this.SHORT_WINDOW_THRESHOLD) {
        const cacheKey = `${domain}:${model}:${windowSeconds}`
        this.usageCache.set(cacheKey, usage)
      }

      return usage
    } catch (error) {
      logger.error('Failed to get usage in window', {
        metadata: {
          domain,
          model,
          windowSeconds,
          error: error instanceof Error ? error.message : String(error),
        }
      })
      // Return empty usage on error
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        windowStart,
        windowEnd: now,
      }
    }
  }

  /**
   * Get historical token usage for analytics
   */
  async getHistoricalUsage(
    domain: string,
    startDate: Date,
    endDate: Date,
    granularity: 'hour' | 'day' = 'hour'
  ): Promise<any[]> {
    try {
      const truncFunc = granularity === 'hour' ? 'hour' : 'day'
      const query = `
        SELECT 
          DATE_TRUNC($1, timestamp) as period,
          model,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(total_tokens) as total_tokens,
          COUNT(*) as request_count,
          COUNT(DISTINCT request_type) as request_types
        FROM token_usage
        WHERE domain = $2
          AND timestamp >= $3
          AND timestamp < $4
        GROUP BY DATE_TRUNC($1, timestamp), model
        ORDER BY period DESC, model
      `

      const result = await this.pool.query(query, [truncFunc, domain, startDate, endDate])
      return result.rows
    } catch (error) {
      logger.error('Failed to get historical usage', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  /**
   * Record a rate limit event
   */
  async recordRateLimitEvent(
    domain: string,
    model: string,
    eventType: 'limit_exceeded' | 'model_switched' | 'limit_suggested',
    config: RateLimitConfig,
    usage: UsageWindow,
    metadata?: any
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO rate_limit_events 
         (domain, model, event_type, window_seconds, tokens_used, token_limit, 
          requests_used, request_limit, fallback_model, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          domain,
          model,
          eventType,
          config.windowSeconds,
          usage.totalTokens,
          config.tokenLimit,
          usage.requestCount,
          config.requestLimit,
          config.fallbackModel,
          metadata ? JSON.stringify(metadata) : null,
        ]
      )
    } catch (error) {
      logger.error('Failed to record rate limit event', {
        domain,
        model,
        eventType,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Get or update rate limit configurations
   */
  async getRateLimitConfigs(domain: string, model: string): Promise<RateLimitConfig[]> {
    const cacheKey = `${domain}:${model}`
    const cached = this.configCache.get(cacheKey)
    if (cached) {
      return cached
    }

    try {
      const query = `
        SELECT id, domain, model, window_seconds, token_limit, request_limit, 
               fallback_model, priority
        FROM rate_limit_configs
        WHERE is_active = true
          AND model = $1
          AND (domain = $2 OR domain IS NULL)
        ORDER BY priority DESC, domain DESC NULLS LAST
      `

      const result = await this.pool.query(query, [model, domain])
      const configs: RateLimitConfig[] = result.rows.map(row => ({
        id: row.id,
        domain: row.domain,
        model: row.model,
        windowSeconds: row.window_seconds,
        tokenLimit: row.token_limit,
        requestLimit: row.request_limit,
        fallbackModel: row.fallback_model,
        priority: row.priority,
      }))

      this.configCache.set(cacheKey, configs)
      return configs
    } catch (error) {
      logger.error('Failed to get rate limit configs', {
        domain,
        model,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  /**
   * Update rate limit configuration
   */
  async updateRateLimitConfig(config: Partial<RateLimitConfig> & { id: number }): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE rate_limit_configs 
         SET token_limit = COALESCE($2, token_limit),
             request_limit = COALESCE($3, request_limit),
             fallback_model = COALESCE($4, fallback_model),
             updated_at = NOW()
         WHERE id = $1`,
        [config.id, config.tokenLimit, config.requestLimit, config.fallbackModel]
      )

      // Clear config cache to force reload
      this.configCache.clear()
    } catch (error) {
      logger.error('Failed to update rate limit config', {
        metadata: {
          configId: config.id,
          error: error instanceof Error ? error.message : String(error),
        }
      })
      throw error
    }
  }

  /**
   * Private methods
   */

  private async writeToDatabase(
    request: ProxyRequest,
    metrics: TokenMetrics,
    requestId?: string
  ): Promise<void> {
    const query = `
      INSERT INTO token_usage 
      (request_id, domain, model, input_tokens, output_tokens, request_type)
      VALUES ($1, $2, $3, $4, $5, $6)
    `

    await this.pool.query(query, [
      requestId || null,
      request.host,
      request.model,
      metrics.inputTokens,
      metrics.outputTokens,
      request.requestType,
    ])
  }

  private updateCache(domain: string, model: string, metrics: TokenMetrics): void {
    // Update cache for common short windows (1 min, 5 min)
    const windows = [60, 300]
    const now = new Date()

    for (const windowSeconds of windows) {
      const cacheKey = `${domain}:${model}:${windowSeconds}`
      const existing = this.usageCache.get(cacheKey)

      if (existing) {
        // Update existing cache entry
        existing.inputTokens += metrics.inputTokens
        existing.outputTokens += metrics.outputTokens
        existing.totalTokens += metrics.totalTokens
        existing.requestCount += 1
        existing.windowEnd = now
      } else {
        // Create new cache entry
        const usage: UsageWindow = {
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          totalTokens: metrics.totalTokens,
          requestCount: 1,
          windowStart: new Date(now.getTime() - windowSeconds * 1000),
          windowEnd: now,
        }
        this.usageCache.set(cacheKey, usage)
      }
    }
  }

  /**
   * Create future partitions (should be called periodically)
   */
  async createFuturePartitions(): Promise<void> {
    try {
      await this.pool.query('SELECT create_monthly_partitions(3)')
      logger.info('Successfully created future partitions for token_usage table')
    } catch (error) {
      logger.error('Failed to create future partitions', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}