import { OpenAI } from 'openai';
import type { InsightGenerationResult, AIServiceConfig } from './types';
import { getAIServiceConfig, createOpenAIClient, convertMarkdownToHTML } from './utils';
import { db } from "@db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_PRIMARY_PROMPT } from "@/lib/constants";

export class InsightsService {
  private client: OpenAI;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = createOpenAIClient(config);
  }

  static async create(userId: number): Promise<InsightsService> {
    const config = await getAIServiceConfig(userId);
    return new InsightsService(config);
  }

  async generateInsights(transcription: string, userId: number): Promise<InsightGenerationResult> {
    try {
      // Get user's custom prompt or use default
      const userSettings = await db.query.settings.findFirst({
        where: eq(settings.userId, userId),
      });

      const prompt = userSettings?.defaultPrompt || DEFAULT_PRIMARY_PROMPT;

      const response = await this.client.chat.completions.create({
        model: this.config.model || "gpt-4o",
        messages: [
          { 
            role: "system", 
            content: prompt 
          },
          { 
            role: "user", 
            content: transcription 
          }
        ],
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      });

      const summary = response.choices[0].message.content || "";
      const formattedSummary = convertMarkdownToHTML(summary);

      return {
        summary: formattedSummary,
        keyPoints: [], // Could be enhanced to extract key points
        topics: [], // Could be enhanced to extract topics
      };

    } catch (error: any) {
      console.error('Insight generation error:', error);
      return {
        summary: "",
        error: error.message || 'Failed to generate insights'
      };
    }
  }
}

export async function createInsightsService(userId: number): Promise<InsightsService> {
  return InsightsService.create(userId);
}
