#!/usr/bin/env bun
import { Pool } from 'pg'

/**
 * Migration to add comprehensive token usage tracking
 * Includes partitioned token_usage table and rate limit configurations
 */
async function addTokenUsageTracking() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    console.log('Starting token usage tracking migration...')

    // Start transaction
    await pool.query('BEGIN')

    // Create partitioned token_usage table
    console.log('Creating partitioned token_usage table...')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id BIGSERIAL,
        request_id UUID UNIQUE,
        domain VARCHAR(255) NOT NULL,
        model VARCHAR(100) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
        request_type VARCHAR(50) NOT NULL,
        PRIMARY KEY (id, timestamp)
      ) PARTITION BY RANGE (timestamp)
    `)

    // Create initial partitions for the next 3 months
    const now = new Date()
    for (let i = 0; i < 3; i++) {
      const startDate = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const endDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
      const partitionName = `token_usage_${startDate.getFullYear()}_${String(startDate.getMonth() + 1).padStart(2, '0')}`
      
      console.log(`Creating partition ${partitionName}...`)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF token_usage
        FOR VALUES FROM ('${startDate.toISOString().split('T')[0]}') TO ('${endDate.toISOString().split('T')[0]}')
      `)
    }

    // Create indexes for token_usage
    console.log('Creating indexes for token_usage...')
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_lookup 
      ON token_usage (domain, model, timestamp DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_domain_timestamp 
      ON token_usage (domain, timestamp DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_request_id 
      ON token_usage (request_id)
    `)

    // Create rate_limit_configs table
    console.log('Creating rate_limit_configs table...')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_configs (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255),
        model VARCHAR(100) NOT NULL,
        window_seconds INTEGER NOT NULL,
        token_limit INTEGER,
        request_limit INTEGER,
        fallback_model VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT check_has_limit CHECK (token_limit IS NOT NULL OR request_limit IS NOT NULL)
      )
    `)

    // Create unique index for rate limit configs
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_configs_unique 
      ON rate_limit_configs (COALESCE(domain, ''), model, window_seconds) 
      WHERE is_active = true
    `)

    // Create rate_limit_events table for tracking limit hits
    console.log('Creating rate_limit_events table...')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_events (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(255) NOT NULL,
        model VARCHAR(100) NOT NULL,
        event_type VARCHAR(50) NOT NULL, -- 'limit_exceeded', 'model_switched', 'limit_suggested'
        window_seconds INTEGER NOT NULL,
        tokens_used INTEGER,
        token_limit INTEGER,
        requests_used INTEGER,
        request_limit INTEGER,
        fallback_model VARCHAR(100),
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB
      )
    `)

    // Create index for rate limit events
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup 
      ON rate_limit_events (domain, timestamp DESC)
    `)

    // Add function to get token usage in window
    console.log('Creating helper functions...')
    await pool.query(`
      CREATE OR REPLACE FUNCTION get_token_usage_in_window(
        p_domain VARCHAR,
        p_model VARCHAR,
        p_window_seconds INTEGER
      ) RETURNS TABLE (
        input_tokens BIGINT,
        output_tokens BIGINT,
        total_tokens BIGINT,
        request_count BIGINT
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT 
          COALESCE(SUM(tu.input_tokens), 0)::BIGINT as input_tokens,
          COALESCE(SUM(tu.output_tokens), 0)::BIGINT as output_tokens,
          COALESCE(SUM(tu.total_tokens), 0)::BIGINT as total_tokens,
          COUNT(*)::BIGINT as request_count
        FROM token_usage tu
        WHERE tu.domain = p_domain
          AND tu.model = p_model
          AND tu.timestamp > NOW() - (p_window_seconds || ' seconds')::INTERVAL;
      END;
      $$ LANGUAGE plpgsql STABLE
    `)

    // Add function to auto-create future partitions
    console.log('Creating partition maintenance function...')
    await pool.query(`
      CREATE OR REPLACE FUNCTION create_monthly_partitions(months_ahead INTEGER DEFAULT 3)
      RETURNS void AS $$
      DECLARE
        start_date DATE;
        end_date DATE;
        partition_name TEXT;
        i INTEGER;
      BEGIN
        FOR i IN 0..months_ahead LOOP
          start_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
          end_date := DATE_TRUNC('month', start_date + INTERVAL '1 month');
          partition_name := 'token_usage_' || TO_CHAR(start_date, 'YYYY_MM');
          
          -- Check if partition already exists
          IF NOT EXISTS (
            SELECT 1 FROM pg_tables 
            WHERE tablename = partition_name
          ) THEN
            EXECUTE format(
              'CREATE TABLE %I PARTITION OF token_usage FOR VALUES FROM (%L) TO (%L)',
              partition_name, start_date, end_date
            );
            RAISE NOTICE 'Created partition %', partition_name;
          END IF;
        END LOOP;
      END;
      $$ LANGUAGE plpgsql
    `)

    // Add comments
    console.log('Adding table and column comments...')
    await pool.query(`COMMENT ON TABLE token_usage IS 'Tracks all token usage including filtered request types'`)
    await pool.query(`COMMENT ON TABLE rate_limit_configs IS 'Configurable rate limits per domain/model combination'`)
    await pool.query(`COMMENT ON TABLE rate_limit_events IS 'Historical record of rate limit events and model switches'`)
    await pool.query(`COMMENT ON COLUMN token_usage.total_tokens IS 'Generated column: input_tokens + output_tokens'`)
    await pool.query(`COMMENT ON COLUMN rate_limit_configs.domain IS 'NULL means global limit for the model'`)
    await pool.query(`COMMENT ON COLUMN rate_limit_configs.priority IS 'Higher priority configs override lower ones'`)

    // Insert default rate limit configurations
    console.log('Inserting default rate limit configurations...')
    await pool.query(`
      INSERT INTO rate_limit_configs (model, window_seconds, token_limit, request_limit, priority)
      VALUES 
        -- Short-term burst protection (1 minute)
        ('claude-3-opus-20240229', 60, 10000, 10, 1),
        ('claude-3-5-sonnet-20241022', 60, 10000, 10, 1),
        ('claude-3-haiku-20240307', 60, 10000, 10, 1),
        
        -- Long-term usage limits (5 hours)
        ('claude-3-opus-20240229', 18000, 140000, NULL, 1),
        ('claude-3-5-sonnet-20241022', 18000, 140000, NULL, 1),
        ('claude-3-haiku-20240307', 18000, 140000, NULL, 1)
      ON CONFLICT DO NOTHING
    `)

    // Verify migration
    console.log('Verifying migration...')
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('token_usage', 'rate_limit_configs', 'rate_limit_events')
    `)

    const foundTables = tableCheck.rows.map(row => row.table_name)
    const expectedTables = ['token_usage', 'rate_limit_configs', 'rate_limit_events']
    const missingTables = expectedTables.filter(table => !foundTables.includes(table))

    if (missingTables.length > 0) {
      throw new Error(`Missing tables after migration: ${missingTables.join(', ')}`)
    }

    // Commit transaction
    await pool.query('COMMIT')
    console.log('Token usage tracking migration completed successfully!')
    console.log('✅ All tables, partitions, and indexes created')
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK')
    console.error(
      'Token usage tracking migration failed:',
      error instanceof Error ? error.message : String(error)
    )
    process.exit(1)
  } finally {
    await pool.end()
  }
}

// Run migration
addTokenUsageTracking().catch(console.error)