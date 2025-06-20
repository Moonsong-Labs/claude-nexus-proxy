# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Claude Nexus Proxy - A high-performance proxy for Claude API with monitoring dashboard. Built with Bun and Hono framework, deployed as separate Docker images for each service.

## Architecture

### Monorepo Structure

```
claude-nexus-proxy/
├── packages/shared/      # Shared types and configurations
├── services/
│   ├── proxy/           # Proxy API service (Port 3000)
│   └── dashboard/       # Dashboard web service (Port 3001)
├── scripts/             # Utility scripts
├── docker/              # Docker configurations
│   ├── proxy/           # Proxy Dockerfile
│   └── dashboard/       # Dashboard Dockerfile
└── docker-compose.yml   # Container orchestration
```

### Key Services

**Proxy Service** (`services/proxy/`)

- Direct API forwarding to Claude
- Multi-auth support (API keys, OAuth with auto-refresh)
- Token tracking and telemetry
- Request/response storage
- Slack notifications

**Dashboard Service** (`services/dashboard/`)

- Real-time monitoring UI
- Analytics and usage charts
- Request history browser
- SSE for live updates

## Development

```bash
# Install dependencies
bun install

# Run both services
bun run dev

# Run individually
bun run dev:proxy      # Port 3000
bun run dev:dashboard  # Port 3001

# Build
bun run build
```

## Docker Deployment

The project uses **separate Docker images** for each service:

```bash
# Build images
./docker/build-images.sh

# Run proxy service
docker run -p 3000:3000 alanpurestake/claude-nexus-proxy:latest

# Run dashboard service
docker run -p 3001:3001 alanpurestake/claude-nexus-dashboard:latest
```

Docker configurations are in the `docker/` directory. Each service has its own optimized image for better security, scaling, and maintainability.

## Key Implementation Details

### Conversation Tracking & Branching

The proxy automatically tracks conversations and detects branches using message hashing:

**How it works:**

1. Each message in a request is hashed using SHA-256
2. The current message hash and parent message hash (previous message) are stored
3. Requests are linked into conversations by matching parent/child relationships
4. Conversations support branching (like git) when resumed from earlier points
5. Branches are automatically detected when multiple requests share the same parent
6. When multiple conversations have the same parent hash, the system picks the conversation with the fewest requests to continue
7. Messages continue on the same branch as their parent unless they create a new branch point

**Message Normalization:**

- String content and array content are normalized to produce consistent hashes
- Example: `"hello"` and `[{type: "text", text: "hello"}]` produce the same hash
- **System reminders are filtered out**: Content items starting with `<system-reminder>` are ignored during hashing
- This ensures conversations link correctly regardless of content format or system reminder presence

**API Endpoints:**

- `/api/conversations` - Get conversations grouped by conversation_id with branch information
- Query parameters: `domain` (filter by domain), `limit` (max conversations)

**Database Schema:**

- `conversation_id` - UUID identifying the conversation
- `current_message_hash` - Hash of the last message in the request
- `parent_message_hash` - Hash of the previous message (null for first message)
- `branch_id` - Branch identifier (defaults to 'main', auto-generated for new branches)

**Dashboard Features:**

- **Conversations View** - Visual timeline showing message flow and branches
- **Branch Visualization** - Blue nodes indicate branch points
- **Branch Labels** - Non-main branches are labeled with their branch ID
- **Conversation Grouping** - All related requests grouped under one conversation

### Authentication Flow

**Client Authentication (Proxy Level):**

1. Extract domain from Host header
2. Check for `client_api_key` in domain credential file
3. Verify Bearer token against stored key using timing-safe comparison
4. Return 401 Unauthorized if invalid

**Claude API Authentication:**

1. Check domain-specific credential files (`<domain>.credentials.json`)
2. Use Authorization header from request
3. Fall back to CLAUDE_API_KEY environment variable

### OAuth Support

- Auto-refresh tokens 1 minute before expiry
- Stores refreshed tokens back to credential files
- Adds `anthropic-beta: oauth-2025-04-20` header

### Token Tracking

- Per-domain statistics
- Request type classification (query evaluation vs inference)
- Tool call counting
- Available at `/token-stats` endpoint

### Storage

- PostgreSQL for request/response data
- Write-only access from proxy
- Read-only access from dashboard
- Automatic batch processing
- **Conversation Grouping**: Requests are automatically grouped by conversation using message hashing

### Debug Logging

When `DEBUG=true`:

- Logs full request/response (with sensitive data masked)
- Shows streaming chunks
- Masks patterns: `sk-ant-****`, `Bearer ****`

## Environment Variables

**Essential:**

- `CLAUDE_API_KEY` - Default API key (optional)
- `DATABASE_URL` - PostgreSQL connection
- `DASHBOARD_API_KEY` - Dashboard authentication

**Optional:**

- `DEBUG` - Enable debug logging
- `STORAGE_ENABLED` - Enable storage (default: false)
- `SLACK_WEBHOOK_URL` - Slack notifications
- `CREDENTIALS_DIR` - Domain credential directory
- `COLLECT_TEST_SAMPLES` - Collect request samples for testing (default: false)
- `TEST_SAMPLES_DIR` - Directory for test samples (default: test-samples)
- `ENABLE_CLIENT_AUTH` - Enable client API key authentication (default: true). Set to false to allow anyone to use the proxy without authentication
- `DASHBOARD_CACHE_TTL` - Dashboard cache TTL in seconds (default: 30). Set to 0 to disable caching
- `SLOW_QUERY_THRESHOLD_MS` - Threshold in milliseconds for logging slow SQL queries (default: 5000)

## Important Notes

### Request Metadata

- Query evaluation and quota are not part of the conversation, they serve as metadata queries

## Testing & Type Safety

**Type Checking:**

- Run `bun run typecheck` before committing
- Type checking is automatic during builds
- Fix all type errors before deploying

**Test Sample Collection:**
The proxy can collect real request samples for test development:

- Enable with `COLLECT_TEST_SAMPLES=true`
- Samples are stored in `test-samples/` directory
- Each request type gets its own file (e.g., `inference_streaming_opus.json`)
- Sensitive data is automatically masked
- Samples include headers, body, and metadata

**Tests:**
Currently no automated tests. When implementing:

- Use Bun's built-in test runner
- Test proxy logic, telemetry, token tracking
- Test both streaming and non-streaming responses
- Use collected samples as test data

## Important Notes

- Uses Bun runtime exclusively (no Node.js)
- Separate Docker images for each service
- TypeScript compilation for production builds
- Model-agnostic (accepts any model name)

## Common Tasks

### Add Domain Credentials

```bash
# Generate secure client API key
bun run scripts/generate-api-key.ts

# Create credential file
cat > credentials/domain.com.credentials.json << EOF
{
  "type": "api_key",
  "api_key": "sk-ant-...",
  "client_api_key": "cnp_live_..."
}
EOF
```

### Enable Storage

```bash
export STORAGE_ENABLED=true
export DATABASE_URL=postgresql://...
```

### View Token Stats

```bash
curl http://localhost:3000/token-stats
```

### Access Dashboard

```bash
open http://localhost:3001
# Use DASHBOARD_API_KEY for authentication
# Auth header: X-Dashboard-Key: <your-key>
```

## Sub-task Tracking & Visualization

### Sub-task Detection

The proxy automatically detects and tracks sub-tasks spawned using the Task tool:

**Database Fields:**
- `parent_task_request_id` - Links sub-task requests to their parent task
- `is_subtask` - Boolean flag indicating if a request is a sub-task
- `task_tool_invocation` - JSONB array storing Task tool invocations

**Sub-task Linking:**
- Sub-tasks are linked by matching the user message to Task tool invocation prompts
- The system creates parent-child relationships between tasks and their sub-tasks
- Multiple sub-tasks can be spawned from a single parent request

### Dashboard Visualization

**Conversation Tree:**
- Sub-task nodes appear as separate gray boxes to the right of parent nodes
- Format: "sub-task N (M)" where N is the sub-task number and M is the message count
- Sub-task boxes are clickable and link to their conversation
- Hover over sub-task boxes to see the task prompt in a tooltip

**Stats Display:**
- "Total Sub-tasks" panel shows count of all sub-tasks in a conversation
- Sub-task indicators on parent nodes show number of spawned tasks

**Visual Design:**
- Sub-task boxes: 100x36px gray boxes with 150px right offset
- Tooltips: 250x130px with gradient background, appear above nodes on hover
- Connected to parent nodes with horizontal edges

## Important Implementation Notes

### Conversation Hash Filtering
When generating message hashes for conversation tracking, the system filters out:
- Content items that start with `<system-reminder>`
- This prevents conversation linking from breaking when Claude adds system reminders

### Dashboard Authentication
- Uses `X-Dashboard-Key` header (not Authorization)
- Cookie-based auth also supported for browser sessions

### SQL Query Optimization
- Always include all required fields in SELECT statements
- Missing fields like `parent_task_request_id`, `is_subtask`, `task_tool_invocation` will break sub-task tracking
- Use the SLOW_QUERY_THRESHOLD_MS env var to monitor query performance
