#!/usr/bin/env bun
/**
 * Migration 011: Add conversation_analyses table for AI-powered conversation analysis
 *
 * This migration creates the infrastructure for storing AI-generated analyses of conversations.
 * Each conversation+branch can have one analysis, which includes:
 * - Analysis content and structured data
 * - Processing status and retry tracking
 * - Token usage metrics
 * - Model information
 *
 * Features:
 * - ENUM type for status field (better than CHECK constraint)
 * - Automatic updated_at trigger
 * - Optimized indexes for pending analyses and conversation lookups
 */

import { Pool } from 'pg'
import { config } from 'dotenv'

// Load environment variables
config()

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  try {
    console.log('Migration 011: Creating conversation_analyses table and related objects...')

    // Create ENUM type for status
    console.log('\n1. Creating conversation_analysis_status ENUM type...')
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_analysis_status') THEN
              CREATE TYPE conversation_analysis_status AS ENUM (
                  'pending',
                  'processing',
                  'completed',
                  'failed'
              );
              RAISE NOTICE 'Created conversation_analysis_status ENUM type';
          ELSE
              RAISE NOTICE 'conversation_analysis_status ENUM type already exists';
          END IF;
      END$$;
    `)
    console.log('✓ ENUM type ready')

    // Create or replace the updated_at trigger function
    console.log('\n2. Creating trigger_set_timestamp function...')
    await pool.query(`
      CREATE OR REPLACE FUNCTION trigger_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    console.log('✓ Trigger function created')

    // Create the main table
    console.log('\n3. Creating conversation_analyses table...')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_analyses (
          id BIGSERIAL PRIMARY KEY,
          conversation_id UUID NOT NULL,
          branch_id VARCHAR(255) NOT NULL DEFAULT 'main',
          status conversation_analysis_status NOT NULL DEFAULT 'pending',
          model_used VARCHAR(255) DEFAULT 'gemini-2.5-pro',
          analysis_content TEXT,
          analysis_data JSONB,
          raw_response JSONB,
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          generated_at TIMESTAMPTZ,
          processing_duration_ms INTEGER,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (conversation_id, branch_id)
      );
    `)
    console.log('✓ Table created')

    // Create the updated_at trigger
    console.log('\n4. Creating updated_at trigger...')
    await pool.query(`
      DROP TRIGGER IF EXISTS set_timestamp_on_conversation_analyses ON conversation_analyses;
      CREATE TRIGGER set_timestamp_on_conversation_analyses
      BEFORE UPDATE ON conversation_analyses
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
    `)
    console.log('✓ Trigger created')

    // Create indexes
    console.log('\n5. Creating indexes...')

    // Index for finding pending analyses
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_analyses_status
      ON conversation_analyses (status)
      WHERE status = 'pending';
    `)
    console.log('  ✓ Created partial index on status for pending analyses')

    // Index for conversation lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_analyses_conversation
      ON conversation_analyses (conversation_id, branch_id);
    `)
    console.log('  ✓ Created composite index on (conversation_id, branch_id)')

    // Add column comments for documentation
    console.log('\n6. Adding column comments...')
    await pool.query(`
      COMMENT ON TABLE conversation_analyses IS 'Stores AI-generated analyses of conversations';
      COMMENT ON COLUMN conversation_analyses.conversation_id IS 'UUID of the conversation being analyzed';
      COMMENT ON COLUMN conversation_analyses.branch_id IS 'Branch within the conversation (defaults to main)';
      COMMENT ON COLUMN conversation_analyses.status IS 'Processing status: pending, processing, completed, or failed';
      COMMENT ON COLUMN conversation_analyses.model_used IS 'AI model used for analysis (e.g., gemini-2.5-pro)';
      COMMENT ON COLUMN conversation_analyses.analysis_content IS 'Human-readable analysis text';
      COMMENT ON COLUMN conversation_analyses.analysis_data IS 'Structured analysis data in JSON format';
      COMMENT ON COLUMN conversation_analyses.raw_response IS 'Complete raw response from the AI model';
      COMMENT ON COLUMN conversation_analyses.error_message IS 'Error details if analysis failed';
      COMMENT ON COLUMN conversation_analyses.retry_count IS 'Number of retry attempts for failed analyses';
      COMMENT ON COLUMN conversation_analyses.generated_at IS 'Timestamp when the analysis was completed';
      COMMENT ON COLUMN conversation_analyses.processing_duration_ms IS 'Time taken to generate the analysis in milliseconds';
      COMMENT ON COLUMN conversation_analyses.prompt_tokens IS 'Number of tokens used in the prompt';
      COMMENT ON COLUMN conversation_analyses.completion_tokens IS 'Number of tokens in the completion';
    `)
    console.log('✓ Column comments added')

    // Analyze the table to update statistics
    console.log('\n7. Analyzing conversation_analyses table...')
    await pool.query('ANALYZE conversation_analyses')
    console.log('✓ Table analyzed')

    // Show final status
    console.log('\n8. Verifying migration results...')

    // Check table structure
    const tableCheck = await pool.query(`
      SELECT 
        column_name,
        data_type,
        column_default,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'conversation_analyses'
      ORDER BY ordinal_position
    `)

    console.log('\nTable structure:')
    console.log('Columns:', tableCheck.rows.length)

    // Check indexes
    const indexCheck = await pool.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'conversation_analyses'
    `)

    console.log('\nIndexes:', indexCheck.rows.length)
    for (const idx of indexCheck.rows) {
      console.log(`  - ${idx.indexname}`)
    }

    console.log('\n✅ Migration 011 completed successfully!')
    console.log('\nThe conversation_analyses table is ready for storing AI-generated analyses.')
    console.log('Key features:')
    console.log('  - ENUM type for status field ensures data integrity')
    console.log('  - Automatic updated_at timestamp via trigger')
    console.log('  - Optimized indexes for queue processing and lookups')
    console.log('  - UNIQUE constraint prevents duplicate analyses per conversation/branch')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await pool.end()
  }
}

// Run migration
migrate().catch(error => {
  console.error('Migration error:', error)
  process.exit(1)
})
