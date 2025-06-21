/**
 * Value object representing token usage metrics
 */
export interface TokenMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  fullUsageData?: any
  toolCallCount: number
}