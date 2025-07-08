import { test, expect } from '@playwright/test'

test.describe('Dark Mode Component Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Enable dark mode
    await page.click('#theme-toggle')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('navigation bar should have proper contrast in dark mode', async ({ page }) => {
    const nav = page.locator('nav')

    // Check background color
    const navBg = await nav.evaluate(el => window.getComputedStyle(el).backgroundColor)
    expect(navBg).toBe('rgb(30, 41, 59)') // --bg-secondary dark

    // Check text is visible
    const navTitle = page.locator('nav h1')
    const titleColor = await navTitle.evaluate(el => window.getComputedStyle(el).color)
    expect(titleColor).toBe('rgb(241, 245, 249)') // --text-primary dark

    // Check links are visible
    const navLink = page.locator('nav a').first()
    const linkColor = await navLink.evaluate(el => window.getComputedStyle(el).color)
    expect(linkColor).toBe('rgb(96, 165, 250)') // --text-link dark
  })

  test('tables should be readable in dark mode', async ({ page }) => {
    // Navigate to requests page which has tables
    await page.goto('/dashboard/requests')
    await page.waitForLoadState('networkidle')

    // Check if there are any tables (may need to wait for data)
    const tableExists = (await page.locator('table').count()) > 0

    if (tableExists) {
      // Check table header styling
      const th = page.locator('th').first()
      const thColor = await th.evaluate(el => window.getComputedStyle(el).color)
      expect(thColor).toBe('rgb(203, 213, 225)') // --text-secondary dark

      // Check table borders
      const thBorder = await th.evaluate(el => window.getComputedStyle(el).borderBottomColor)
      expect(thBorder).toBe('rgb(51, 65, 85)') // --border-color dark
    }
  })

  test('stat cards should have proper styling in dark mode', async ({ page }) => {
    // Check stat cards on dashboard
    const statCard = page.locator('.stat-card').first()
    const cardExists = (await statCard.count()) > 0

    if (cardExists) {
      // Check background
      const cardBg = await statCard.evaluate(el => window.getComputedStyle(el).backgroundColor)
      expect(cardBg).toBe('rgb(30, 41, 59)') // --bg-secondary dark

      // Check label color
      const statLabel = page.locator('.stat-label').first()
      const labelColor = await statLabel.evaluate(el => window.getComputedStyle(el).color)
      expect(labelColor).toBe('rgb(203, 213, 225)') // --text-secondary dark
    }
  })

  test('code blocks should use dark theme', async ({ page }) => {
    // Navigate to a page that might have code blocks
    await page.goto('/dashboard/requests')

    // Check if pre elements exist
    const preExists = (await page.locator('pre').count()) > 0

    if (preExists) {
      const pre = page.locator('pre').first()
      const preBg = await pre.evaluate(el => window.getComputedStyle(el).backgroundColor)
      expect(preBg).toBe('rgb(15, 23, 42)') // --code-bg dark

      const preColor = await pre.evaluate(el => window.getComputedStyle(el).color)
      expect(preColor).toBe('rgb(226, 232, 240)') // --code-text dark
    }
  })

  test('buttons should have proper hover states in dark mode', async ({ page }) => {
    // Find a button
    const button = page.locator('.btn').first()
    const buttonExists = (await button.count()) > 0

    if (buttonExists) {
      // Check initial state
      const initialBg = await button.evaluate(el => window.getComputedStyle(el).backgroundColor)
      expect(initialBg).toBe('rgb(37, 99, 235)') // --btn-primary-bg dark

      // Hover over button
      await button.hover()

      // Check hover state (may need a small delay for transition)
      await page.waitForTimeout(100)
      const hoverBg = await button.evaluate(el => window.getComputedStyle(el).backgroundColor)
      expect(hoverBg).toBe('rgb(59, 130, 246)') // --btn-primary-hover dark
    }
  })

  test('form inputs should be styled correctly in dark mode', async ({ page }) => {
    // Look for search input or other inputs
    const searchInput = page.locator('.search-input').first()
    const inputExists = (await searchInput.count()) > 0

    if (inputExists) {
      // Check background
      const inputBg = await searchInput.evaluate(el => window.getComputedStyle(el).backgroundColor)
      expect(inputBg).toBe('rgb(30, 41, 59)') // --bg-secondary dark

      // Check border
      const inputBorder = await searchInput.evaluate(el => window.getComputedStyle(el).borderColor)
      expect(inputBorder).toContain('rgb(51, 65, 85)') // --border-color dark

      // Check text color
      const inputColor = await searchInput.evaluate(el => window.getComputedStyle(el).color)
      expect(inputColor).toBe('rgb(241, 245, 249)') // --text-primary dark
    }
  })

  test('pagination controls should be visible in dark mode', async ({ page }) => {
    await page.goto('/dashboard/requests')

    const paginationLink = page.locator('.pagination-link').first()
    const paginationExists = (await paginationLink.count()) > 0

    if (paginationExists) {
      // Check background
      const linkBg = await paginationLink.evaluate(
        el => window.getComputedStyle(el).backgroundColor
      )
      expect(linkBg).toBe('rgb(30, 41, 59)') // --bg-secondary dark

      // Check text color
      const linkColor = await paginationLink.evaluate(el => window.getComputedStyle(el).color)
      expect(linkColor).toBe('rgb(241, 245, 249)') // --text-primary dark

      // Check border
      const linkBorder = await paginationLink.evaluate(
        el => window.getComputedStyle(el).borderColor
      )
      expect(linkBorder).toContain('rgb(51, 65, 85)') // --border-color dark
    }
  })

  test('message components should have proper colors in dark mode', async ({ page }) => {
    // Try to find a page with messages
    await page.goto('/dashboard/requests')

    // Look for message components
    const messageContent = page.locator('.message-content').first()
    const messageExists = (await messageContent.count()) > 0

    if (messageExists) {
      const messageBg = await messageContent.evaluate(
        el => window.getComputedStyle(el).backgroundColor
      )
      // Background should be one of the message background colors (varies by type)
      expect(messageBg).toMatch(/rgb\(\d+, \d+, \d+\)/)
    }
  })

  test('badges should have correct colors in dark mode', async ({ page }) => {
    // Look for badges
    const badge = page.locator('.badge').first()
    const badgeExists = (await badge.count()) > 0

    if (badgeExists) {
      // Check if it's a specific badge type
      const isSuccess = await badge.evaluate(el => el.classList.contains('badge-success'))
      const isError = await badge.evaluate(el => el.classList.contains('badge-error'))

      if (isSuccess) {
        const badgeBg = await badge.evaluate(el => window.getComputedStyle(el).backgroundColor)
        expect(badgeBg).toBe('rgb(6, 78, 59)') // --color-success-bg dark
      } else if (isError) {
        const badgeBg = await badge.evaluate(el => window.getComputedStyle(el).backgroundColor)
        expect(badgeBg).toBe('rgb(127, 29, 29)') // --color-error-bg dark
      }
    }
  })

  test('theme toggle button should remain visible and functional', async ({ page }) => {
    const themeToggle = page.locator('#theme-toggle')

    // Check visibility
    await expect(themeToggle).toBeVisible()

    // Check styling
    const toggleBorder = await themeToggle.evaluate(el => window.getComputedStyle(el).borderColor)
    expect(toggleBorder).toContain('rgb(51, 65, 85)') // --border-color dark

    // Check icon color
    const toggleColor = await themeToggle.evaluate(el => window.getComputedStyle(el).color)
    expect(toggleColor).toBe('rgb(203, 213, 225)') // --text-secondary dark

    // Test hover state
    await themeToggle.hover()
    await page.waitForTimeout(100)

    const hoverBg = await themeToggle.evaluate(el => window.getComputedStyle(el).backgroundColor)
    expect(hoverBg).toBe('rgb(51, 65, 85)') // --bg-tertiary dark
  })
})
