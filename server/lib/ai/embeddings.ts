import { OpenAI } from 'openai';
import { db } from "@db";
import { eq, desc } from "drizzle-orm";
import { chats, todos, projects } from "@db/schema";
import { getAIServiceConfig, createOpenAIClient } from './utils';
import type { AIServiceConfig } from './types';

// In-memory cache for embeddings (temporary solution)
const embeddingsCache = new Map<string, number[]>();

export class EmbeddingsService {
  private client: OpenAI;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = createOpenAIClient(config);
  }

  static async create(userId: number): Promise<EmbeddingsService> {
    try {
      console.log('Creating EmbeddingsService for user:', userId);
      const config = await getAIServiceConfig(userId);
      console.log('Got AI service config:', { 
        hasApiKey: !!config.apiKey,
        model: config.model
      });
      return new EmbeddingsService(config);
    } catch (error) {
      console.error('Failed to create EmbeddingsService:', error);
      throw error;
    }
  }

  async createEmbedding(input: string) {
    try {
      console.log('Creating embedding for input length:', input.length);

      const embeddingResponse = await this.client.embeddings.create({
        model: "text-embedding-ada-002",
        input: input.replace(/\n/g, " "),
      });

      const embedding = embeddingResponse.data[0].embedding;
      return embedding;
    } catch (error) {
      console.error('Error creating embedding:', error);
      throw error;
    }
  }

  async storeEmbedding(contentType: string, contentId: number, contentText: string, embedding: number[]) {
    try {
      const key = `${contentType}:${contentId}`;
      embeddingsCache.set(key, embedding);
      console.log('Stored embedding in cache:', key);
    } catch (error) {
      console.error('Error storing embedding:', error);
      throw error;
    }
  }

  async updateChatContext(userId: number, message: string) {
    try {
      console.log('Updating chat context for user:', userId);

      // Create embedding for the new message
      const messageEmbedding = await this.createEmbedding(message);

      // Get relevant context from previous chats
      const recentChats = await db.query.chats.findMany({
        where: eq(chats.userId, userId),
        orderBy: desc(chats.timestamp),
        limit: 10
      });

      console.log('Found recent chats:', recentChats.length);

      // For now, return basic context without vector similarity
      const enhancedContext = recentChats.map(chat => ({
        type: 'chat',
        text: chat.content,
        metadata: { timestamp: chat.timestamp }
      }));

      return {
        enhancedContext,
        similarityScore: 0.8 // Placeholder score
      };
    } catch (error) {
      console.error('Error updating chat context:', error);
      return {
        enhancedContext: [],
        similarityScore: 0
      };
    }
  }

  async findRecommendedTasks(
    userId: number,
    content: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      includeCompleted?: boolean;
    } = {}
  ) {
    const {
      limit = 5,
      minSimilarity = 0.5,
      includeCompleted = false
    } = options;

    try {
      console.log('Finding recommended tasks for user:', userId);

      const contentEmbedding = await this.createEmbedding(content);

      // Get user's todos
      const userTodos = await db.query.todos.findMany({
        where: eq(todos.userId, userId),
      });

      console.log('Found user todos:', userTodos.length);

      // For now, return basic recommendations
      const recommendations = userTodos
        .filter(todo => includeCompleted || !todo.completed)
        .slice(0, limit)
        .map(todo => ({
          ...todo,
          similarity: 0.8 // Placeholder similarity score
        }));

      return {
        recommendations,
        total: recommendations.length
      };
    } catch (error) {
      console.error('Error finding recommended tasks:', error);
      return {
        recommendations: [],
        total: 0
      };
    }
  }
}

export async function createEmbeddingsService(userId: number): Promise<EmbeddingsService> {
  return EmbeddingsService.create(userId);
}

// Export the instance methods as standalone functions for backward compatibility
export const createEmbedding = async (options: {
  contentType: 'chat' | 'todo' | 'project' | 'transcription';
  contentId: number;
  contentText: string;
}) => {
  const service = await createEmbeddingsService(1); // Default user for system operations
  const embedding = await service.createEmbedding(options.contentText);
  await service.storeEmbedding(options.contentType, options.contentId, options.contentText, embedding);
  return embedding;
};

export const updateChatContext = async (userId: number, message: string) => {
  const service = await createEmbeddingsService(userId);
  return service.updateChatContext(userId, message);
};

export const findRecommendedTasks = async (
  userId: number,
  content: string,
  options?: {
    limit?: number;
    minSimilarity?: number;
    includeCompleted?: boolean;
  }
) => {
  const service = await createEmbeddingsService(userId);
  return service.findRecommendedTasks(userId, content, options);
};