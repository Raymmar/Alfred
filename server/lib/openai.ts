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

  const userData = await getContextData(userId);
  const { enhancedContext, similarityScore } = await updateChatContext(userId, message);

  const { recommendations: recommendedTasks } = await findRecommendedTasks(userId, message, {
    limit: 5,
    minSimilarity: 0.5,
    includeCompleted: false
  });

  let systemMessage = `You are Alfred, an intelligent AI assistant with comprehensive access to the user's recording library and task management system.

Database Context:
Total Projects: ${userData.totalProjects}
Total Recordings: ${userData.totalRecordings}
Total Tasks: ${userData.totalTodos} (${userData.totalCompletedTodos} completed)

${userData.latestRecording ? `Latest Recording:
Title: "${userData.latestRecording.title}"
Created: ${userData.latestRecording.createdAt.toLocaleString()}
Has Transcription: ${!!userData.latestRecording.transcription}
Has Summary: ${!!userData.latestRecording.summary}
` : 'No recordings available.'}

Available Projects and Recordings:
${userData.projects.map(p => `
Project: "${p.title}" (Created: ${p.createdAt.toLocaleString()})
Type: ${p.isRecording ? 'Recording' : 'Project'}
${p.description ? `Description: ${p.description}` : ''}
${p.transcription ? `Has Transcription: Yes` : ''}
${p.summary ? `Has Summary: Yes` : ''}
Tasks (${p.todoCount} total, ${p.completedTodos} completed):
${p.todos?.map(t => `- ${t.text} (${t.completed ? 'Completed' : 'Pending'}, Created: ${t.createdAt.toLocaleString()})`).join('\n') || 'No tasks'}
${p.note ? `\nNotes (Last updated: ${p.note.updatedAt.toLocaleString()}):\n${p.note.content}` : ''}
`).join('\n')}

Relevant Context:
${formatContextForPrompt(enhancedContext)}

Recommended Tasks Based on Current Context:
${recommendedTasks.length > 0
    ? recommendedTasks.map(task =>
      `- [${task.completed ? 'Completed' : 'Pending'}] ${task.text}${
        task.projectTitle ? ` (Project: ${task.projectTitle})` : ''
      }`
    ).join('\n')
    : 'No specifically relevant tasks found for this conversation.'}

Instructions:
1. Use the provided context to give informed responses about recordings and projects
2. When asked about "last recording" or "recent recording", refer to the Latest Recording section
3. Maintain conversation continuity by referencing previous interactions
4. Be concise. Do not add any filler words or pleasantries to your responses.
5. If recommending actions, prioritize suggesting tasks from the recommended tasks list
6. When discussing tasks, reference their current status and project context
7. Consider both task relevance and project relationships when making suggestions
8. When asked about recordings, provide both high-level summaries and specific details if available`;

  if (context?.transcription || context?.summary) {
    systemMessage += `\n\nCurrent Recording Context:
${context.transcription ? `\nTranscript:\n${context.transcription}` : ''}
${context.summary ? `\nSummary:\n${context.summary}` : ''}`;
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
    console.log('GPT response:', assistantResponse);

    const [userMessage, assistantMessage] = await db.transaction(async (tx) => {
      const [userMsg] = await tx.insert(chats).values({
        userId,
        role: "user",
        content: message,
        timestamp: new Date(),
      }).returning();

      const [assistantMsg] = await tx.insert(chats).values({
        userId,
        role: "assistant",
        content: assistantResponse,
        timestamp: new Date(),
      }).returning();

      return [userMsg, assistantMsg];
    });

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
        similarityScore,
        contextCount: enhancedContext.length,
        recommendedTasks: recommendedTasks.length
      }
    };
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(error.message || "Failed to generate response");
  }
}