import { logger } from '../middleware/logger.js'
import { getErrorMessage } from '@claude-nexus/shared'

interface StatsResponse {
  totalRequests: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
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
  conversationId?: string
}

interface RequestsResponse {
  requests: RequestSummary[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

interface RequestDetails extends RequestSummary {
  requestBody: any
  responseBody: any
  streamingChunks: Array<{
    chunkIndex: number
    timestamp: string
    data: string
    tokenCount: number
  }>
  // Optional fields that may be added in the future
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  telemetry?: any
  method?: string
  endpoint?: string
  streaming?: boolean
}

interface DomainsResponse {
  domains: Array<{
    domain: string
    requestCount: number
  }>
}

/**
 * API client for communicating with the Proxy service
 */
export class ProxyApiClient {
  private baseUrl: string
  private apiKey: string | undefined

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || process.env.PROXY_API_URL || 'http://localhost:3000'
    this.apiKey = apiKey || process.env.DASHBOARD_API_KEY || process.env.INTERNAL_API_KEY
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey
    }

    return headers
  }

  /**
   * Get aggregated statistics
   */
  async getStats(params?: { domain?: string; since?: string }): Promise<StatsResponse> {
    try {
      const url = new URL('/api/stats', this.baseUrl)
      if (params?.domain) {
        url.searchParams.set('domain', params.domain)
      }
      if (params?.since) {
        url.searchParams.set('since', params.since)
      }

      const response = await fetch(url.toString(), {
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as StatsResponse
    } catch (error) {
      logger.error('Failed to fetch stats from proxy API', {
        error: getErrorMessage(error),
        params,
      })
      throw error
    }
  }

  /**
   * Get recent requests
   */
  async getRequests(params?: {
    domain?: string
    limit?: number
    offset?: number
  }): Promise<RequestsResponse> {
    try {
      const url = new URL('/api/requests', this.baseUrl)
      if (params?.domain) {
        url.searchParams.set('domain', params.domain)
      }
      if (params?.limit) {
        url.searchParams.set('limit', params.limit.toString())
      }
      if (params?.offset) {
        url.searchParams.set('offset', params.offset.toString())
      }

      const response = await fetch(url.toString(), {
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as RequestsResponse
    } catch (error) {
      logger.error('Failed to fetch requests from proxy API', {
        error: getErrorMessage(error),
        params,
      })
      throw error
    }
  }

  /**
   * Get request details
   */
  async getRequestDetails(requestId: string): Promise<RequestDetails> {
    try {
      const url = new URL(`/api/requests/${requestId}`, this.baseUrl)

      const response = await fetch(url.toString(), {
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Request not found')
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as RequestDetails
    } catch (error) {
      logger.error('Failed to fetch request details from proxy API', {
        error: getErrorMessage(error),
        requestId,
      })
      throw error
    }
  }

  /**
   * Get list of active domains with request counts
   */
  async getDomains(): Promise<DomainsResponse> {
    try {
      const url = new URL('/api/domains', this.baseUrl)

      const response = await fetch(url.toString(), {
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as DomainsResponse
      // Return the full domain objects with request counts
      return data
    } catch (error) {
      logger.error('Failed to fetch domains from proxy API', {
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  /**
   * Convert API response to dashboard format for backward compatibility
   */
  convertToDashboardFormat(stats: StatsResponse, requests: RequestSummary[]) {
    return {
      stats: {
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        estimatedCost: (stats.totalTokens / 1000) * 0.002, // Rough estimate
        activeDomains: stats.activeDomains,
      },
      requests: requests.map(req => ({
        request_id: req.requestId,
        domain: req.domain,
        model: req.model,
        total_tokens: req.totalTokens,
        input_tokens: req.inputTokens,
        output_tokens: req.outputTokens,
        timestamp: req.timestamp,
        response_status: req.responseStatus,
      })),
    }
  }
}
