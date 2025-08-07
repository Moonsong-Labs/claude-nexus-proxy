import { test, expect } from '@playwright/test'

// List of dashboard pages to verify
const routes: { path: string; expectSelector?: string }[] = [
  { path: '/dashboard', expectSelector: 'nav' },
  { path: '/dashboard/requests', expectSelector: 'body' },
  { path: '/dashboard/token-usage', expectSelector: 'body' },
  { path: '/dashboard/usage', expectSelector: 'body' },
  { path: '/dashboard/prompts', expectSelector: 'body' },
  // In read-only mode, login may redirect to /dashboard, but still ensure no errors
  { path: '/dashboard/login', expectSelector: 'body' },
]

test.describe('Page rendering and console errors', () => {
  for (const { path, expectSelector } of routes) {
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

      // Wait for network to settle a bit for client-side fetches
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

      // Assert no console errors or page errors captured
      expect(
        errors,
        errors.length ? `Errors on ${path}:\n${errors.join('\n')}` : 'no errors'
      ).toHaveLength(0)
    })
  }
})

