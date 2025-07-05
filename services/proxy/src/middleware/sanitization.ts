import { SyncRedactor } from 'redact-pii'
import { logger } from './logger.js'

// Configure PII redaction with custom patterns
const piiRedactor = new SyncRedactor({
  customRedactors: {
    after: [
      // API keys
      { regexpPattern: /sk-ant-[a-zA-Z0-9-_]+/g, replaceWith: '[API_KEY]' },
      { regexpPattern: /cnp_[a-zA-Z0-9_]+/g, replaceWith: '[API_KEY]' },
      // JWT tokens
      {
        regexpPattern: /eyJ[a-zA-Z0-9-_]+\.eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/g,
        replaceWith: '[JWT_TOKEN]',
      },
      // Database URLs
      { regexpPattern: /postgresql:\/\/[^@]+@[^/]+\/\w+/g, replaceWith: '[DATABASE_URL]' },
      { regexpPattern: /mysql:\/\/[^@]+@[^/]+\/\w+/g, replaceWith: '[DATABASE_URL]' },
      { regexpPattern: /mongodb:\/\/[^@]+@[^/]+\/\w+/g, replaceWith: '[DATABASE_URL]' },
    ],
  },
  // Use specific replacements for built-in patterns
  builtInRedactors: {
    creditCardNumber: { replaceWith: '[CREDIT_CARD]' },
    emailAddress: { replaceWith: '[EMAIL]' },
    ipAddress: { replaceWith: '[IP_ADDRESS]' },
    phoneNumber: { replaceWith: '[PHONE]' },
    streetAddress: { replaceWith: '[ADDRESS]' },
    usSocialSecurityNumber: { replaceWith: '[SSN]' },
    zipcode: { replaceWith: '[ZIPCODE]' },
    url: { replaceWith: '[URL]' },
  },
})

export function sanitizeForLLM(content: string): string {
  const startTime = Date.now()

  try {
    // 1. First redact PII
    let sanitized = piiRedactor.redact(content)

    // 2. Remove potential control characters
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')

    // 3. Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim()

    // 4. Remove prompt injection patterns (combined regex for performance)
    const injectionPattern = new RegExp(
      [
        'ignore (previous|all) instructions?',
        'disregard (previous|all) instructions?',
        'forget everything',
        'new task:',
        'system:',
        'assistant:',
        'user:',
        '\\[INST\\]',
        '\\[\\/INST\\]',
        '<\\|im_start\\|>',
        '<\\|im_end\\|>',
      ].join('|'),
      'gi'
    )

    sanitized = sanitized.replace(injectionPattern, '[FILTERED]')

    // 5. Escape HTML-like special characters to prevent command interpretation
    sanitized = sanitized
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    // 6. Length limiting
    const MAX_CONTENT_LENGTH = 50000
    if (sanitized.length > MAX_CONTENT_LENGTH) {
      sanitized = sanitized.substring(0, MAX_CONTENT_LENGTH) + '... [TRUNCATED]'
    }

    logger.debug(`Content sanitized in ${Date.now() - startTime}ms`, {
      metadata: {
        originalLength: content.length,
        sanitizedLength: sanitized.length,
        piiRedacted: content !== piiRedactor.redact(content),
      },
    })

    return sanitized
  } catch (error) {
    logger.error('Error sanitizing content', { error })
    // On error, return a safe fallback
    return '[SANITIZATION_ERROR]'
  }
}

export interface ValidationResult {
  isValid: boolean
  issues: string[]
}

export function validateAnalysisOutput(output: string): ValidationResult {
  const issues: string[] = []

  // More flexible section detection
  const requiredSections = [
    { name: 'summary', pattern: /summary:?/i },
    { name: 'key topics', pattern: /key\s+topics?:?/i },
    { name: 'patterns', pattern: /patterns?:?/i },
  ]

  requiredSections.forEach(section => {
    if (!section.pattern.test(output)) {
      issues.push(`Missing required section: ${section.name}`)
    }
  })

  // Scan for PII leakage in output
  const outputWithRedactedPII = piiRedactor.redact(output)
  if (outputWithRedactedPII !== output) {
    issues.push('Output contains PII that needs to be redacted')
  }

  // Check for suspicious content
  const suspiciousPatterns = [
    /password\s*[:=]\s*\S+/i,
    /api[_\s-]?key\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
    /token\s*[:=]\s*\S+/i,
  ]

  suspiciousPatterns.forEach(pattern => {
    if (pattern.test(output)) {
      issues.push('Output contains potentially sensitive information')
    }
  })

  return {
    isValid: issues.length === 0,
    issues,
  }
}

export function enhancePromptForRetry(originalPrompt: string): string {
  return (
    originalPrompt +
    `

IMPORTANT: Your response MUST include these three clearly labeled sections:
1. "Summary:" followed by a brief summary
2. "Key Topics:" followed by the main topics discussed
3. "Patterns:" followed by any notable patterns observed`
  )
}
