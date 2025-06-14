import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import request from 'supertest'
import { GenericContainer, StartedTestContainer } from 'testcontainers'
import { Pool } from 'pg'
import { mockServer } from '../../test-setup/setup'
import { rest } from 'msw'
import { StorageService, initializeDatabase } from '@/storage'

describe('Proxy Integration Tests', () => {
  let app: Hono
  let container: StartedTestContainer
  let pool: Pool
  let storageService: StorageService
  
  beforeAll(async () => {
    // Start PostgreSQL container
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test_claude_proxy'
      })
      .withExposedPorts(5432)
      .withStartupTimeout(30000)
      .start()
    
    const dbConfig = {
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: 'test_claude_proxy',
      user: 'test',
      password: 'test'
    }
    
    // Initialize database
    pool = new Pool(dbConfig)
    await initializeDatabase(pool)
    
    // Initialize storage service
    storageService = new StorageService(dbConfig)
    
    // Set up test environment
    process.env.CLAUDE_API_KEY = 'sk-ant-api03-test-key'
    process.env.STORAGE_ENABLED = 'true'
    
    // Import and initialize app after setting env vars
    const { default: createApp } = await import('@/index')
    app = createApp({ storageService })
  }, 60000) // 60 second timeout for container startup
  
  afterAll(async () => {
    await storageService?.close()
    await pool?.end()
    await container?.stop()
  })
  
  beforeEach(() => {
    // Clear database between tests
    // In production, you'd truncate tables or use transactions
  })
  
  describe('POST /v1/messages', () => {
    it('should proxy a simple message request with API key auth', async () => {
      const requestBody = {
        model: 'claude-3-opus-20240229',
        messages: [
          { role: 'user', content: 'What is 2+2?' }
        ],
        max_tokens: 100
      }
      
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: '2+2 equals 4.' }
        ],
        model: 'claude-3-opus-20240229',
        usage: {
          input_tokens: 15,
          output_tokens: 8
        }
      }
      
      mockServer.use(
        rest.post('https://api.anthropic.com/v1/messages', async (req, res, ctx) => {
          // Verify request was proxied correctly
          const body = await req.json()
          expect(body).toEqual(requestBody)
          expect(req.headers.get('x-api-key')).toBe('sk-ant-api03-test-key')
          
          return res(ctx.status(200), ctx.json(mockResponse))
        })
      )
      
      const response = await request(app.fetch)
        .post('/v1/messages')
        .set('Content-Type', 'application/json')
        .send(requestBody)
        .expect(200)
      
      expect(response.body).toEqual(mockResponse)
      
      // Verify storage
      await new Promise(resolve => setTimeout(resolve, 100)) // Wait for batch processing
      const storedRequests = await storageService.getRequestsByDomain('', 10)
      expect(storedRequests).toHaveLength(1)
      expect(storedRequests[0].request_type).toBe('inference')
      expect(storedRequests[0].input_tokens).toBe(15)
      expect(storedRequests[0].output_tokens).toBe(8)
    })
    
    it('should handle streaming responses correctly', async () => {
      const requestBody = {
        model: 'claude-3-opus-20240229',
        messages: [
          { role: 'user', content: 'Tell me a story' }
        ],
        stream: true,
        max_tokens: 100
      }
      
      const streamChunks = [
        {
          type: 'message_start',
          message: {
            id: 'msg_stream_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-opus-20240229',
            usage: { input_tokens: 10, output_tokens: 0 }
          }
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Once upon' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' a time...' }
        },
        {
          type: 'content_block_stop',
          index: 0
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 }
        },
        {
          type: 'message_stop'
        }
      ]
      
      mockServer.use(
        rest.post('https://api.anthropic.com/v1/messages', async (req, res, ctx) => {
          const body = await req.json()
          expect(body.stream).toBe(true)
          
          return res(
            ctx.status(200),
            ctx.set('Content-Type', 'text/event-stream'),
            ctx.body(global.testUtils.createStreamResponse(streamChunks))
          )
        })
      )
      
      const response = await request(app.fetch)
        .post('/v1/messages')
        .set('Content-Type', 'application/json')
        .send(requestBody)
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)
      
      // Parse SSE response
      const chunks = response.text
        .split('\n\n')
        .filter(chunk => chunk.startsWith('data: '))
        .map(chunk => chunk.slice(6))
        .filter(data => data !== '[DONE]')
        .map(data => JSON.parse(data))
      
      expect(chunks).toHaveLength(streamChunks.length)
      expect(chunks[0].type).toBe('message_start')
      expect(chunks[chunks.length - 1].type).toBe('message_stop')
      
      // Verify streaming chunks were stored
      await new Promise(resolve => setTimeout(resolve, 100))
      const details = await storageService.getRequestDetails(
        (await storageService.getRequestsByDomain('', 1))[0].id
      )
      expect(details.streamingChunks).toHaveLength(streamChunks.length)
    })
    
    it('should handle OAuth authentication with token refresh', async () => {
      // Set up OAuth credential file mock
      const mockCredentials = {
        type: 'oauth',
        oauth: {
          accessToken: 'old_access_token',
          refreshToken: 'refresh_token_123',
          expiresAt: Date.now() - 1000, // Already expired
          scopes: ['user:inference'],
          isMax: false
        }
      }
      
      // Mock credential loading
      vi.mock('fs', () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => JSON.stringify(mockCredentials)),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn()
      }))
      
      // Mock token refresh
      mockServer.use(
        rest.post('https://console.anthropic.com/v1/oauth/token', (req, res, ctx) => {
          return res(
            ctx.status(200),
            ctx.json({
              access_token: 'new_access_token',
              refresh_token: 'new_refresh_token',
              expires_in: 3600
            })
          )
        })
      )
      
      // Mock Claude API call with new token
      mockServer.use(
        rest.post('https://api.anthropic.com/v1/messages', async (req, res, ctx) => {
          expect(req.headers.get('authorization')).toBe('Bearer new_access_token')
          expect(req.headers.get('anthropic-beta')).toBe('oauth-2025-04-20')
          
          return res(
            ctx.status(200),
            ctx.json({
              id: 'msg_oauth',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'OAuth response' }],
              usage: { input_tokens: 5, output_tokens: 3 }
            })
          )
        })
      )
      
      const response = await request(app.fetch)
        .post('/v1/messages')
        .set('Content-Type', 'application/json')
        .set('Host', 'oauth.example.com')
        .send({
          model: 'claude-3-opus-20240229',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        })
        .expect(200)
      
      expect(response.body.content[0].text).toBe('OAuth response')
    })
    
    it('should handle rate limiting gracefully', async () => {
      mockServer.use(
        rest.post('https://api.anthropic.com/v1/messages', (req, res, ctx) => {
          return res(
            ctx.status(429),
            ctx.json({
              error: {
                type: 'rate_limit_error',
                message: 'Rate limit exceeded'
              }
            }),
            ctx.set('Retry-After', '30')
          )
        })
      )
      
      const response = await request(app.fetch)
        .post('/v1/messages')
        .set('Content-Type', 'application/json')
        .send({
          model: 'claude-3-opus-20240229',
          messages: [{ role: 'user', content: 'Hello' }]
        })
        .expect(429)
      
      expect(response.body.error.type).toBe('rate_limit_error')
      expect(response.headers['retry-after']).toBe('30')
    })
    
    it('should track tokens correctly for different request types', async () => {
      // Query evaluation request (single system message)
      const queryRequest = {
        model: 'claude-3-opus-20240229',
        system: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'What is the capital of France?' }
        ],
        max_tokens: 50
      }
      
      mockServer.use(
        rest.post('https://api.anthropic.com/v1/messages', async (req, res, ctx) => {
          return res(
            ctx.status(200),
            ctx.json({
              id: 'msg_query',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Paris is the capital of France.' }],
              usage: { input_tokens: 20, output_tokens: 10 }
            })
          )
        })
      )
      
      await request(app.fetch)
        .post('/v1/messages')
        .set('Host', 'test.domain.com')
        .send(queryRequest)
        .expect(200)
      
      // Get token stats
      const statsResponse = await request(app.fetch)
        .get('/token-stats?domain=test.domain.com')
        .expect(200)
      
      expect(statsResponse.body.domains['test.domain.com']).toMatchObject({
        queryEvaluationInputTokens: 20,
        queryEvaluationOutputTokens: 10,
        queryEvaluationRequests: 1,
        inferenceInputTokens: 0,
        inferenceOutputTokens: 0,
        inferenceRequests: 0
      })
    })
  })
  
  describe('GET /api/requests', () => {
    it('should retrieve stored requests with filtering', async () => {
      // Create some test requests
      const domains = ['domain1.com', 'domain2.com', 'domain1.com']
      
      for (const domain of domains) {
        await request(app.fetch)
          .post('/v1/messages')
          .set('Host', domain)
          .send({
            model: 'claude-3-haiku-20240307',
            messages: [{ role: 'user', content: 'Test' }],
            max_tokens: 10
          })
      }
      
      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Get all requests
      const allResponse = await request(app.fetch)
        .get('/api/requests')
        .expect(200)
      
      expect(allResponse.body.requests.length).toBeGreaterThanOrEqual(3)
      
      // Get filtered requests
      const filteredResponse = await request(app.fetch)
        .get('/api/requests?domain=domain1.com&limit=10')
        .expect(200)
      
      expect(filteredResponse.body.requests).toHaveLength(2)
      expect(filteredResponse.body.requests.every(r => r.domain === 'domain1.com')).toBe(true)
    })
  })
  
  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockServer.use(
        rest.post('https://api.anthropic.com/v1/messages', (req, res) => {
          return res.networkError('Connection refused')
        })
      )
      
      const response = await request(app.fetch)
        .post('/v1/messages')
        .send({
          model: 'claude-3-opus-20240229',
          messages: [{ role: 'user', content: 'Hello' }]
        })
        .expect(500)
      
      expect(response.body.error).toBeDefined()
    })
    
    it('should handle malformed requests', async () => {
      const response = await request(app.fetch)
        .post('/v1/messages')
        .send({
          // Missing required fields
          messages: 'invalid'
        })
        .expect(400)
      
      expect(response.body.error).toBeDefined()
    })
  })
})