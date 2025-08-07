# <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="4" cy="12" r="2"/><path d="M12 9 L12 7"/><path d="M15 12 L18 12"/><path d="M12 15 L12 18"/><path d="M9 12 L6 12"/></svg>Claude Nexus Proxy

A high-performance proxy for Claude Code with comprehensive monitoring, conversation tracking, and dashboard visualization.  
(_Supports Claude Max plan_)

⚠️ Disclaimer: This project has been entirely vibe Coded (using Claude Nexus Proxy) with the goal to not manually touch a single file.
Use at your own risk :)

## 🎯 Objectives

Claude Nexus Proxy empowers development teams to maximize their Claude AI usage through:

- 🔍 **Complete Visibility**: Real-time access to conversations, tool invocations, and prompts for effective troubleshooting and debugging
- 📈 **Historical Analytics**: Comprehensive activity history enabling usage monitoring, pattern identification, and continuous improvement
- 🤖 **Intelligent Insights**: AI-powered conversation analysis providing actionable prompt optimization suggestions and best practice recommendations

## 🚀 Demo

Experience Claude Nexus Proxy in action with our live demo:

👉 **[https://nexus-demo.moonsonglabs.dev](https://nexus-demo.moonsonglabs.dev)**

_Note: This is a read-only demo showcasing real usage data from our development team._

<img src="https://github.com/user-attachments/assets/aebffb8c-9535-4073-aa76-be31ee05a402" alt="Claude Nexus Proxy Dashboard" width="800">

## ✨ Features

- 🚀 **High-Performance Proxy** - Built with Bun and Hono for minimal latency
- 🔀 **Conversation Tracking** - Automatic message threading with branch, sub-agent & compact support
- 📊 **Real-time Dashboard** - Monitor usage, view conversations, and analyze patterns
- 🔐 **Multi-Auth Support** - API keys and OAuth with auto-refresh
- 📈 **Token Tracking** - Detailed usage statistics per domain and account
- 🔄 **Streaming Support** - Full SSE streaming with chunk storage
- 🐳 **Docker Ready** - Separate optimized images for each service
- 🤖 **Claude CLI Integration** - Run Claude CLI connected to the proxy
- 🧠 **AI-Powered Analysis** - Automated conversation insights using Gemini Pro

## 📚 Key Concepts

Understanding these terms will help you navigate Claude Nexus Proxy effectively:

### Core Concepts

- **🗣️ Conversation**: A complete interaction session between a user and Claude, consisting of multiple message exchanges. Each conversation has a unique ID and can span multiple requests.
- **🌳 Branch**: When you edit an earlier message in a conversation and continue from there, it creates a new branch - similar to Git branches. This allows exploring alternative conversation paths without losing the original.
- **📦 Compact**: When a conversation exceeds Claude's context window, it's automatically summarized and continued as a "compact" conversation, preserving the essential context while staying within token limits.
- **🤖 Sub-task**: When Claude spawns another AI agent using the Task tool, it creates a sub-task. These are tracked separately but linked to their parent conversation for complete visibility.

### Technical Terms

- **🔤 Token**: The basic unit of text that Claude processes. Monitoring token usage helps track costs and stay within API limits.
- **📊 Request**: A single API call to Claude, which may contain multiple messages. Conversations are built from multiple requests.
- **🔧 Tool Use**: Claude's ability to use external tools (like file reading, web search, or spawning sub-tasks). Each tool invocation is tracked and displayed.
- **📝 MCP (Model Context Protocol)**: A protocol for managing and sharing prompt templates across teams, with GitHub integration for version control.

### Dashboard Elements

- **Timeline View**: Shows the chronological flow of messages within a conversation
- **Tree View**: Visualizes conversation branches and sub-tasks as an interactive tree
- **Message Hash**: Unique identifier for each message, used to track conversation flow and detect branches

## 📸 Screenshots

### Conversation Tracking & Visualization

Visualize entire conversation flows as interactive trees, making it easy to understand complex interactions, debug issues, and track conversation branches.

<img src="https://github.com/user-attachments/assets/655f2c5c-91c0-41f6-9d82-19f44dd3ef6d" alt="Conversation tree visualization showing branching and message flow" width="400">

### Detailed Conversation Timeline

Dive deep into individual conversations with a timeline view that shows message flow, token usage, branches, and execution metrics. Filter by branch to focus on specific conversation paths.

<img src="https://github.com/user-attachments/assets/e3e8df59-a4a8-47a8-9033-4a0624bf03cf" alt="Conversation timeline with branch filters and detailed metrics" width="400">

### Request Details & Tool Results

Examine individual API requests and responses with syntax highlighting, tool result visualization, and comprehensive metadata including token counts and timing information.

<img src="https://github.com/user-attachments/assets/aeda8a80-5a9a-407c-b14d-e6a8af6883de" alt="Request details showing tool results and conversation messages" width="400">

### AI-Powered Conversation Analysis

Leverage Gemini Pro to automatically analyze conversations for sentiment, quality, outcomes, and actionable insights. Get intelligent recommendations for improving your AI interactions.

<img src="https://github.com/user-attachments/assets/63ed0346-ee2e-49b4-86df-49937516786f" alt="AI analysis panel showing comprehensive conversation insights" width="400">

### MCP Prompt Management

Manage and sync Model Context Protocol prompts from GitHub repositories. Create reusable prompt templates that can be shared across your team and integrated with Claude Desktop.

<img src="https://github.com/user-attachments/assets/6cb406d7-cb2a-4698-b03d-0b67b7b44702" alt="MCP prompts interface showing GitHub-synced prompt library" width="400">

### Raw JSON Debugging

For developers who need complete visibility, access the raw JSON view of any request or response with syntax highlighting and expandable tree structure.

<img src="https://github.com/user-attachments/assets/b3c247ca-e66b-4e6c-8b89-0f1a881b7198" alt="Raw JSON view for detailed debugging" width="400">

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- PostgreSQL database
- Claude Plan (_or Claude API Key_)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/claude-nexus-proxy.git
cd claude-nexus-proxy

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your settings

# Start development servers
bun run dev
```

The proxy runs on `http://localhost:3000` and dashboard on `http://localhost:3001`.

### Using Claude Code with the Proxy

Run Claude CLI connected to your local proxy:

```bash
API_TIMEOUT_MS=300000 DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 ANTHROPIC_BASE_URL=http://localhost:3000 claude
```

## Configuration

### Environment Variables

Essential configuration:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/claude_nexus

# Dashboard Authentication
# ⚠️ CRITICAL SECURITY WARNING: Without this key, the dashboard runs in read-only mode
# with NO authentication, exposing ALL conversation data to anyone with network access!
# NEVER deploy to production without setting this!
DASHBOARD_API_KEY=your-secure-key

# Optional Features
STORAGE_ENABLED=true
DEBUG=false
```

See the [Documentation](docs/README.md) for complete configuration options.

### Domain Credentials

Create domain-specific credentials:

```bash
# Generate secure API key
bun run auth:generate-key

# Create credential file
cat > credentials/example.com.credentials.json << EOF
{
  "type": "api_key",
  "accountId": "acc_name_to_display",
  "api_key": "sk-ant-...",
  "client_api_key": "cnp_live_..."
}
EOF
```

(_Use `credentials/localhost\:3000.credentials.json` for using it locally_)

Authenticate your credential with Claude MAX Plan:

```bash
./scripts/auth/oauth-login.ts credentials/example.com.credentials.json
```

## Usage

### API Proxy

Use the proxy exactly like Claude's API:

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Authorization: Bearer YOUR_CLIENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus-20240229",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Dashboard

Access the dashboard at `http://localhost:3001` with your `DASHBOARD_API_KEY`.

**⚠️ Security Warning**: If `DASHBOARD_API_KEY` is not set, the dashboard runs in read-only mode without any authentication, exposing all conversation data. This should NEVER be used in production. See the [Security Guide](docs/03-Operations/security.md) for details.

Features:

- Real-time request monitoring
- Conversation visualization with branching
- Token usage analytics
- Request history browsing

## Architecture

```
claude-nexus-proxy/
├── packages/shared/      # Shared types and utilities
├── services/
│   ├── proxy/           # Proxy API service
│   └── dashboard/       # Dashboard web service
└── scripts/             # Management utilities
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## Development

```bash
# Run type checking
bun run typecheck

# Run tests
bun test

# Run Playwright E2E (page rendering + console errors)
# Requires dashboard to start (reads .env) and a reachable Postgres
npx playwright test

# Format code
bun run format

# Database operations
bun run db:backup              # Backup database
bun run db:analyze-conversations # Analyze conversation structure
bun run db:rebuild-conversations # Rebuild conversation data

# AI Analysis management
bun run ai:check-jobs          # Check analysis job statuses
bun run ai:check-content       # Inspect analysis content
bun run ai:reset-stuck         # Reset jobs with high retry counts
```

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for development guidelines.

## Deployment

### Environments (MoonsongLabs Internal)

Claude Nexus Proxy supports deployment to multiple environments:

- **Production (`prod`)** - Live production services
- **Staging (`staging`)** - Pre-production testing environment

For AWS EC2 deployments, use the `manage-nexus-proxies.sh` script with environment filtering:

```bash
# Deploy to production servers only
./scripts/ops/manage-nexus-proxies.sh --env prod up

# Check staging server status
./scripts/ops/manage-nexus-proxies.sh --env staging status
```

See [AWS Infrastructure Guide](docs/03-Operations/deployment/aws-infrastructure.md) for detailed multi-environment setup.

### Docker

#### Using Pre-built Images (Default)

```bash
# Run with docker-compose using images from registry
./docker-up.sh up -d
```

#### Using Locally Built Images

```bash
# Build and run with locally built images
./docker-local.sh up -d --build
```

(_dashboard key: `key`_)

#### Building Images Separately

```bash
# Build images individually
docker build -f docker/proxy/Dockerfile -t claude-nexus-proxy:local .
docker build -f docker/dashboard/Dockerfile -t claude-nexus-dashboard:local .
```

### Production

See the [Deployment Guide](docs/03-Operations/deployment/) for production deployment options.

## Documentation

Comprehensive documentation is available in the [docs](docs/) directory:

### 📚 Getting Started

- [Quick Start Guide](docs/00-Overview/quickstart.md) - Get up and running in 5 minutes
- [Installation](docs/01-Getting-Started/installation.md) - Detailed installation instructions
- [Configuration](docs/01-Getting-Started/configuration.md) - All configuration options

### 🔧 User Guides

- [API Reference](docs/02-User-Guide/api-reference.md) - Complete API documentation
- [Authentication](docs/02-User-Guide/authentication.md) - Auth setup and troubleshooting
- [Dashboard Guide](docs/02-User-Guide/dashboard-guide.md) - Using the monitoring dashboard
- [Claude CLI](docs/02-User-Guide/claude-cli.md) - CLI integration guide

### 🚀 Operations

- [Deployment](docs/03-Operations/deployment/) - Docker and production deployment
- [Security](docs/03-Operations/security.md) - Security best practices
- [Monitoring](docs/03-Operations/monitoring.md) - Metrics and observability
- [Backup & Recovery](docs/03-Operations/backup-recovery.md) - Data protection

### 🏗️ Architecture

- [System Architecture](docs/00-Overview/architecture.md) - High-level design
- [Internals](docs/04-Architecture/internals.md) - Deep implementation details
- [ADRs](docs/04-Architecture/ADRs/) - Architecture decision records

### 🔍 Troubleshooting

- [Common Issues](docs/05-Troubleshooting/common-issues.md) - FAQ and solutions
- [Performance](docs/05-Troubleshooting/performance.md) - Performance optimization
- [Debugging](docs/05-Troubleshooting/debugging.md) - Debug techniques

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) first.

## License

[MIT License](LICENSE)

## Support

- 📖 [Full Documentation](docs/README.md)
- 🐛 [Issue Tracker](https://github.com/yourusername/claude-nexus-proxy/issues)
- 💬 [Discussions](https://github.com/yourusername/claude-nexus-proxy/discussions)
- 📊 [Changelog](docs/06-Reference/changelog.md)
