import { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { randomBytes } from 'crypto'

const CSRF_TOKEN_COOKIE = 'csrf_token'
const CSRF_HEADER = 'X-CSRF-Token'
const TOKEN_LENGTH = 32

/**
 * Generate a CSRF token
 */
function generateToken(): string {
  return randomBytes(TOKEN_LENGTH).toString('hex')
}

/**
 * CSRF protection middleware
 * Validates CSRF tokens on state-changing requests (POST, PUT, DELETE, PATCH)
 */
export function csrfProtection() {
  return async (c: Context, next: Next) => {
    const method = c.req.method.toUpperCase()

    // Get or generate CSRF token
    let csrfToken = getCookie(c, CSRF_TOKEN_COOKIE)
    if (!csrfToken) {
      csrfToken = generateToken()
      setCookie(c, CSRF_TOKEN_COOKIE, csrfToken, {
        httpOnly: true,
        sameSite: 'Strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      })
    }

    // Skip CSRF validation for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      // Expose the token for forms to use
      c.set('csrfToken', csrfToken)
      return next()
    }

    // Validate CSRF token for state-changing requests
    const requestToken = c.req.header(CSRF_HEADER)

    if (!requestToken || requestToken !== csrfToken) {
      return c.json(
        {
          error: 'Invalid CSRF token',
          message: 'Request validation failed. Please refresh the page and try again.',
        },
        403
      )
    }

    // Token is valid, continue
    c.set('csrfToken', csrfToken)
    return next()
  }
}

/**
 * Helper to inject CSRF token into HTML forms and AJAX requests
 * This should be added to templates that make state-changing requests
 */
export function injectCsrfToken(c: Context): string {
  const token = c.get('csrfToken') || ''
  return `
    <meta name="csrf-token" content="${token}">
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
    </script>
  `
}
