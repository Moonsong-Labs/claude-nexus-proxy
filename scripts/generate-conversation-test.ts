#!/usr/bin/env bun

import { Pool } from 'pg'
import { config } from 'dotenv'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'

// Load environment variables
config()

const __dirname = dirname(fileURLToPath(import.meta.url))

interface RequestData {
  request_id: string
  domain: string
  conversation_id: string | null
  branch_id: string | null
  current_message_hash: string | null
  parent_message_hash: string | null
  system_hash: string | null
  headers: any
  body: any
  response_body: any
  response_headers: any
  timestamp: Date
  model: string | null
  request_type: string | null
}

interface TestFixture {
  description: string
  type: 'standard' | 'compact'
  expectedLink: boolean
  expectedSummaryContent?: string
  expectedBranchPattern?: string
  parent: {
    request_id: string
    domain: string
    conversation_id: string | null
    branch_id: string | null
    current_message_hash: string | null
    parent_message_hash: string | null
    system_hash: string | null
    body: any // Include full request body for hash recomputation
    response_body: any
  }
  child: {
    request_id: string
    domain: string
    body: any
  }
}

async function fetchRequestData(pool: Pool, requestId: string): Promise<RequestData | null> {
  const query = `
    SELECT 
      request_id,
      domain,
      conversation_id,
      branch_id,
      current_message_hash,
      parent_message_hash,
      system_hash,
      headers,
      body,
      response_body,
      response_headers,
      timestamp,
      model,
      request_type
    FROM api_requests
    WHERE request_id = $1
  `

  const result = await pool.query(query, [requestId])

  if (result.rows.length === 0) {
    return null
  }

  return result.rows[0]
}

function detectFixtureType(childBody: any): 'standard' | 'compact' {
  if (!childBody.messages || childBody.messages.length === 0) {
    return 'standard'
  }

  const firstMessage = childBody.messages[0]
  const content =
    typeof firstMessage.content === 'string'
      ? firstMessage.content
      : firstMessage.content?.[0]?.text || ''

  // Check if this is a compact/continuation message
  if (content.includes('This session is being continued from a previous conversation')) {
    return 'compact'
  }

  return 'standard'
}

function extractSummaryContent(childBody: any): string | undefined {
  if (!childBody.messages || childBody.messages.length === 0) {
    return undefined
  }

  const firstMessage = childBody.messages[0]
  const content =
    typeof firstMessage.content === 'string'
      ? firstMessage.content
      : firstMessage.content?.[0]?.text || ''

  // Extract summary content from continuation message
  const summaryMatch = content.match(/The conversation is summarized below:\s*([^.]+)/)
  if (summaryMatch) {
    return summaryMatch[1].trim()
  }

  return undefined
}

function generateBranchPattern(branchId: string | null): string | undefined {
  if (!branchId || branchId === 'main') {
    return undefined
  }

  // Common branch patterns
  if (branchId.startsWith('compact_')) {
    return '^compact_\\\\d{6}$'
  }
  if (branchId.startsWith('branch_')) {
    return '^branch_\\\\d+$'
  }

  return undefined
}

function sanitizeForTest(data: any): any {
  // Remove or sanitize sensitive data
  if (typeof data === 'object' && data !== null) {
    const cleaned = { ...data }

    // Remove sensitive headers
    if (cleaned.headers) {
      if (cleaned.headers.authorization) {
        cleaned.headers.authorization = 'Bearer sk-ant-***'
      }
      if (cleaned.headers['x-api-key']) {
        cleaned.headers['x-api-key'] = '***'
      }
      if (cleaned.headers['anthropic-dangerous-direct-browser-access']) {
        cleaned.headers['anthropic-dangerous-direct-browser-access'] = 'true'
      }
    }

    // Sanitize API keys in body if present
    if (cleaned.api_key) {
      cleaned.api_key = 'sk-ant-***'
    }

    // Recursively clean nested objects
    for (const key in cleaned) {
      if (typeof cleaned[key] === 'object') {
        cleaned[key] = sanitizeForTest(cleaned[key])
      }
    }

    return cleaned
  }

  return data
}

async function generateTestFixture(
  pool: Pool,
  parentId: string,
  childId: string,
  description?: string
): Promise<TestFixture> {
  // Fetch both requests
  const [parentData, childData] = await Promise.all([
    fetchRequestData(pool, parentId),
    fetchRequestData(pool, childId),
  ])

  if (!parentData) {
    throw new Error(`Parent request ${parentId} not found`)
  }

  if (!childData) {
    throw new Error(`Child request ${childId} not found`)
  }

  // Filter out tool-related messages from bodies
  const filterToolMessages = (body: any) => {
    if (!body?.messages) return body

    return {
      ...body,
      messages: body.messages.filter(
        (msg: any) => msg.role !== 'tool_use' && msg.role !== 'tool_result'
      ),
    }
  }

  // Detect fixture type
  const fixtureType = detectFixtureType(childData.body)

  // Build the fixture with sanitized data
  const fixture: TestFixture = {
    description: description || `Test linking between ${parentId} and ${childId}`,
    type: fixtureType,
    expectedLink: childData.conversation_id === parentData.conversation_id,
    parent: {
      request_id: parentData.request_id,
      domain: parentData.domain,
      conversation_id: parentData.conversation_id,
      branch_id: parentData.branch_id,
      current_message_hash: parentData.current_message_hash,
      parent_message_hash: parentData.parent_message_hash,
      system_hash: parentData.system_hash,
      body: sanitizeForTest(filterToolMessages(parentData.body)), // Include filtered and sanitized body
      response_body: sanitizeForTest(parentData.response_body),
    },
    child: {
      request_id: childData.request_id,
      domain: childData.domain,
      body: sanitizeForTest(filterToolMessages(childData.body)), // Filter and sanitize child body too
    },
  }

  // Add optional fields for compact conversations
  if (fixtureType === 'compact') {
    const summaryContent = extractSummaryContent(childData.body)
    if (summaryContent) {
      fixture.expectedSummaryContent = summaryContent
    }

    const branchPattern = generateBranchPattern(childData.branch_id)
    if (branchPattern) {
      fixture.expectedBranchPattern = branchPattern
    }
  }

  return fixture
}

function generateTestCode(fixture: TestFixture, fixturePath: string): string {
  const testName = fixture.description
  const fixtureFile = basename(fixturePath)

  let testCode = `
  test('${testName}', async () => {
    // Load test fixture
    const fixture = await loadFixture('${fixtureFile}')
    
    // Mock query executor to return parent
    const mockParent = {
      request_id: fixture.parent.request_id,
      domain: fixture.parent.domain,
      conversation_id: fixture.parent.conversation_id,
      branch_id: fixture.parent.branch_id,
      current_message_hash: fixture.parent.current_message_hash,
      parent_message_hash: fixture.parent.parent_message_hash,
      system_hash: fixture.parent.system_hash,
    }
    
    mockQueryExecutor = async (criteria) => {
      if (criteria.currentMessageHash === fixture.parent.current_message_hash) {
        return [mockParent]
      }
      return []
    }
    
    // Note: The fixture includes full parent.body and child.body with messages and system
    // This allows the test to recompute hashes if needed for validation`

  if (fixture.type === 'compact') {
    testCode += `
    
    // Mock compact search executor for continuation
    mockCompactSearchExecutor = async (domain, summaryContent, beforeTimestamp) => {
      if (domain === fixture.child.domain && summaryContent.includes('${fixture.expectedSummaryContent || ''}')) {
        return mockParent
      }
      return null
    }`
  }

  testCode += `
    
    // Create linker with mocks
    const linker = new ConversationLinker(mockQueryExecutor, mockCompactSearchExecutor)
    
    // Prepare child request
    const childRequest: LinkingRequest = {
      domain: fixture.child.domain,
      messages: fixture.child.body.messages,
      systemPrompt: fixture.child.body.system,
      requestId: fixture.child.request_id,
      messageCount: fixture.child.body.messages?.length || 0,
    }
    
    // Execute linking
    const result = await linker.linkConversation(childRequest)
    
    // Verify expectations
    expect(result).toBeDefined()`

  if (fixture.expectedLink) {
    testCode += `
    expect(result.parentRequestId).toBe(fixture.parent.request_id)
    expect(result.conversationId).toBe(fixture.parent.conversation_id)`
  } else {
    testCode += `
    expect(result.parentRequestId).toBeNull()
    expect(result.conversationId).not.toBe(fixture.parent.conversation_id)`
  }

  if (fixture.expectedBranchPattern) {
    testCode += `
    expect(result.branchId).toMatch(/${fixture.expectedBranchPattern.replace(/\\\\/g, '\\')}/))`
  }

  testCode += `
  })`

  return testCode
}

async function main() {
  const command = process.argv[2]

  if (command === '--help' || !command) {
    console.log('Usage:')
    console.log('  Generate fixture from database:')
    console.log(
      '    bun scripts/generate-conversation-test.ts <parent_id> <child_id> [output_file] [description]'
    )
    console.log('')
    console.log('  Generate test code from fixture:')
    console.log('    bun scripts/generate-conversation-test.ts --from-fixture <fixture_file>')
    console.log('')
    console.log('Examples:')
    console.log('  bun scripts/generate-conversation-test.ts abc-123 def-456')
    console.log(
      '  bun scripts/generate-conversation-test.ts abc-123 def-456 branch-test.json "Test branch creation"'
    )
    console.log('  bun scripts/generate-conversation-test.ts --from-fixture branch-test.json')
    process.exit(0)
  }

  if (command === '--from-fixture') {
    // Generate test code from existing fixture
    const fixtureFile = process.argv[3]
    if (!fixtureFile) {
      console.error('Error: fixture file path required')
      process.exit(1)
    }

    const fixturePath = fixtureFile.startsWith('/')
      ? fixtureFile
      : join(
          __dirname,
          '..',
          'packages/shared/src/utils/__tests__/fixtures/conversation-linking',
          fixtureFile
        )

    try {
      const fixtureContent = await readFile(fixturePath, 'utf-8')
      const fixture = JSON.parse(fixtureContent) as TestFixture

      const testCode = generateTestCode(fixture, fixturePath)

      console.log('Generated test code:')
      console.log('```typescript')
      console.log(testCode)
      console.log('```')

      console.log(
        '\nAdd this test to: packages/shared/src/utils/__tests__/conversation-linker.test.ts'
      )
    } catch (error) {
      console.error('Error loading fixture:', error)
      process.exit(1)
    }
  } else {
    // Generate fixture from database
    const parentId = command
    const childId = process.argv[3]
    const outputFile = process.argv[4]
    const description = process.argv[5]

    if (!childId) {
      console.error('Error: both parent and child request IDs required')
      console.error('Run with --help for usage information')
      process.exit(1)
    }

    // Connect to database
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      console.error('DATABASE_URL environment variable is required')
      process.exit(1)
    }

    const pool = new Pool({ connectionString: databaseUrl })

    try {
      console.log(`Fetching requests ${parentId} and ${childId}...`)

      // Generate the test fixture
      const fixture = await generateTestFixture(pool, parentId, childId, description)

      // Determine output path
      let outputPath: string
      if (outputFile) {
        if (outputFile.startsWith('/')) {
          outputPath = outputFile
        } else {
          outputPath = join(
            __dirname,
            '..',
            'packages/shared/src/utils/__tests__/fixtures/conversation-linking',
            outputFile.endsWith('.json') ? outputFile : `${outputFile}.json`
          )
        }
      } else {
        // Generate a filename based on the request IDs
        const timestamp = new Date().toISOString().split('T')[0]
        outputPath = join(
          __dirname,
          '..',
          'packages/shared/src/utils/__tests__/fixtures/conversation-linking',
          `generated-${timestamp}-${parentId.slice(0, 8)}-${childId.slice(0, 8)}.json`
        )
      }

      // Ensure directory exists
      const dir = dirname(outputPath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      // Write the fixture
      await writeFile(outputPath, JSON.stringify(fixture, null, 2))

      console.log(`✅ Test fixture generated successfully!`)
      console.log(`📄 Output: ${outputPath}`)
      console.log(`🔗 Type: ${fixture.type}`)
      console.log(`✓ Expected link: ${fixture.expectedLink}`)

      if (fixture.expectedSummaryContent) {
        console.log(`📝 Summary content: "${fixture.expectedSummaryContent}"`)
      }

      // Display some key information
      console.log('\nFixture summary:')
      console.log(`- Parent conversation: ${fixture.parent.conversation_id || 'none'}`)
      console.log(`- Parent branch: ${fixture.parent.branch_id || 'none'}`)
      console.log(
        `- Parent message hash: ${fixture.parent.current_message_hash?.slice(0, 12) || 'none'}...`
      )
      console.log(`- Child messages: ${fixture.child.body.messages?.length || 0}`)

      // Offer to generate test code
      console.log('\nTo generate test code from this fixture:')
      console.log(
        `  bun scripts/generate-conversation-test.ts --from-fixture ${basename(outputPath)}`
      )
    } catch (error) {
      console.error('Error generating test fixture:', error)
      process.exit(1)
    } finally {
      await pool.end()
    }
  }
}

main()
