import { getOpenAIClient, AIServiceConfig, handleAIError, CHAT_MODEL, cleanMarkdownResponse } from "./config";
import { db } from "@db";
import { settings, chats } from "@db/schema";
import { eq } from "drizzle-orm";
import { createEmbedding } from "../embeddings";

export interface ChatOptions extends AIServiceConfig {
  message: string;
  systemPrompt?: string;
}

export interface ChatResponse {
  message: string;
  context?: {
    similarityScore?: number;
    contextCount?: number;
    recommendedTasks?: number;
  };
}

export async function createChatCompletion(options: ChatOptions): Promise<ChatResponse> {
  try {
    const openai = await getOpenAIClient(options.userId);

    // Get user's custom prompt or use default
    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, options.userId),
    });

    const systemPrompt = options.systemPrompt || userSettings?.systemPrompt;

    if (!systemPrompt) {
      throw new Error("No system prompt configured. Please set a prompt in settings.");
    }

    // Build system message with context
    let systemMessage = `${systemPrompt}\n\n`;
    if (options.context?.transcription) {
      systemMessage += `Transcription Context:\n${options.context.transcription}\n\n`;
    }
    if (options.context?.summary) {
      systemMessage += `Summary Context:\n${options.context.summary}\n\n`;
    }

    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { 
          role: "system", 
          content: systemMessage
        },
        {
          role: "user",
          content: options.message
        }
      ],
      temperature: 0.2,
      max_tokens: 8000,
    });

    const content = response.choices[0].message.content || "";
    const cleanedResponse = cleanMarkdownResponse(content);

    // Store chat messages in database
    const [userMessage, assistantMessage] = await db.transaction(async (tx) => {
      const [userMsg] = await tx.insert(chats).values({
        userId: options.userId,
        role: "user",
        content: options.message,
        projectId: options.context?.projectId || null,
        timestamp: new Date(),
      }).returning();

      const [assistantMsg] = await tx.insert(chats).values({
        userId: options.userId,
        role: "assistant",
        content: cleanedResponse,
        projectId: options.context?.projectId || null,
        timestamp: new Date(),
      }).returning();

      return [userMsg, assistantMsg];
    });

    // Create embeddings for chat messages
    await Promise.all([
      createEmbedding({
        contentType: 'chat',
        contentId: userMessage.id,
        contentText: options.message,
      }),
      createEmbedding({
        contentType: 'chat',
        contentId: assistantMessage.id,
        contentText: cleanedResponse,
      })
    ]);

    return {
      message: cleanedResponse,
      context: {
        contextCount: options.context ? 1 : 0,
      }
    };
  } catch (error) {
    handleAIError(error);
  }
}