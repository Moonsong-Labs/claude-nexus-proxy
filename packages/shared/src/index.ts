// Re-export all shared modules
export * from './types/index.js'
export * from './config/index.js'
export * from './logger/index.js'
export * from './utils/errors.js'
export * from './utils/conversation-hash.js'
export * from './utils/conversation-linker.js'

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
  hashMessage,
  hashMessagesOnly,
  hashSystemPrompt,
  hashConversationState,
  hashConversationStateWithSystem,
  extractMessageHashes,
  extractMessageHashesLegacy,
  generateConversationId,
} from './utils/conversation-hash.js'

export { config } from './config/index.js'

export {
  ConversationLinker,
  type QueryExecutor,
  type CompactSearchExecutor,
  type LinkingRequest,
  type LinkingResult,
  type ParentQueryCriteria,
} from './utils/conversation-linker.js'
