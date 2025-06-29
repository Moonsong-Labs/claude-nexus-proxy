#!/usr/bin/env bun

import { hashMessagesOnly, hashSystemPrompt } from '../packages/shared/src/utils/conversation-hash'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

async function computeHashesForFixture(fixturePath: string) {
  const content = await readFile(fixturePath, 'utf-8')
  const fixture = JSON.parse(content)

  // Compute parent's current message hash
  if (fixture.parent.body.messages) {
    const parentHash = hashMessagesOnly(fixture.parent.body.messages)
    fixture.parent.current_message_hash = parentHash
    console.log(`Parent current_message_hash: ${parentHash}`)
  }

  // Compute parent's system hash
  if (fixture.parent.body.system) {
    const systemHash = hashSystemPrompt(fixture.parent.body.system)
    fixture.parent.system_hash = systemHash
    console.log(`Parent system_hash: ${systemHash}`)
  }

  // For child, compute what its parent_message_hash should be
  if (fixture.child.body.messages && fixture.child.body.messages.length >= 3) {
    // Parent hash is all messages except the last 2
    const parentMessages = fixture.child.body.messages.slice(0, -2)
    const expectedParentHash = hashMessagesOnly(parentMessages)
    console.log(`Child's expected parent_message_hash: ${expectedParentHash}`)
    console.log(
      `Matches parent's current hash: ${expectedParentHash === fixture.parent.current_message_hash}`
    )
  }

  // Write back the updated fixture
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2))
  console.log(`Updated fixture: ${fixturePath}`)
}

// Run on the fixture
const fixturePath =
  process.argv[2] ||
  join(
    __dirname,
    '../packages/shared/src/utils/__tests__/fixtures/conversation-linking/01-simple-continuation.json'
  )
computeHashesForFixture(fixturePath)
