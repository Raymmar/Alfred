import { OpenAI } from 'openai';
import { db } from "@db";
import { eq } from "drizzle-orm";
import { chats, todos, projects } from "@db/schema";
import { getAIServiceConfig, createOpenAIClient } from './utils';
import type { AIServiceConfig } from './types';

interface CreateEmbeddingOptions {
  contentType: 'chat' | 'todo' | 'project' | 'transcription';
  contentId: number;
  contentText: string;
}

interface FindRecommendedTasksOptions {
  limit?: number;
  minSimilarity?: number;
  includeCompleted?: boolean;
}

export async function createEmbedding(options: CreateEmbeddingOptions) {
  const config = await getAIServiceConfig(1); // Default user for system operations
  const openai = createOpenAIClient(config);

  try {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: options.contentText.replace(/\n/g, " "),
    });

    // Store embedding in database
    // Note: This would require adding embeddings table to schema
    const embedding = embeddingResponse.data[0].embedding;
    
    return {
      contentType: options.contentType,
      contentId: options.contentId,
      embedding
    };
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw error;
  }
}

export async function updateChatContext(userId: number, message: string) {
  try {
    const config = await getAIServiceConfig(userId);
    const openai = createOpenAIClient(config);

    // Create embedding for the new message
    const messageEmbedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: message.replace(/\n/g, " "),
    });

    // Get relevant context from database
    // This would require implementing vector similarity search
    const enhancedContext = [];
    const similarityScore = 0;

    return {
      enhancedContext,
      similarityScore
    };
  } catch (error) {
    console.error('Error updating chat context:', error);
    return {
      enhancedContext: [],
      similarityScore: 0
    };
  }
}

export async function findRecommendedTasks(
  userId: number,
  content: string,
  options: FindRecommendedTasksOptions = {}
) {
  const {
    limit = 5,
    minSimilarity = 0.5,
    includeCompleted = false
  } = options;

  try {
    // Get user's todos
    const userTodos = await db.query.todos.findMany({
      where: eq(todos.userId, userId),
    });

    // For now, return basic recommendations without embeddings
    const recommendations = userTodos
      .filter(todo => includeCompleted || !todo.completed)
      .slice(0, limit)
      .map(todo => ({
        ...todo,
        similarity: 1.0 // Placeholder for actual similarity score
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
