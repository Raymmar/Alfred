import { OpenAI } from 'openai';
import type { TaskExtractionResult, AIServiceConfig } from './types';
import { getAIServiceConfig, createOpenAIClient } from './utils';
import { db } from "@db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TODO_PROMPT } from "@/lib/constants";

export function isEmptyTaskResponse(text: string): boolean {
  if (!text || typeof text !== 'string') {
    console.log('Empty task check: Invalid or empty input');
    return true;
  }

  const trimmedText = text.trim().toLowerCase();
  if (!trimmedText) {
    console.log('Empty task check: Empty after trimming');
    return true;
  }

  const excludedPhrases = [
    "no task",
    "no tasks",
    "no deliverable",
    "no deliverables",
    "no tasks identified",
    "no deliverables identified",
    "no tasks or deliverables",
    "no tasks or deliverables identified",
    "no specific tasks",
    "no specific deliverables",
    "none identified",
    "could not identify",
    "unable to identify",
    "no action items",
    "no actions",
  ];

  // First check exact matches
  if (excludedPhrases.includes(trimmedText)) {
    console.log('Empty task check: Exact match found:', trimmedText);
    return true;
  }

  // Then check for phrases within the text
  const hasPhrase = excludedPhrases.some(phrase => {
    const includes = trimmedText.includes(phrase);
    if (includes) {
      console.log('Empty task check: Phrase match found:', phrase, 'in:', trimmedText);
    }
    return includes;
  });

  // Check for common patterns that might indicate an empty task message
  const containsOnlyPunctuation = /^[\s\.,!?:;-]*$/.test(trimmedText);
  if (containsOnlyPunctuation) {
    console.log('Empty task check: Contains only punctuation');
    return true;
  }

  // Additional pattern checks for empty task indicators
  const patternChecks = [
    /^no\s+.*\s+found/i,
    /^could\s+not\s+.*\s+any/i,
    /^unable\s+to\s+.*\s+any/i,
    /^did\s+not\s+.*\s+any/i,
    /^doesn't\s+.*\s+any/i,
    /^does\s+not\s+.*\s+any/i,
    /^none\s+.*\s+found/i,
    /^no\s+.*\s+identified/i,
  ];

  const matchesPattern = patternChecks.some(pattern => {
    const matches = pattern.test(trimmedText);
    if (matches) {
      console.log('Empty task check: Pattern match found:', pattern, 'in:', trimmedText);
    }
    return matches;
  });

  return hasPhrase || matchesPattern;
}

export async function cleanupEmptyTasks(projectId: number): Promise<void> {
  try {
    const projectTodos = await db.query.todos.findMany({
      where: eq(todos.projectId, projectId),
    });

    for (const todo of projectTodos) {
      if (isEmptyTaskResponse(todo.text)) {
        console.log('Cleanup: Removing task that indicates no tasks:', todo.text);
        await db.delete(todos)
          .where(and(
            eq(todos.id, todo.id),
            eq(todos.projectId, projectId)
          ));
      }
    }
  } catch (error) {
    console.error('Error during task cleanup:', error);
  }
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