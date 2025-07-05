#!/usr/bin/env bun

/**
 * Migration 012: Add analysis audit log table
 *
 * This migration creates an audit log table for tracking all AI analysis
 * related events including requests, regenerations, and access patterns.
 */

import pg from 'pg'
import { config } from '@claude-nexus/shared/config'

const { Pool } = pg

async function migrate() {
  const pool = new Pool({
    connectionString: config.database.url,
  })

  try {
    console.log('Starting migration 012: Add analysis audit log...')

    await pool.query('BEGIN')

    // Create audit log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analysis_audit_log (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        outcome VARCHAR(50) NOT NULL,
        conversation_id UUID NOT NULL,
        branch_id VARCHAR(255) NOT NULL,
        domain VARCHAR(255) NOT NULL,
        request_id VARCHAR(255) NOT NULL,
        user_context JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `)

    console.log('Created analysis_audit_log table')

    // Create indexes for efficient querying
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_conversation ON analysis_audit_log (conversation_id, branch_id);
      CREATE INDEX IF NOT EXISTS idx_audit_domain ON analysis_audit_log (domain);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON analysis_audit_log (timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON analysis_audit_log (event_type);
    `)

    console.log('Created indexes on analysis_audit_log table')

    // Create partitioning for better performance (optional, for high-volume)
    // Partition by month
    await pool.query(`
      -- Enable partitioning if needed in the future
      -- This is a placeholder for potential partitioning strategy
      COMMENT ON TABLE analysis_audit_log IS 
        'Audit log for AI analysis operations. Consider partitioning by timestamp for high-volume deployments.'
    `)

    await pool.query('COMMIT')
    console.log('Migration 012 completed successfully')
  } catch (error) {
    await pool.query('ROLLBACK')
    console.error('Migration 012 failed:', error)
    throw error
  } finally {
    await pool.end()
  }
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
