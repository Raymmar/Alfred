import type { SelectProject, SelectUser, SelectChat } from "@db/schema";

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
  error?: string;
}

export interface InsightGenerationResult {
  summary: string;
  keyPoints?: string[];
  topics?: string[];
  error?: string;
}

export interface TaskExtractionResult {
  tasks: Array<{
    text: string;
    priority?: 'low' | 'medium' | 'high';
    category?: string;
  }>;
  error?: string;
}

export interface ChatContext {
  transcription?: string | null;
  summary?: string | null;
  projectId?: number;
}

export interface ChatCompletionOptions {
  userId: number;
  message: string;
  context?: ChatContext;
  promptType?: 'primary' | 'todo' | 'system';
}

export interface ChatCompletionResult {
  message: string;
  context?: {
    similarityScore: number;
    contextCount: number;
    recommendedTasks: number;
  };
  error?: string;
}

export interface AIServiceConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
