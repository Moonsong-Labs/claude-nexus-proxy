import { GeminiService } from './GeminiService.js'
import {
  claimJob,
  completeJob,
  failJob,
  resetStuckJobs,
  fetchConversationMessages,
  type ConversationAnalysisJob,
} from './db.js'
import { AI_WORKER_CONFIG } from '@claude-nexus/shared/config'
import { logger } from '../../middleware/logger.js'

export class AnalysisWorker {
  private geminiService: GeminiService
  private pollInterval: number
  private maxConcurrentJobs: number
  private jobTimeoutMinutes: number
  private isRunning = false
  private timer: NodeJS.Timeout | null = null
  private activeJobs: Array<Promise<void>> = []

  constructor() {
    this.geminiService = new GeminiService()

    this.pollInterval = AI_WORKER_CONFIG.POLL_INTERVAL_MS
    this.maxConcurrentJobs = AI_WORKER_CONFIG.MAX_CONCURRENT_JOBS
    this.jobTimeoutMinutes = AI_WORKER_CONFIG.JOB_TIMEOUT_MINUTES
  }

  start() {
    if (!AI_WORKER_CONFIG.ENABLED) {
      logger.info('AI Analysis Worker is disabled by configuration', {
        metadata: { worker: 'analysis-worker' },
      })
      return
    }

    this.isRunning = true
    logger.info(`AI Analysis Worker started`, {
      metadata: {
        worker: 'analysis-worker',
        pollInterval: this.pollInterval,
        maxConcurrentJobs: this.maxConcurrentJobs,
      },
    })

    this.runCycle()
  }

  async stop() {
    logger.info('Stopping AI Analysis Worker...', { metadata: { worker: 'analysis-worker' } })
    this.isRunning = false

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const timeout = 30000
    const startTime = Date.now()

    if (this.activeJobs.length > 0) {
      logger.info(`Waiting for ${this.activeJobs.length} active jobs to complete...`, {
        metadata: { worker: 'analysis-worker' },
      })

      await Promise.race([
        Promise.all(this.activeJobs),
        new Promise(resolve => setTimeout(resolve, timeout)),
      ])

      const elapsed = Date.now() - startTime
      if (elapsed >= timeout) {
        logger.warn(`Forced shutdown after ${timeout}ms timeout`, {
          metadata: { worker: 'analysis-worker' },
        })
      } else {
        logger.info(`All jobs completed in ${elapsed}ms`, {
          metadata: { worker: 'analysis-worker' },
        })
      }
    }

    logger.info('AI Analysis Worker stopped', { metadata: { worker: 'analysis-worker' } })
  }

  private async runCycle() {
    if (!this.isRunning) {
      return
    }

    try {
      await this.processPendingJobs()
      await this.handleStuckJobs()
    } catch (error) {
      logger.error('Error in worker cycle', { error, metadata: { worker: 'analysis-worker' } })
    } finally {
      if (this.isRunning) {
        this.timer = setTimeout(() => this.runCycle(), this.pollInterval)
      }
    }
  }

  private async processPendingJobs() {
    const availableSlots = this.maxConcurrentJobs - this.activeJobs.length
    if (availableSlots <= 0) {
      return
    }

    const jobsToProcess: ConversationAnalysisJob[] = []

    for (let i = 0; i < availableSlots; i++) {
      const job = await claimJob()
      if (job) {
        jobsToProcess.push(job)
      } else {
        break
      }
    }

    if (jobsToProcess.length === 0) {
      return
    }

    logger.debug(`Processing ${jobsToProcess.length} jobs...`, {
      metadata: { worker: 'analysis-worker' },
    })

    const newJobPromises = jobsToProcess.map(job => {
      const jobPromise = this.processJob(job).finally(() => {
        const index = this.activeJobs.indexOf(jobPromise)
        if (index > -1) {
          this.activeJobs.splice(index, 1)
        }
      })

      this.activeJobs.push(jobPromise)
      return jobPromise
    })

    await Promise.allSettled(newJobPromises)
  }

  private async processJob(job: ConversationAnalysisJob) {
    const startTime = Date.now()

    try {
      logger.debug(`Processing job ${job.id} for conversation ${job.conversation_id}`, {
        metadata: { worker: 'analysis-worker' },
      })

      const messages = await fetchConversationMessages(job.conversation_id, job.branch_id)

      if (messages.length === 0) {
        throw new Error('No messages found for conversation')
      }

      const analysis = await this.withExponentialBackoff(
        () => this.geminiService.analyzeConversation(messages),
        job.retry_count
      )

      const processingDuration = Date.now() - startTime

      await completeJob(
        job.id,
        analysis.content,
        analysis.data,
        analysis.rawResponse,
        this.geminiService['modelName'] || 'gemini-2.0-flash-exp',
        analysis.promptTokens,
        analysis.completionTokens,
        processingDuration
      )

      logger.info(`Job ${job.id} completed successfully`, {
        metadata: {
          worker: 'analysis-worker',
          jobId: job.id,
          conversationId: job.conversation_id,
          durationMs: processingDuration,
          tokensUsed: analysis.promptTokens + analysis.completionTokens,
        },
      })
    } catch (error) {
      const processingDuration = Date.now() - startTime
      logger.error(`Job ${job.id} failed`, {
        error,
        metadata: {
          worker: 'analysis-worker',
          jobId: job.id,
          conversationId: job.conversation_id,
          durationMs: processingDuration,
        },
      })

      await failJob(job, error as Error)
    }
  }

  private async withExponentialBackoff<T>(fn: () => Promise<T>, retryCount: number): Promise<T> {
    if (retryCount === 0) {
      return fn()
    }

    const baseDelay = 1000
    const maxDelay = 15000
    const jitter = Math.random() * 0.3

    const delay = Math.min(baseDelay * Math.pow(2.5, retryCount - 1), maxDelay)
    const jitteredDelay = delay * (1 + jitter)

    logger.debug(
      `Waiting ${Math.round(jitteredDelay)}ms before retry (attempt ${retryCount + 1})`,
      { metadata: { worker: 'analysis-worker' } }
    )

    await new Promise(resolve => setTimeout(resolve, jitteredDelay))

    return fn()
  }

  private async handleStuckJobs() {
    try {
      const resetCount = await resetStuckJobs()
      if (resetCount > 0) {
        logger.info(`Reset ${resetCount} stuck analysis jobs`, {
          metadata: { worker: 'analysis-worker' },
        })
      }
    } catch (error) {
      logger.error('Error handling stuck jobs', { error, metadata: { worker: 'analysis-worker' } })
    }
  }
}
