#!/usr/bin/env bun
/**
 * Load Sample Data into Local Database
 * 
 * This script loads sample data extracted from production into your local
 * development database. It handles the initial schema setup and data loading.
 * 
 * Usage:
 *   bun run scripts/load-sample-data.ts [options]
 * 
 * Options:
 *   --input        Input SQL file (default: ./sample-data.sql)
 *   --database-url Database connection URL (uses DATABASE_URL env var by default)
 *   --reset        Drop and recreate database before loading (default: false)
 */

import { parseArgs } from "util";
import { Client } from "pg";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    input: {
      type: "string",
      default: "./sample-data.sql",
    },
    "database-url": {
      type: "string",
    },
    reset: {
      type: "boolean",
      default: false,
    },
  },
  strict: true,
  allowPositionals: true,
});

const inputFile = values.input || "./sample-data.sql";
const databaseUrl = values["database-url"] || process.env.DATABASE_URL;
const shouldReset = values.reset || false;

if (!databaseUrl) {
  console.error("❌ Error: Database URL not provided");
  console.error("Set DATABASE_URL environment variable or use --database-url option");
  process.exit(1);
}

if (!existsSync(inputFile)) {
  console.error(`❌ Error: Input file not found: ${inputFile}`);
  console.error("Run extract-sample-data.ts first to generate sample data");
  process.exit(1);
}

console.log("📥 Loading sample data into local database...");
console.log(`📊 Parameters:`);
console.log(`   - Input: ${inputFile}`);
console.log(`   - Database: ${databaseUrl.replace(/\/\/.*@/, '//<redacted>@')}`);
console.log(`   - Reset: ${shouldReset}`);

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  console.log("✅ Connected to local database");

  if (shouldReset) {
    console.log("\n🔧 Resetting database...");
    
    // Drop all tables
    const dropTablesQuery = `
      DO $$ 
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `;
    
    await client.query(dropTablesQuery);
    console.log("✅ Dropped all existing tables");
    
    // Run init-database.sql
    const initDbPath = path.join(process.cwd(), "scripts", "init-database.sql");
    if (existsSync(initDbPath)) {
      console.log("📝 Running init-database.sql...");
      const initSql = await readFile(initDbPath, "utf-8");
      await client.query(initSql);
      console.log("✅ Database schema initialized");
    } else {
      console.error("❌ Error: init-database.sql not found");
      process.exit(1);
    }
  } else {
    // Check if tables exist
    const checkTablesQuery = `
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'api_requests'
    `;
    
    const result = await client.query(checkTablesQuery);
    if (result.rows[0].count === '0') {
      console.log("\n⚠️  Database tables not found. Running init-database.sql...");
      
      const initDbPath = path.join(process.cwd(), "scripts", "init-database.sql");
      if (existsSync(initDbPath)) {
        const initSql = await readFile(initDbPath, "utf-8");
        await client.query(initSql);
        console.log("✅ Database schema initialized");
      } else {
        console.error("❌ Error: init-database.sql not found");
        process.exit(1);
      }
    }
  }

  // Clear existing sample data (preserve schema)
  if (!shouldReset) {
    console.log("\n🧹 Clearing existing data...");
    
    // Delete in correct order to respect foreign keys
    const clearQueries = [
      "DELETE FROM streaming_chunks",
      "DELETE FROM conversation_analyses",
      "DELETE FROM api_requests",
    ];
    
    for (const query of clearQueries) {
      try {
        const result = await client.query(query);
        if (result.rowCount > 0) {
          console.log(`   - Cleared ${result.rowCount} rows from ${query.split(' ')[2]}`);
        }
      } catch (error) {
        // Table might not exist, that's ok
      }
    }
  }

  // Load sample data
  console.log("\n📝 Loading sample data...");
  const sampleSql = await readFile(inputFile, "utf-8");
  
  // Execute the SQL
  await client.query(sampleSql);
  console.log("✅ Sample data loaded successfully");

  // Get statistics
  console.log("\n📊 Database Statistics:");
  
  const stats = [
    { table: 'api_requests', label: 'API Requests' },
    { table: 'streaming_chunks', label: 'Streaming Chunks' },
    { table: 'conversation_analyses', label: 'Conversation Analyses' },
  ];
  
  for (const { table, label } of stats) {
    try {
      const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`   - ${label}: ${result.rows[0].count}`);
    } catch (error) {
      // Table might not exist
    }
  }

  // Get conversation summary
  const convQuery = `
    SELECT 
      COUNT(DISTINCT conversation_id) as conversations,
      COUNT(DISTINCT domain) as domains,
      COUNT(DISTINCT model) as models,
      MIN(timestamp) as oldest,
      MAX(timestamp) as newest
    FROM api_requests
    WHERE conversation_id IS NOT NULL
  `;
  
  const convResult = await client.query(convQuery);
  const conv = convResult.rows[0];
  
  console.log("\n📋 Conversation Summary:");
  console.log(`   - Total conversations: ${conv.conversations}`);
  console.log(`   - Domains: ${conv.domains}`);
  console.log(`   - Models used: ${conv.models}`);
  console.log(`   - Date range: ${new Date(conv.oldest).toLocaleDateString()} - ${new Date(conv.newest).toLocaleDateString()}`);

  console.log("\n✅ Sample data loaded successfully!");
  console.log("\n🚀 Next steps:");
  console.log("   1. Start the services: bun run dev");
  console.log("   2. Open dashboard: http://localhost:3001");
  console.log("   3. Use dashboard API key: test-dashboard-key-123");

} catch (error) {
  console.error("❌ Error:", error);
  process.exit(1);
} finally {
  await client.end();
}