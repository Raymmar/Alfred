import { getOpenAIClient, AIServiceConfig, handleAIError, CHAT_MODEL } from "./config";
import { DEFAULT_TODO_PROMPT } from "@/lib/constants";
import { db } from "@db";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";

export interface TaskExtractionOptions extends AIServiceConfig {
  customPrompt?: string;
}

export interface Task {
  text: string;
  assignee?: string;
  priority?: 'low' | 'medium' | 'high';
}

export async function extractTasks(
  text: string,
  options: TaskExtractionOptions
): Promise<Task[]> {
  try {
    const openai = await getOpenAIClient(options.userId);
    
    // Get user's custom prompt or use default
    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, options.userId),
    });

    const prompt = options.customPrompt || userSettings?.todoPrompt || DEFAULT_TODO_PROMPT;

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
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const tasks = JSON.parse(content || "[]");

    // Ensure we have an array of tasks
    return Array.isArray(tasks) ? tasks : [];
  } catch (error) {
    handleAIError(error);
  }
}

// Utility function to check if a task response is empty
export function isEmptyTaskResponse(text: string): boolean {
  if (!text?.trim()) return true;

  const trimmedText = text.trim().toLowerCase();
  const excludedPhrases = [
    "no task",
    "no tasks",
    "no deliverable",
    "no deliverables",
    "identified",
    "no specific tasks",
    "none found",
    "not applicable",
  ];

  return excludedPhrases.some(phrase => trimmedText.includes(phrase));
}
