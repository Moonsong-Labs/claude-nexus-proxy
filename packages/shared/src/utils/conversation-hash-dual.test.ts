import { describe, expect, it } from 'bun:test'
import {
  hashMessagesOnly,
  hashSystemPrompt,
  extractMessageHashes,
  extractMessageHashesLegacy,
} from './conversation-hash'
import type { ClaudeMessage } from '../types/claude'

describe('Dual Hash System', () => {
  const testMessages: ClaudeMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
  ]

  const testSystem = 'You are a helpful assistant.'
  const testSystemWithGitStatus = `You are a helpful assistant.
gitStatus: On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean

Current branch: main
Main branch: main

Status:
(clean)

Recent commits:
abc123 fix: some bug
def456 feat: new feature`

  describe('hashMessagesOnly', () => {
    it('should hash messages without system prompt', () => {
      const hash = hashMessagesOnly(testMessages)
      expect(hash).toBeTruthy()
      expect(hash.length).toBe(64) // SHA-256 hex string
    })

    it('should return empty string for empty messages', () => {
      const hash = hashMessagesOnly([])
      expect(hash).toBe('')
    })

    it('should produce consistent hashes', () => {
      const hash1 = hashMessagesOnly(testMessages)
      const hash2 = hashMessagesOnly(testMessages)
      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different messages', () => {
      const messages2 = [...testMessages, { role: 'assistant', content: 'I am fine!' }]
      const hash1 = hashMessagesOnly(testMessages)
      const hash2 = hashMessagesOnly(messages2)
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('hashSystemPrompt', () => {
    it('should hash system prompt', () => {
      const hash = hashSystemPrompt(testSystem)
      expect(hash).toBeTruthy()
      expect(hash?.length).toBe(64)
    })

    it('should return null for no system prompt', () => {
      expect(hashSystemPrompt()).toBe(null)
      expect(hashSystemPrompt('')).toBe(null)
    })

    it('should produce same hash for system with and without git status', () => {
      const hash1 = hashSystemPrompt(testSystem)
      const hash2 = hashSystemPrompt(testSystemWithGitStatus)
      // Should be different because git status is included
      expect(hash1).not.toBe(hash2)

      // But if we have the same system prompt with different git status
      const systemWithGit1 = testSystemWithGitStatus
      const systemWithGit2 = testSystemWithGitStatus.replace('abc123', 'xyz789')
      const hash3 = hashSystemPrompt(systemWithGit1)
      const hash4 = hashSystemPrompt(systemWithGit2)
      // These should be the same because git status is filtered out
      expect(hash3).toBe(hash4)
    })
  })

  describe('extractMessageHashes', () => {
    it('should extract all three hashes', () => {
      const result = extractMessageHashes(testMessages, testSystem)

      expect(result.currentMessageHash).toBeTruthy()
      expect(result.parentMessageHash).toBeTruthy()
      expect(result.systemHash).toBeTruthy()

      // Verify hashes are different
      expect(result.currentMessageHash).not.toBe(result.parentMessageHash)
      expect(result.currentMessageHash).not.toBe(result.systemHash)
    })

    it('should return null parent hash for single message', () => {
      const singleMessage = [testMessages[0]]
      const result = extractMessageHashes(singleMessage, testSystem)

      expect(result.currentMessageHash).toBeTruthy()
      expect(result.parentMessageHash).toBe(null)
      expect(result.systemHash).toBeTruthy()
    })

    it('should return null system hash when no system prompt', () => {
      const result = extractMessageHashes(testMessages)

      expect(result.currentMessageHash).toBeTruthy()
      expect(result.parentMessageHash).toBeTruthy()
      expect(result.systemHash).toBe(null)
    })

    it('should produce same message hashes regardless of system prompt', () => {
      const result1 = extractMessageHashes(testMessages, testSystem)
      const result2 = extractMessageHashes(testMessages, testSystemWithGitStatus)

      // Message hashes should be the same
      expect(result1.currentMessageHash).toBe(result2.currentMessageHash)
      expect(result1.parentMessageHash).toBe(result2.parentMessageHash)

      // System hashes should be different
      expect(result1.systemHash).not.toBe(result2.systemHash)
    })
  })

  describe('Legacy compatibility', () => {
    it('should maintain different behavior between new and legacy functions', () => {
      const newResult = extractMessageHashes(testMessages, testSystem)
      const legacyResult = extractMessageHashesLegacy(testMessages, testSystem)

      // Legacy includes system in message hash, new doesn't
      expect(newResult.currentMessageHash).not.toBe(legacyResult.currentMessageHash)
      expect(newResult.parentMessageHash).not.toBe(legacyResult.parentMessageHash)
    })
  })
})
