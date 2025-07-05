import { html, raw } from 'hono/html'
import { dashboardStyles } from './styles.js'
import { Context } from 'hono'

/**
 * Dashboard HTML layout template
 */
export const layout = (
  title: string,
  content: any,
  additionalScripts: string = '',
  context?: Context
) => {
  // Get CSRF token if context is provided
  const csrfToken = context?.get('csrfToken') || ''

  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title} - Claude Nexus Dashboard</title>
        ${csrfToken ? html`<meta name="csrf-token" content="${csrfToken}" />` : ''}
        <style>
          ${raw(
            dashboardStyles
          )}
        
        /* Ultra-dense JSON viewer styles injected globally */
        andypf-json-viewer::part(json-viewer) {
            font-size: 10px !important;
            line-height: 1.1 !important;
          }

          andypf-json-viewer::part(key) {
            font-size: 10px !important;
          }

          andypf-json-viewer::part(value) {
            font-size: 10px !important;
          }

          andypf-json-viewer::part(row) {
            line-height: 1.1 !important;
            padding: 0 !important;
          }
        </style>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css"
        />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@andypf/json-viewer@2.1.10/dist/iife/index.js"></script>
        <style>
          /* JSON Viewer styling - Ultra Dense */
          andypf-json-viewer {
            display: block;
            padding: 0.5rem;
            border-radius: 0.25rem;
            overflow: auto;
            margin-bottom: 0.125rem;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
            font-size: 10px;
            line-height: 1.2;
            letter-spacing: -0.03em;
            --json-viewer-indent: 12px;
            --json-viewer-key-color: #1e40af;
            --json-viewer-value-string-color: #059669;
            --json-viewer-value-number-color: #dc2626;
            --json-viewer-value-boolean-color: #7c3aed;
            --json-viewer-value-null-color: #6b7280;
            --json-viewer-property-color: #1e40af;
            --json-viewer-bracket-color: #6b7280;
            --json-viewer-comma-color: #6b7280;
          }

          /* Compact view - reduce padding on containers */
          #request-json-container andypf-json-viewer,
          #response-json-container andypf-json-viewer {
            padding: 0.25rem;
            margin-bottom: 0;
          }

          /* Make the overall section more compact */
          #raw-view .section-content {
            padding: 0.25rem;
          }

          /* Reduce spacing between sections */
          .section {
            margin-bottom: 0.5rem;
          }

          .section-header {
            padding: 0.375rem 0.5rem;
            font-size: 0.875rem;
          }

          .section-content {
            padding: 0.375rem;
          }

          /* Dense view toggle buttons */
          .view-toggle {
            margin: 0.5rem 0;
          }

          .view-toggle button {
            padding: 0.25rem 0.75rem;
            font-size: 0.8125rem;
          }

          /* Ensure code blocks in these containers have light backgrounds */
          .hljs {
            background: transparent !important;
            color: #1f2937 !important;
          }

          /* Chunk containers */
          #chunks-container > div > div {
            background-color: white !important;
          }

          /* Tool use and conversation code blocks */
          .message-content pre,
          .message-content code,
          .conversation-container pre,
          .conversation-container code {
            background-color: #f9fafb !important;
            color: #1f2937 !important;
            border: 1px solid #e5e7eb;
          }

          .message-content pre code,
          .conversation-container pre code {
            background-color: transparent !important;
            border: none;
          }

          /* Specific language code blocks */
          .language-json,
          .language-javascript,
          .language-python,
          .language-bash,
          .language-shell,
          pre.hljs,
          code.hljs {
            background-color: #f9fafb !important;
            color: #1f2937 !important;
          }
        </style>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        ${csrfToken
          ? raw(`
      <script>
        // Add CSRF token to all HTMX requests
        document.addEventListener('DOMContentLoaded', function() {
          document.body.addEventListener('htmx:configRequest', function(evt) {
            const token = document.querySelector('meta[name="csrf-token"]')?.content;
            if (token) {
              evt.detail.headers['X-CSRF-Token'] = token;
            }
          });
        });
      </script>`)
          : ''}
        ${additionalScripts}
      </head>
      <body>
        <nav>
          <div class="container">
            <h1>Claude Nexus Dashboard</h1>
            <div class="space-x-4">
              <a href="/dashboard" class="text-sm text-blue-600">Dashboard</a>
              <a href="/dashboard/requests" class="text-sm text-blue-600">Requests</a>
              <a href="/dashboard/token-usage" class="text-sm text-blue-600">Token Usage</a>
              <span class="text-sm text-gray-600" id="current-domain">All Domains</span>
              <a href="/dashboard/logout" class="text-sm text-blue-600">Logout</a>
            </div>
          </div>
        </nav>
        <main class="container" style="padding: 2rem 1rem;">${content}</main>
      </body>
    </html>
  `
}
