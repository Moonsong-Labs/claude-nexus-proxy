# Installation Guide

This guide will walk you through installing Claude Nexus Proxy in various environments.

## Prerequisites

Before you begin, ensure you have the following:

- **[Bun](https://bun.sh)** runtime v1.0 or higher
- **PostgreSQL** database (v12 or higher recommended)
- **Claude API key** from Anthropic
- **Node.js** (optional, for npm scripts compatibility)
- **Docker** (optional, for containerized deployment)

## Installation Methods

### Method 1: Local Development Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/claude-nexus-proxy.git
cd claude-nexus-proxy
```

#### 2. Install Dependencies

```bash
bun install
```

#### 3. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your settings
nano .env  # or use your preferred editor
```

Required environment variables:

```bash
# Database connection
DATABASE_URL=postgresql://user:password@localhost:5432/claude_nexus

# Dashboard authentication
DASHBOARD_API_KEY=your-secure-dashboard-key

# Enable storage (recommended)
STORAGE_ENABLED=true
```

#### 4. Set Up the Database

```bash
# Create the database (if not exists)
createdb claude_nexus

# Run migrations
bun run db:migrate
bun run db:migrate:token-usage
```

#### 5. Create Domain Credentials

```bash
# Create credentials directory
mkdir -p credentials

# Generate a secure client API key
bun run scripts/generate-api-key.ts

# Create your first domain credential file
cat > credentials/your-domain.com.credentials.json << EOF
{
  "type": "api_key",
  "accountId": "acc_unique_id",
  "api_key": "sk-ant-your-claude-api-key",
  "client_api_key": "cnp_live_generated_key"
}
EOF
```

#### 6. Start the Services

```bash
# Start both proxy and dashboard
bun run dev

# Or start individually
bun run dev:proxy      # Proxy on port 3000
bun run dev:dashboard  # Dashboard on port 3001
```

### Method 2: Docker Installation

#### 1. Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/yourusername/claude-nexus-proxy.git
cd claude-nexus-proxy

# Create .env file
cp .env.example .env
# Edit .env with your settings

# Start all services
docker compose up -d

# View logs
docker compose logs -f
```

#### 2. Using Individual Docker Images

```bash
# Pull the images
docker pull alanpurestake/claude-nexus-proxy:latest
docker pull alanpurestake/claude-nexus-dashboard:latest

# Run PostgreSQL
docker run -d \
  --name claude-postgres \
  -e POSTGRES_DB=claude_nexus \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15

# Run the proxy
docker run -d \
  --name claude-proxy \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/claude_nexus \
  -e STORAGE_ENABLED=true \
  -v $(pwd)/credentials:/app/credentials \
  alanpurestake/claude-nexus-proxy:latest

# Run the dashboard
docker run -d \
  --name claude-dashboard \
  -p 3001:3001 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/claude_nexus \
  -e DASHBOARD_API_KEY=your-dashboard-key \
  alanpurestake/claude-nexus-dashboard:latest
```

### Method 3: Production Installation

For production deployments, additional considerations apply:

#### 1. Database Setup

```bash
# Use a managed PostgreSQL service or set up a dedicated instance
# Example for AWS RDS:
DATABASE_URL=postgresql://user:password@your-rds-endpoint:5432/claude_nexus
```

#### 2. Environment Configuration

```bash
# Production .env
NODE_ENV=production
DATABASE_URL=postgresql://...
DASHBOARD_API_KEY=<strong-random-key>
STORAGE_ENABLED=true
SLOW_QUERY_THRESHOLD_MS=1000
CLAUDE_API_TIMEOUT=600000
PROXY_SERVER_TIMEOUT=660000
```

#### 3. Build for Production

```bash
# Build the services
bun run build

# The built files will be in:
# - services/proxy/dist/
# - services/dashboard/dist/
```

#### 4. Run with Process Manager

```bash
# Using PM2
pm2 start services/proxy/dist/index.js --name claude-proxy
pm2 start services/dashboard/dist/index.js --name claude-dashboard

# Using systemd (create service files)
sudo systemctl start claude-proxy
sudo systemctl start claude-dashboard
```

## Verification

After installation, verify everything is working:

### 1. Check Proxy Health

```bash
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

### 2. Check Dashboard

Open http://localhost:3001 in your browser. You should see the login page.

### 3. Test API Call

```bash
# Replace with your domain and client API key
curl -X POST http://localhost:3000/v1/messages \
  -H "Host: your-domain.com" \
  -H "Authorization: Bearer cnp_live_your_client_key" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "model": "claude-3-opus-20240229",
    "max_tokens": 100
  }'
```

## Troubleshooting Installation

### Common Issues

1. **Database Connection Failed**
   - Ensure PostgreSQL is running
   - Check DATABASE_URL format
   - Verify database exists: `createdb claude_nexus`

2. **Port Already in Use**
   - Change ports in .env:
     ```bash
     PROXY_PORT=3000
     DASHBOARD_PORT=3001
     ```

3. **Bun Not Found**
   - Install Bun: `curl -fsSL https://bun.sh/install | bash`
   - Add to PATH: `export PATH="$HOME/.bun/bin:$PATH"`

4. **Migration Failed**
   - Check database permissions
   - Run migrations manually:
     ```bash
     cd services/proxy
     bun run db:migrate
     ```

### Getting Help

- Check the [Troubleshooting Guide](../05-Troubleshooting/common-issues.md)
- Review [Configuration Reference](./configuration.md)
- Open an issue on GitHub

## Next Steps

- [Configure your domains](./configuration.md)
- [Set up authentication](../02-User-Guide/authentication.md)
- [Deploy to production](../03-Operations/deployment/docker.md)
- [Monitor usage](../02-User-Guide/dashboard-guide.md)
