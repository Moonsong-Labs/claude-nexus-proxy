import { container } from '../container.js'
import { logger } from '../middleware/logger.js'

/**
 * Periodic task to create future partitions for token_usage table
 * Should be run daily to ensure partitions are created ahead of time
 */
export async function runPartitionMaintenance() {
  const tokenUsageService = container.getTokenUsageService()
  
  if (!tokenUsageService) {
    logger.warn('Token usage service not available, skipping partition maintenance')
    return
  }
  
  try {
    logger.info('Starting partition maintenance for token_usage table')
    await tokenUsageService.createFuturePartitions()
    logger.info('Partition maintenance completed successfully')
  } catch (error) {
    logger.error('Partition maintenance failed', {
      error: error instanceof Error ? error : new Error(String(error))
    })
  }
}

// Schedule partition maintenance to run daily at 2 AM
export function schedulePartitionMaintenance() {
  // Run immediately on startup
  runPartitionMaintenance()
  
  // Then run daily
  const ONE_DAY = 24 * 60 * 60 * 1000
  setInterval(() => {
    runPartitionMaintenance()
  }, ONE_DAY)
  
  logger.info('Partition maintenance scheduled to run daily')
}