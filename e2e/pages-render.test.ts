import { test, expect } from '@playwright/test'

// List of non-parameterized pages to verify
const staticRoutes: { path: string; expectSelector?: string }[] = [
  { path: '/', expectSelector: 'body' },
  { path: '/dashboard', expectSelector: 'nav' },
  { path: '/dashboard/requests', expectSelector: 'body' },
  { path: '/dashboard/token-usage', expectSelector: 'body' },
  { path: '/dashboard/usage', expectSelector: 'body' },
  { path: '/dashboard/prompts', expectSelector: 'body' },
  // In read-only mode, login may redirect to /dashboard, but still ensure no errors
  { path: '/dashboard/login', expectSelector: 'body' },
]

test.describe('Static pages render without console errors', () => {
  for (const { path, expectSelector } of staticRoutes) {
    test(`renders ${path} without console errors`, async ({ page, baseURL }) => {
      const errors: string[] = []

      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(`[console.error] ${msg.text()}`)
        }
      })

      page.on('pageerror', err => {
        errors.push(`[pageerror] ${String(err)}`)
      })

      const response = await page.goto(path, { waitUntil: 'domcontentloaded' })

      // Ensure navigation succeeded (allow 2xx/3xx)
      expect(response, `No response for ${path}`).not.toBeNull()
      const status = response!.status()
      expect(status, `Unexpected HTTP status ${status} for ${path}`).toBeLessThan(400)

      // If redirected, ensure final URL still on the same origin
      if (baseURL) {
        const base = new URL(baseURL)
        const current = new URL(page.url())
        expect(current.origin).toBe(base.origin)
      }

      if (expectSelector) {
        await expect(page.locator(expectSelector)).toBeVisible()
      }

      // Allow HTMX/client requests to settle
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

      // Assert no console errors or page errors captured
      expect(
        errors,
        errors.length ? `Errors on ${path}:\n${errors.join('\n')}` : 'no errors'
      ).toHaveLength(0)
    })
  }
})

test.describe('Dynamic detail pages render without console errors', () => {
  test('request details page (if data exists)', async ({ page, request, baseURL }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`)
    })
    page.on('pageerror', err => errors.push(`[pageerror] ${String(err)}`))

    const resp = await request.get('/api/requests?limit=1')
    if (!resp.ok()) test.skip('requests API not available')
    const data = await resp.json().catch(() => ({} as any))
    const req = data?.requests?.[0]
    test.skip(!req?.request_id, 'no requests in DB')

    const url = `/dashboard/request/${req.request_id}`
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(nav, `No response for ${url}`).not.toBeNull()
    expect(nav!.status()).toBeLessThan(400)
    if (baseURL) {
      const base = new URL(baseURL)
      const current = new URL(page.url())
      expect(current.origin).toBe(base.origin)
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    expect(errors, errors.length ? `Errors on ${url}:\n${errors.join('\n')}` : 'no errors').toHaveLength(0)
  })

  test('conversation details page (if data exists)', async ({ page, request, baseURL }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`)
    })
    page.on('pageerror', err => errors.push(`[pageerror] ${String(err)}`))

    const resp = await request.get('/api/conversations?limit=1')
    if (!resp.ok()) test.skip('conversations API not available')
    const data = await resp.json().catch(() => ({} as any))
    const conv = data?.conversations?.[0]
    test.skip(!conv?.conversation_id, 'no conversations in DB')

    const url = `/dashboard/conversation/${conv.conversation_id}`
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded' })
    expect(nav, `No response for ${url}`).not.toBeNull()
    expect(nav!.status()).toBeLessThan(400)
    if (baseURL) {
      const base = new URL(baseURL)
      const current = new URL(page.url())
      expect(current.origin).toBe(base.origin)
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    expect(errors, errors.length ? `Errors on ${url}:\n${errors.join('\n')}` : 'no errors').toHaveLength(0)
  })

  test('prompt details page (if link exists)', async ({ page, baseURL }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`)
    })
    page.on('pageerror', err => errors.push(`[pageerror] ${String(err)}`))

    // Open prompts listing
    const listResp = await page.goto('/dashboard/prompts', { waitUntil: 'domcontentloaded' })
    expect(listResp, 'No response for /dashboard/prompts').not.toBeNull()
    expect(listResp!.status()).toBeLessThan(400)

    // If a prompt card link exists, navigate to it
    const promptLink = page.getByRole('link', { name: /view details/i }).first()
    const hasLink = (await promptLink.count()) > 0
    test.skip(!hasLink, 'no prompts available')

    await promptLink.click()
    await page.waitForLoadState('domcontentloaded')

    if (baseURL) {
      const base = new URL(baseURL)
      const current = new URL(page.url())
      expect(current.origin).toBe(base.origin)
      expect(current.pathname.startsWith('/dashboard/prompts/')).toBeTruthy()
    }

    await page.waitForTimeout(200)
    expect(errors, errors.length ? `Errors on prompts detail: \n${errors.join('\n')}` : 'no errors').toHaveLength(0)
  })
})
