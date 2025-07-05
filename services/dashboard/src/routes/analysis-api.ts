import { Hono } from 'hono'
import { z } from 'zod'
import { ProxyApiClient } from '../services/api-client.js'
import { logger } from '../middleware/logger.js'
import {
  getErrorMessage,
  CreateAnalysisRequestSchema,
  type CreateAnalysisResponse,
  type GetAnalysisResponse,
  type RegenerateAnalysisResponse,
} from '@claude-nexus/shared'

export const analysisRoutes = new Hono<{
  Variables: {
    apiClient?: ProxyApiClient
  }
}>()

/**
 * POST /api/analyses
 * Create a new conversation analysis request
 */
analysisRoutes.post('/analyses', async c => {
  const apiClient = c.get('apiClient')
  if (!apiClient) {
    return c.json({ error: 'API client not configured' }, 503)
  }

  try {
    // Parse and validate request body
    const body = await c.req.json()
    const validatedData = CreateAnalysisRequestSchema.parse(body)

    // Forward to proxy service
    const response = await apiClient.post<CreateAnalysisResponse>('/api/analyses', validatedData)

    return c.json(response, 201)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: 'Invalid request data',
          details: error.errors,
        },
        400
      )
    }

    // Check if it's a 409 Conflict (analysis already exists)
    if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
      const conflictResponse = error as { data?: unknown; body?: unknown; status: number }
      const responseData = conflictResponse.data ||
        conflictResponse.body || { error: 'Analysis already exists' }
      return c.json(responseData, 409)
    }

    logger.error('Failed to create analysis', {
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return c.json({ error: 'Failed to create analysis' }, 500)
  }
})

/**
 * GET /api/analyses/:conversationId/:branchId
 * Get analysis status/result for a specific conversation branch
 */
analysisRoutes.get('/analyses/:conversationId/:branchId', async c => {
  const apiClient = c.get('apiClient')
  if (!apiClient) {
    return c.json({ error: 'API client not configured' }, 503)
  }

  const conversationId = c.req.param('conversationId')
  const branchId = c.req.param('branchId')

  // Validate UUID format for conversationId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(conversationId)) {
    return c.json({ error: 'Invalid conversation ID format' }, 400)
  }

  try {
    // Forward to proxy service
    const response = await apiClient.get<GetAnalysisResponse>(
      `/api/analyses/${conversationId}/${branchId}`
    )

    return c.json(response)
  } catch (error) {
    // Handle 404 Not Found
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      return c.json({ error: 'Analysis not found' }, 404)
    }
    logger.error('Failed to get analysis', {
      error: getErrorMessage(error),
    })
    return c.json({ error: 'Failed to retrieve analysis' }, 500)
  }
})

/**
 * POST /api/analyses/:conversationId/:branchId/regenerate
 * Force regeneration of analysis for a specific conversation branch
 */
analysisRoutes.post('/analyses/:conversationId/:branchId/regenerate', async c => {
  const apiClient = c.get('apiClient')
  if (!apiClient) {
    return c.json({ error: 'API client not configured' }, 503)
  }

  const conversationId = c.req.param('conversationId')
  const branchId = c.req.param('branchId')

  // Validate UUID format for conversationId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(conversationId)) {
    return c.json({ error: 'Invalid conversation ID format' }, 400)
  }

  try {
    // Forward to proxy service
    const response = await apiClient.post<RegenerateAnalysisResponse>(
      `/api/analyses/${conversationId}/${branchId}/regenerate`
    )

    return c.json(response)
  } catch (error) {
    // Handle 404 Not Found
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      return c.json({ error: 'Conversation not found' }, 404)
    }

    logger.error('Failed to regenerate analysis', {
      error: getErrorMessage(error),
    })
    return c.json({ error: 'Failed to regenerate analysis' }, 500)
  }
})
