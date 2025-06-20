import { Hono } from 'hono'
import { cors } from 'hono/cors'
// Remove static file serving - will inline CSS instead
import { container } from './container.js'
import { loggingMiddleware, logger } from './middleware/logger.js'
// Use the new API-based dashboard routes
import { dashboardRoutes } from './routes/dashboard-api.js'
import { conversationDetailRoutes } from './routes/conversation-detail.js'
import { dashboardAuth } from './middleware/auth.js'
import { getErrorMessage, hasStatusCode } from '@claude-nexus/shared'

/**
 * Create and configure the Dashboard application
 */
export async function createDashboardApp(): Promise<Hono<{ Variables: { apiClient: any } }>> {
  const app = new Hono<{ Variables: { apiClient: any } }>()

  // Centralized error handler
  app.onError((err, c) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
    })

    // Don't expose internal errors to clients
    const message = process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'

    return c.json(
      {
        error: {
          message,
          type: 'internal_error',
        },
      },
      hasStatusCode(err) ? (((err as any).status || 500) as any) : (500 as any)
    )
  })

  // Global middleware
  app.use('*', cors())
  app.use('*', loggingMiddleware())

  // Health check
  app.get('/health', async c => {
    const apiClient = container.getApiClient()
    const health: any = {
      status: 'healthy',
      service: 'claude-nexus-dashboard',
      version: process.env.npm_package_version || 'unknown',
      timestamp: new Date().toISOString(),
    }

    // Check proxy API connection
    try {
      // Try to fetch stats with a short timeout
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      await apiClient.getStats()
      clearTimeout(timeout)

      health.proxyApi = 'connected'
    } catch (error) {
      health.status = 'unhealthy'
      health.proxyApi = 'disconnected'
      health.error = getErrorMessage(error)
    }

    return c.json(health, health.status === 'healthy' ? 200 : 503)
  })

  // API endpoints for dashboard data
  app.get('/api/requests', async c => {
    const storageService = container.getStorageService()
    const domain = c.req.query('domain')
    const limit = parseInt(c.req.query('limit') || '100')

    try {
      const requests = await storageService.getRequestsByDomain(domain || '', limit)
      return c.json({
        status: 'ok',
        requests,
        count: requests.length,
      })
    } catch (error) {
      logger.error('Failed to get requests', { error: getErrorMessage(error) })
      return c.json({ error: 'Failed to retrieve requests' }, 500)
    }
  })

  app.get('/api/requests/:requestId', async c => {
    const storageService = container.getStorageService()
    const requestId = c.req.param('requestId')

    try {
      const details = await storageService.getRequestDetails(requestId)
      if (!details.request) {
        return c.json({ error: 'Request not found' }, 404)
      }
      return c.json({
        status: 'ok',
        ...details,
      })
    } catch (error) {
      logger.error('Failed to get request details', { error: getErrorMessage(error) })
      return c.json({ error: 'Failed to retrieve request details' }, 500)
    }
  })

  app.get('/api/storage-stats', async c => {
    const storageService = container.getStorageService()
    const domain = c.req.query('domain')
    const since = c.req.query('since')

    try {
      const stats = await storageService.getStats(domain, since ? new Date(since) : undefined)
      return c.json({
        status: 'ok',
        stats,
      })
    } catch (error) {
      logger.error('Failed to get storage stats', { error: getErrorMessage(error) })
      return c.json({ error: 'Failed to retrieve statistics' }, 500)
    }
  })

  app.get('/api/conversations', async c => {
    const storageService = container.getStorageService()
    const domain = c.req.query('domain')
    const limit = parseInt(c.req.query('limit') || '50')
    const excludeSubtasks = c.req.query('excludeSubtasks') === 'true'

    try {
      const conversations = await storageService.getConversationsWithFilter(
        domain,
        limit,
        excludeSubtasks
      )
      return c.json({
        status: 'ok',
        conversations,
        count: conversations.length,
      })
    } catch (error) {
      logger.error('Failed to get conversations', { error: getErrorMessage(error) })
      return c.json({ error: 'Failed to retrieve conversations' }, 500)
    }
  })

  app.get('/api/requests/:requestId/subtasks', async c => {
    const storageService = container.getStorageService()
    const requestId = c.req.param('requestId')

    try {
      const subtasks = await storageService.getSubtasksForRequest(requestId)
      return c.json({
        status: 'ok',
        subtasks,
        count: subtasks.length,
      })
    } catch (error) {
      logger.error('Failed to get subtasks', { error: getErrorMessage(error), requestId })
      return c.json({ error: 'Failed to retrieve subtasks' }, 500)
    }
  })

  // Apply auth middleware to all dashboard routes
  app.use('/*', dashboardAuth)

  // Pass API client to dashboard routes instead of database pool
  app.use('/*', async (c, next) => {
    c.set('apiClient', container.getApiClient())
    return next()
  })

  // Mount dashboard routes at /dashboard
  app.route('/dashboard', dashboardRoutes)
  app.route('/dashboard', conversationDetailRoutes)

  // Root redirect to dashboard
  app.get('/', c => {
    return c.redirect('/dashboard')
  })

  // Root API info endpoint
  app.get('/api', c => {
    return c.json({
      service: 'claude-nexus-dashboard',
      version: process.env.npm_package_version || 'unknown',
      endpoints: {
        dashboard: '/',
        health: '/health',
        requests: '/api/requests',
        stats: '/api/storage-stats',
      },
    })
  })

  // Log successful initialization
  logger.info('Dashboard application initialized', {
    proxyUrl: process.env.PROXY_API_URL || 'http://proxy:3000',
  })

  return app
}
