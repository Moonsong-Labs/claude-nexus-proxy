#!/usr/bin/env bun

import { ConversationLinker } from '../packages/shared/src/utils/conversation-linker'
import { readFile } from 'fs/promises'
import { join } from 'path'

async function debugFixture() {
  const fixturePath = join(
    __dirname,
    '../packages/shared/src/utils/__tests__/fixtures/conversation-linking/01-simple-continuation.json'
  )
  const content = await readFile(fixturePath, 'utf-8')
  const testCase = JSON.parse(content)

  console.log('=== Test Case ===')
  console.log('Type:', testCase.type)
  console.log('Expected Link:', testCase.expectedLink)
  console.log('Parent current_message_hash:', testCase.parent.current_message_hash)
  console.log('Parent messages:', testCase.parent.body.messages)
  console.log('Child messages:', testCase.child.body.messages)

  // Create linker with debug logging
  const mockQueryExecutor = async (criteria: any) => {
    console.log('\n=== Query Executor Called ===')
    console.log('Criteria:', criteria)

    if (criteria.currentMessageHash === testCase.parent.current_message_hash) {
      console.log('Returning parent!')
      return [
        {
          request_id: testCase.parent.request_id,
          conversation_id: testCase.parent.conversation_id,
          branch_id: testCase.parent.branch_id || 'main',
          current_message_hash: testCase.parent.current_message_hash,
          system_hash: testCase.parent.system_hash,
        },
      ]
    }
    console.log('No match found')
    return []
  }

  const mockCompactSearchExecutor = async () => null

  const linker = new ConversationLinker(mockQueryExecutor, mockCompactSearchExecutor)

  // Try to link
  const request = {
    domain: testCase.child.domain,
    messages: testCase.child.body.messages,
    systemPrompt: testCase.child.body.system,
    requestId: testCase.child.request_id,
    messageCount: testCase.child.body.messages.length,
  }

  console.log('\n=== Linking Request ===')
  console.log('Domain:', request.domain)
  console.log('Message Count:', request.messageCount)

  const result = await linker.linkConversation(request)

  console.log('\n=== Result ===')
  console.log('Result:', result)
  console.log('Expected conversation_id:', testCase.parent.conversation_id)
  console.log('Actual conversation_id:', result.conversationId)
}

debugFixture().catch(console.error)
