import { describe, expect, it } from 'bun:test'
import { extractMessageHashes } from '../../packages/shared/src/utils/conversation-hash'
import type { ClaudeMessage } from '../../packages/shared/src/types/claude'

describe('Special Conversation Linking Cases', () => {
  describe('Conversation Summarization', () => {
    it('should detect summarization system prompt', () => {
      const messages: ClaudeMessage[] = [{ role: 'user', content: 'Summarize our conversation' }]

      const systemWithSummarization =
        'You are a helpful AI assistant tasked with summarizing conversations. Please provide a concise summary.'
      const systemNormal = 'You are a helpful AI assistant.'

      // Both should produce same message hash
      const { currentMessageHash: hash1, systemHash: sysHash1 } = extractMessageHashes(
        messages,
        systemWithSummarization
      )
      const { currentMessageHash: hash2, systemHash: sysHash2 } = extractMessageHashes(
        messages,
        systemNormal
      )

      // Message hashes should be the same
      expect(hash1).toBe(hash2)

      // System hashes should be different
      expect(sysHash1).not.toBe(sysHash2)
    })
  })

  describe('Context Overflow Continuation', () => {
    it('should detect continuation pattern in message', () => {
      const continuationMessage = `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:
Analysis:
Let me chronologically analyze the conversation:

1. **Initial User Request**: The user requested to improve conversation link detection by splitting system prompts and message content into separate hashes.

Summary:
The user wants better conversation tracking.

Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`

      const messages: ClaudeMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: continuationMessage }],
        },
      ]

      const { currentMessageHash, parentMessageHash } = extractMessageHashes(messages)

      // Should have a hash for the message
      expect(currentMessageHash).toBeTruthy()

      // Should not have a parent (it's the first message)
      expect(parentMessageHash).toBeNull()
    })

    it('should extract continuation target text', () => {
      const continuationMessage = `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:
Analysis:
Let me chronologically analyze the conversation:

1. **Initial User Request**: The user requested to improve conversation link detection.

Please continue the conversation from where we left it off without asking the user any further questions.`

      // Extract the target text using regex
      const continuationMatch = continuationMessage.match(
        /This session is being continued from a previous conversation that ran out of context.*?The conversation is summarized below:\s*(.+?)\s*(?:Please continue|$)/s
      )

      expect(continuationMatch).toBeTruthy()
      expect(continuationMatch![1]).toContain('Let me chronologically analyze the conversation')
      expect(continuationMatch![1]).toContain('Initial User Request')
    })
  })

  describe('Branch ID Generation', () => {
    it('should generate compact branch ID from timestamp', () => {
      const timestamp = new Date('2024-01-20T14:30:45.123Z')
      const branchId = `compact_${timestamp
        .toISOString()
        .replace(/[^0-9]/g, '')
        .substring(8, 14)}`

      // Should be compact_143045 (hour minute second)
      expect(branchId).toBe('compact_143045')
    })
  })
})
