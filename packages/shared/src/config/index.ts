/**
 * Centralized configuration for the application
 * All configuration values should be accessed through this module
 */

// Note: Environment variables should be loaded before importing this module.
// In development, use dotenv in your entry point or use bun which loads .env automatically.

// Helper to parse environment variables
const env = {
  string: (key: string, defaultValue: string): string => {
    return process.env[key] || defaultValue
  },
  int: (key: string, defaultValue: number): number => {
    const value = process.env[key]
    return value ? parseInt(value, 10) : defaultValue
  },
  bool: (key: string, defaultValue: boolean): boolean => {
    const value = process.env[key]
    if (!value) {
      return defaultValue
    }
    return value.toLowerCase() === 'true'
  },
}

export const config = {
  // Server configuration
  server: {
    port: env.int('PORT', 3000),
    host: env.string('HOST', '0.0.0.0'),
    env: env.string('NODE_ENV', 'development'),
    isProduction: process.env.NODE_ENV === 'production',
    timeout: env.int('PROXY_SERVER_TIMEOUT', 660000), // 11 minutes (longer than max request + retries)
  },

  // API configuration
  api: {
    claudeBaseUrl: env.string('CLAUDE_API_BASE_URL', 'https://api.anthropic.com'),
    claudeTimeout: env.int('CLAUDE_API_TIMEOUT', 600000), // 10 minutes
    oauthClientId: env.string('CLAUDE_OAUTH_CLIENT_ID', ''),
  },

  // Authentication
  auth: {
    credentialsDir: env.string('CREDENTIALS_DIR', 'credentials'),
  },

  // Database configuration
  database: {
    url: env.string('DATABASE_URL', ''),
    host: env.string('DB_HOST', 'localhost'),
    port: env.int('DB_PORT', 5432),
    name: env.string('DB_NAME', 'claude_proxy'),
    user: env.string('DB_USER', 'postgres'),
    password: env.string('DB_PASSWORD', ''),
    ssl: env.bool('DB_SSL', process.env.NODE_ENV === 'production'),
    poolSize: env.int('DB_POOL_SIZE', 20),
  },

  // Storage configuration
  storage: {
    enabled: env.bool('STORAGE_ENABLED', false),
    batchSize: env.int('STORAGE_BATCH_SIZE', 100),
    batchInterval: env.int('STORAGE_BATCH_INTERVAL', 5000),
  },

  // Rate limiting
  rateLimit: {
    windowMs: env.int('RATE_LIMIT_WINDOW_MS', 3600000), // 1 hour
    maxRequests: env.int('RATE_LIMIT_MAX_REQUESTS', 1000),
    maxTokens: env.int('RATE_LIMIT_MAX_TOKENS', 1000000),
    domainWindowMs: env.int('DOMAIN_RATE_LIMIT_WINDOW_MS', 3600000),
    domainMaxRequests: env.int('DOMAIN_RATE_LIMIT_MAX_REQUESTS', 5000),
    domainMaxTokens: env.int('DOMAIN_RATE_LIMIT_MAX_TOKENS', 5000000),
  },

  // Circuit breaker
  circuitBreaker: {
    failureThreshold: env.int('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
    successThreshold: env.int('CIRCUIT_BREAKER_SUCCESS_THRESHOLD', 3),
    timeout: env.int('CIRCUIT_BREAKER_TIMEOUT', 120000), // 2 minutes
    volumeThreshold: env.int('CIRCUIT_BREAKER_VOLUME_THRESHOLD', 10),
    errorThresholdPercentage: env.int('CIRCUIT_BREAKER_ERROR_PERCENTAGE', 50),
  },

  // Request validation
  validation: {
    maxRequestSize: env.int('MAX_REQUEST_SIZE', 10 * 1024 * 1024), // 10MB
    maxMessageCount: env.int('MAX_MESSAGE_COUNT', 100),
    maxSystemLength: env.int('MAX_SYSTEM_LENGTH', 10000),
    maxMessageLength: env.int('MAX_MESSAGE_LENGTH', 100000),
    maxTotalLength: env.int('MAX_TOTAL_LENGTH', 500000),
  },

  // Logging
  logging: {
    level: env.string('LOG_LEVEL', 'info'),
    prettyPrint: !env.bool('LOG_JSON', process.env.NODE_ENV === 'production'),
  },

  // Slack configuration
  slack: {
    webhookUrl: env.string('SLACK_WEBHOOK_URL', ''),
    channel: env.string('SLACK_CHANNEL', ''),
    username: env.string('SLACK_USERNAME', 'Claude Proxy'),
    iconEmoji: env.string('SLACK_ICON_EMOJI', ':robot_face:'),
    // Only enable if webhook URL is provided
    enabled: env.bool('SLACK_ENABLED', !!env.string('SLACK_WEBHOOK_URL', '')),
  },

  // Spark API configuration
  spark: {
    apiUrl: env.string('SPARK_API_URL', 'http://localhost:8000'),
    apiKey: env.string('SPARK_API_KEY', ''),
    enabled: env.bool('SPARK_ENABLED', !!env.string('SPARK_API_KEY', '')),
  },

  // Telemetry
  telemetry: {
    endpoint: env.string('TELEMETRY_ENDPOINT', ''),
    enabled: env.bool('TELEMETRY_ENABLED', true),
  },

  // Feature flags
  features: {
    debug: env.bool('DEBUG', false),
    enableHealthChecks: env.bool('ENABLE_HEALTH_CHECKS', true),
    enableMetrics: env.bool('ENABLE_METRICS', true),
    enableNotifications: env.bool('ENABLE_NOTIFICATIONS', true),
    enableDashboard: env.bool('ENABLE_DASHBOARD', true),
    collectTestSamples: env.bool('COLLECT_TEST_SAMPLES', false),
    testSamplesDir: env.string('TEST_SAMPLES_DIR', 'test-samples'),
    enableClientAuth: env.bool('ENABLE_CLIENT_AUTH', true),
  },

  // Cache configuration
  cache: {
    messageCacheSize: env.int('MESSAGE_CACHE_SIZE', 1000),
    credentialCacheTTL: env.int('CREDENTIAL_CACHE_TTL', 3600000), // 1 hour
    credentialCacheSize: env.int('CREDENTIAL_CACHE_SIZE', 100),
  },

  // AI Analysis configuration
  aiAnalysis: {
    // Gemini API configuration
    geminiApiKey: env.string('GEMINI_API_KEY', ''),
    geminiApiUrl: env.string(
      'GEMINI_API_URL',
      'https://generativelanguage.googleapis.com/v1beta/models'
    ),
    geminiModelName: env.string('GEMINI_MODEL_NAME', 'gemini-2.0-flash-exp'),

    // Security configurations
    maxRetries: env.int('AI_ANALYSIS_MAX_RETRIES', 2),
    requestTimeoutMs: env.int('AI_ANALYSIS_REQUEST_TIMEOUT_MS', 60000), // 60 seconds

    // Rate limiting
    rateLimits: {
      creation: env.int('AI_ANALYSIS_RATE_LIMIT_CREATION', 15), // 15 per minute
      retrieval: env.int('AI_ANALYSIS_RATE_LIMIT_RETRIEVAL', 100), // 100 per minute
    },

    // Worker configuration
    workerEnabled: env.bool('AI_WORKER_ENABLED', false),
    workerPollIntervalMs: env.int('AI_WORKER_POLL_INTERVAL_MS', 5000),
    workerMaxConcurrentJobs: env.int('AI_WORKER_MAX_CONCURRENT_JOBS', 3),
    workerJobTimeoutMinutes: env.int('AI_WORKER_JOB_TIMEOUT_MINUTES', 5),

    // Security features
    enablePIIRedaction: env.bool('AI_ANALYSIS_ENABLE_PII_REDACTION', true),
    enablePromptInjectionProtection: env.bool(
      'AI_ANALYSIS_ENABLE_PROMPT_INJECTION_PROTECTION',
      true
    ),
    enableOutputValidation: env.bool('AI_ANALYSIS_ENABLE_OUTPUT_VALIDATION', true),
    enableAuditLogging: env.bool('AI_ANALYSIS_ENABLE_AUDIT_LOGGING', true),
  },
}

// Validate required configuration
export function validateConfig(): void {
  const errors: string[] = []

  // Check for critical missing configuration
  if (config.storage.enabled && !config.database.url && !config.database.host) {
    errors.push('Storage is enabled but no database configuration provided')
  }

  if (
    config.slack.enabled &&
    config.slack.webhookUrl &&
    !config.slack.webhookUrl.startsWith('https://')
  ) {
    errors.push('Invalid Slack webhook URL')
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`)
  }
}

// Export type for configuration
export type Config = typeof config

// Export AI analysis configuration
export {
  ANALYSIS_PROMPT_CONFIG,
  GEMINI_CONFIG,
  AI_WORKER_CONFIG,
  AI_ANALYSIS_CONFIG,
} from './ai-analysis.js'
