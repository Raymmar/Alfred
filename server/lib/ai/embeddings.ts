import { OpenAI } from 'openai';
import { db } from "@db";
import { eq, desc } from "drizzle-orm";
import { chats, todos, projects, embeddings } from "@db/schema";
import { getAIServiceConfig, createOpenAIClient } from './utils';
import type { AIServiceConfig } from './types';

export class EmbeddingsService {
  private client: OpenAI;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = createOpenAIClient(config);
  }

  static async create(userId: number): Promise<EmbeddingsService> {
    const config = await getAIServiceConfig(userId);
    return new EmbeddingsService(config);
  }

  async createEmbedding(input: string) {
    try {
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
      await db.insert(embeddings).values({
        contentType,
        contentId,
        contentText,
        embedding: JSON.stringify(embedding), // Store as JSON string
        createdAt: new Date(),
      });
    } catch (error) {
      console.error('Error storing embedding:', error);
      throw error;
    }
  }

  async updateChatContext(userId: number, message: string) {
    try {
      // Create embedding for the new message
      const messageEmbedding = await this.createEmbedding(message);

      // Get relevant context from previous chats
      const recentChats = await db.query.chats.findMany({
        where: eq(chats.userId, userId),
        orderBy: desc(chats.timestamp),
        limit: 10
      });

      // For now, return basic context without vector similarity
      // This could be enhanced with actual vector similarity search
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
      const contentEmbedding = await this.createEmbedding(content);

      // Get user's todos
      const userTodos = await db.query.todos.findMany({
        where: eq(todos.userId, userId),
      });

      // For now, return basic recommendations
      // This could be enhanced with actual vector similarity comparison
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