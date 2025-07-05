import { Hono } from 'hono'
import { html } from 'hono/html'
import {
  getErrorMessage,
  type CreateAnalysisRequest,
  type GetAnalysisResponse,
} from '@claude-nexus/shared'
import { container } from '../../container.js'
import { logger } from '../../middleware/logger.js'
import { escapeHtml, escapeHtmlArray } from '../../utils/html.js'
import { csrfProtection } from '../../middleware/csrf.js'

import { ProxyApiClient } from '../../services/api-client.js'

export const analysisPartialsRoutes = new Hono<{
  Variables: {
    apiClient?: ProxyApiClient
    csrfToken?: string
  }
}>()

// Apply CSRF protection to all routes
analysisPartialsRoutes.use('*', csrfProtection())

/**
 * Get the current status of an analysis and render the appropriate partial
 */
analysisPartialsRoutes.get('/status/:conversationId/:branchId', async c => {
  const { conversationId, branchId } = c.req.param()
  const pollCount = parseInt(c.req.query('pollCount') || '0')
  const apiClient = c.get('apiClient') || container.getApiClient()

  try {
    // Get analysis status from API
    const response = await apiClient.get<GetAnalysisResponse>(
      `/api/analyses/${conversationId}/${branchId}`
    )

    // If there's no analysis field, the analysis doesn't exist yet
    if (!response.analysis && response.status !== 'pending' && response.status !== 'processing') {
      // No analysis exists - render idle state
      return c.html(renderIdlePanel(conversationId, branchId))
    }

    // Render appropriate state based on status
    switch (response.status) {
      case 'pending':
      case 'processing':
        return c.html(renderProcessingPanel(conversationId, branchId, pollCount))
      case 'completed':
        if (response.analysis) {
          return c.html(renderCompletedPanel(conversationId, branchId, response))
        }
        return c.html(renderIdlePanel(conversationId, branchId))
      case 'failed':
        return c.html(renderFailedPanel(conversationId, branchId, response.error))
      default:
        return c.html(renderIdlePanel(conversationId, branchId))
    }
  } catch (error) {
    logger.error('Failed to get analysis status', {
      error: getErrorMessage(error),
      metadata: {
        conversationId,
        branchId,
      },
    })
    return c.html(renderErrorPanel('Failed to load analysis status'))
  }
})

/**
 * Handle analysis generation request
 */
analysisPartialsRoutes.post('/generate/:conversationId/:branchId', async c => {
  const { conversationId, branchId } = c.req.param()
  const apiClient = c.get('apiClient') || container.getApiClient()

  try {
    // Create analysis request
    const requestData: CreateAnalysisRequest = {
      conversationId,
      branchId,
    }

    try {
      await apiClient.post('/api/analyses', requestData)
      // Analysis created successfully - show processing state
      return c.html(renderProcessingPanel(conversationId, branchId, 0))
    } catch (postError: any) {
      // Check if it's a 409 conflict
      if (postError?.status === 409 && postError?.data) {
        interface ConflictErrorData {
          analysis: GetAnalysisResponse
        }
        const conflictData = postError.data as ConflictErrorData
        const analysis = conflictData.analysis

        if (analysis.status === 'pending' || analysis.status === 'processing') {
          return c.html(renderProcessingPanel(conversationId, branchId, 0))
        } else if (analysis.status === 'completed') {
          return c.html(renderCompletedPanel(conversationId, branchId, analysis))
        }
      }
      throw postError
    }
  } catch (error) {
    logger.error('Failed to generate analysis', {
      error: getErrorMessage(error),
      metadata: {
        conversationId,
        branchId,
      },
    })
    return c.html(renderFailedPanel(conversationId, branchId, 'Failed to generate analysis'))
  }
})

/**
 * Handle analysis regeneration request
 */
analysisPartialsRoutes.post('/regenerate/:conversationId/:branchId', async c => {
  const { conversationId, branchId } = c.req.param()
  const apiClient = c.get('apiClient') || container.getApiClient()

  try {
    // Regenerate analysis
    await apiClient.post(`/api/analyses/${conversationId}/${branchId}/regenerate`, {})

    // Show processing state
    return c.html(renderProcessingPanel(conversationId, branchId, 0))
  } catch (error) {
    logger.error('Failed to regenerate analysis', {
      error: getErrorMessage(error),
      metadata: {
        conversationId,
        branchId,
      },
    })
    return c.html(renderFailedPanel(conversationId, branchId, 'Failed to regenerate analysis'))
  }
})

// Render functions for different states

function renderIdlePanel(conversationId: string, branchId: string) {
  return html`
    <div id="analysis-panel" class="section">
      <div class="section-content">
        <h3 style="margin-top: 0; margin-bottom: 1rem;">AI Analysis</h3>
        <p style="color: #6b7280; margin-bottom: 1.5rem;">
          Get AI-powered insights for this conversation branch to understand patterns, key topics,
          and actionable recommendations.
        </p>
        <button
          hx-post="/partials/analysis/generate/${conversationId}/${branchId}"
          hx-target="#analysis-panel"
          hx-swap="outerHTML"
          class="btn"
        >
          Generate AI Analysis
        </button>
      </div>
    </div>
  `
}

function renderProcessingPanel(conversationId: string, branchId: string, pollCount: number = 0) {
  // Progressive backoff: 2s, 3s, 5s, 10s, then every 10s
  const pollIntervals = [2, 3, 5, 10, 10]
  const interval = pollIntervals[Math.min(pollCount, pollIntervals.length - 1)]

  return html`
    <div
      id="analysis-panel"
      class="section"
      hx-get="/partials/analysis/status/${conversationId}/${branchId}?pollCount=${pollCount + 1}"
      hx-trigger="delay:${interval}s"
      hx-swap="outerHTML"
    >
      <div class="section-content">
        <h3 style="margin-top: 0; margin-bottom: 1rem;">AI Analysis</h3>
        <div style="display: flex; align-items: center; gap: 0.75rem; color: #6b7280;">
          <span class="spinner"></span>
          <span>Analysis in progress... This may take a moment.</span>
        </div>
      </div>
    </div>
  `
}

function renderCompletedPanel(
  conversationId: string,
  branchId: string,
  analysisResponse: GetAnalysisResponse
) {
  const formatDate = (date: string | Date) => {
    const d = new Date(date)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDuration = (ms?: number) => {
    if (!ms) {
      return 'N/A'
    }
    const seconds = Math.round(ms / 1000)
    return `${seconds}s`
  }

  // Check if we have analysis data
  if (!analysisResponse.analysis) {
    return renderIdlePanel(conversationId, branchId)
  }

  const analysis = analysisResponse.analysis
  const analysisData = analysis.data

  return html`
    <div id="analysis-panel" class="section">
      <div
        class="section-header"
        style="display: flex; justify-content: space-between; align-items: center;"
      >
        <h3 style="margin: 0;">AI Analysis</h3>
        <button
          hx-post="/partials/analysis/regenerate/${conversationId}/${branchId}"
          hx-target="#analysis-panel"
          hx-swap="outerHTML"
          class="btn btn-secondary"
          style="font-size: 0.875rem; padding: 0.375rem 0.75rem;"
        >
          Regenerate
        </button>
      </div>
      <div class="section-content">
        ${analysisData.summary
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">Summary</h4>
                <p style="color: #4b5563; line-height: 1.6;">${escapeHtml(analysisData.summary)}</p>
              </div>
            `
          : ''}
        ${analysisData.keyTopics && analysisData.keyTopics.length > 0
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">Key Topics</h4>
                <ul style="margin: 0; padding-left: 1.5rem; color: #4b5563;">
                  ${escapeHtmlArray(analysisData.keyTopics).map(
                    (topic: string) => html`<li>${topic}</li>`
                  )}
                </ul>
              </div>
            `
          : ''}
        ${analysisData.sentiment
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">Sentiment</h4>
                <p style="color: #4b5563;">${escapeHtml(analysisData.sentiment)}</p>
              </div>
            `
          : ''}
        ${analysisData.actionItems && analysisData.actionItems.length > 0
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">
                  Action Items
                </h4>
                <ul style="margin: 0; padding-left: 1.5rem; color: #4b5563;">
                  ${escapeHtmlArray(analysisData.actionItems).map(
                    (item: string) => html`<li style="margin-bottom: 0.5rem;">${item}</li>`
                  )}
                </ul>
              </div>
            `
          : ''}
        ${analysisData.outcomes && analysisData.outcomes.length > 0
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">Outcomes</h4>
                <ul style="margin: 0; padding-left: 1.5rem; color: #4b5563;">
                  ${escapeHtmlArray(analysisData.outcomes).map(
                    (outcome: string) => html`<li style="margin-bottom: 0.5rem;">${outcome}</li>`
                  )}
                </ul>
              </div>
            `
          : ''}
        ${analysisData.userIntent
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">User Intent</h4>
                <p style="color: #4b5563; line-height: 1.6;">
                  ${escapeHtml(analysisData.userIntent)}
                </p>
              </div>
            `
          : ''}
        ${analysisData.technicalDetails
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">
                  Technical Details
                </h4>
                ${analysisData.technicalDetails.frameworks.length > 0
                  ? html`
                      <div style="margin-bottom: 0.75rem;">
                        <h5 style="font-size: 0.875rem; margin-bottom: 0.25rem; color: #6b7280;">
                          Frameworks & Technologies
                        </h5>
                        <p style="color: #4b5563;">
                          ${escapeHtmlArray(analysisData.technicalDetails.frameworks).join(', ')}
                        </p>
                      </div>
                    `
                  : ''}
                ${analysisData.technicalDetails.issues.length > 0
                  ? html`
                      <div style="margin-bottom: 0.75rem;">
                        <h5 style="font-size: 0.875rem; margin-bottom: 0.25rem; color: #6b7280;">
                          Issues Encountered
                        </h5>
                        <ul style="margin: 0; padding-left: 1.5rem; color: #4b5563;">
                          ${escapeHtmlArray(analysisData.technicalDetails.issues).map(
                            (issue: string) => html`<li>${issue}</li>`
                          )}
                        </ul>
                      </div>
                    `
                  : ''}
                ${analysisData.technicalDetails.solutions.length > 0
                  ? html`
                      <div style="margin-bottom: 0.75rem;">
                        <h5 style="font-size: 0.875rem; margin-bottom: 0.25rem; color: #6b7280;">
                          Solutions
                        </h5>
                        <ul style="margin: 0; padding-left: 1.5rem; color: #4b5563;">
                          ${escapeHtmlArray(analysisData.technicalDetails.solutions).map(
                            (solution: string) => html`<li>${solution}</li>`
                          )}
                        </ul>
                      </div>
                    `
                  : ''}
              </div>
            `
          : ''}
        ${analysisData.conversationQuality
          ? html`
              <div style="margin-bottom: 1.5rem;">
                <h4 style="font-size: 1rem; margin-bottom: 0.5rem; color: #374151;">
                  Conversation Quality
                </h4>
                <div style="display: flex; gap: 2rem; flex-wrap: wrap;">
                  <div>
                    <span style="font-size: 0.875rem; color: #6b7280;">Clarity:</span>
                    <span
                      style="margin-left: 0.5rem; font-weight: 500; text-transform: capitalize;"
                    >
                      ${analysisData.conversationQuality.clarity}
                    </span>
                  </div>
                  <div>
                    <span style="font-size: 0.875rem; color: #6b7280;">Completeness:</span>
                    <span
                      style="margin-left: 0.5rem; font-weight: 500; text-transform: capitalize;"
                    >
                      ${analysisData.conversationQuality.completeness}
                    </span>
                  </div>
                  <div>
                    <span style="font-size: 0.875rem; color: #6b7280;">Effectiveness:</span>
                    <span
                      style="margin-left: 0.5rem; font-weight: 500; text-transform: capitalize;"
                    >
                      ${analysisData.conversationQuality.effectiveness}
                    </span>
                  </div>
                </div>
              </div>
            `
          : ''}
        ${!analysisData.summary &&
        !analysisData.keyTopics &&
        !analysisData.sentiment &&
        !analysisData.actionItems &&
        !analysisData.outcomes
          ? html`
              <p style="color: #4b5563; white-space: pre-wrap;">
                ${escapeHtml(analysis.content) || 'No analysis content available.'}
              </p>
            `
          : ''}

        <div
          style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #9ca3af;"
        >
          <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
            <span>Model: ${escapeHtml(analysis.modelUsed) || 'Unknown'}</span>
            <span>Generated: ${formatDate(analysis.generatedAt)}</span>
            <span>Duration: ${formatDuration(analysis.processingDurationMs)}</span>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderFailedPanel(conversationId: string, branchId: string, errorMessage?: string | null) {
  return html`
    <div id="analysis-panel" class="section">
      <div class="section-content">
        <h3 style="margin-top: 0; margin-bottom: 1rem;">AI Analysis</h3>
        <div class="error-banner" style="margin-bottom: 1.5rem;">
          <strong>Analysis Failed</strong>
          ${errorMessage
            ? html`<p style="margin: 0.5rem 0 0 0;">${escapeHtml(errorMessage)}</p>`
            : ''}
        </div>
        <button
          hx-post="/partials/analysis/generate/${conversationId}/${branchId}"
          hx-target="#analysis-panel"
          hx-swap="outerHTML"
          class="btn"
        >
          Try Again
        </button>
      </div>
    </div>
  `
}

function renderErrorPanel(message: string) {
  return html`
    <div id="analysis-panel" class="section">
      <div class="section-content">
        <div class="error-banner">${escapeHtml(message)}</div>
      </div>
    </div>
  `
}
