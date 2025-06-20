#!/usr/bin/env bun
/**
 * Script to continuously link sub-task conversations
 * Runs periodically to find and link new sub-tasks
 */

import { Pool } from 'pg'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
const envPath = path.join(process.cwd(), '../../.env')
dotenv.config({ path: envPath })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

async function linkSubtasks() {
  const client = await pool.connect()

  try {
    // Find requests with Task invocations that might have sub-tasks to link
    const parentTasksQuery = `
      SELECT 
        request_id,
        task_tool_invocation,
        timestamp
      FROM api_requests
      WHERE task_tool_invocation IS NOT NULL
      AND timestamp > NOW() - INTERVAL '1 hour'
    `

    const { rows: parentTasks } = await client.query(parentTasksQuery)

    console.log(`Found ${parentTasks.length} requests with Task invocations in the last hour`)

    let totalLinked = 0

    for (const parent of parentTasks) {
      for (const task of parent.task_tool_invocation) {
        const taskPrompt = task.input?.prompt || task.input?.description || ''

        if (!taskPrompt) continue

        // Link conversations that match this task prompt
        const linkQuery = `
          UPDATE api_requests
          SET parent_task_request_id = $1,
              is_subtask = true
          WHERE conversation_id IN (
            SELECT DISTINCT ar.conversation_id
            FROM api_requests ar
            WHERE ar.timestamp > $2
            AND ar.timestamp < $2 + interval '30 seconds'
            AND ar.timestamp = (
              SELECT MIN(timestamp) FROM api_requests WHERE conversation_id = ar.conversation_id
            )
            AND body->'messages'->0->>'role' = 'user'
            AND (
              -- Check if content matches (handling both string and array formats)
              (body->'messages'->0->>'content' = $3)
              OR 
              (body->'messages'->0->'content'->0->>'text' = $3)
              OR 
              (body->'messages'->0->'content'->1->>'text' = $3)
            )
            AND parent_task_request_id IS NULL -- Not already linked
          )
          RETURNING conversation_id
        `

        const result = await client.query(linkQuery, [
          parent.request_id,
          parent.timestamp,
          taskPrompt,
        ])

        if (result.rowCount && result.rowCount > 0) {
          console.log(
            `✅ Linked ${result.rowCount} sub-task conversation(s) to parent ${parent.request_id}`
          )
          totalLinked += result.rowCount
        }
      }
    }

    if (totalLinked > 0) {
      console.log(`\n✅ Total linked: ${totalLinked} sub-task conversations`)
    } else {
      console.log('\n⏳ No new sub-tasks to link')
    }
  } catch (error) {
    console.error('❌ Error linking sub-tasks:', error)
  } finally {
    client.release()
  }
}

// Run continuously every 10 seconds
async function runContinuously() {
  console.log('🔄 Starting continuous sub-task linking...')
  console.log('Press Ctrl+C to stop\n')

  while (true) {
    await linkSubtasks()
    await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10 seconds
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down...')
  await pool.end()
  process.exit(0)
})

// Start the continuous linking
runContinuously().catch(console.error)
