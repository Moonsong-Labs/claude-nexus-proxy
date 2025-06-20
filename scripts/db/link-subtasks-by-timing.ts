#!/usr/bin/env bun
/**
 * Link sub-task conversations based on timing
 * If a conversation starts within 30 seconds of a Task invocation, it's likely a sub-task
 */

import { Pool } from 'pg'
import { getErrorMessage } from '@claude-nexus/shared'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is required')
  process.exit(1)
}

async function linkSubtasksByTiming() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  try {
    console.log('🔍 Finding Task invocations and potential sub-tasks...')

    // Find all requests with Task tool invocations
    const taskQuery = `
      SELECT request_id, conversation_id, timestamp, task_tool_invocation
      FROM api_requests
      WHERE task_tool_invocation IS NOT NULL
      ORDER BY timestamp DESC
    `

    const { rows: taskRequests } = await pool.query(taskQuery)
    console.log(`Found ${taskRequests.length} requests with Task invocations`)

    let linkedCount = 0

    for (const taskRequest of taskRequests) {
      // Find conversations that started shortly after this Task invocation
      const linkQuery = `
        UPDATE api_requests ar
        SET 
          parent_task_request_id = $1,
          is_subtask = true
        WHERE ar.conversation_id IN (
          SELECT DISTINCT conversation_id
          FROM api_requests
          WHERE timestamp > $2
          AND timestamp < $2 + interval '30 seconds'
          AND conversation_id != $3
          AND parent_task_request_id IS NULL
        )
        RETURNING ar.conversation_id
      `

      const { rows: linkedConversations } = await pool.query(linkQuery, [
        taskRequest.request_id,
        taskRequest.timestamp,
        taskRequest.conversation_id,
      ])

      if (linkedConversations.length > 0) {
        linkedCount += linkedConversations.length
        console.log(
          `  ✅ Linked ${linkedConversations.length} sub-task conversations to ${taskRequest.request_id}`
        )

        // Update the parent task with the first linked conversation
        const updateParentQuery = `
          UPDATE api_requests
          SET task_tool_invocation = jsonb_set(
            task_tool_invocation,
            '{0,linked_conversation_id}',
            $2::jsonb
          )
          WHERE request_id = $1
        `

        await pool.query(updateParentQuery, [
          taskRequest.request_id,
          JSON.stringify(linkedConversations[0].conversation_id),
        ])
      }
    }

    console.log(`\n✨ Linked ${linkedCount} sub-task conversations total`)
  } catch (error) {
    console.error('Error linking sub-tasks:', getErrorMessage(error))
  } finally {
    await pool.end()
  }
}

// Run the script
linkSubtasksByTiming()
