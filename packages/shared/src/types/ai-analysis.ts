import { z } from 'zod'

// Define the Zod schema for runtime validation
export const ConversationAnalysisSchema = z.object({
  summary: z
    .string()
    .describe('A concise, neutral summary of the entire conversation (2-4 sentences).'),
  keyTopics: z.array(z.string()).describe('A list of the main subjects discussed (3-5 topics).'),
  sentiment: z
    .enum(['positive', 'neutral', 'negative', 'mixed'])
    .describe("The overall sentiment of the user's messages."),
  userIntent: z.string().describe('The primary goal or question the user was trying to address.'),
  outcomes: z
    .array(z.string())
    .describe('Key conclusions, resolutions, or final answers provided.'),
  actionItems: z
    .array(z.string())
    .describe('A list of clear, actionable tasks for the user or assistant.'),
  technicalDetails: z
    .object({
      frameworks: z.array(z.string()).describe('Technologies, frameworks, or libraries mentioned.'),
      issues: z.array(z.string()).describe('Technical problems or errors encountered.'),
      solutions: z.array(z.string()).describe('Proposed or implemented solutions.'),
    })
    .describe('Specific technical elements identified in the conversation.'),
  conversationQuality: z
    .object({
      clarity: z
        .enum(['high', 'medium', 'low'])
        .describe('How clear and well-structured the conversation was.'),
      completeness: z
        .enum(['complete', 'partial', 'incomplete'])
        .describe("Whether the user's goals were fully addressed."),
      effectiveness: z
        .enum(['highly effective', 'effective', 'needs improvement'])
        .describe('Overall effectiveness of the interaction.'),
    })
    .describe('Assessment of the conversation quality.'),
})

// Infer the TypeScript type from the Zod schema
export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>

// API Request/Response types for conversation analysis endpoints

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed'

export enum ConversationAnalysisStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// POST /api/analyses request body
export const CreateAnalysisRequestSchema = z.object({
  conversationId: z.string().uuid(),
  branchId: z.string().default('main'),
})

export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>

// POST /api/analyses response
export interface CreateAnalysisResponse {
  id: number
  conversationId: string
  branchId: string
  status: AnalysisStatus
  createdAt: string
}

// GET /api/analyses/:conversationId/:branchId response
export interface GetAnalysisResponse {
  id: number
  conversationId: string
  branchId: string
  status: AnalysisStatus
  analysis?: {
    content: string // Markdown formatted analysis
    data: ConversationAnalysis // Structured data
    modelUsed: string
    generatedAt: string
    processingDurationMs: number
  }
  error?: string // Only present if status is 'failed'
  createdAt: string
  updatedAt: string
}

// POST /api/analyses/:conversationId/:branchId/regenerate response
export interface RegenerateAnalysisResponse {
  id: number
  status: AnalysisStatus
  message: string
}

// Error response for 409 Conflict when analysis already exists
export interface AnalysisConflictResponse {
  error: string
  analysis: GetAnalysisResponse
}
