import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { settings, users, projects, todos, chats } from "@db/schema";
import { updateChatContext, createEmbedding } from './embeddings';
import { findRecommendedTasks } from './embeddings';

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024
const CHAT_MODEL = "gpt-4o";

// Task filtering functions - used by routes.ts only
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

interface ChatOptions {
  userId: number;
  message: string;
  context?: {
    transcription?: string | null;
    summary?: string | null;
    projectId?: number;
  };
}

async function getContextData(userId: number) {
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    with: {
      todos: true,
      note: true,
    },
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });

  // Get the most recent recording first
  const latestRecording = userProjects.find(p => p.recordingUrl && p.recordingUrl !== 'personal.none');

  const projectsContext = userProjects.map(project => ({
    title: project.title,
    description: project.description,
    createdAt: project.createdAt,
    hasSummary: !!project.summary,
    hasTranscription: !!project.transcription,
    isRecording: project.recordingUrl && project.recordingUrl !== 'personal.none',
    recordingUrl: project.recordingUrl,
    todoCount: project.todos?.length || 0,
    completedTodos: project.todos?.filter(todo => todo.completed).length || 0,
    todos: project.todos?.map(todo => ({
      text: todo.text,
      completed: todo.completed,
      createdAt: todo.createdAt
    })) || [],
    note: project.note ? {
      content: project.note.content,
      updatedAt: project.note.updatedAt
    } : null,
    transcription: project.transcription,
    summary: project.summary
  }));

  return {
    projects: projectsContext,
    latestRecording: latestRecording ? {
      title: latestRecording.title,
      createdAt: latestRecording.createdAt,
      transcription: latestRecording.transcription,
      summary: latestRecording.summary
    } : null,
    totalProjects: projectsContext.length,
    totalRecordings: projectsContext.filter(p => p.isRecording).length,
    totalTodos: projectsContext.reduce((acc, proj) => acc + proj.todoCount, 0),
    totalCompletedTodos: projectsContext.reduce((acc, proj) => acc + proj.completedTodos, 0),
  };
}

function formatContextForPrompt(enhancedContext: any[]): string {
  if (!Array.isArray(enhancedContext) || enhancedContext.length === 0) {
    return 'No relevant context found.';
  }

  return enhancedContext
    .map(ctx => {
      if (!ctx || typeof ctx !== 'object') return '';

      const type = ctx.type || 'Unknown';
      const source = type.charAt(0).toUpperCase() + type.slice(1);
      const metadata = ctx.metadata ?
        `(${new Date(ctx.metadata.timestamp || ctx.metadata.created_at).toLocaleString()})` : '';
      const text = typeof ctx.text === 'string' ? ctx.text : 'No content available';

      return `[${source}] ${metadata}\n${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

export async function createChatCompletion({
  userId,
  message,
  context,
}: ChatOptions) {
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

  const openai = new OpenAI({
    apiKey,
  });

  // Get only the relevant project data if we have a project context
  let projectData = null;
  if (context?.projectId) {
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, context.projectId),
        eq(projects.userId, userId)
      ),
      with: {
        todos: true,
        note: true,
      },
    });

    if (project) {
      projectData = {
        title: project.title,
        transcription: project.transcription,
        summary: project.summary,
        note: project.note?.content,
      };
    }
  }

  // Use user's custom prompt or fall back to default
  const customPrompt = userSettings?.defaultPrompt?.trim() || user.defaultPrompt?.trim();

  // Build a focused system message that emphasizes note enhancement
  let systemMessage = customPrompt || `You are an AI assistant focused on enhancing user notes with relevant context from meeting transcriptions. When provided with a user's note and a transcript:

1. Use the user's note as the primary structure
2. Only add information from the transcript that directly relates to or clarifies points in the user's note
3. Maintain the same formatting style as the user's note (bullets, paragraphs, headings)
4. Be concise and only include essential details
5. If there is no user note, create a brief, structured summary of the key points from the transcript
6. Format the output to match the user's style:
   - If the user's note uses bullet points, continue with bullets
   - If the user's note uses paragraphs, maintain paragraph structure
   - Keep the same heading levels and formatting

Remember: You are enhancing the user's note, not replacing it. Your additions should seamlessly blend with their existing content.`;

  // Add project-specific context only if we have it
  if (projectData) {
    systemMessage += `\n\nCurrent Project Context:
Title: ${projectData.title}
${projectData.note ? `\nUser's Note:\n${projectData.note}` : ''}
${projectData.transcription ? `\nTranscription Context Available` : ''}
${projectData.summary ? `\nSummary Context Available` : ''}`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const assistantResponse = response.choices[0].message.content || "";

    // Store the chat messages in the database
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
        content: assistantResponse,
        projectId: context?.projectId || null,
        timestamp: new Date(),
      }).returning();

      return [userMsg, assistantMsg];
    });

    // Create embeddings for future context
    await Promise.all([
      createEmbedding({
        contentType: 'chat',
        contentId: userMessage.id,
        contentText: message,
      }),
      createEmbedding({
        contentType: 'chat',
        contentId: assistantMessage.id,
        contentText: assistantResponse,
      })
    ]);

    return {
      message: assistantResponse,
      context: {
        hasUserNote: !!projectData?.note,
        projectTitle: projectData?.title
      }
    };
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(error.message || "Failed to generate response");
  }
}