/**
 * Test utilities for theme testing
 */

/**
 * Create a mock localStorage for testing
 */
export const mockLocalStorage = () => {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    clear: () => {
      Object.keys(store).forEach(key => delete store[key])
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] || null,
  }
}

/**
 * Extract CSS variables from a style string
 */
export const extractCSSVariables = (styles: string): Record<string, string> => {
  const varRegex = /--[\w-]+:\s*[^;]+/g
  const matches = styles.match(varRegex) || []
  return matches.reduce(
    (acc, match) => {
      const [key, value] = match.split(':').map(s => s.trim())
      acc[key] = value
      return acc
    },
    {} as Record<string, string>
  )
}

/**
 * Extract CSS variables from a specific selector
 */
export const extractCSSVariablesFromSelector = (
  styles: string,
  selector: string
): Record<string, string> => {
  const selectorRegex = new RegExp(`${selector}\\s*{([^}]+)}`, 's')
  const match = styles.match(selectorRegex)
  if (!match) {
    return {}
  }

  return extractCSSVariables(match[1])
}

interface MockElementOptions {
  style?: Record<string, string>
  attributes?: Record<string, string>
  listeners?: Record<string, (...args: unknown[]) => void>
  disabled?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * Mock DOM element for testing
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createMockElement = (id: string, options: MockElementOptions = {}): any => ({
  id,
  style: { display: 'block', ...(options.style || {}) },
  getAttribute: (attr: string) => options.attributes?.[attr],
  setAttribute: (attr: string, value: string) => {
    if (!options.attributes) {
      options.attributes = {}
    }
    options.attributes[attr] = value
  },
  addEventListener: (_event: string, _handler: (...args: unknown[]) => void) => {
    if (!options.listeners) {
      options.listeners = {}
    }
    options.listeners[_event] = _handler
  },
  click: () => {
    if (options.listeners?.click) {
      options.listeners.click()
    }
  },
  disabled: options.disabled || false,
  ...options,
})

/**
 * Mock document for testing
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createMockDocument = (): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: Record<string, any> = {}
  const documentElement = createMockElement('html', {
    attributes: { 'data-theme': 'light' },
  })

  return {
    getElementById: (id: string) => elements[id] || null,
    createElement: (tag: string) => createMockElement(tag),
    documentElement,
    querySelector: (selector: string) => {
      if (selector === 'html') {
        return documentElement
      }
      return null
    },
    addEventListener: (_event: string, _handler: (...args: unknown[]) => void) => {
      // Mock implementation
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setElement: (id: string, element: any) => {
      elements[id] = element
    },
    _getElements: () => elements,
  }
}

/**
 * Simulate theme toggle action
 */
export const simulateThemeToggle = (
  document: ReturnType<typeof createMockDocument>,
  localStorage: ReturnType<typeof mockLocalStorage>
) => {
  const currentTheme = document.documentElement.getAttribute('data-theme')
  const newTheme = currentTheme === 'light' ? 'dark' : 'light'

  document.documentElement.setAttribute('data-theme', newTheme)
  localStorage.setItem('theme', newTheme)

  // Update icon visibility
  const lightIcon = document.getElementById('theme-icon-light') as ReturnType<
    typeof createMockElement
  > | null
  const darkIcon = document.getElementById('theme-icon-dark') as ReturnType<
    typeof createMockElement
  > | null

  if (lightIcon && darkIcon && 'style' in lightIcon && 'style' in darkIcon) {
    if (newTheme === 'dark') {
      lightIcon.style.display = 'none'
      darkIcon.style.display = 'block'
    } else {
      lightIcon.style.display = 'block'
      darkIcon.style.display = 'none'
    }
  }

  // Update highlight.js themes
  const hljsLight = document.getElementById('hljs-light-theme') as { disabled: boolean } | null
  const hljsDark = document.getElementById('hljs-dark-theme') as { disabled: boolean } | null

  if (hljsLight && hljsDark && 'disabled' in hljsLight && 'disabled' in hljsDark) {
    if (newTheme === 'dark') {
      hljsLight.disabled = true
      hljsDark.disabled = false
    } else {
      hljsLight.disabled = false
      hljsDark.disabled = true
    }
  }

  return newTheme
}

/**
 * Parse RGB color string to values
 */
export const parseRGB = (rgbString: string): { r: number; g: number; b: number } | null => {
  const match = rgbString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!match) {
    return null
  }

  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
  }
}

/**
 * Convert hex color to RGB
 */
export const hexToRGB = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}
