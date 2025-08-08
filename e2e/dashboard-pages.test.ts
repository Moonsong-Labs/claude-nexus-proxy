import { test, expect, Page, ConsoleMessage } from '@playwright/test'

// Known external CDNs used by the app; ignore console errors originating from these
const EXTERNAL_HOSTS = new Set<string>([
  'cdnjs.cloudflare.com', // highlight.js
  'cdn.jsdelivr.net', // andypf/json-viewer
  'unpkg.com', // htmx
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'static.cloudflareinsights.com',
  'cdn.tailwindcss.com',
])

const IGNORE_PATTERNS = [
  /favicon\.ico/i,
  /apple-touch-icon.*\.png/i,
  /DevTools failed to load SourceMap/i,
  /(stylesheet|font).*\b(net::|ERR_|blocked|CORS)/i,
]

function isExternal(urlOrText?: string): boolean {
  if (!urlOrText) return false
  try {
    const u = new URL(urlOrText)
    return Array.from(EXTERNAL_HOSTS).some(host => u.host.includes(host))
  } catch {
    // Not a URL; check substring match for known hosts
    const s = String(urlOrText).toLowerCase()
    return Array.from(EXTERNAL_HOSTS).some(host => s.includes(host))
  }
}

async function captureErrors(page: Page) {
  const errors: string[] = []

  const onConsole = (msg: ConsoleMessage) => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warning' && type !== 'assert') return

    const loc = msg.location() // {url, lineNumber, columnNumber}
    const originUrl = loc?.url || ''
    const text = msg.text()

    // Ignore noise and external-origin issues
    if (isExternal(originUrl) || isExternal(text)) return
    if (IGNORE_PATTERNS.some(rx => rx.test(text))) return

    errors.push(`[console.${type}] ${text}${originUrl ? ` @ ${originUrl}` : ''}`)
  }

  const onPageError = (err: Error) => {
    const stack = String(err?.stack || err?.message || '')
    if (isExternal(stack)) return
    errors.push(`[pageerror] ${err?.message || String(err)}`)
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  return {
    getErrors: () => errors.slice(),
    dispose: () => {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}

// Routes to verify. We purposely include a few param routes with fake IDs to
// ensure error views render without crashing client-side.
let ROUTES: Array<{
  path: string
  assertions?: (page: Page) => Promise<void>
}> = [
  {
    path: '/dashboard',
    assertions: async page => {
      const overview = page.getByRole('heading', { name: /Conversations Overview/i })
      const errorBanner = page.locator('div.error-banner').first()
      await expect(overview.or(errorBanner)).toBeVisible()
    },
  },
  {
    path: '/dashboard/requests',
    assertions: async page => {
      await expect(page.getByText(/Recent Requests/i)).toBeVisible()
    },
  },
  {
    path: '/dashboard/usage',
    assertions: async page => {
      await expect(page.getByText(/Domain Stats|Select Domain|Hourly Request Count/i)).toBeVisible()
    },
  },
  {
    path: '/dashboard/token-usage',
    assertions: async page => {
      await expect(page.getByText(/Token Usage|Token Usage Overview/i)).toBeVisible()
    },
  },
  {
    path: '/dashboard/prompts',
    assertions: async page => {
      await expect(page.getByRole('heading', { name: /MCP Prompts/i })).toBeVisible()
    },
  },
  // Param routes (should show graceful error UIs; not necessarily 200 status, but must render)
  {
    path: '/dashboard/request/req_FAKE',
    assertions: async page => {
      await expect(page.locator('div.error-banner').first()).toBeVisible()
    },
  },
  {
    path: '/dashboard/conversation/conv_FAKE',
    assertions: async page => {
      // conversation-detail returns an error banner html string on not found
      await expect(page.locator('div.error-banner').first()).toBeVisible()
    },
  },
  {
    path: '/dashboard/prompts/fake',
    assertions: async page => {
      // Prompt detail error container
      const errorText = page.getByText(/Error Loading Prompt|Prompt Not Found/i)
      const errorBlock = page.locator('.error-container')
      await expect(errorText.or(errorBlock)).toBeVisible()
    },
  },
]

// If database is not configured, skip DB-dependent routes (request/conversation detail)
if (!process.env.DATABASE_URL) {
  ROUTES = ROUTES.filter(
    r => !['/dashboard/request/req_FAKE', '/dashboard/conversation/conv_FAKE'].includes(r.path)
  )
}

// Single test iterating all routes keeps startup/shutdown overhead minimal
// and ensures uniform error filtering across pages.

test('dashboard pages render with no in-app console errors', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL is not configured in Playwright use.baseURL')

  for (const route of ROUTES) {
    await test.step(route.path, async () => {
      const { getErrors, dispose } = await captureErrors(page)
      try {
        const url = new URL(route.path, baseURL).toString()

        // Navigate and await load; avoid networkidle because HTMX/SSE may keep connections open
        await page.goto(url, { waitUntil: 'load' })

        // Optionally wait for HTMX to settle if present
        await page.waitForFunction(
          () => ((window as any).htmx ? !document.querySelector('.htmx-request') : true),
          undefined,
          { timeout: 5000 }
        )

        // Basic nav/header should be present on every dashboard page
        await expect(page.getByRole('heading', { name: /Claude Nexus Dashboard/i })).toBeVisible()

        // Run route-specific structural assertions (not data-dependent)
        if (route.assertions) {
          await route.assertions(page)
        }

        // Collect errors and assert none
        const filteredErrors = getErrors()
        expect(
          filteredErrors,
          `Unexpected console/page errors for ${route.path} ->\n${filteredErrors.join('\n')}`
        ).toEqual([])
      } finally {
        // Clean up listeners to avoid cross-route bleed
        dispose()

        // Be a good citizen: go back to a neutral state
        // eslint-disable-next-line no-await-in-loop
        await page.goto(baseURL, { waitUntil: 'load' })
      }
    })
  }
})
