#!/usr/bin/env bun
import { Pool } from 'pg'

/**
 * Migration script to add sub-task tracking columns to the database
 * This enables tracking relationships between Task tool invocations and their spawned conversations
 */
async function migrateSubtaskSchema() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    console.log('Starting sub-task tracking schema migration...')

    // Start transaction
    await pool.query('BEGIN')

    // Add new columns to api_requests table
    console.log('Adding sub-task tracking columns...')
    await pool.query(`
      ALTER TABLE api_requests
      ADD COLUMN IF NOT EXISTS parent_task_request_id UUID REFERENCES api_requests(request_id),
      ADD COLUMN IF NOT EXISTS is_subtask BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS task_tool_invocation JSONB
    `)

    // Create indexes for efficient lookups
    console.log('Creating indexes...')
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_parent_task_request_id 
      ON api_requests(parent_task_request_id)
    `)

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_is_subtask 
      ON api_requests(is_subtask)
    `)

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_requests_task_tool_invocation_gin
      ON api_requests USING GIN(task_tool_invocation)
      WHERE task_tool_invocation IS NOT NULL
    `)

    // Add column comments
    console.log('Adding column comments...')
    await pool.query(`
      COMMENT ON COLUMN api_requests.parent_task_request_id IS 'References the request that spawned this sub-task via Task tool';
      COMMENT ON COLUMN api_requests.is_subtask IS 'Indicates if this conversation was spawned as a sub-task';
      COMMENT ON COLUMN api_requests.task_tool_invocation IS 'Stores the Task tool invocation details from parent request';
    `)

    // Verify all columns exist
    console.log('Verifying migration...')
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'api_requests' 
      AND column_name IN ('parent_task_request_id', 'is_subtask', 'task_tool_invocation')
    `)

    const foundColumns = columnCheck.rows.map(row => row.column_name)
    const expectedColumns = ['parent_task_request_id', 'is_subtask', 'task_tool_invocation']
    const missingColumns = expectedColumns.filter(col => !foundColumns.includes(col))

    if (missingColumns.length > 0) {
      throw new Error(`Missing columns after migration: ${missingColumns.join(', ')}`)
    }

    // Commit transaction
    await pool.query('COMMIT')
    console.log('Migration completed successfully!')
    console.log(`✅ All sub-task tracking columns are present`)
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK')
    console.error('Migration failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    await pool.end()
  }
}

// Run migration
migrateSubtaskSchema().catch(console.error)
