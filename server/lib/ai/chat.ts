import { OpenAI } from 'openai';
import type { ChatCompletionOptions, ChatCompletionResult, AIServiceConfig } from './types';
import { getAIServiceConfig, createOpenAIClient, convertMarkdownToHTML, formatContextForPrompt } from './utils';
import { db } from "@db";
import { settings, chats } from "@db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import { updateChatContext, createEmbedding } from '../embeddings';
import { findRecommendedTasks } from '../embeddings';

export class ChatService {
  private client: OpenAI;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = createOpenAIClient(config);
  }

  static async create(userId: number): Promise<ChatService> {
    const config = await getAIServiceConfig(userId);
    return new ChatService(config);
  }

  async createChatCompletion({
    userId,
    message,
    context,
    promptType = 'system'
  }: ChatCompletionOptions): Promise<ChatCompletionResult> {
    try {
      const userSettings = await db.query.settings.findFirst({
        where: eq(settings.userId, userId),
      });

      const systemPrompt = userSettings?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      const { enhancedContext, similarityScore } = await updateChatContext(userId, message);
      
      const { recommendations: recommendedTasks } = await findRecommendedTasks(userId, message, {
        limit: 5,
        minSimilarity: 0.5,
        includeCompleted: false
      });

      // Build the system message with context
      const systemMessage = `${systemPrompt}\n\n${context ? `Current Context:\n${JSON.stringify(context, null, 2)}\n\n` : ''}Relevant Context:\n${formatContextForPrompt(enhancedContext)}\n\nRecommended Tasks:\n${recommendedTasks.map(task => `- ${task.text}`).join('\n')}`;

      const response = await this.client.chat.completions.create({
        model: this.config.model || "gpt-4o",
        messages: [
          { 
            role: "system", 
            content: systemMessage 
          },
          { 
            role: "user", 
            content: message 
          }
        ],
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      });

      const assistantResponse = response.choices[0].message.content || "";
      const formattedResponse = convertMarkdownToHTML(assistantResponse);

      // Store the conversation in the database
      const [userMessage, assistantMessage] = await db.transaction(async (tx) => {
        const [userMsg] = await tx.insert(chats).values({
          userId,
          role: "user",
          content: message,
          projectId: context?.projectId || null,
          timestamp: new Date(),
        }).returning();

        const [assistantMsg] = await tx.insert(chats).values({
          userId,
          role: "assistant",
          content: formattedResponse,
          projectId: context?.projectId || null,
          timestamp: new Date(),
        }).returning();

        return [userMsg, assistantMsg];
      });

      // Create embeddings for the conversation
      await Promise.all([
        createEmbedding({
          contentType: 'chat',
          contentId: userMessage.id,
          contentText: message,
        }),
        createEmbedding({
          contentType: 'chat',
          contentId: assistantMessage.id,
          contentText: formattedResponse,
        })
      ]);

      return {
        message: formattedResponse,
        context: {
          similarityScore,
          contextCount: enhancedContext.length,
          recommendedTasks: recommendedTasks.length
        }
      };

    } catch (error: any) {
      console.error('Chat completion error:', error);
      return {
        message: "",
        error: error.message || 'Failed to generate chat response'
      };
    }
  }
}

export async function createChatService(userId: number): Promise<ChatService> {
  return ChatService.create(userId);
}
