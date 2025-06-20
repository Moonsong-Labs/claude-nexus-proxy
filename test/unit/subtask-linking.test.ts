import { describe, it, expect, beforeEach } from 'bun:test'
import { Pool } from 'pg'
import { StorageWriter } from '../../services/proxy/src/storage/writer'
import { randomUUID } from 'crypto'
import mainRequestSample from '../../services/proxy/test-samples/inference_streaming_with_tools_with_system_opus-1750420376296-im7ygz453.json'
import subtaskRequestSample from '../../services/proxy/test-samples/inference_streaming_with_tools_with_system_opus-1750420386819-wixegs6ph.json'

describe('Sub-task Linking', () => {
  let pool: Pool
  let writer: StorageWriter
  let testRequestId: string
  let testSubtaskRequestId: string

  beforeEach(async () => {
    // Create a test database connection
    const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is required for tests')
    }

    pool = new Pool({ connectionString: DATABASE_URL })
    writer = new StorageWriter(pool)

    // Generate test IDs
    testRequestId = randomUUID()
    testSubtaskRequestId = randomUUID()

    // Clean up any existing test data
    await pool.query('DELETE FROM api_requests WHERE request_id IN ($1, $2)', [
      testRequestId,
      testSubtaskRequestId,
    ])
  })

  afterEach(async () => {
    // Clean up test data
    await pool.query('DELETE FROM api_requests WHERE request_id IN ($1, $2)', [
      testRequestId,
      testSubtaskRequestId,
    ])
    await pool.end()
  })

  it('should detect Task tool invocations in responses', async () => {
    // Store the main request
    await writer.storeRequest({
      requestId: testRequestId,
      domain: 'test.localhost',
      timestamp: new Date(mainRequestSample.timestamp),
      method: mainRequestSample.method,
      path: mainRequestSample.path,
      headers: mainRequestSample.headers,
      body: mainRequestSample.body,
      apiKey: '',
      model: mainRequestSample.body.model,
      requestType: 'inference',
    })

    // Store the response with Task tool invocation
    await writer.storeResponse({
      requestId: testRequestId,
      statusCode: mainRequestSample.response.status,
      headers: mainRequestSample.response.headers,
      body: mainRequestSample.response.body,
      streaming: mainRequestSample.response.streaming,
      inputTokens: mainRequestSample.response.usage?.input_tokens,
      outputTokens: mainRequestSample.response.usage?.output_tokens,
      totalTokens: mainRequestSample.response.usage?.total_tokens,
      firstTokenMs: mainRequestSample.response.firstTokenMs,
      durationMs: mainRequestSample.response.durationMs,
      error: mainRequestSample.response.error,
      toolCallCount: mainRequestSample.response.toolCalls,
    })

    // Verify Task tool invocation was detected
    const { rows } = await pool.query(
      'SELECT task_tool_invocation FROM api_requests WHERE request_id = $1',
      [testRequestId]
    )

    expect(rows[0].task_tool_invocation).toBeTruthy()
    expect(rows[0].task_tool_invocation).toHaveLength(1)
    expect(rows[0].task_tool_invocation[0].name).toBe('Task')
    expect(rows[0].task_tool_invocation[0].id).toBe('toolu_01B95K5SLaSL1aSy59JQLWqC')
  })

  it('should link sub-task conversations based on timing', async () => {
    // First, create the main request with Task invocation
    await writer.storeRequest({
      requestId: testRequestId,
      domain: 'test.localhost',
      timestamp: new Date(mainRequestSample.timestamp),
      method: mainRequestSample.method,
      path: mainRequestSample.path,
      headers: mainRequestSample.headers,
      body: mainRequestSample.body,
      apiKey: '',
      model: mainRequestSample.body.model,
      requestType: 'inference',
      conversationId: randomUUID(),
    })

    await writer.storeResponse({
      requestId: testRequestId,
      statusCode: mainRequestSample.response.status,
      headers: mainRequestSample.response.headers,
      body: mainRequestSample.response.body,
      streaming: mainRequestSample.response.streaming,
      inputTokens: mainRequestSample.response.usage?.input_tokens,
      outputTokens: mainRequestSample.response.usage?.output_tokens,
      totalTokens: mainRequestSample.response.usage?.total_tokens,
      firstTokenMs: mainRequestSample.response.firstTokenMs,
      durationMs: mainRequestSample.response.durationMs,
      error: mainRequestSample.response.error,
      toolCallCount: mainRequestSample.response.toolCalls,
    })

    // Create the sub-task conversation (started ~10 seconds after the Task invocation)
    const subtaskConversationId = randomUUID()
    await writer.storeRequest({
      requestId: testSubtaskRequestId,
      domain: 'test.localhost',
      timestamp: new Date(subtaskRequestSample.timestamp),
      method: subtaskRequestSample.method,
      path: subtaskRequestSample.path,
      headers: subtaskRequestSample.headers,
      body: subtaskRequestSample.body,
      apiKey: '',
      model: subtaskRequestSample.body.model,
      requestType: 'inference',
      conversationId: subtaskConversationId,
    })

    // Run the timing-based linking logic
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

    const mainRequest = await pool.query(
      'SELECT timestamp, conversation_id FROM api_requests WHERE request_id = $1',
      [testRequestId]
    )

    const { rows: linkedConversations } = await pool.query(linkQuery, [
      testRequestId,
      mainRequest.rows[0].timestamp,
      mainRequest.rows[0].conversation_id,
    ])

    // Verify the sub-task was linked
    expect(linkedConversations).toHaveLength(1)
    expect(linkedConversations[0].conversation_id).toBe(subtaskConversationId)

    // Verify the sub-task is marked correctly
    const subtask = await pool.query(
      'SELECT parent_task_request_id, is_subtask FROM api_requests WHERE request_id = $1',
      [testSubtaskRequestId]
    )

    expect(subtask.rows[0].parent_task_request_id).toBe(testRequestId)
    expect(subtask.rows[0].is_subtask).toBe(true)
  })

  it('should match sub-task prompt with Task tool invocation prompt', () => {
    // Extract the Task tool invocation from main request
    const taskInvocation = mainRequestSample.response.body.content.find(
      (c: any) => c.type === 'tool_use' && c.name === 'Task'
    )

    expect(taskInvocation).toBeTruthy()
    expect(taskInvocation.input.prompt).toBeTruthy()

    // Extract the user prompt from sub-task request
    const subtaskPrompt = subtaskRequestSample.body.messages[0].content[1].text

    // They should match exactly
    expect(subtaskPrompt).toBe(taskInvocation.input.prompt)
  })
})
