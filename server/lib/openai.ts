import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { settings, users, projects, todos, chats } from "@db/schema";
import { updateChatContext, createEmbedding } from './embeddings';
import { findRecommendedTasks } from './embeddings';
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT } from "@/lib/constants";
import { marked } from 'marked';

// Configure marked for HTML output
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
  headerIds: false, // Don't add IDs to headers
  mangle: false, // Don't escape HTML
  sanitize: false // Don't sanitize HTML (TipTap handles this)
});

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024
const CHAT_MODEL = "gpt-4o";

// Helper function to convert markdown to HTML
function convertMarkdownToHTML(markdown: string): string {
  if (!markdown) return '';

  try {
    // Convert markdown to HTML
    const html = marked(markdown);

    // Clean up empty paragraphs that might be created
    return html.replace(/<p>\s*<\/p>/g, '');
  } catch (error) {
    console.error('Error converting markdown to HTML:', error);
    // If conversion fails, wrap the original content in a paragraph
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

interface ChatOptions {
  userId: number;
  message: string;
  context?: {
    transcription?: string | null;
    summary?: string | null;
    projectId?: number;
  };
  promptType?: 'primary' | 'todo';
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
  promptType = 'primary'
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

  // Use user's custom prompts or fall back to defaults
  const primaryPrompt = user.defaultPrompt || DEFAULT_PRIMARY_PROMPT;
  const todoPrompt = user.todoPrompt || DEFAULT_TODO_PROMPT;

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

  // Use the appropriate prompt based on the promptType
  const promptToUse = promptType === 'todo' ? todoPrompt : primaryPrompt;

  // Build system message with enhanced contextual awareness and selected prompt
  let systemMessage = `${promptToUse}\n\nDatabase Context:
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
` : 'No recordings available.'}

Available Projects and Recordings:
${userData.projects.map(p => `
Project: "${p.title}" (Created: ${p.createdAt.toLocaleString()})
Type: ${p.isRecording ? 'Recording' : 'Project'}
${p.description ? `Description: ${p.description}` : ''}
${p.transcription ? `Has Transcription: Yes\nTranscription Preview:\n${p.transcription.substring(0, 300)}...` : ''}
${p.summary ? `\nSummary:\n${p.summary}` : ''}
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
    : 'No specifically relevant tasks found for this conversation.'}`;

  // For project-specific chat, add focused context
  if (context?.projectId) {
    const projectContext = userData.projects.find(p => p.id === context.projectId);
    if (projectContext) {
      systemMessage += `\n\nFocused Project Context:
Title: "${projectContext.title}"
${projectContext.description ? `Description: ${projectContext.description}\n` : ''}
Created: ${projectContext.createdAt.toLocaleString()}
Tasks: ${projectContext.todoCount} total (${projectContext.completedTodos} completed)
${projectContext.transcription ? `\nTranscription:\n${projectContext.transcription}` : ''}
${projectContext.summary ? `\nSummary:\n${projectContext.summary}` : ''}
${projectContext.note ? `\nNotes:\n${projectContext.note.content}` : ''}

Current Tasks:
${projectContext.todos?.map(t => `- ${t.text} (${t.completed ? 'Completed' : 'Pending'})`).join('\n') || 'No tasks'}`;
    }
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

    // Convert markdown response to HTML
    const htmlResponse = convertMarkdownToHTML(assistantResponse);
    console.log('Converted HTML response:', htmlResponse);

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
        content: htmlResponse, // Store the HTML version
        projectId: context?.projectId || null,
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
        contentText: htmlResponse, // Use HTML version for embedding
      })
    ]);

    return {
      message: htmlResponse, // Return HTML version
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