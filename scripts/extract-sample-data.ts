#!/usr/bin/env bun
/**
 * Extract Sample Data from Production Database
 * 
 * This script extracts a small sample of data from production database
 * for local development testing. It anonymizes sensitive data and 
 * maintains referential integrity.
 * 
 * Usage:
 *   bun run scripts/extract-sample-data.ts --source-db="postgresql://..." [options]
 * 
 * Options:
 *   --source-db    Production database URL (required)
 *   --output       Output file path (default: ./sample-data.sql)
 *   --limit        Number of conversations to extract (default: 5)
 *   --recent       Extract only recent data (last N days, default: 30)
 *   --domain       Filter by specific domain
 */

import { parseArgs } from "util";
import { Client } from "pg";
import { writeFile } from "fs/promises";

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    "source-db": {
      type: "string",
    },
    output: {
      type: "string",
      default: "./sample-data.sql",
    },
    limit: {
      type: "string",
      default: "5",
    },
    recent: {
      type: "string",
      default: "30",
    },
    domain: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: true,
});

if (!values["source-db"]) {
  console.error("❌ Error: --source-db is required");
  console.error("Usage: bun run extract-sample-data.ts --source-db='postgresql://...'");
  process.exit(1);
}

const sourceDb = values["source-db"];
const outputFile = values.output || "./sample-data.sql";
const conversationLimit = parseInt(values.limit || "5");
const recentDays = parseInt(values.recent || "30");
const domainFilter = values.domain;

console.log("🔍 Extracting sample data from production database...");
console.log(`📊 Parameters:`);
console.log(`   - Conversations: ${conversationLimit}`);
console.log(`   - Recent days: ${recentDays}`);
console.log(`   - Domain filter: ${domainFilter || "none"}`);
console.log(`   - Output: ${outputFile}`);

const client = new Client({ connectionString: sourceDb });

try {
  await client.connect();
  console.log("✅ Connected to source database");

  // Start building the SQL output
  let sql = `-- Sample data extracted from production database
-- Generated on ${new Date().toISOString()}
-- This data has been anonymized for local development use

BEGIN;

-- Disable foreign key checks temporarily
SET session_replication_role = 'replica';

`;

  // 1. Get sample conversations with variety
  console.log("\n📥 Extracting conversations...");
  const conversationsQuery = `
    WITH ranked_conversations AS (
      SELECT DISTINCT conversation_id, 
             MIN(timestamp) as first_message,
             COUNT(*) as message_count,
             array_agg(DISTINCT domain) as domains,
             array_agg(DISTINCT model) as models
      FROM api_requests
      WHERE timestamp > NOW() - INTERVAL '${recentDays} days'
        ${domainFilter ? `AND domain = $1` : ""}
        AND conversation_id IS NOT NULL
      GROUP BY conversation_id
      HAVING COUNT(*) >= 2  -- Only conversations with multiple messages
      ORDER BY 
        CASE 
          WHEN COUNT(DISTINCT branch_id) > 1 THEN 0  -- Prioritize branched conversations
          ELSE 1 
        END,
        COUNT(*) DESC  -- Then by message count
      LIMIT ${conversationLimit * 2}  -- Get extra to ensure variety
    )
    SELECT conversation_id 
    FROM ranked_conversations
    ORDER BY RANDOM()
    LIMIT ${conversationLimit}
  `;

  const convResult = await client.query(
    conversationsQuery,
    domainFilter ? [domainFilter] : []
  );

  const conversationIds = convResult.rows.map(r => r.conversation_id);
  console.log(`✅ Found ${conversationIds.length} conversations to extract`);

  if (conversationIds.length === 0) {
    console.error("❌ No conversations found matching criteria");
    process.exit(1);
  }

  // 2. Extract api_requests for these conversations
  console.log("\n📥 Extracting API requests...");
  const requestsQuery = `
    SELECT * FROM api_requests 
    WHERE conversation_id = ANY($1::uuid[])
    ORDER BY timestamp ASC
  `;

  const requestsResult = await client.query(requestsQuery, [conversationIds]);
  console.log(`✅ Found ${requestsResult.rows.length} API requests`);

  // Anonymize and format api_requests data
  sql += "\n-- API Requests\n";
  for (const row of requestsResult.rows) {
    // Anonymize sensitive data
    const anonymized = {
      ...row,
      domain: anonymizeDomain(row.domain),
      api_key_hash: row.api_key_hash ? 'REDACTED_HASH' : null,
      headers: anonymizeHeaders(row.headers),
      // Keep request/response bodies as they contain the conversation content
      account_id: row.account_id ? `acc_sample_${hashString(row.account_id).slice(0, 8)}` : null,
    };

    sql += formatInsertStatement('api_requests', anonymized);
  }

  // 3. Extract streaming chunks for these requests
  const requestIds = requestsResult.rows.map(r => r.request_id);
  if (requestIds.length > 0) {
    console.log("\n📥 Extracting streaming chunks...");
    const chunksQuery = `
      SELECT * FROM streaming_chunks 
      WHERE request_id = ANY($1::uuid[])
      ORDER BY request_id, chunk_index
    `;

    const chunksResult = await client.query(chunksQuery, [requestIds]);
    console.log(`✅ Found ${chunksResult.rows.length} streaming chunks`);

    if (chunksResult.rows.length > 0) {
      sql += "\n-- Streaming Chunks\n";
      for (const row of chunksResult.rows) {
        sql += formatInsertStatement('streaming_chunks', row);
      }
    }
  }

  // 4. Extract related conversation analyses if they exist
  console.log("\n📥 Checking for conversation analyses...");
  const analysesQuery = `
    SELECT * FROM conversation_analyses 
    WHERE conversation_id = ANY($1::uuid[])
  `;

  try {
    const analysesResult = await client.query(analysesQuery, [conversationIds]);
    console.log(`✅ Found ${analysesResult.rows.length} conversation analyses`);

    if (analysesResult.rows.length > 0) {
      sql += "\n-- Conversation Analyses\n";
      for (const row of analysesResult.rows) {
        sql += formatInsertStatement('conversation_analyses', row);
      }
    }
  } catch (error) {
    console.log("ℹ️  No conversation_analyses table found (optional)");
  }

  // Re-enable foreign key checks
  sql += `
-- Re-enable foreign key checks
SET session_replication_role = 'origin';

COMMIT;

-- Summary of extracted data:
-- Conversations: ${conversationIds.length}
-- API Requests: ${requestsResult.rows.length}
-- Streaming Chunks: ${requestIds.length > 0 ? (await client.query('SELECT COUNT(*) FROM streaming_chunks WHERE request_id = ANY($1::uuid[])', [requestIds])).rows[0].count : 0}
`;

  // Write to file
  await writeFile(outputFile, sql);
  console.log(`\n✅ Sample data written to: ${outputFile}`);

  // Print summary
  console.log("\n📊 Extraction Summary:");
  console.log(`   - Conversations: ${conversationIds.length}`);
  console.log(`   - API Requests: ${requestsResult.rows.length}`);
  console.log(`   - Average messages per conversation: ${Math.round(requestsResult.rows.length / conversationIds.length)}`);
  
  const domains = [...new Set(requestsResult.rows.map(r => r.domain))];
  console.log(`   - Domains: ${domains.join(", ")}`);
  
  const models = [...new Set(requestsResult.rows.filter(r => r.model).map(r => r.model))];
  console.log(`   - Models: ${models.join(", ")}`);

} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
} finally {
  await client.end();
}

// Helper functions

function anonymizeDomain(domain: string): string {
  if (!domain) return domain;
  
  // Keep localhost domains as-is
  if (domain.includes('localhost')) return domain;
  
  // For other domains, partially anonymize
  const parts = domain.split('.');
  if (parts.length >= 2) {
    parts[0] = 'sample-' + parts[0].slice(0, 3);
  }
  return parts.join('.');
}

function anonymizeHeaders(headers: any): any {
  if (!headers) return headers;
  
  const anonymized = { ...headers };
  
  // Remove sensitive headers
  const sensitiveHeaders = [
    'authorization',
    'x-api-key',
    'cookie',
    'x-dashboard-key',
    'anthropic-beta'
  ];
  
  for (const header of sensitiveHeaders) {
    if (anonymized[header]) {
      anonymized[header] = 'REDACTED';
    }
  }
  
  return anonymized;
}

function hashString(str: string): string {
  // Simple hash for consistent anonymization
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function formatInsertStatement(table: string, row: any): string {
  const columns = Object.keys(row).filter(col => row[col] !== null);
  const values = columns.map(col => {
    const value = row[col];
    
    if (value === null || value === undefined) {
      return 'NULL';
    } else if (typeof value === 'string') {
      // Escape single quotes
      return `'${value.replace(/'/g, "''")}'`;
    } else if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    } else if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    } else if (typeof value === 'object') {
      // JSONB columns
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    } else {
      return value.toString();
    }
  });

  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
}