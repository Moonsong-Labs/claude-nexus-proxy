#!/usr/bin/env bun

import { Pool } from 'pg'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function migrate() {
  const client = await pool.connect()

  try {
    console.log('Starting migration 006: Split conversation hashes...')

    await client.query('BEGIN')

    // Add system_hash column
    console.log('Adding system_hash column to api_requests table...')
    await client.query(`
      ALTER TABLE api_requests 
      ADD COLUMN IF NOT EXISTS system_hash VARCHAR(64);
    `)

    // Create index for system_hash
    console.log('Creating index on system_hash...')
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_requests_system_hash 
      ON api_requests(system_hash);
    `)

    // Add comment to document the column
    await client.query(`
      COMMENT ON COLUMN api_requests.system_hash IS 
      'SHA-256 hash of the system prompt only, separate from message content hash';
    `)

    await client.query('COMMIT')
    console.log('Migration 006 completed successfully!')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Migration 006 failed:', error)
    throw error
  } finally {
    client.release()
  }
}

// Rollback function for reversibility
async function rollback() {
  const client = await pool.connect()

  try {
    console.log('Rolling back migration 006...')

    await client.query('BEGIN')

    // Drop index first
    await client.query('DROP INDEX IF EXISTS idx_api_requests_system_hash;')

    // Drop column
    await client.query('ALTER TABLE api_requests DROP COLUMN IF EXISTS system_hash;')

    await client.query('COMMIT')
    console.log('Rollback 006 completed successfully!')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Rollback 006 failed:', error)
    throw error
  } finally {
    client.release()
  }
}

// Main execution
async function main() {
  const command = process.argv[2]

  try {
    if (command === 'rollback') {
      await rollback()
    } else {
      await migrate()
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
