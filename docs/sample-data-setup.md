# Sample Data Setup for Local Development

This guide explains how to extract sample data from your production database and load it into your local development environment.

## Overview

The sample data scripts allow you to:
- Extract real conversation data from production
- Anonymize sensitive information (domains, API keys, account IDs)
- Maintain referential integrity between tables
- Load data into local development database
- View realistic data in the dashboard

## Scripts

### 1. Extract Sample Data (`scripts/extract-sample-data.ts`)

Extracts anonymized sample data from production database.

**Usage:**
```bash
bun run scripts/extract-sample-data.ts \
  --source-db="postgresql://user:pass@prod-host/prod_db" \
  --limit=10 \
  --recent=30 \
  --output=./sample-data.sql
```

**Options:**
- `--source-db` (required): Production database connection URL
- `--limit`: Number of conversations to extract (default: 5)
- `--recent`: Extract data from last N days (default: 30)
- `--domain`: Filter by specific domain
- `--output`: Output SQL file path (default: ./sample-data.sql)

**What it extracts:**
- Complete conversations with multiple messages
- Prioritizes branched conversations for variety
- Related streaming chunks
- Conversation analyses (if available)

**Anonymization:**
- Domains are partially obscured (e.g., `example.com` → `sample-exa.com`)
- API keys and hashes are replaced with 'REDACTED'
- Account IDs are hashed
- Headers containing sensitive data are cleaned
- Message content is preserved for realistic testing

### 2. Load Sample Data (`scripts/load-sample-data.ts`)

Loads the extracted sample data into your local database.

**Usage:**
```bash
# Basic usage (uses DATABASE_URL from .env)
bun run scripts/load-sample-data.ts

# With options
bun run scripts/load-sample-data.ts \
  --input=./sample-data.sql \
  --database-url="postgresql://postgres:postgres@localhost:5432/claude_proxy" \
  --reset
```

**Options:**
- `--input`: Input SQL file (default: ./sample-data.sql)
- `--database-url`: Database connection URL (default: uses DATABASE_URL env var)
- `--reset`: Drop and recreate all tables before loading (default: false)

**What it does:**
1. Connects to local database
2. Initializes schema if needed (using `scripts/init-database.sql`)
3. Clears existing data (unless --reset is used)
4. Loads sample data
5. Shows statistics about loaded data

## Complete Setup Process

### Option 1: Docker Compose with Sample Data

1. **Start PostgreSQL only:**
   ```bash
   docker compose -f docker/docker-compose.yml up -d postgres
   ```

2. **Extract sample data from production:**
   ```bash
   bun run scripts/extract-sample-data.ts \
     --source-db="postgresql://YOUR_PROD_DB_URL" \
     --limit=10
   ```

3. **Load sample data:**
   ```bash
   bun run scripts/load-sample-data.ts
   ```

4. **Start all services:**
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

5. **Access dashboard:**
   - URL: http://localhost:3001
   - API Key: `key` (or whatever you set in docker-compose.yml)

### Option 2: Local Development with Sample Data

1. **Ensure PostgreSQL is running**

2. **Set up .env file:**
   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/claude_proxy
   DASHBOARD_API_KEY=test-dashboard-key-123
   STORAGE_ENABLED=true
   ENABLE_CLIENT_AUTH=false
   ```

3. **Extract and load sample data:**
   ```bash
   # Extract from production
   bun run scripts/extract-sample-data.ts --source-db="postgresql://..."
   
   # Load into local
   bun run scripts/load-sample-data.ts
   ```

4. **Run services:**
   ```bash
   bun run dev
   ```

## Sample Data File Format

The generated `sample-data.sql` file contains:
- Transaction wrapped INSERTs
- Foreign key checks disabled during import
- Data for tables:
  - `api_requests` - Main request/response data
  - `streaming_chunks` - Streaming response chunks
  - `conversation_analyses` - AI analysis results (if available)
- Summary comments with extraction statistics

## Tips

1. **Extracting specific conversations:**
   - Use `--domain` to filter by domain
   - Adjust `--limit` and `--recent` for more/less data
   - The script prioritizes conversations with branches

2. **Troubleshooting:**
   - If load fails, try `--reset` to start fresh
   - Check PostgreSQL logs for constraint violations
   - Ensure your local schema matches production

3. **Privacy considerations:**
   - The script anonymizes sensitive data
   - Review `sample-data.sql` before sharing
   - Message content is NOT anonymized

4. **Performance:**
   - Extraction is optimized with indexes
   - Loading uses transactions for speed
   - For large datasets, increase `--limit` gradually

## Example Workflow

```bash
# 1. Extract 20 recent conversations from production
bun run scripts/extract-sample-data.ts \
  --source-db="$PROD_DATABASE_URL" \
  --limit=20 \
  --recent=7 \
  --output=./test-data.sql

# 2. Review the extracted data
head -n 100 ./test-data.sql

# 3. Load into local database (with reset)
bun run scripts/load-sample-data.ts \
  --input=./test-data.sql \
  --reset

# 4. Start services and view data
bun run dev
# Open http://localhost:3001
```

## Security Notes

- Never commit `sample-data.sql` files to version control
- Add `*.sql` to `.gitignore` if needed
- The extraction script anonymizes data, but review before sharing
- Production database credentials should use read-only access when possible