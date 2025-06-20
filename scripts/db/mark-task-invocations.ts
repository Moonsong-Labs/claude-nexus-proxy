#!/usr/bin/env bun
/**
 * Simple script to mark all requests that have Task tool invocations
 */

import { Pool } from 'pg'
import { getErrorMessage } from '@claude-nexus/shared'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is required')
  process.exit(1)
}

async function markTaskInvocations() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  try {
    console.log('🔍 Finding and marking Task tool invocations...')

    // Update all requests that have Task tool invocations in their response
    const updateQuery = `
      UPDATE api_requests
      SET task_tool_invocation = (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', tool.value->>'id',
            'name', tool.value->>'name',
            'prompt', tool.value->'input'->>'prompt',
            'description', tool.value->'input'->>'description'
          )
        )
        FROM jsonb_array_elements(response_body->'content') AS tool
        WHERE tool.value->>'type' = 'tool_use' 
        AND tool.value->>'name' = 'Task'
      )
      WHERE response_body IS NOT NULL
      AND response_body->'content' IS NOT NULL
      AND EXISTS (
        SELECT 1 
        FROM jsonb_array_elements(response_body->'content') AS tool
        WHERE tool.value->>'type' = 'tool_use' 
        AND tool.value->>'name' = 'Task'
      )
      AND task_tool_invocation IS NULL
      RETURNING request_id, conversation_id
    `

    const { rows: markedRequests } = await pool.query(updateQuery)
    console.log(`✅ Marked ${markedRequests.length} requests with Task invocations`)

    // Mark conversations as sub-tasks based on simple criteria:
    // If a conversation starts after a Task invocation, it's likely a sub-task
    console.log('\n🔗 Looking for potential sub-task conversations...')

    // For each marked request, find conversations that started shortly after
    for (const request of markedRequests) {
      const findSubtasksQuery = `
        WITH task_time AS (
          SELECT timestamp, task_tool_invocation
          FROM api_requests
          WHERE request_id = $1
        )
        UPDATE api_requests ar
        SET 
          parent_task_request_id = $1,
          is_subtask = true
        FROM task_time tt
        WHERE ar.conversation_id IN (
          SELECT DISTINCT conversation_id
          FROM api_requests
          WHERE timestamp > tt.timestamp
          AND timestamp < tt.timestamp + interval '2 minutes'
          AND conversation_id != $2
          AND parent_task_request_id IS NULL
        )
        RETURNING ar.conversation_id
      `

      const { rows: linkedConversations } = await pool.query(findSubtasksQuery, [
        request.request_id,
        request.conversation_id,
      ])

      if (linkedConversations.length > 0) {
        console.log(
          `  ✅ Linked ${linkedConversations.length} sub-task conversations to request ${request.request_id}`
        )

        // Update the parent task with linked conversation IDs
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
          request.request_id,
          JSON.stringify(linkedConversations[0].conversation_id),
        ])
      }
    }

    console.log('\n✨ Processing complete!')
  } catch (error) {
    console.error('Error processing tasks:', getErrorMessage(error))
  } finally {
    await pool.end()
  }
}

// Run the script
markTaskInvocations()
