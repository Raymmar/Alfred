import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { settings, users, projects, todos, chats } from "@db/schema";
import { updateChatContext, createEmbedding, findRecommendedTasks } from './embeddings';
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import { marked } from 'marked';

// =============================================================================
// Types and Interfaces
// =============================================================================

interface ChatOptions {
  userId: number;
  message: string;
  context?: {
    transcription?: string | null;
    summary?: string | null;
    projectId?: number;
    note?: string | null;
  };
  contentType?: 'chat' | 'insight' | 'transcript' | 'task';
  promptType?: 'primary' | 'todo' | 'system';
}

// =============================================================================
// Helper Functions for Content Formatting
// =============================================================================

// Configure marked for clean HTML output compatible with TipTap
marked.setOptions({
  gfm: true,
  breaks: true,
  headerPrefix: '',
  headerIds: false,
  smartypants: true,
});

// Convert markdown to clean HTML with minimal formatting
function convertMarkdownToHTML(markdown: string): string {
  if (!markdown) return '';

  try {
    const html = marked(markdown);
    return html
      .replace(/\sstyle="[^"]*"/g, '')
      .replace(/\sclass="[^"]*"/g, '')
      .replace(/<p>\s*<\/p>/g, '')
      .replace(/\sdata-[^=]*="[^"]*"/g, '')
      .replace(/(\r?\n){3,}/g, '\n\n')
      .replace(/<\/li><li>/g, '</li>\n<li>')
      .replace(/<\/h([1-6])><h([1-6])>/g, '</h$1>\n<h$2>')
      .trim();
  } catch (error) {
    console.error('Error converting markdown to HTML:', error);
    return `<p>${markdown}</p>`;
  }
}

// =============================================================================
// Task Processing Utilities
// =============================================================================

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

  if (excludedPhrases.includes(trimmedText)) {
    console.log('Empty task check: Exact match found:', trimmedText);
    return true;
  }

  const hasPhrase = excludedPhrases.some(phrase => {
    const includes = trimmedText.includes(phrase);
    if (includes) {
      console.log('Empty task check: Phrase match found:', phrase);
    }
    return includes;
  });

  const containsOnlyPunctuation = /^[\s\.,!?:;-]*$/.test(trimmedText);
  if (containsOnlyPunctuation) {
    console.log('Empty task check: Contains only punctuation');
    return true;
  }

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
      console.log('Empty task check: Pattern match found:', pattern);
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

// =============================================================================
// OpenAI Configuration & Core Setup
// =============================================================================

const CHAT_MODEL = "gpt-4o"; // Latest model as of May 13, 2024

// Get user's OpenAI API key and custom prompts
async function getUserSettings(userId: number) {
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

  return {
    apiKey,
    insightPrompt: userSettings?.insightPrompt || DEFAULT_PRIMARY_PROMPT,
    todoPrompt: userSettings?.todoPrompt || DEFAULT_TODO_PROMPT,
    systemPrompt: userSettings?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  };
}

// =============================================================================
// Main Chat Completion Function
// =============================================================================

export async function createChatCompletion({
  userId,
  message,
  context,
  contentType = 'chat',
  promptType = 'system'
}: ChatOptions) {
  // Get user settings and API key
  const settings = await getUserSettings(userId);
  const openai = new OpenAI({ apiKey: settings.apiKey });

  // Select appropriate prompt based on content type
  let basePrompt;
  switch (contentType) {
    case 'insight':
      basePrompt = settings.insightPrompt;
      break;
    case 'task':
      basePrompt = settings.todoPrompt;
      break;
    case 'transcript':
      basePrompt = "Please provide a clean, well-formatted transcript of the audio content.";
      break;
    default:
      basePrompt = settings.systemPrompt;
  }

  // Build context for the chat
  const userData = await getContextData(userId);
  const { enhancedContext, similarityScore } = await updateChatContext(userId, message);

  // Only fetch recommended tasks for chat and insight content types
  let recommendedTasks = [];
  if (contentType === 'chat' || contentType === 'insight') {
    const taskResults = await findRecommendedTasks(userId, message, {
      limit: 5,
      minSimilarity: 0.5,
      includeCompleted: false
    });
    recommendedTasks = taskResults.recommendations;
  }

  // Build system message with appropriate context
  let systemMessage = `${basePrompt}\n\n`;

  // Add chat-specific context
  if (contentType === 'chat') {
    systemMessage += buildChatContext(userData);
  }

  // Add project-specific context when available
  if (context?.projectId) {
    systemMessage += buildProjectContext(userData, context.projectId);
  }

  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: `${context?.note ? `User's Note:\n${context.note}\n\n` : ''}${message}` },
      ],
      temperature: contentType === 'transcript' ? 0.1 : 0.2,
      max_tokens: 8000,
    });

    const assistantResponse = response.choices[0].message.content || "";

    // Format response based on content type
    let finalResponse = formatResponse(assistantResponse, contentType);

    // Store chat history if it's a direct chat interaction
    if (contentType === 'chat') {
      await storeChatHistory(userId, message, finalResponse, context?.projectId);
    }

    return {
      message: finalResponse,
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

// =============================================================================
// Context Building Utilities
// =============================================================================

async function getContextData(userId: number) {
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    with: {
      todos: true,
      note: true,
    },
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });

  const latestRecording = userProjects.find(p => p.recordingUrl && p.recordingUrl !== 'personal.none');

  const projectsContext = userProjects.map(project => ({
    id: project.id,
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

// Format AI response based on content type
function formatResponse(response: string, contentType: string): string {
  switch (contentType) {
    case 'insight':
    case 'chat':
      return convertMarkdownToHTML(response);
    case 'transcript':
      return response.replace(/\n{3,}/g, '\n\n').trim();
    case 'task':
      return response;
    default:
      return response;
  }
}

// Build chat context string
function buildChatContext(userData: any): string {
  return `Database Context:
Total Projects: ${userData.totalProjects}
Total Recordings: ${userData.totalRecordings}
Total Tasks: ${userData.totalTodos} (${userData.totalCompletedTodos} completed)

${userData.latestRecording ? `Latest Recording:
Title: "${userData.latestRecording.title}"
Created: ${userData.latestRecording.createdAt.toLocaleString()}
Has Transcription: ${!!userData.latestRecording.transcription}
Has Summary: ${!!userData.latestRecording.summary}
${userData.latestRecording.transcription ? `\nTranscription Preview:\n${userData.latestRecording.transcription.substring(0, 500)}...` : ''}
${userData.latestRecording.summary ? `\nSummary:\n${userData.latestRecording.summary}` : ''}
` : 'No recordings available.'}`;
}

// Build project-specific context string
function buildProjectContext(userData: any, projectId: number): string {
  const projectContext = userData.projects.find((p: any) => p.id === projectId);
  if (!projectContext) return '';

  return `\n\nProject Context:
Title: "${projectContext.title}"
${projectContext.description ? `Description: ${projectContext.description}\n` : ''}
Created: ${projectContext.createdAt.toLocaleString()}
${projectContext.transcription ? `\nTranscription:\n${projectContext.transcription}` : ''}
${projectContext.summary ? `\nSummary:\n${projectContext.summary}` : ''}
${projectContext.note ? `\nNotes:\n${projectContext.note.content}` : ''}`;
}

// Store chat history and create embeddings
async function storeChatHistory(userId: number, userMessage: string, assistantResponse: string, projectId: number | null) {
  const [userMsg, assistantMsg] = await db.transaction(async (tx) => {
    const [userMessage] = await tx.insert(chats).values({
      userId,
      role: "user",
      content: userMessage,
      projectId: projectId || null,
      timestamp: new Date(),
    }).returning();

    const [assistantMessage] = await tx.insert(chats).values({
      userId,
      role: "assistant",
      content: assistantResponse,
      projectId: projectId || null,
      timestamp: new Date(),
    }).returning();

    return [userMessage, assistantMessage];
  });

  await Promise.all([
    createEmbedding({
      contentType: 'chat',
      contentId: userMsg.id,
      contentText: userMessage,
    }),
    createEmbedding({
      contentType: 'chat',
      contentId: assistantMsg.id,
      contentText: assistantResponse,
    })
  ]);
}