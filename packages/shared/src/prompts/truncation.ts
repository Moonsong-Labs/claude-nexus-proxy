import { fromPreTrained } from '@lenml/tokenizer-gemini'
import { ANALYSIS_PROMPT_CONFIG } from '../config/ai-analysis.js'

// Define a Message type if not already available
export interface Message {
  role: 'user' | 'model'
  content: string
}

// Helper type for tokenized messages
type TokenizedMessage = {
  message: Message
  index: number
  tokenCount: number
}

const tokenizer = fromPreTrained()

/**
 * Truncates a conversation to fit within a token limit, preserving the
 * first and last messages as per the configured strategy.
 *
 * Priority is given to the tail messages. If the combined head and tail
 * still exceed the limit, head messages are dropped. If the tail alone
 * exceeds the limit, tail messages are dropped from the start of the tail.
 *
 * Handles edge cases including:
 * - Conversations shorter than head+tail size (avoids duplication)
 * - Single messages that exceed the token limit
 * - Proper insertion of truncation markers
 */
export function truncateConversation(messages: Message[]): Message[] {
  const { MAX_PROMPT_TOKENS, TRUNCATION_STRATEGY } = ANALYSIS_PROMPT_CONFIG
  const { HEAD_MESSAGES, TAIL_MESSAGES } = TRUNCATION_STRATEGY

  // 1. Pre-tokenize all messages for efficiency and to preserve original index.
  const tokenizedMessages: TokenizedMessage[] = messages.map((msg, i) => ({
    message: msg,
    index: i,
    tokenCount: tokenizer.encode(JSON.stringify(msg)).length,
  }))

  const totalTokenCount = tokenizedMessages.reduce((sum, m) => sum + m.tokenCount, 0)
  if (totalTokenCount <= MAX_PROMPT_TOKENS) {
    return messages
  }

  // 2. Define head and tail slices from the tokenized array.
  const headSlice = tokenizedMessages.slice(0, HEAD_MESSAGES)
  const tailSlice = tokenizedMessages.slice(-TAIL_MESSAGES)

  // 3. Handle extreme edge case: The tail alone is too large.
  let tailTokenCount = tailSlice.reduce((sum, m) => sum + m.tokenCount, 0)
  while (tailTokenCount > MAX_PROMPT_TOKENS && tailSlice.length > 1) {
    const removed = tailSlice.shift() // Remove from the start of the tail
    if (removed) {
      tailTokenCount -= removed.tokenCount
    }
  }

  // Handle single message that's too big
  if (tailSlice.length === 1 && tailTokenCount > MAX_PROMPT_TOKENS) {
    const singleMessage = { ...tailSlice[0].message }
    // A more sophisticated implementation might find the exact cut-off point.
    // For now, a simple character-based reduction is a safe fallback.
    const estimatedChars = MAX_PROMPT_TOKENS * ANALYSIS_PROMPT_CONFIG.ESTIMATED_CHARS_PER_TOKEN
    singleMessage.content =
      singleMessage.content.slice(0, estimatedChars) + '\n...[CONTENT TRUNCATED]...'
    return [singleMessage]
  }

  // 4. Preserve the tail and fit as much of the head as possible.
  const headTokenBudget = MAX_PROMPT_TOKENS - tailTokenCount
  const finalHead: TokenizedMessage[] = []
  let currentHeadTokens = 0

  for (const msg of headSlice) {
    if (currentHeadTokens + msg.tokenCount <= headTokenBudget) {
      finalHead.push(msg)
      currentHeadTokens += msg.tokenCount
    } else {
      break
    }
  }

  // 5. Correctly assemble the final list, handling overlaps and inserting the separator.
  const finalMessageMap = new Map<number, Message>()
  finalHead.forEach(m => finalMessageMap.set(m.index, m.message))
  tailSlice.forEach(m => finalMessageMap.set(m.index, m.message))

  const sortedMessages = Array.from(finalMessageMap.entries()).sort(
    ([indexA], [indexB]) => indexA - indexB
  )

  const result: Message[] = []
  let lastIndex = -1
  const separator: Message = { role: 'user', content: '[...conversation truncated...]' }
  let separatorInserted = false

  for (const [index, message] of sortedMessages) {
    if (lastIndex !== -1 && index > lastIndex + 1) {
      result.push(separator)
      separatorInserted = true
    }
    result.push(message)
    lastIndex = index
  }

  // If we truncated but didn't insert a separator, we should still indicate truncation occurred
  if (tokenizedMessages.length > result.length && !separatorInserted && result.length > 0) {
    // Insert at the beginning if no head messages were kept
    if (finalHead.length === 0 && result.length > 0) {
      // Check if the first kept message is not from the beginning
      const firstKeptIndex = sortedMessages[0]?.[0] || 0
      if (firstKeptIndex > 0) {
        result.unshift(separator)
      }
    } else if (finalHead.length > 0 && finalHead.length < result.length) {
      // Insert after the head messages
      result.splice(finalHead.length, 0, separator)
    }
  }

  return result
}
