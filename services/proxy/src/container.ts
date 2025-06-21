import { Pool } from 'pg'
import { MessageController } from './controllers/MessageController.js'
import { ProxyService } from './services/ProxyService.js'
import { AuthenticationService } from './services/AuthenticationService.js'
import { ClaudeApiClient } from './services/ClaudeApiClient.js'
import { MetricsService } from './services/MetricsService.js'
import { NotificationService } from './services/NotificationService.js'
import { StorageAdapter } from './storage/StorageAdapter.js'
import { TokenUsageService } from './services/TokenUsageService.js'
import { config } from '@claude-nexus/shared/config'
import { logger } from './middleware/logger.js'

/**
 * Dependency injection container for the proxy service
 */
class Container {
  private pool?: Pool
  private storageService?: StorageAdapter
  private tokenUsageService?: TokenUsageService
  private metricsService?: MetricsService
  private notificationService?: NotificationService
  private authenticationService?: AuthenticationService
  private claudeApiClient?: ClaudeApiClient
  private proxyService?: ProxyService
  private messageController?: MessageController

  constructor() {
    this.initializeServices()
  }

  private initializeServices(): void {
    // Initialize database pool if configured
    if (config.storage.enabled && config.database.url) {
      this.pool = new Pool({
        connectionString: config.database.url,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      })

      this.pool.on('error', err => {
        logger.error('Unexpected database pool error', {
          error: { message: err.message, stack: err.stack },
        })
      })
    }

    // Initialize storage service if enabled
    if (this.pool && config.storage.enabled) {
      this.storageService = new StorageAdapter(this.pool)
    }

    // Initialize token usage service if pool is available
    if (this.pool) {
      this.tokenUsageService = new TokenUsageService(this.pool)
    }

    // Initialize services
    this.metricsService = new MetricsService(
      {
        enableTokenTracking: true,
        enableStorage: config.storage.enabled,
        enableTelemetry: config.telemetry.enabled,
      },
      this.storageService,
      config.telemetry.endpoint,
      this.tokenUsageService
    )
    this.notificationService = new NotificationService()
    this.authenticationService = new AuthenticationService(
      config.api.claudeApiKey,
      config.auth.credentialsDir
    )
    this.claudeApiClient = new ClaudeApiClient()

    // Wire up dependencies
    this.notificationService.setAuthService(this.authenticationService)

    this.proxyService = new ProxyService(
      this.authenticationService,
      this.claudeApiClient,
      this.notificationService,
      this.metricsService,
      this.storageService
    )

    this.messageController = new MessageController(this.proxyService)
  }

  getDbPool(): Pool | undefined {
    return this.pool
  }

  getStorageService(): StorageAdapter | undefined {
    return this.storageService
  }

  getTokenUsageService(): TokenUsageService | undefined {
    return this.tokenUsageService
  }

  getMetricsService(): MetricsService {
    if (!this.metricsService) {
      throw new Error('MetricsService not initialized')
    }
    return this.metricsService
  }

  getNotificationService(): NotificationService {
    if (!this.notificationService) {
      throw new Error('NotificationService not initialized')
    }
    return this.notificationService
  }

  getAuthenticationService(): AuthenticationService {
    if (!this.authenticationService) {
      throw new Error('AuthenticationService not initialized')
    }
    return this.authenticationService
  }

  getClaudeApiClient(): ClaudeApiClient {
    if (!this.claudeApiClient) {
      throw new Error('ClaudeApiClient not initialized')
    }
    return this.claudeApiClient
  }

  getProxyService(): ProxyService {
    if (!this.proxyService) {
      throw new Error('ProxyService not initialized')
    }
    return this.proxyService
  }

  getMessageController(): MessageController {
    if (!this.messageController) {
      throw new Error('MessageController not initialized')
    }
    return this.messageController
  }

  async cleanup(): Promise<void> {
    if (this.storageService) {
      await this.storageService.close()
    }
    if (this.pool) {
      await this.pool.end()
    }
  }
}

// Create singleton instance
export const container = new Container()
