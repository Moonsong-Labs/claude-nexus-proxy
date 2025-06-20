#!/usr/bin/env bun
/**
 * Script to retroactively process existing Task tool invocations
 * and link sub-task conversations
 */

import { Pool } from 'pg'
import { getErrorMessage } from '@claude-nexus/shared'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is required')
  process.exit(1)
}

async function processExistingSubtasks() {
  const pool = new Pool({ connectionString: DATABASE_URL })

  try {
    console.log('🔍 Finding requests with Task tool invocations...')

    // Find all requests that have Task tool invocations in their response body
    const findTasksQuery = `
      SELECT request_id, response_body, conversation_id
      FROM api_requests
      WHERE response_body IS NOT NULL
        AND response_body->'content' IS NOT NULL
        AND task_tool_invocation IS NULL
    `

    const { rows: requests } = await pool.query(findTasksQuery)
    console.log(`Found ${requests.length} requests to process`)

    let processedCount = 0
    let linkedCount = 0

    for (const request of requests) {
      const { request_id, response_body, conversation_id } = request

      // Check if response contains Task tool invocations
      const content = response_body.content
      if (!Array.isArray(content)) continue

      const taskInvocations = content.filter(
        (item: any) => item.type === 'tool_use' && item.name === 'Task'
      )

      if (taskInvocations.length === 0) continue

      console.log(
        `\n📋 Processing request ${request_id} with ${taskInvocations.length} Task invocations`
      )

      // Extract task details
      const taskDetails = taskInvocations.map((task: any) => ({
        id: task.id,
        name: task.name || 'Task',
        prompt: task.input?.prompt || '',
        description: task.input?.description || '',
      }))

      // Update the request with task_tool_invocation
      await pool.query('UPDATE api_requests SET task_tool_invocation = $1 WHERE request_id = $2', [
        JSON.stringify(taskDetails),
        request_id,
      ])
      processedCount++

      // Try to link sub-task conversations
      for (const task of taskDetails) {
        if (!task.prompt) continue

        // Normalize the prompt for matching
        const normalizedPrompt = task.prompt.trim()

        // Find conversations that start with this prompt
        const linkQuery = `
          UPDATE api_requests
          SET 
            parent_task_request_id = $1,
            is_subtask = true
          WHERE conversation_id IN (
            SELECT DISTINCT ar.conversation_id
            FROM api_requests ar
            WHERE ar.timestamp = (
              SELECT MIN(timestamp) FROM api_requests WHERE conversation_id = ar.conversation_id
            )
            AND (
              ar.body->'messages'->0->>'content' = $2
              OR ar.body->'messages'->0->'content'->0->>'text' = $2
              OR ar.body->'messages'->0->'content'->1->>'text' = $2
            )
          )
          AND parent_task_request_id IS NULL
          RETURNING conversation_id
        `

        const { rows: linkedConversations } = await pool.query(linkQuery, [
          request_id,
          normalizedPrompt,
        ])

        if (linkedConversations.length > 0) {
          console.log(`  ✅ Linked ${linkedConversations.length} sub-task conversations`)
          linkedCount += linkedConversations.length

          // Update the task with linked conversation ID
          const linkedConvId = linkedConversations[0].conversation_id
          const updatedTasks = taskDetails.map((t: any) =>
            t.prompt === normalizedPrompt ? { ...t, linked_conversation_id: linkedConvId } : t
          )

          await pool.query(
            'UPDATE api_requests SET task_tool_invocation = $1 WHERE request_id = $2',
            [JSON.stringify(updatedTasks), request_id]
          )
        }
      }
    }

    console.log('\n✨ Processing complete!')
    console.log(`   - Processed ${processedCount} requests with Task invocations`)
    console.log(`   - Linked ${linkedCount} sub-task conversations`)
  } catch (error) {
    console.error('Error processing sub-tasks:', getErrorMessage(error))
  } finally {
    await pool.end()
  }
}

// Run the script
processExistingSubtasks()
