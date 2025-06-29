import { Context, Next } from 'hono'
import { ValidationError } from '../types/errors'
import { validateClaudeRequest, ClaudeMessagesRequest } from '../types/claude'
import { getRequestLogger } from './logger'

// Request size limits
const MAX_REQUEST_SIZE = 10 * 1024 * 1024 // 10MB
// Validation middleware
export function validationMiddleware() {
  return async (c: Context, next: Next) => {
    const path = c.req.path
    const logger = getRequestLogger(c)

    // Only validate Claude API endpoints
    if (!path.startsWith('/v1/messages')) {
      return next()
    }

    // Check Content-Type
    const contentType = c.req.header('content-type')
    if (!contentType?.includes('application/json')) {
      logger.warn('Invalid content type', { contentType })
      throw new ValidationError('Content-Type must be application/json')
    }

    // Check request size
    const contentLength = parseInt(c.req.header('content-length') || '0')
    if (contentLength > MAX_REQUEST_SIZE) {
      logger.warn('Request too large', { contentLength, limit: MAX_REQUEST_SIZE })
      throw new ValidationError(`Request size exceeds limit of ${MAX_REQUEST_SIZE} bytes`)
    }

    // Parse and validate request body
    let body: any
    try {
      body = await c.req.json()
    } catch (error) {
      logger.warn('Invalid JSON body', {
        error: error instanceof Error ? { message: error.message } : { message: String(error) },
      })
      throw new ValidationError('Invalid JSON in request body')
    }

    // Basic Claude request validation
    if (!validateClaudeRequest(body)) {
      logger.warn('Invalid Claude request format', { body })
      throw new ValidationError('Invalid request format for Claude API')
    }

    // Additional validation
    const validationErrors = validateClaudeRequestDetails(body)
    if (validationErrors.length > 0) {
      logger.warn('Request validation failed', { errors: validationErrors })
      throw new ValidationError(`Request validation failed: ${validationErrors.join(', ')}`)
    }

    // Attach validated body to context
    c.set('validatedBody', body)

    logger.debug('Request validation passed')
    await next()
  }
}

// Detailed validation with security enhancements
function validateClaudeRequestDetails(request: ClaudeMessagesRequest): string[] {
  const errors: string[] = []

  // Security: Validate model name format (alphanumeric, dots, dashes)
  if (request.model && !/^[a-zA-Z0-9.\-:]+$/.test(request.model)) {
    errors.push('Invalid model name format')
  }

  // Security: Validate max_tokens is within reasonable bounds
  if (request.max_tokens !== undefined) {
    if (
      !Number.isInteger(request.max_tokens) ||
      request.max_tokens < 1 ||
      request.max_tokens > 1000000
    ) {
      errors.push('max_tokens must be between 1 and 1,000,000')
    }
  }

  // Validate temperature
  if (request.temperature !== undefined) {
    if (
      typeof request.temperature !== 'number' ||
      request.temperature < 0 ||
      request.temperature > 1
    ) {
      errors.push('temperature must be between 0 and 1')
    }
  }

  // Validate messages array
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    errors.push('messages must be a non-empty array')
    return errors
  }

  // Security: Limit total message count to prevent DoS
  const MAX_MESSAGES = 100
  if (request.messages.length > MAX_MESSAGES) {
    errors.push(`Too many messages: ${request.messages.length} (max: ${MAX_MESSAGES})`)
  }

  // Validate each message and calculate total length
  let totalLength = 0
  const MAX_MESSAGE_LENGTH = 100000 // 100KB per message
  const MAX_TOTAL_LENGTH = 500000 // 500KB total

  // Add system prompt length if present
  if (request.system) {
    const systemLength =
      typeof request.system === 'string'
        ? request.system.length
        : JSON.stringify(request.system).length
    totalLength += systemLength

    if (systemLength > MAX_MESSAGE_LENGTH) {
      errors.push(`System prompt too long: ${systemLength} characters (max: ${MAX_MESSAGE_LENGTH})`)
    }
  }

  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i]

    // Validate message structure
    if (!message || typeof message !== 'object') {
      errors.push(`Message ${i} is not a valid object`)
      continue
    }

    // Validate role
    if (!['user', 'assistant', 'system'].includes(message.role)) {
      errors.push(`Message ${i} has invalid role: ${message.role}`)
    }

    // Check message content length
    const messageLength =
      typeof message.content === 'string'
        ? message.content.length
        : JSON.stringify(message.content).length

    if (messageLength > MAX_MESSAGE_LENGTH) {
      errors.push(`Message ${i} too long: ${messageLength} characters (max: ${MAX_MESSAGE_LENGTH})`)
    }

    totalLength += messageLength

    // Check for empty content
    if (
      !message.content ||
      (typeof message.content === 'string' && message.content.trim() === '')
    ) {
      errors.push(`Message ${i} has empty content`)
    }

    // Validate content array if not string
    if (Array.isArray(message.content)) {
      for (let j = 0; j < message.content.length; j++) {
        const content = message.content[j]
        if (!content || typeof content !== 'object' || !content.type) {
          errors.push(`Message ${i} content[${j}] is invalid`)
        }
        // Security: Validate content types
        if (content.type && !['text', 'image', 'tool_use', 'tool_result'].includes(content.type)) {
          errors.push(`Message ${i} content[${j}] has invalid type: ${content.type}`)
        }
      }
    }
  }

  // Check total length
  if (totalLength > MAX_TOTAL_LENGTH) {
    errors.push(
      `Total request size too large: ${totalLength} characters (max: ${MAX_TOTAL_LENGTH})`
    )
  }

  // Validate tools if present
  if (request.tools) {
    if (!Array.isArray(request.tools)) {
      errors.push('tools must be an array')
    } else if (request.tools.length > 50) {
      errors.push(`Too many tools: ${request.tools.length} (max: 50)`)
    }
  }

  return errors
}

// Helper to sanitize error messages for client
export function sanitizeErrorMessage(message: string): string {
  // Limit message length to prevent ReDoS
  const truncatedMessage = message.length > 1000 ? message.substring(0, 1000) + '...' : message

  // Remove any potential sensitive information with simpler, safer regex patterns
  return truncatedMessage
    .replace(/sk-ant-[\w-]{1,100}/g, 'sk-ant-****')
    .replace(/Bearer\s+[\w\-._~+/]{1,200}/g, 'Bearer ****')
    .replace(/[\w._%+-]{1,50}@[\w.-]{1,50}\.\w{2,10}/g, '****@****.com')
    .replace(/password["\s:=]+["']?[\w\S]{1,50}/gi, 'password: ****')
    .replace(/api[_-]?key["\s:=]+["']?[\w\S]{1,50}/gi, 'api_key: ****')
}
