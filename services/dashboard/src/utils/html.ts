/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(unsafe: string | null | undefined): string {
  if (!unsafe) {
    return ''
  }

  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Escape an array of strings for safe HTML rendering
 */
export function escapeHtmlArray(items: readonly string[]): string[] {
  return items.map(item => escapeHtml(item))
}

/**
 * Conditionally escape HTML based on whether the content is user-generated
 */
export function safeHtml(content: string | null | undefined, isUserGenerated = true): string {
  return isUserGenerated ? escapeHtml(content) : content || ''
}
