/**
 * Type definitions for conversation-related data
 */

export interface ConversationRequest {
  request_id: string
  timestamp: string
  branch_id?: string
  model: string
  total_tokens: number
  error?: any
  current_message_hash?: string
  parent_message_hash?: string
  request_tokens?: number
  response_tokens?: number
  duration?: number
  hasToolUse?: boolean
  hasToolResult?: boolean
  messageTypeSummary?: string[]
  message_count?: number
  parent_task_request_id?: string
  is_subtask?: boolean
  task_tool_invocation?: any
}

export interface ConversationSummary {
  conversation_id: string
  message_count: number
  first_message: Date
  last_message: Date
  total_tokens: number
  branches: string[]
  requests: ConversationRequest[]
}

export interface ApiRequest extends ConversationRequest {
  domain: string
  status_code: number
  request_body?: any
  response_body?: any
  path: string
  method: string
  headers?: Record<string, string>
}
