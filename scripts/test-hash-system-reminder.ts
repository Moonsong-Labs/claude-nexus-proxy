#!/usr/bin/env bun
/**
 * Test script to verify that messages with and without system reminders
 * produce the same hash
 */

import { hashMessage, normalizeMessageContent } from '../packages/shared/dist/utils/conversation-hash.js'
import type { ClaudeMessage } from '../packages/shared/dist/types/claude.js'

// Test case 1: Message without system reminder
const messageWithoutReminder: ClaudeMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'spawn an task to list the code lines of the repo' },
    { type: 'text', text: 'Some other content' }
  ]
}

// Test case 2: Same message with system reminder inserted
const messageWithReminder: ClaudeMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'spawn an task to list the code lines of the repo' },
    { type: 'text', text: 'Some other content' },
    { type: 'text', text: '<system-reminder>This is a system reminder that should be ignored</system-reminder>' }
  ]
}

// Test case 3: System reminder in different position
const messageWithReminderFirst: ClaudeMessage = {
  role: 'user',
  content: [
    { type: 'text', text: '<system-reminder>This is a system reminder that should be ignored</system-reminder>' },
    { type: 'text', text: 'spawn an task to list the code lines of the repo' },
    { type: 'text', text: 'Some other content' }
  ]
}

console.log('Testing message hashing with system reminders...\n')

const hash1 = hashMessage(messageWithoutReminder)
const hash2 = hashMessage(messageWithReminder)
const hash3 = hashMessage(messageWithReminderFirst)

console.log('Message without reminder hash:', hash1)
console.log('Message with reminder at end hash:', hash2)
console.log('Message with reminder at start hash:', hash3)

console.log('\nHashes match:', hash1 === hash2 && hash1 === hash3)

if (hash1 === hash2 && hash1 === hash3) {
  console.log('✅ SUCCESS: System reminders are correctly ignored in message hashing')
} else {
  console.log('❌ FAILURE: System reminders are affecting message hashes')
  process.exit(1)
}