#!/usr/bin/env bun

import { hashMessagesOnly } from '../packages/shared/src/utils/conversation-hash'
import { ConversationLinker } from '../packages/shared/src/utils/conversation-linker'

// Test messages
const message1 = { role: 'user', content: 'What is 2+2?' }
const message2 = { role: 'assistant', content: '2 + 2 = 4' }
const message3 = { role: 'user', content: 'What is 3+3?' }

console.log('=== Direct Hash Computation ===')
console.log('Hash of [message1]:', hashMessagesOnly([message1]))
console.log('Hash of [message1, message2]:', hashMessagesOnly([message1, message2]))
console.log(
  'Hash of [message1, message2, message3]:',
  hashMessagesOnly([message1, message2, message3])
)

// Use ConversationLinker's internal method
const linker = new ConversationLinker(
  async () => [],
  async () => null
)

console.log('\n=== ConversationLinker Hash Computation ===')
console.log('Hash of [message1] via linker:', linker.computeMessageHash([message1]))
console.log(
  'Hash of [message1, message2] via linker:',
  linker.computeMessageHash([message1, message2])
)
console.log(
  'Hash of [message1, message2, message3] via linker:',
  linker.computeMessageHash([message1, message2, message3])
)

// Compute parent hash for 3 messages (should be hash of first message only)
const allMessages = [message1, message2, message3]
const parentMessages = allMessages.slice(0, -2) // First 1 message
console.log('\n=== Parent Hash Computation ===')
console.log('Parent messages (slice(0, -2)):', parentMessages)
console.log('Parent hash:', hashMessagesOnly(parentMessages))
console.log('Parent hash via linker:', linker.computeMessageHash(parentMessages))
