import OpenAI from "openai";
import { db } from "@db";
import { settings, users } from "@db/schema";
import { eq } from "drizzle-orm";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024
export const CHAT_MODEL = "gpt-4o";
export const WHISPER_MODEL = "whisper-1";

export interface AIServiceConfig {
  userId: number;
  context?: {
    transcription?: string | null;
    summary?: string | null;
    projectId?: number;
    note?: string | null;
  };
}

export async function getOpenAIClient(userId: number): Promise<OpenAI> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error("User not found");
  }

  const userSettings = await db.query.settings.findFirst({
    where: eq(settings.userId, userId),
  });

  const apiKey = userSettings?.openAiKey || user.openaiApiKey;

  if (!apiKey) {
    throw new Error("OpenAI API key not found. Please add your API key in settings.");
  }

  return new OpenAI({ apiKey });
}

// Helper function to clean and format markdown response
export function cleanMarkdownResponse(markdown: string): string {
  if (!markdown) return '';
  
  return markdown
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks
    .replace(/^\s+|\s+$/g, '') // Trim whitespace
    .replace(/\s*\n\s*/g, '\n') // Clean up spaces around newlines
    .trim();
}

// Helper function to handle API errors
export function handleAIError(error: any): never {
  console.error("OpenAI API error:", error);
  throw new Error(error.message || "Failed to process AI request");
}
