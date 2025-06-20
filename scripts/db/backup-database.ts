#!/usr/bin/env bun
import { execSync } from 'child_process'
import { parseArgs } from 'util'

/**
 * Database backup script - creates a backup of the Claude Nexus database
 *
 * Usage:
 *   bun run scripts/backup-database.ts              # Creates a new backup database
 *   bun run scripts/backup-database.ts --file       # Exports to a .sql file
 *   bun run scripts/backup-database.ts --file=backup.sql  # Exports to specific file
 */

function formatTimestamp(): string {
  const now = new Date()
  return now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '')
}

function getDatabaseName(connectionString: string): string {
  const url = new URL(connectionString)
  return url.pathname.substring(1)
}

async function backupDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }

  // Parse command line arguments
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      file: {
        type: 'string',
        short: 'f',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
    strict: true,
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Database Backup Script

Usage:
  bun run scripts/backup-database.ts              # Creates a new backup database
  bun run scripts/backup-database.ts --file       # Exports to a .sql file
  bun run scripts/backup-database.ts --file=backup.sql  # Exports to specific file
  bun run scripts/backup-database.ts --help       # Show this help

Options:
  -f, --file [filename]  Export to file instead of creating a backup database
  -h, --help            Show help information
`)
    process.exit(0)
  }

  const dbName = getDatabaseName(databaseUrl)
  const timestamp = formatTimestamp()

  try {
    if (values.file !== undefined) {
      // File backup mode
      const filename =
        typeof values.file === 'string' && values.file
          ? values.file
          : `claude_nexus_backup_${timestamp}.sql`

      console.log(`Starting database backup to file: ${filename}`)
      console.log(`Source database: ${dbName}`)

      // Use pg_dump with connection string directly
      const dumpCommand = [
        'pg_dump',
        `"${databaseUrl}"`,
        '--verbose',
        '--no-owner',
        '--no-privileges',
        '--if-exists',
        '--clean',
        `-f ${filename}`,
      ].join(' ')

      execSync(dumpCommand, { stdio: 'inherit' })

      console.log(`✅ Database backup completed successfully!`)
      console.log(`📁 Backup file: ${filename}`)

      // Get file size
      const stats = await Bun.file(filename).size
      console.log(`📊 File size: ${(stats / 1024 / 1024).toFixed(2)} MB`)
    } else {
      // Database backup mode
      const backupDbName = `${dbName}_backup_${timestamp}`

      console.log(`Starting database backup...`)
      console.log(`Source database: ${dbName}`)
      console.log(`Backup database: ${backupDbName}`)

      // First, create the backup database using the postgres database
      console.log(`Creating backup database...`)
      const postgresUrl = new URL(databaseUrl)
      postgresUrl.pathname = '/postgres'
      const createDbCommand = `psql "${postgresUrl.toString()}" -c "CREATE DATABASE \\"${backupDbName}\\""`

      execSync(createDbCommand, { stdio: 'inherit' })

      // Then use pg_dump and psql to copy the database
      console.log(`Copying database content...`)
      const backupUrl = new URL(databaseUrl)
      backupUrl.pathname = `/${backupDbName}`
      
      const backupCommand = `pg_dump "${databaseUrl}" --verbose --no-owner --no-privileges | psql "${backupUrl.toString()}"`

      execSync(backupCommand, { stdio: 'inherit', shell: true })

      console.log(`✅ Database backup completed successfully!`)
      console.log(`🗄️  Backup database: ${backupDbName}`)

      // Show connection string for the backup
      console.log(`🔗 Connection string: ${backupUrl.toString()}`)
    }
  } catch (error) {
    console.error('❌ Backup failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run backup
backupDatabase().catch(console.error)
