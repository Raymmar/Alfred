import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { settings, users, projects, todos, chats } from "@db/schema";
import { updateChatContext, createEmbedding } from './embeddings';
import { findRecommendedTasks } from './embeddings';
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import { marked } from 'marked';

// Configure marked for clean HTML output compatible with TipTap and our styling
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
  mangle: false, // Don't escape HTML
  sanitize: false, // Don't sanitize HTML (we handle this on the frontend)
  headerPrefix: '', // Don't prefix headers
  headerIds: false, // Don't add IDs to headers
  smartypants: true, // Use smart punctuation
});

// Helper function to convert markdown to HTML with minimal formatting
function convertMarkdownToHTML(markdown: string): string {
  if (!markdown) return '';

  try {
    // Convert markdown to HTML
    const html = marked(markdown);

    // Clean up HTML but preserve essential formatting
    return html
      // Remove any style attributes
      .replace(/\sstyle="[^"]*"/g, '')
      // Remove any class attributes
      .replace(/\sclass="[^"]*"/g, '')
      // Clean up empty paragraphs
      .replace(/<p>\s*<\/p>/g, '')
      // Remove any data attributes
      .replace(/\sdata-[^=]*="[^"]*"/g, '')
      // Clean up multiple line breaks while preserving intentional spacing
      .replace(/(\r?\n){3,}/g, '\n\n')
      // Ensure proper spacing around list items
      .replace(/<\/li><li>/g, '</li>\n<li>')
      // Ensure proper spacing around headers
      .replace(/<\/h([1-6])><h([1-6])>/g, '</h$1>\n<h$2>')
      // Normalize whitespace
      .trim();
  } catch (error) {
    console.error('Error converting markdown to HTML:', error);
    return `<p>${markdown}</p>`;
  }
}

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

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024
const CHAT_MODEL = "gpt-4o";

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

export async function createChatCompletion({
  userId,
  message,
  context,
  contentType = 'chat',
  promptType = 'system'
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

  // Use user's custom prompts or fall back to defaults based on content type
  let basePrompt;
  switch (contentType) {
    case 'insight':
      basePrompt = userSettings?.insightPrompt || DEFAULT_PRIMARY_PROMPT;
      break;
    case 'task':
      basePrompt = userSettings?.todoPrompt || DEFAULT_TODO_PROMPT;
      break;
    case 'transcript':
      basePrompt = "Please provide a clean, well-formatted transcript of the audio content.";
      break;
    default:
      basePrompt = userSettings?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  const openai = new OpenAI({
    apiKey,
  });

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

  // Build system message with context appropriate for the content type
  let systemMessage = `${basePrompt}\n\n`;

  if (contentType === 'chat') {
    // Include full context for chat interactions
    systemMessage += `Database Context:
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

  // Add project-specific context when available
  if (context?.projectId) {
    const projectContext = userData.projects.find(p => p.id === context.projectId);
    if (projectContext) {
      systemMessage += `\n\nProject Context:
Title: "${projectContext.title}"
${projectContext.description ? `Description: ${projectContext.description}\n` : ''}
Created: ${projectContext.createdAt.toLocaleString()}
${projectContext.transcription ? `\nTranscription:\n${projectContext.transcription}` : ''}
${projectContext.summary ? `\nSummary:\n${projectContext.summary}` : ''}
${projectContext.note ? `\nNotes:\n${projectContext.note.content}` : ''}`;
    }
  }

  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: `${context?.note ? `User's Note:\n${context.note}\n\n` : ''}${message}` },
      ],
      temperature: contentType === 'transcript' ? 0.1 : 0.2, // Lower temperature for transcripts
      max_tokens: 8000,
    });

    const assistantResponse = response.choices[0].message.content || "";

    // Apply appropriate formatting based on content type
    let finalResponse;
    switch (contentType) {
      case 'insight':
      case 'chat':
        finalResponse = convertMarkdownToHTML(assistantResponse);
        break;
      case 'transcript':
        // Keep transcripts as clean text with minimal formatting
        finalResponse = assistantResponse
          .replace(/\n{3,}/g, '\n\n') // Normalize spacing
          .trim();
        break;
      case 'task':
        // Keep tasks as plain text
        finalResponse = assistantResponse;
        break;
      default:
        finalResponse = assistantResponse;
    }

    // Only store in chat history if it's a direct chat interaction
    if (contentType === 'chat') {
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
          content: finalResponse,
          projectId: context?.projectId || null,
          timestamp: new Date(),
        }).returning();

        return [userMsg, assistantMsg];
      });

      // Create embeddings only for chat messages
      await Promise.all([
        createEmbedding({
          contentType: 'chat',
          contentId: userMessage.id,
          contentText: message,
        }),
        createEmbedding({
          contentType: 'chat',
          contentId: assistantMessage.id,
          contentText: finalResponse,
        })
      ]);
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