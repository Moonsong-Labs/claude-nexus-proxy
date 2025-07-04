// Re-export all shared modules
export * from './types/index.js'
export * from './config/index.js'
export * from './logger/index.js'
export * from './utils/errors.js'
export * from './utils/conversation-hash.js'
export * from './utils/conversation-linker.js'
export * from './utils/system-reminder.js'

// Re-export specific functions to ensure they're available
export {
  getErrorMessage,
  getErrorStack,
  getErrorCode,
  hasStatusCode,
  isError,
  getStatusCode,
} from './utils/errors.js'

export { createLogger } from './logger/index.js'

export {
  hashMessagesOnly,
  hashSystemPrompt,
  extractMessageHashes,
  generateConversationId,
} from './utils/conversation-hash.js'

export { config } from './config/index.js'

export {
  ConversationLinker,
  type QueryExecutor,
  type CompactSearchExecutor,
  type RequestByIdExecutor,
  type SubtaskQueryExecutor,
  type SubtaskSequenceQueryExecutor,
  type LinkingRequest,
  type LinkingResult,
  type ParentQueryCriteria,
  type TaskInvocation,
} from './utils/conversation-linker.js'

export { stripSystemReminder, containsSystemReminder } from './utils/system-reminder.js'

// Export model limits configuration
export {
  MODEL_CONTEXT_RULES,
  DEFAULT_CONTEXT_LIMIT,
  BATTERY_THRESHOLDS,
  getModelContextLimit,
  getBatteryColor,
  getBatteryLevel,
  type ModelContextRule,
} from './constants/model-limits.js'
