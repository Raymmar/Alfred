import { OpenAI } from 'openai';
import type { TaskExtractionResult, AIServiceConfig } from './types';
import { getAIServiceConfig, createOpenAIClient } from './utils';
import { db } from "@db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TODO_PROMPT } from "@/lib/constants";

export function isEmptyTaskResponse(text: string): boolean {
  if (!text || typeof text !== 'string') return true;

  const trimmedText = text.trim().toLowerCase();
  if (!trimmedText) return true;

  const excludedPhrases = [
    "no task",
    "no tasks",
    "no deliverable",
    "no deliverables",
    "no tasks identified",
    "no deliverables identified",
    "no tasks or deliverables",
    "not found",
    "none found",
    "none identified",
    "could not identify",
    "unable to identify",
    "no action items",
    "no actions",
  ];

  // Check exact matches
  if (excludedPhrases.includes(trimmedText)) {
    return true;
  }

  // Check for phrases
  const hasPhrase = excludedPhrases.some(phrase => trimmedText.includes(phrase));
  
  // Check for patterns
  const patterns = [
    /^no\s+.*\s+found/i,
    /^could\s+not\s+.*\s+any/i,
    /^unable\s+to\s+.*\s+any/i,
    /^did\s+not\s+.*\s+any/i,
    /^none\s+.*\s+found/i,
    /^no\s+.*\s+identified/i,
  ];

  const matchesPattern = patterns.some(pattern => pattern.test(trimmedText));

  return hasPhrase || matchesPattern;
}

export class TaskExtractionService {
  private client: OpenAI;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = createOpenAIClient(config);
  }

  static async create(userId: number): Promise<TaskExtractionService> {
    const config = await getAIServiceConfig(userId);
    return new TaskExtractionService(config);
  }

  async extractTasks(content: string, userId: number): Promise<TaskExtractionResult> {
    try {
      // Get user's custom task prompt or use default
      const userSettings = await db.query.settings.findFirst({
        where: eq(settings.userId, userId),
      });

      const prompt = userSettings?.todoPrompt || DEFAULT_TODO_PROMPT;

      const response = await this.client.chat.completions.create({
        model: this.config.model || "gpt-4o",
        messages: [
          { 
            role: "system", 
            content: prompt 
          },
          { 
            role: "user", 
            content: content 
          }
        ],
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 500,
      });

      const taskText = response.choices[0].message.content || "";

      // Return empty result if no tasks found
      if (isEmptyTaskResponse(taskText)) {
        return { tasks: [] };
      }

      // Parse tasks from the response
      // Assuming tasks are returned in a format like:
      // - Task 1
      // - Task 2 [high]
      // - Task 3 [medium]
      const tasks = taskText.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-') || line.startsWith('*'))
        .map(line => {
          const text = line.replace(/^[-*]\s+/, '');
          const priorityMatch = text.match(/\[(high|medium|low)\]$/i);
          const priority = priorityMatch ? 
            priorityMatch[1].toLowerCase() as 'high' | 'medium' | 'low' : 
            'medium';
          
          return {
            text: text.replace(/\[(high|medium|low)\]$/i, '').trim(),
            priority
          };
        });

      return { tasks };

    } catch (error: any) {
      console.error('Task extraction error:', error);
      return {
        tasks: [],
        error: error.message || 'Failed to extract tasks'
      };
    }
  }
}

export async function createTaskExtractionService(userId: number): Promise<TaskExtractionService> {
  return TaskExtractionService.create(userId);
}
