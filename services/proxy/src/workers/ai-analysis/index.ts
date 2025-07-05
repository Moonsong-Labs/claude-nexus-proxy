import { AnalysisWorker } from './AnalysisWorker.js'
import { logger } from '../../middleware/logger.js'
import { AI_WORKER_CONFIG, GEMINI_CONFIG } from '@claude-nexus/shared/config'

let workerInstance: AnalysisWorker | null = null

export function startAnalysisWorker(): AnalysisWorker {
  if (workerInstance) {
    logger.warn('Analysis worker already started', { metadata: { worker: 'analysis-worker' } })
    return workerInstance
  }

  // Validate configuration before starting
  if (AI_WORKER_CONFIG.ENABLED && !GEMINI_CONFIG.API_KEY) {
    logger.error(
      'FATAL: AI_WORKER_ENABLED is true, but GEMINI_API_KEY is not set. The AI Analysis Worker cannot start.',
      {
        metadata: { worker: 'analysis-worker' },
      }
    )
    process.exit(1)
  }

  workerInstance = new AnalysisWorker()
  workerInstance.start()

  const gracefulShutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down analysis worker gracefully...`, {
      metadata: { worker: 'analysis-worker' },
    })
    if (workerInstance) {
      await workerInstance.stop()
      workerInstance = null
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  return workerInstance
}

export function getAnalysisWorker(): AnalysisWorker | null {
  return workerInstance
}

export { AnalysisWorker }
