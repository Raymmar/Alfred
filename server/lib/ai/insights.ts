import { getOpenAIClient, AIServiceConfig, handleAIError, CHAT_MODEL, cleanMarkdownResponse } from "./config";
import { db } from "@db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";

export interface InsightOptions extends AIServiceConfig {
  customPrompt?: string;
}

export interface InsightResult {
  content: string;
  sourceText: string;
}

export async function generateInsights(
  text: string,
  options: InsightOptions
): Promise<InsightResult> {
  try {
    const openai = await getOpenAIClient(options.userId);

    // Get user's custom prompt or use default
    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, options.userId),
    });

    const prompt = options.customPrompt || userSettings?.insightPrompt;

    if (!prompt) {
      throw new Error("No insight prompt configured. Please set a prompt in settings.");
    }

    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { 
          role: "system", 
          content: prompt
        },
        {
          role: "user",
          content: `${options.context?.note ? `User's Note:\n${options.context.note}\n\n` : ''}Transcript:\n${text}`
        }
      ],
      temperature: 0.2,
      max_tokens: 8000,
    });

    const content = response.choices[0].message.content || "";

    return {
      content: cleanMarkdownResponse(content),
      sourceText: text,
    };
  } catch (error) {
    handleAIError(error);
  }
}