import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { settings, users, projects, todos, chats } from "@db/schema";
import { updateChatContext, createEmbedding } from './embeddings';
import { findRecommendedTasks } from './embeddings';
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import { marked } from 'marked';
import fs from 'node:fs/promises';
import path from 'path';
import { spawn } from 'child_process';

// Configure marked for clean HTML output compatible with TipTap and our styling
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
  headerPrefix: '', // Don't prefix headers
  headerIds: false, // Don't add IDs to headers
  smartypants: true, // Use smart punctuation
});

// Update constants for file size limits and processing
const MAX_FILE_SIZE_MB = 100; // Maximum size we'll process
const CHUNK_SIZE_MB = 24; // Slightly below the Whisper API limit (25MB) for safety
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const WHISPER_MODEL = "whisper-1";

// Helper function for handling API retries
async function withRetry<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY_MS
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && (error?.status === 429 || error?.status >= 500)) {
      console.log(`Retrying operation, ${retries} attempts remaining...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Helper function to split audio into chunks using FFmpeg
async function splitAudioIntoChunks(filepath: string, outputDir: string): Promise<string[]> {
  const chunkFiles: string[] = [];
  const basename = path.basename(filepath, path.extname(filepath));

  return new Promise((resolve, reject) => {
    // Use FFmpeg to split into 20-minute chunks (below 25MB typically)
    const ffmpeg = spawn('ffmpeg', [
      '-i', filepath,
      '-f', 'segment',
      '-segment_time', '1200', // 20 minutes
      '-c', 'copy',
      '-map', '0',
      '-reset_timestamps', '1',
      path.join(outputDir, `${basename}_chunk_%d.webm`)
    ]);

    let error = '';
    ffmpeg.stderr.on('data', (data) => {
      error += data.toString();
    });

    ffmpeg.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg failed with code ${code}: ${error}`));
        return;
      }

      try {
        // Get all chunk files
        const files = await fs.readdir(outputDir);
        const chunkPattern = new RegExp(`${basename}_chunk_\\d+\\.webm`);
        const chunks = files
          .filter(f => chunkPattern.test(f))
          .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
          })
          .map(f => path.join(outputDir, f));

        resolve(chunks);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Helper function to process audio chunks with Whisper
async function processAudioChunk(
  openai: OpenAI,
  chunk: string,
  options: { prompt?: string; language?: string } = {}
): Promise<string> {
  try {
    console.log('Processing audio chunk:', {
      path: chunk,
      size: (await fs.stat(chunk)).size / (1024 * 1024) + 'MB'
    });

    const transcription = await withRetry(async () => {
      const response = await openai.audio.transcriptions.create({
        file: await fs.readFile(chunk),
        model: WHISPER_MODEL,
        response_format: 'verbose_json',
        prompt: options.prompt,
        language: options.language,
      });
      return response;
    });

    console.log('Chunk transcription completed:', {
      chunks: transcription.segments?.length || 0,
      duration: transcription.duration
    });

    return transcription.text;
  } catch (error: any) {
    console.error('Error processing audio chunk:', {
      error: error.message,
      status: error.status,
      path: chunk
    });
    throw error;
  }
}

// Export the transcription function for use in routes.ts
export async function transcribeAudio(
  filepath: string,
  apiKey: string,
  options: { prompt?: string; language?: string } = {}
): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const outputDir = path.dirname(filepath);
  const chunks = await splitAudioIntoChunks(filepath, outputDir);
  let fullTranscription = '';

  console.log('Starting transcription process:', {
    totalChunks: chunks.length,
    options
  });

  try {
    for (const [index, chunk] of chunks.entries()) {
      const chunkTranscription = await processAudioChunk(openai, chunk, {
        ...options,
        // Pass previous chunk ending as prompt for continuity
        prompt: fullTranscription.slice(-100) + (options.prompt || '')
      });

      fullTranscription += (index > 0 ? ' ' : '') + chunkTranscription;

      console.log('Progress:', {
        chunk: index + 1,
        totalChunks: chunks.length,
        transcriptionLength: fullTranscription.length
      });

      // Clean up chunk file after processing
      await fs.unlink(chunk).catch(err => {
        console.warn('Failed to clean up chunk file:', err);
      });
    }

    return fullTranscription;
  } catch (error) {
    // Clean up any remaining chunks on error
    await Promise.all(chunks.map(chunk => 
      fs.unlink(chunk).catch(() => {})
    ));
    throw error;
  }
}

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


// Interface for Chat Options
interface ChatOptions {
  userId: number;
  message: string;
  context?: {
    transcription?: string | null;
    summary?: string | null;
    projectId?: number;
  };
  promptType?: 'primary' | 'todo' | 'system';
}

export async function createChatCompletion({
  userId,
  message,
  context,
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

  // Use user's custom prompts or fall back to defaults
  const primaryPrompt = userSettings?.defaultPrompt || DEFAULT_PRIMARY_PROMPT;
  const todoPrompt = userSettings?.todoPrompt || DEFAULT_TODO_PROMPT;
  const systemPrompt = userSettings?.systemPrompt || DEFAULT_SYSTEM_PROMPT;

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

  // Select the appropriate prompt based on the promptType
  const basePrompt = promptType === 'todo'
    ? todoPrompt
    : promptType === 'primary'
      ? primaryPrompt
      : systemPrompt;

  // Build system message with enhanced contextual awareness and selected prompt
  let systemMessage = `${basePrompt}\n\nDatabase Context:
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

  const startTime = Date.now();
  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 1000, // Increased for longer summaries
      timeout_seconds: 300, // 5 minute timeout for processing
    });

    const assistantResponse = response.choices[0].message.content || "";
    console.log('GPT response:', {
      responseLength: assistantResponse.length,
      promptType,
      processingTime: Date.now() - startTime
    });

    // Only convert to HTML if it's not a todo prompt
    const finalResponse = promptType === 'todo'
      ? assistantResponse  // Keep tasks as plain text
      : convertMarkdownToHTML(assistantResponse); // Convert insights to HTML

    console.log('Final response:', finalResponse);

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

    return {
      message: finalResponse,
      context: {
        similarityScore,
        contextCount: enhancedContext.length,
        recommendedTasks: recommendedTasks.length
      }
    };
  } catch (error: any) {
    console.error("OpenAI API error:", {
      error: error.message,
      context: {
        userId,
        messageLength: message.length,
        promptType
      }
    });
    throw error;
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