import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import { setCookie } from 'hono/cookie'
import { ProxyApiClient } from '../services/api-client.js'
import { getErrorMessage } from '@claude-nexus/shared'
import { parseConversation, calculateCost, formatMessageTime } from '../utils/conversation.js'
import { getBranchColor } from '../utils/conversation-graph.js'
import { formatNumber, formatDuration, escapeHtml } from '../utils/formatters.js'

export const dashboardRoutes = new Hono<{
  Variables: {
    apiClient?: ProxyApiClient
    domain?: string
  }
}>()

/**
 * Dashboard HTML layout template
 */
export const layout = (title: string, content: any) => html`
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title} - Claude Nexus Dashboard</title>
      <style>
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.5;
          color: #1f2937;
          background-color: #f9fafb;
        }
        .container {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 1rem;
        }
        nav {
          background: white;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border-bottom: 1px solid #e5e7eb;
        }
        nav .container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
        }
        h1 {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0;
        }
        h3 {
          font-size: 1.125rem;
          font-weight: 500;
          margin: 0 0 1rem 0;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .stat-card {
          background: white;
          padding: 1.5rem;
          border-radius: 0.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .stat-label {
          font-size: 0.875rem;
          color: #6b7280;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0.5rem 0;
        }
        .stat-meta {
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .section {
          background: white;
          border-radius: 0.375rem;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          margin-bottom: 1rem;
          border: 1px solid #e5e7eb;
        }
        .section-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #e5e7eb;
          font-weight: 500;
          font-size: 0.9rem;
        }
        .section-content {
          padding: 1rem;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }
        th {
          text-align: left;
          padding: 0.75rem;
          border-bottom: 1px solid #e5e7eb;
          font-size: 0.875rem;
          color: #6b7280;
        }
        td {
          padding: 0.75rem;
          border-bottom: 1px solid #f3f4f6;
        }
        tr:hover {
          background-color: #f9fafb;
        }

        .btn {
          display: inline-block;
          padding: 0.5rem 1rem;
          background: #3b82f6;
          color: white;
          text-decoration: none;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          border: none;
          cursor: pointer;
        }
        .btn:hover {
          background: #2563eb;
        }
        .btn-secondary {
          background: #6b7280;
        }
        .btn-secondary:hover {
          background: #4b5563;
        }

        select {
          padding: 0.5rem;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          font-size: 1rem;
          background: white;
        }

        /* Pagination styles */
        .pagination-link {
          padding: 0.5rem 0.75rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
          text-decoration: none;
          color: #374151;
          transition: all 0.15s;
        }
        .pagination-link:hover {
          background: #f3f4f6;
          border-color: #d1d5db;
        }
        .pagination-current {
          padding: 0.5rem 0.75rem;
          background: #3b82f6;
          color: white;
          border-radius: 0.375rem;
        }
        .pagination-disabled {
          padding: 0.5rem 1rem;
          color: #9ca3af;
        }

        .text-sm {
          font-size: 0.875rem;
        }
        .text-gray-500 {
          color: #6b7280;
        }
        .text-gray-600 {
          color: #4b5563;
        }
        .text-blue-600 {
          color: #2563eb;
        }
        .mb-6 {
          margin-bottom: 1.5rem;
        }
        .space-x-4 > * + * {
          margin-left: 1rem;
        }

        .error-banner {
          background: #fee;
          border: 1px solid #fcc;
          color: #c33;
          padding: 1rem;
          margin-bottom: 1rem;
          border-radius: 0.375rem;
        }

        /* Conversation view styles */
        .conversation-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .message {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .message-meta {
          flex-shrink: 0;
          width: 65px;
          padding-top: 0.5rem;
        }

        .message-time {
          color: #9ca3af;
          font-size: 0.65rem;
          line-height: 1;
          margin-bottom: 0.2rem;
        }

        .message-role {
          font-weight: 500;
          color: #6b7280;
          font-size: 0.75rem;
          line-height: 1.2;
        }

        .message-content {
          flex: 1;
          padding: 0.5rem 0.75rem;
          border-radius: 0.375rem;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          min-width: 0; /* Allow flex item to shrink below content size */
          overflow: hidden;
        }

        .message-user .message-content {
          background: #eff6ff;
          border-color: #dbeafe;
        }

        .message-assistant .message-content {
          background: #f9fafb;
        }

        .message-assistant-response .message-content {
          background: #f0fdf4;
          border-color: #86efac;
          border-left: 3px solid #10b981;
        }

        .message-system .message-content {
          background: #fef3c7;
          text-align: center;
          margin: 0 auto;
          max-width: 70%;
          font-size: 0.8rem;
        }

        .message-content pre {
          background: #1f2937;
          color: #f9fafb;
          padding: 0.5rem;
          border-radius: 0.25rem;
          overflow-x: auto;
          margin: 0.25rem 0;
          font-size: 0.8rem;
          max-width: 100%;
        }

        .message-content code {
          background: #e5e7eb;
          padding: 0.1rem 0.2rem;
          border-radius: 0.125rem;
          font-size: 0.8rem;
        }

        .message-content pre code {
          background: transparent;
          padding: 0;
        }

        .message-content p {
          margin: 0.25rem 0;
        }

        .message-content p:first-child {
          margin-top: 0;
        }

        .message-content p:last-child {
          margin-bottom: 0;
        }

        .message-truncated {
          position: relative;
        }

        .show-more-btn {
          color: #3b82f6;
          cursor: pointer;
          font-size: 0.75rem;
          margin-top: 0.25rem;
          display: inline-block;
        }

        .show-more-btn:hover {
          text-decoration: underline;
        }

        .view-toggle {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .view-toggle button {
          padding: 0.5rem 1rem;
          border: 1px solid #d1d5db;
          background: white;
          border-radius: 0.375rem;
          cursor: pointer;
          font-size: 0.875rem;
        }

        .view-toggle button.active {
          background: #3b82f6;
          color: white;
          border-color: #3b82f6;
        }

        .cost-info {
          display: inline-flex;
          gap: 1rem;
          font-size: 0.875rem;
          color: #6b7280;
        }

        .hidden {
          display: none;
        }

        /* Tool message styles */
        .message-tool-use .message-content {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-left: 3px solid #6b7280;
        }

        .message-tool-result .message-content {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-left: 3px solid #10b981;
        }

        .tool-header {
          font-weight: 600;
          color: #4b5563;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .tool-icon {
          font-size: 1.2rem;
        }

        .tool-result-header {
          font-weight: 600;
          color: #4b5563;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .message-tool-use pre,
        .message-tool-result pre {
          background: #1f2937;
          border: 1px solid #374151;
          color: #f9fafb;
          margin: 0.25rem 0;
          padding: 0.5rem;
          font-size: 0.75rem;
          max-width: 100%;
          overflow-x: auto;
        }

        /* For code inside tool messages, preserve JSON formatting */
        .message-tool-use pre code,
        .message-tool-result pre code {
          white-space: pre;
          word-wrap: normal;
          overflow-wrap: normal;
        }

        .message-tool-use code,
        .message-tool-result code {
          background: #1f2937;
          color: #f9fafb;
        }

        /* Dense headers */
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          margin: 0.5rem 0 0.25rem 0;
        }

        /* Reduce spacing in lists */
        ul,
        ol {
          margin: 0.25rem 0;
          padding-left: 1.5rem;
        }

        li {
          margin: 0.1rem 0;
        }
        /* RenderJSON styles */
        .renderjson a {
          text-decoration: none;
        }
        .renderjson .disclosure {
          color: #9ca3af;
          font-size: 110%;
          cursor: pointer;
        }
        .renderjson .syntax {
          color: #6b7280;
        }
        .renderjson .string {
          color: #059669;
        }
        .renderjson .number {
          color: #2563eb;
        }
        .renderjson .boolean {
          color: #7c3aed;
        }
        .renderjson .key {
          color: #1f2937;
          font-weight: 500;
        }
        .renderjson .keyword {
          color: #dc2626;
        }
        .renderjson .object.syntax {
          color: #6b7280;
        }
        .renderjson .array.syntax {
          color: #6b7280;
        }
        .renderjson {
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        /* Improved conversation styles */
        .conversation-graph-container {
          display: flex;
          gap: 1.5rem;
          position: relative;
        }

        .conversation-graph {
          flex-shrink: 0;
          position: sticky;
          top: 1rem;
          height: fit-content;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 1rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .conversation-timeline {
          flex: 1;
          min-width: 0;
        }

        .conversation-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .conversation-stat-card {
          background: white;
          padding: 1rem;
          border-radius: 0.375rem;
          border: 1px solid #e5e7eb;
        }

        .conversation-stat-label {
          font-size: 0.75rem;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .conversation-stat-value {
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 0.25rem;
        }

        .branch-filter {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
          padding-bottom: 0.5rem;
        }

        .branch-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: 2px solid transparent;
          text-decoration: none;
          position: relative;
        }

        .branch-chip-main {
          background: #f3f4f6;
          color: #4b5563;
          border-color: #e5e7eb;
        }

        .branch-chip-active {
          font-weight: 600;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .branch-chip-active::after {
          content: '';
          position: absolute;
          bottom: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }

        .branch-chip:hover:not(.branch-chip-active) {
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      </style>
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css"
      />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/renderjson@1.4.0/renderjson.min.js"></script>
      <script src="https://unpkg.com/htmx.org@1.9.10"></script>
    </head>
    <body>
      <nav>
        <div class="container">
          <h1>Claude Nexus Dashboard</h1>
          <div class="space-x-4">
            <a href="/dashboard" class="text-sm text-blue-600">Dashboard</a>
            <a href="/dashboard/requests" class="text-sm text-blue-600">Requests</a>
            <span class="text-sm text-gray-600" id="current-domain">All Domains</span>
            <a href="/dashboard/logout" class="text-sm text-blue-600">Logout</a>
          </div>
        </div>
      </nav>
      <main class="container" style="padding: 2rem 1rem;">${content}</main>
    </body>
  </html>
`

/**
 * Main dashboard page - Shows conversations overview with branches
 */
dashboardRoutes.get('/', async c => {
  const domain = c.req.query('domain')
  const refresh = c.req.query('refresh')
  const page = parseInt(c.req.query('page') || '1')
  const perPage = parseInt(c.req.query('per_page') || '50')
  const searchQuery = c.req.query('search')?.toLowerCase()

  // Validate pagination params
  const currentPage = Math.max(1, page)
  const itemsPerPage = Math.min(Math.max(10, perPage), 100) // Between 10 and 100

  // Get storage service from container
  const { container } = await import('../container.js')
  const storageService = container.getStorageService()

  // Clear cache if refresh is requested
  if (refresh === 'true') {
    storageService.clearCache()
  }

  try {
    // For now, fetch all and paginate in memory
    // TODO: Add offset/limit support to getConversationSummaries
    const allConversationSummaries = await storageService.getConversationSummaries(domain, 10000)

    // Create flat list of conversation branches
    const conversationBranches: Array<{
      conversationId: string
      branch: string
      messageCount: number
      tokens: number
      firstMessage: Date
      lastMessage: Date
      domain: string
      latestRequestId?: string
    }> = []

    // We'll need to fetch full conversations to get request IDs
    // For now, let's work with what we have
    allConversationSummaries.forEach(conv => {
      if (conv.branches && Array.isArray(conv.branches)) {
        conv.branches.forEach((branch: any) => {
          conversationBranches.push({
            conversationId: conv.conversation_id,
            branch: branch.branch_id,
            messageCount: branch.message_count,
            tokens: branch.branch_tokens || 0,
            firstMessage: new Date(branch.branch_start),
            lastMessage: new Date(branch.branch_end),
            domain: conv.domain,
            latestRequestId: branch.latest_request_id,
          })
        })
      }
    })

    // Apply search filter if provided
    let filteredBranches = conversationBranches
    if (searchQuery) {
      filteredBranches = conversationBranches.filter(branch => {
        return (
          branch.conversationId.toLowerCase().includes(searchQuery) ||
          branch.branch.toLowerCase().includes(searchQuery) ||
          branch.domain.toLowerCase().includes(searchQuery)
        )
      })
    }

    // Sort by last message time
    filteredBranches.sort((a, b) => b.lastMessage.getTime() - a.lastMessage.getTime())

    // Get unique domains for the dropdown
    const uniqueDomains = [...new Set(conversationBranches.map(branch => branch.domain))].sort()

    // Calculate totals from conversation branches
    const totalMessages = conversationBranches.reduce((sum, branch) => sum + branch.messageCount, 0)
    const totalTokens = conversationBranches.reduce((sum, branch) => sum + branch.tokens, 0)

    // Calculate pagination
    const totalItems = filteredBranches.length
    const totalPages = Math.ceil(totalItems / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const paginatedBranches = filteredBranches.slice(startIndex, endIndex)

    const content = html`
      <div
        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;"
      >
        <h2 style="margin: 0;">Conversations Overview</h2>
        <div style="display: flex; gap: 1rem; align-items: center;">
          <!-- Search Bar -->
          <form action="/dashboard" method="get" style="display: flex; gap: 0.5rem;">
            ${domain
              ? html`<input type="hidden" name="domain" value="${escapeHtml(domain)}" />`
              : ''}
            <input type="hidden" name="page" value="1" />
            <input type="hidden" name="per_page" value="${itemsPerPage}" />
            <input
              type="search"
              name="search"
              placeholder="Search conversations..."
              value="${escapeHtml(c.req.query('search') || '')}"
              style="padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; width: 250px; font-size: 0.875rem;"
            />
            <button
              type="submit"
              class="btn btn-secondary"
              style="padding: 0.5rem 1rem; font-size: 0.875rem;"
            >
              Search
            </button>
          </form>
          <a
            href="/dashboard?refresh=true&page=${currentPage}&per_page=${itemsPerPage}${domain
              ? `&domain=${encodeURIComponent(domain)}`
              : ''}${searchQuery
              ? `&search=${encodeURIComponent(c.req.query('search') || '')}`
              : ''}"
            class="btn btn-secondary"
            style="font-size: 0.875rem;"
          >
            Refresh
          </a>
        </div>
      </div>

      <!-- Domain Filter -->
      <div style="margin-bottom: 1.5rem;">
        <label class="text-sm text-gray-600">Filter by Domain:</label>
        <select
          onchange="window.location.href = '/dashboard' + (this.value ? '?domain=' + this.value : '?') + '&page=1&per_page=${itemsPerPage}${searchQuery
            ? `&search=${encodeURIComponent(c.req.query('search') || '')}`
            : ''}'"
          style="margin-left: 0.5rem; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; font-size: 0.875rem;"
        >
          <option value="">All Domains</option>
          ${raw(
            uniqueDomains
              .map(
                d =>
                  `<option value="${escapeHtml(d)}" ${domain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`
              )
              .join('')
          )}
        </select>
      </div>

      <!-- Stats Summary -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Conversations</div>
          <div class="stat-value">${allConversationSummaries.length}</div>
          <div class="stat-meta">Unique conversations</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Branches</div>
          <div class="stat-value">${conversationBranches.length}</div>
          <div class="stat-meta">Including main branches</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Messages</div>
          <div class="stat-value">${totalMessages}</div>
          <div class="stat-meta">Across all conversations</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Tokens</div>
          <div class="stat-value">${formatNumber(totalTokens)}</div>
          <div class="stat-meta">Combined usage</div>
        </div>
      </div>

      <!-- Conversation Branches Table -->
      <div class="section">
        <div class="section-header">
          Conversation Branches
          <span class="text-sm text-gray-500" style="float: right;">
            Showing ${paginatedBranches.length} of ${totalItems}
            ${searchQuery ? 'filtered ' : ''}branches (Page ${currentPage} of ${totalPages})
          </span>
        </div>
        <div class="section-content">
          ${paginatedBranches.length === 0
            ? html`<p class="text-gray-500">No conversations found</p>`
            : html`
                <table>
                  <thead>
                    <tr>
                      <th>Conversation</th>
                      <th>Branch</th>
                      <th>Domain</th>
                      <th>Messages</th>
                      <th>Tokens</th>
                      <th>Duration</th>
                      <th>Last Activity</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${raw(
                      paginatedBranches
                        .map(branch => {
                          const duration =
                            branch.lastMessage.getTime() - branch.firstMessage.getTime()
                          const branchColor = getBranchColor(branch.branch)

                          return `
                            <tr>
                              <td class="text-sm">
                                <a href="/dashboard/conversation/${branch.conversationId}${branch.branch !== 'main' ? `?branch=${branch.branch}` : ''}" 
                                   class="text-blue-600" 
                                   style="font-family: monospace; font-size: 0.75rem;">
                                  ${branch.conversationId.substring(0, 8)}...
                                </a>
                              </td>
                              <td class="text-sm">
                                ${
                                  branch.branch !== 'main'
                                    ? `<span style="font-size: 0.75rem; background: ${branchColor}20; color: ${branchColor}; padding: 0.125rem 0.5rem; border-radius: 9999px; border: 1px solid ${branchColor};">${escapeHtml(branch.branch)}</span>`
                                    : '<span style="font-size: 0.75rem; color: #6b7280;">main</span>'
                                }
                              </td>
                              <td class="text-sm">${branch.domain}</td>
                              <td class="text-sm">${branch.messageCount}</td>
                              <td class="text-sm">${formatNumber(branch.tokens)}</td>
                              <td class="text-sm">${formatDuration(duration)}</td>
                              <td class="text-sm">${formatTimestamp(branch.lastMessage)}</td>
                              <td class="text-sm">
                                ${
                                  branch.latestRequestId
                                    ? `<a href="/dashboard/request/${branch.latestRequestId}" class="text-blue-600" title="View latest request">Latest →</a>`
                                    : '<span class="text-gray-400">N/A</span>'
                                }
                              </td>
                            </tr>
                          `
                        })
                        .join('')
                    )}
                  </tbody>
                </table>

                ${totalPages > 1
                  ? html`
                      <div
                        style="display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 2rem; padding: 1rem 0;"
                      >
                        ${currentPage > 1
                          ? html`
                              <a
                                href="?page=${currentPage - 1}${domain
                                  ? `&domain=${domain}`
                                  : ''}&per_page=${itemsPerPage}${searchQuery
                                  ? `&search=${encodeURIComponent(c.req.query('search') || '')}`
                                  : ''}"
                                class="pagination-link"
                              >
                                ← Previous
                              </a>
                            `
                          : html` <span class="pagination-disabled">← Previous</span> `}

                        <div style="display: flex; gap: 0.5rem;">
                          ${generatePageNumbers(currentPage, totalPages).map(pageNum =>
                            pageNum === '...'
                              ? html`<span style="padding: 0.5rem;">...</span>`
                              : pageNum === currentPage
                                ? html`<span class="pagination-current">${pageNum}</span>`
                                : html`
                                    <a
                                      href="?page=${pageNum}${domain
                                        ? `&domain=${domain}`
                                        : ''}&per_page=${itemsPerPage}${searchQuery
                                        ? `&search=${encodeURIComponent(c.req.query('search') || '')}`
                                        : ''}"
                                      class="pagination-link"
                                    >
                                      ${pageNum}
                                    </a>
                                  `
                          )}
                        </div>

                        ${currentPage < totalPages
                          ? html`
                              <a
                                href="?page=${currentPage + 1}${domain
                                  ? `&domain=${domain}`
                                  : ''}&per_page=${itemsPerPage}${searchQuery
                                  ? `&search=${encodeURIComponent(c.req.query('search') || '')}`
                                  : ''}"
                                class="pagination-link"
                              >
                                Next →
                              </a>
                            `
                          : html` <span class="pagination-disabled">Next →</span> `}

                        <div style="margin-left: 2rem; color: #6b7280; font-size: 0.875rem;">
                          Items per page:
                          <select
                            onchange="window.location.href='?page=1${domain
                              ? `&domain=${domain}`
                              : ''}&per_page=' + this.value + '${searchQuery
                              ? `&search=${encodeURIComponent(c.req.query('search') || '')}`
                              : ''}'"
                            style="margin-left: 0.5rem; padding: 0.25rem 0.5rem; border: 1px solid #e5e7eb; border-radius: 0.375rem;"
                          >
                            <option value="10" ${itemsPerPage === 10 ? 'selected' : ''}>10</option>
                            <option value="25" ${itemsPerPage === 25 ? 'selected' : ''}>25</option>
                            <option value="50" ${itemsPerPage === 50 ? 'selected' : ''}>50</option>
                            <option value="100" ${itemsPerPage === 100 ? 'selected' : ''}>
                              100
                            </option>
                          </select>
                        </div>
                      </div>
                    `
                  : ''}
              `}
        </div>
      </div>
    `

    return c.html(layout('Dashboard', content))
  } catch (error) {
    return c.html(
      layout(
        'Error',
        html`
          <div class="error-banner">
            <strong>Error:</strong> ${getErrorMessage(error) || 'Failed to load conversations'}
          </div>
        `
      )
    )
  }
})

function generatePageNumbers(current: number, total: number): (number | string)[] {
  const pages: (number | string)[] = []
  const maxVisible = 7 // Maximum number of page buttons to show

  if (total <= maxVisible) {
    // Show all pages if total is small
    for (let i = 1; i <= total; i++) {
      pages.push(i)
    }
  } else {
    // Always show first page
    pages.push(1)

    if (current > 3) {
      pages.push('...')
    }

    // Show pages around current
    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)

    for (let i = start; i <= end; i++) {
      pages.push(i)
    }

    if (current < total - 2) {
      pages.push('...')
    }

    // Always show last page
    if (total > 1) {
      pages.push(total)
    }
  }

  return pages
}

function formatTimestamp(timestamp: string | Date): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) {
    return 'Just now'
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`
  }

  return date.toLocaleString()
}

/**
 * Requests page - Shows recent API requests
 */
dashboardRoutes.get('/requests', async c => {
  const apiClient = c.get('apiClient')
  const domain = c.req.query('domain')

  if (!apiClient) {
    return c.html(
      layout(
        'Error',
        html`
          <div class="error-banner">
            <strong>Error:</strong> API client not configured. Please check your configuration.
          </div>
        `
      )
    )
  }

  // Initialize default data
  let stats = {
    totalRequests: 0,
    totalTokens: 0,
    estimatedCost: 0,
    activeDomains: 0,
  }
  let recentRequests: any[] = []
  let domains: Array<{ domain: string; requestCount: number }> = []
  let error: string | null = null

  // Fetch data from Proxy API with individual error handling
  const results = await Promise.allSettled([
    apiClient.getStats({ domain }),
    apiClient.getRequests({ domain, limit: 20 }),
    apiClient.getDomains(),
  ])

  // Handle stats result
  if (results[0].status === 'fulfilled') {
    const statsResponse = results[0].value
    stats = {
      totalRequests: statsResponse.totalRequests,
      totalTokens: statsResponse.totalTokens,
      estimatedCost: (statsResponse.totalTokens / 1000) * 0.002,
      activeDomains: statsResponse.activeDomains,
    }
  } else {
    console.error('Failed to fetch stats:', results[0].reason)
  }

  // Handle requests result
  if (results[1].status === 'fulfilled') {
    recentRequests = results[1].value.requests
  } else {
    console.error('Failed to fetch requests:', results[1].reason)
  }

  // Handle domains result
  if (results[2].status === 'fulfilled') {
    domains = results[2].value.domains
  } else {
    console.error('Failed to fetch domains:', results[2].reason)
    // Don't show error banner for domains failure since it's not critical
  }

  // Only show error if critical data (stats or requests) failed
  if (results[0].status === 'rejected' || results[1].status === 'rejected') {
    error = 'Failed to load some dashboard data. Some features may be limited.'
  }

  const content = html`
    ${error ? html`<div class="error-banner">${error}</div>` : ''}

    <div class="mb-6">
      <a href="/dashboard" class="text-blue-600">← Back to Dashboard</a>
    </div>

    <!-- Domain Filter -->
    <div class="mb-6">
      <label class="text-sm text-gray-600">Filter by Domain:</label>
      <select
        onchange="window.location.href = '/dashboard/requests' + (this.value ? '?domain=' + this.value : '')"
        style="margin-left: 0.5rem;"
      >
        <option value="">All Domains</option>
        ${raw(
          domains
            .map(
              d =>
                `<option value="${d.domain}" ${domain === d.domain ? 'selected' : ''}>${d.domain} (${d.requestCount})</option>`
            )
            .join('')
        )}
      </select>
    </div>

    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Requests</div>
        <div class="stat-value">${stats.totalRequests.toLocaleString()}</div>
        <div class="stat-meta">Last 24 hours</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Tokens</div>
        <div class="stat-value">${formatNumber(stats.totalTokens)}</div>
        <div class="stat-meta">Input + Output</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Estimated Cost</div>
        <div class="stat-value">$${stats.estimatedCost.toFixed(2)}</div>
        <div class="stat-meta">Based on token usage</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Domains</div>
        <div class="stat-value">${stats.activeDomains}</div>
        <div class="stat-meta">Unique domains</div>
      </div>
    </div>

    <!-- Recent Requests -->
    <div class="section">
      <div class="section-header">
        Recent Requests
        <a
          href="/dashboard/requests${domain ? '?domain=' + domain : ''}"
          class="btn btn-secondary"
          style="float: right; font-size: 0.75rem; padding: 0.25rem 0.75rem;"
          >Refresh</a
        >
      </div>
      <div class="section-content">
        ${recentRequests.length === 0
          ? html` <p class="text-gray-500">No requests found</p> `
          : html`
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Domain</th>
                    <th>Model</th>
                    <th>Tokens</th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${raw(
                    recentRequests
                      .map(
                        req => `
                <tr>
                  <td class="text-sm">${formatTimestamp(req.timestamp)}</td>
                  <td class="text-sm">${req.domain}</td>
                  <td class="text-sm">${req.model || 'N/A'}</td>
                  <td class="text-sm">${formatNumber(req.totalTokens || 0)}</td>
                  <td class="text-sm">${req.responseStatus || 'N/A'}</td>
                  <td class="text-sm">
                    <a href="/dashboard/request/${req.requestId}" class="text-blue-600">View</a>
                  </td>
                </tr>
              `
                      )
                      .join('')
                  )}
                </tbody>
              </table>
            `}
      </div>
    </div>
  `

  return c.html(layout('Requests', content))
})

/**
 * Request details page with conversation view
 */
dashboardRoutes.get('/request/:id', async c => {
  const apiClient = c.get('apiClient')
  const requestId = c.req.param('id')

  if (!apiClient) {
    return c.html(
      layout(
        'Error',
        html` <div class="error-banner"><strong>Error:</strong> API client not configured.</div> `
      )
    )
  }

  try {
    const details = await apiClient.getRequestDetails(requestId)

    // Parse conversation data
    const conversation = await parseConversation({
      request_body: details.requestBody,
      response_body: details.responseBody,
      request_tokens: details.inputTokens,
      response_tokens: details.outputTokens,
      model: details.model,
      duration: details.durationMs,
      status_code: details.responseStatus,
      timestamp: details.timestamp,
    })

    // Calculate cost
    const cost = calculateCost(conversation.totalInputTokens, conversation.totalOutputTokens)

    // Format messages for display - reverse order to show newest first
    const messagesHtml = conversation.messages
      .slice()
      .reverse()
      .map((msg, idx) => {
        const messageId = `message-${idx}`
        const contentId = `content-${idx}`
        const truncatedId = `truncated-${idx}`

        // Add special classes for tool messages
        let messageClass = `message message-${msg.role}`
        if (msg.isToolUse) {
          messageClass += ' message-tool-use'
        } else if (msg.isToolResult) {
          messageClass += ' message-tool-result'
        }

        // Add special styling for assistant messages
        if (msg.role === 'assistant') {
          messageClass += ' message-assistant-response'
        }

        // Format role display
        let roleDisplay = msg.role.charAt(0).toUpperCase() + msg.role.slice(1)
        if (msg.isToolUse) {
          roleDisplay = 'Tool 🔧'
        } else if (msg.isToolResult) {
          roleDisplay = 'Result ✅'
        }

        return `
        <div class="${messageClass}">
          <div class="message-meta">
            <div class="message-time">${formatMessageTime(msg.timestamp)}</div>
            <div class="message-role">${roleDisplay}</div>
          </div>
          <div class="message-content">
            ${
              msg.isLong
                ? `
              <div id="${truncatedId}" class="message-truncated">
                ${msg.truncatedHtml}
                <span class="show-more-btn" onclick="toggleMessage('${messageId}')">Show more</span>
              </div>
              <div id="${contentId}" class="hidden">
                ${msg.htmlContent}
                <span class="show-more-btn" onclick="toggleMessage('${messageId}')">Show less</span>
              </div>
            `
                : msg.htmlContent
            }
          </div>
        </div>
      `
      })
      .join('')

    const content = html`
      <div class="mb-6">
        <a href="/dashboard" class="text-blue-600">← Back to Dashboard</a>
      </div>

      <!-- Error Banner if present -->
      ${conversation.error
        ? html`
            <div class="error-banner">
              <strong>Error (${conversation.error.statusCode || 'Unknown'}):</strong> ${conversation
                .error.message}
            </div>
          `
        : ''}

      <!-- Request Summary -->
      <div class="section">
        <div class="section-header">Request Summary</div>
        <div
          class="section-content"
          style="display: flex; gap: 2rem; align-items: start; flex-wrap: wrap;"
        >
          <!-- Left side: Main details -->
          <div style="flex: 1; min-width: 300px;">
            <dl
              style="display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; font-size: 0.875rem;"
            >
              <dt class="text-gray-600">Request ID:</dt>
              <dd>${details.requestId}</dd>

              ${details.conversationId
                ? `
              <dt class="text-gray-600">Conversation ID:</dt>
              <dd>
                <a href="/dashboard/conversation/${details.conversationId}" 
                   class="font-mono text-blue-600 hover:text-blue-800 hover:underline">
                  ${details.conversationId}
                </a>
              </dd>
              `
                : ''}

              <dt class="text-gray-600">Domain:</dt>
              <dd>${details.domain}</dd>

              <dt class="text-gray-600">Model:</dt>
              <dd>${conversation.model}</dd>

              <dt class="text-gray-600">Timestamp:</dt>
              <dd>${new Date(details.timestamp).toLocaleString()}</dd>

              <dt class="text-gray-600">Tokens:</dt>
              <dd>
                <span class="cost-info" style="font-size: 0.8rem;">
                  <span>Input: ${conversation.totalInputTokens.toLocaleString()}</span>
                  <span>Output: ${conversation.totalOutputTokens.toLocaleString()}</span>
                  <span
                    >Total:
                    ${(
                      conversation.totalInputTokens + conversation.totalOutputTokens
                    ).toLocaleString()}</span
                  >
                </span>
              </dd>

              <dt class="text-gray-600">Cost:</dt>
              <dd>${cost.formattedTotal}</dd>

              <dt class="text-gray-600">Duration:</dt>
              <dd>${conversation.duration ? formatDuration(conversation.duration) : 'N/A'}</dd>

              <dt class="text-gray-600">Status:</dt>
              <dd>${details.responseStatus}</dd>
            </dl>
          </div>

          <!-- Right side: Tool usage badges -->
          ${raw(
            Object.keys(conversation.toolUsage).length > 0
              ? (() => {
                  // Create a stable-sorted list of tools
                  const sortedTools = Object.entries(conversation.toolUsage).sort(
                    ([toolA, countA], [toolB, countB]) =>
                      countB - countA || toolA.localeCompare(toolB)
                  )

                  // Calculate total
                  const totalCalls = sortedTools.reduce((sum, [, count]) => sum + count, 0)

                  // Function to get color based on usage proportion
                  const getColorForProportion = (count: number) => {
                    const proportion = count / totalCalls
                    if (proportion >= 0.3) {
                      // High usage (30%+) - blue tones
                      return {
                        bg: '#dbeafe', // blue-100
                        color: '#1e40af', // blue-800
                        countBg: '#3b82f6', // blue-500
                        countColor: '#ffffff',
                      }
                    } else if (proportion >= 0.15) {
                      // Medium usage (15-30%) - green tones
                      return {
                        bg: '#d1fae5', // green-100
                        color: '#065f46', // green-800
                        countBg: '#10b981', // green-500
                        countColor: '#ffffff',
                      }
                    } else if (proportion >= 0.05) {
                      // Low usage (5-15%) - amber tones
                      return {
                        bg: '#fef3c7', // amber-100
                        color: '#92400e', // amber-800
                        countBg: '#f59e0b', // amber-500
                        countColor: '#ffffff',
                      }
                    } else {
                      // Very low usage (<5%) - gray tones
                      return {
                        bg: '#f3f4f6', // gray-100
                        color: '#374151', // gray-700
                        countBg: '#6b7280', // gray-500
                        countColor: '#ffffff',
                      }
                    }
                  }

                  // Generate tool badges
                  const toolBadges = sortedTools
                    .map(([tool, count]) => {
                      const colors = getColorForProportion(count)
                      const percentage = ((count / totalCalls) * 100).toFixed(0)
                      return `
                <span style="
                  display: inline-block;
                  background-color: ${colors.bg};
                  color: ${colors.color};
                  padding: 0.125rem 0.5rem;
                  margin: 0.125rem;
                  border-radius: 9999px;
                  font-size: 0.75rem;
                  font-weight: 500;
                  white-space: nowrap;
                " title="${escapeHtml(tool)}: ${count} calls (${percentage}%)">
                  ${escapeHtml(tool)}
                  <span style="
                    background-color: ${colors.countBg};
                    color: ${colors.countColor};
                    padding: 0 0.375rem;
                    margin-left: 0.25rem;
                    border-radius: 9999px;
                    font-weight: 600;
                  ">${count}</span>
                </span>
                `
                    })
                    .join('')

                  // Return the full HTML string
                  return `
          <div style="min-width: 200px; max-width: 300px; flex-shrink: 0;">
            <div style="
              display: flex;
              align-items: baseline;
              justify-content: space-between;
              margin-bottom: 0.375rem;
            ">
              <h4 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: #4b5563;">
                Tool Usage
              </h4>
              <span style="font-size: 0.75rem; color: #6b7280;">
                Total: ${totalCalls}
              </span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
              ${toolBadges}
            </div>
          </div>
          `
                })()
              : ''
          )}
        </div>
      </div>

      <!-- View Toggle -->
      <div class="view-toggle">
        <button class="active" onclick="showView('conversation')">Conversation</button>
        <button onclick="showView('raw')">Raw JSON</button>
        <button onclick="showView('headers')">Headers & Metadata</button>
      </div>

      <!-- Conversation View -->
      <div id="conversation-view" class="conversation-container">${raw(messagesHtml)}</div>

      <!-- Raw JSON View (hidden by default) -->
      <div id="raw-view" class="hidden">
        ${details.requestBody
          ? html`
              <div class="section">
                <div class="section-header">
                  Request Body
                  <button
                    class="btn btn-secondary"
                    style="float: right; font-size: 0.75rem; padding: 0.25rem 0.75rem;"
                    onclick="copyJsonToClipboard('request')"
                  >
                    Copy JSON
                  </button>
                </div>
                <div class="section-content">
                  <div
                    id="request-json"
                    style="background: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto;"
                  ></div>
                </div>
              </div>
            `
          : ''}
        ${details.responseBody
          ? html`
              <div class="section">
                <div class="section-header">
                  Response Body
                  <button
                    class="btn btn-secondary"
                    style="float: right; font-size: 0.75rem; padding: 0.25rem 0.75rem;"
                    onclick="copyJsonToClipboard('response')"
                  >
                    Copy JSON
                  </button>
                </div>
                <div class="section-content">
                  <div
                    id="response-json"
                    style="background: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto;"
                  ></div>
                </div>
              </div>
            `
          : ''}
        ${details.streamingChunks?.length > 0
          ? html`
              <div class="section">
                <div class="section-header">
                  Streaming Chunks (${details.streamingChunks.length})
                </div>
                <div class="section-content">
                  <div id="chunks-container" style="max-height: 400px; overflow-y: auto;">
                    ${raw(
                      details.streamingChunks
                        .map(
                          (chunk, i) => `
                  <div style="margin-bottom: 0.5rem; padding: 0.5rem; background: #f9fafb; border-radius: 0.25rem;">
                    <div class="text-sm text-gray-600">Chunk ${chunk.chunkIndex} - ${chunk.tokenCount || 0} tokens</div>
                    <div id="chunk-${i}" style="margin: 0.25rem 0 0 0; background: white; padding: 0.5rem; border-radius: 0.25rem; border: 1px solid #e5e7eb;"></div>
                  </div>
                `
                        )
                        .join('')
                    )}
                  </div>
                </div>
              </div>
            `
          : ''}
      </div>

      <!-- Headers & Metadata View (hidden by default) -->
      <div id="headers-view" class="hidden">
        ${details.requestHeaders
          ? html`
              <div class="section">
                <div class="section-header">Request Headers</div>
                <div class="section-content">
                  <div
                    id="request-headers"
                    style="background: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto;"
                  ></div>
                </div>
              </div>
            `
          : ''}
        ${details.responseHeaders
          ? html`
              <div class="section">
                <div class="section-header">Response Headers</div>
                <div class="section-content">
                  <div
                    id="response-headers"
                    style="background: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto;"
                  ></div>
                </div>
              </div>
            `
          : ''}

        <div class="section">
          <div class="section-header">Request Metadata</div>
          <div class="section-content">
            <div
              id="request-metadata"
              style="background: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto;"
            ></div>
          </div>
        </div>

        ${details.telemetry
          ? html`
              <div class="section">
                <div class="section-header">Telemetry & Performance</div>
                <div class="section-content">
                  <div
                    id="telemetry-data"
                    style="background: #f3f4f6; padding: 1rem; border-radius: 0.375rem; overflow-x: auto;"
                  ></div>
                </div>
              </div>
            `
          : ''}
      </div>

      <!-- JavaScript for view toggling and message expansion -->
      <script>
        // Store the JSON data in hidden divs to avoid escaping issues
        const getJsonData = id => {
          const el = document.getElementById(id)
          return el ? JSON.parse(el.textContent) : null
        }
      </script>

      <!-- Hidden data storage -->
      <div style="display: none;">
        <div id="request-data-storage">
          ${details.requestBody ? JSON.stringify(details.requestBody) : 'null'}
        </div>
        <div id="response-data-storage">
          ${details.responseBody ? JSON.stringify(details.responseBody) : 'null'}
        </div>
        <div id="chunks-data-storage">
          ${details.streamingChunks ? JSON.stringify(details.streamingChunks) : '[]'}
        </div>
        <div id="request-headers-storage">
          ${details.requestHeaders ? JSON.stringify(details.requestHeaders) : 'null'}
        </div>
        <div id="response-headers-storage">
          ${details.responseHeaders ? JSON.stringify(details.responseHeaders) : 'null'}
        </div>
        <div id="telemetry-data-storage">
          ${details.telemetry ? JSON.stringify(details.telemetry) : 'null'}
        </div>
        <div id="metadata-storage">
          ${JSON.stringify({
            id: details.requestId || '',
            domain: details.domain || '',
            timestamp: details.timestamp || '',
            method: details.method || 'POST',
            endpoint: details.endpoint || '/v1/messages',
            model: details.model || 'unknown',
            inputTokens: details.inputTokens || 0,
            outputTokens: details.outputTokens || 0,
            totalTokens: (details.inputTokens || 0) + (details.outputTokens || 0),
            durationMs: details.durationMs || 0,
            responseStatus: details.responseStatus || 0,
            streaming: details.streaming === true,
          })}
        </div>
      </div>

      <script>
        // Get the JSON data from hidden elements
        const requestData = getJsonData('request-data-storage')
        const responseData = getJsonData('response-data-storage')
        const streamingChunks = getJsonData('chunks-data-storage') || []
        const requestHeaders = getJsonData('request-headers-storage')
        const responseHeaders = getJsonData('response-headers-storage')
        const telemetryData = getJsonData('telemetry-data-storage')
        const requestMetadata = getJsonData('metadata-storage')

        function showView(view) {
          const conversationView = document.getElementById('conversation-view')
          const rawView = document.getElementById('raw-view')
          const headersView = document.getElementById('headers-view')
          const buttons = document.querySelectorAll('.view-toggle button')

          // Hide all views
          conversationView.classList.add('hidden')
          rawView.classList.add('hidden')
          headersView.classList.add('hidden')

          // Remove active from all buttons
          buttons.forEach(btn => btn.classList.remove('active'))

          if (view === 'conversation') {
            conversationView.classList.remove('hidden')
            buttons[0].classList.add('active')
          } else if (view === 'raw') {
            rawView.classList.remove('hidden')
            buttons[1].classList.add('active')

            // Render JSON using RenderJSON when switching to raw view
            if (typeof renderjson !== 'undefined') {
              // Configure RenderJSON
              renderjson.set_max_string_length(200) // Truncate very long strings
              renderjson.set_sort_objects(true) // Sort object keys

              // Parse and render request body
              if (requestData && document.getElementById('request-json')) {
                const requestContainer = document.getElementById('request-json')
                requestContainer.innerHTML = ''
                try {
                  requestContainer.appendChild(renderjson.set_show_to_level('all')(requestData))
                } catch (e) {
                  console.error('Failed to render request data:', e)
                }
              }

              // Parse and render response body
              if (responseData && document.getElementById('response-json')) {
                const responseContainer = document.getElementById('response-json')
                responseContainer.innerHTML = ''
                try {
                  responseContainer.appendChild(renderjson.set_show_to_level('all')(responseData))
                } catch (e) {
                  console.error('Failed to render response data:', e)
                }
              }

              // Parse and render streaming chunks
              try {
                streamingChunks.forEach((chunk, i) => {
                  const chunkContainer = document.getElementById('chunk-' + i)
                  if (chunkContainer) {
                    chunkContainer.innerHTML = ''
                    try {
                      const chunkData = JSON.parse(chunk.data)
                      chunkContainer.appendChild(renderjson.set_show_to_level('all')(chunkData))
                    } catch (e) {
                      // If not valid JSON, display as text
                      chunkContainer.textContent = chunk.data
                    }
                  }
                })
              } catch (e) {
                console.error('Failed to parse chunks:', e)
              }
            }
          } else if (view === 'headers') {
            headersView.classList.remove('hidden')
            buttons[2].classList.add('active')

            // Render headers and metadata using RenderJSON
            if (typeof renderjson !== 'undefined') {
              renderjson.set_max_string_length(200)
              renderjson.set_sort_objects(true)

              // Render request headers
              if (requestHeaders && document.getElementById('request-headers')) {
                const container = document.getElementById('request-headers')
                container.innerHTML = ''
                try {
                  container.appendChild(renderjson.set_show_to_level('all')(requestHeaders))
                } catch (e) {
                  console.error('Failed to render request headers:', e)
                }
              }

              // Render response headers
              if (responseHeaders && document.getElementById('response-headers')) {
                const container = document.getElementById('response-headers')
                container.innerHTML = ''
                try {
                  container.appendChild(renderjson.set_show_to_level('all')(responseHeaders))
                } catch (e) {
                  console.error('Failed to render response headers:', e)
                }
              }

              // Render request metadata
              const metadataContainer = document.getElementById('request-metadata')
              if (metadataContainer) {
                metadataContainer.innerHTML = ''
                metadataContainer.appendChild(renderjson.set_show_to_level('all')(requestMetadata))
              }

              // Render telemetry data
              if (telemetryData && document.getElementById('telemetry-data')) {
                const container = document.getElementById('telemetry-data')
                container.innerHTML = ''
                try {
                  container.appendChild(renderjson.set_show_to_level('all')(telemetryData))
                } catch (e) {
                  console.error('Failed to render telemetry data:', e)
                }
              }
            }
          }
        }

        function toggleMessage(messageId) {
          const idx = messageId.split('-')[1]
          const content = document.getElementById('content-' + idx)
          const truncated = document.getElementById('truncated-' + idx)

          if (content.classList.contains('hidden')) {
            content.classList.remove('hidden')
            truncated.classList.add('hidden')
          } else {
            content.classList.add('hidden')
            truncated.classList.remove('hidden')
          }
        }

        // Copy JSON to clipboard
        function copyJsonToClipboard(type) {
          let data
          if (type === 'request') {
            data = requestData
          } else if (type === 'response') {
            data = responseData
          }

          if (data) {
            const jsonString = JSON.stringify(data, null, 2)
            navigator.clipboard
              .writeText(jsonString)
              .then(() => {
                // Find the button that was clicked and update its text
                const buttons = document.querySelectorAll('button')
                buttons.forEach(btn => {
                  if (btn.onclick && btn.onclick.toString().includes("'" + type + "'")) {
                    const originalText = btn.textContent
                    btn.textContent = 'Copied!'
                    btn.style.background = '#10b981'
                    setTimeout(() => {
                      btn.textContent = originalText
                      btn.style.background = ''
                    }, 2000)
                  }
                })
              })
              .catch(err => {
                console.error('Failed to copy to clipboard:', err)
                alert('Failed to copy to clipboard')
              })
          }
        }

        // Initialize syntax highlighting
        document.addEventListener('DOMContentLoaded', function () {
          hljs.highlightAll()
        })
      </script>
    `

    return c.html(layout('Request Details', content))
  } catch (error) {
    return c.html(
      layout(
        'Error',
        html`
          <div class="error-banner">
            <strong>Error:</strong> ${getErrorMessage(error) || 'Failed to load request details'}
          </div>
          <div class="mb-6">
            <a href="/dashboard" class="text-blue-600">← Back to Dashboard</a>
          </div>
        `
      )
    )
  }
})

/**
 * Login page
 */
dashboardRoutes.get('/login', c => {
  const content = html`
    <div
      style="max-width: 400px; margin: 4rem auto; background: white; padding: 2rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);"
    >
      <h2 style="margin: 0 0 1.5rem 0;">Dashboard Login</h2>
      <form method="POST" action="/dashboard/login">
        <div style="margin-bottom: 1rem;">
          <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #374151;"
            >API Key</label
          >
          <input
            type="password"
            name="key"
            required
            style="width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem;"
            placeholder="Enter your dashboard API key"
          />
        </div>
        <button type="submit" class="btn" style="width: 100%;">Login</button>
      </form>
      <p style="margin-top: 1rem; font-size: 0.875rem; color: #6b7280; text-align: center;">
        Set DASHBOARD_API_KEY environment variable
      </p>
    </div>
  `

  return c.html(layout('Login', content))
})

/**
 * Handle login POST
 */
dashboardRoutes.post('/login', async c => {
  const { key } = await c.req.parseBody()

  if (key === process.env.DASHBOARD_API_KEY) {
    setCookie(c, 'dashboard_auth', key as string, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    return c.redirect('/dashboard')
  }

  return c.redirect('/dashboard/login?error=invalid')
})

/**
 * Logout
 */
dashboardRoutes.get('/logout', c => {
  setCookie(c, 'dashboard_auth', '', { maxAge: 0 })
  return c.redirect('/dashboard/login')
})
