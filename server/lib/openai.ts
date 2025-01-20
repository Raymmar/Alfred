import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { settings, users, projects, todos, chats } from "@db/schema";
import { createEmbedding } from './embeddings';

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

  if (excludedPhrases.includes(trimmedText)) {
    console.log('Empty task check: Exact match found:', trimmedText);
    return true;
  }

  const hasPhrase = excludedPhrases.some(phrase => {
    const includes = trimmedText.includes(phrase);
    if (includes) {
      console.log('Empty task check: Phrase match found:', phrase, 'in:', trimmedText);
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

  const apiKey = user.openaiApiKey;
  if (!apiKey) {
    throw new Error("OpenAI API key not found. Please add your API key in settings.");
  }

  const openai = new OpenAI({
    apiKey,
  });

  // Get project data for formatting context
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
      const noteContent = project.note?.content || '';

      // Analyze note format
      const formatAnalysis = {
        paragraphStyle: noteContent.includes('\n\n') ? 'double' : 'single',
        bulletStyle: noteContent.includes('•') ? '•' : 
                    noteContent.includes('-') ? '-' : 
                    noteContent.includes('*') ? '*' : null,
        hasNumberedLists: /^\d+\.\s/m.test(noteContent),
        headingStyle: /^#+\s/m.test(noteContent) ? 'markdown' :
                     /^[A-Z][^.\n]+:\n/m.test(noteContent) ? 'text' : null,
        indentation: noteContent.match(/^(\s+)/m)?.[1].length || 0
      };

      projectData = {
        title: project.title,
        transcription: project.transcription,
        summary: project.summary,
        note: noteContent,
        formatAnalysis
      };
    }
  }

  // Use user's custom processing prompt or default
  const processingPrompt = user.defaultPrompt?.trim();

  // Build system message focused on format matching and conciseness
  let systemMessage = processingPrompt || `You are enhancing user notes based on meeting transcripts. Follow these strict guidelines:

Format Matching:
${projectData?.formatAnalysis ? `
• Use ${projectData.formatAnalysis.paragraphStyle} paragraph spacing
${projectData.formatAnalysis.bulletStyle ? `• Use "${projectData.formatAnalysis.bulletStyle}" for bullet points` : ''}
${projectData.formatAnalysis.hasNumberedLists ? '• Maintain numbered list formatting' : ''}
${projectData.formatAnalysis.headingStyle ? `• Use ${projectData.formatAnalysis.headingStyle} style headings` : ''}
${projectData.formatAnalysis.indentation ? `• Maintain ${projectData.formatAnalysis.indentation} space indentation` : ''}
` : ''}

Content Rules:
1. Only add relevant context from the transcript that directly relates to the user's notes
2. Keep additions brief - max 1-2 sentences per point
3. Maintain the user's writing style and format exactly
4. Focus on clarifying and expanding existing points
5. Do not add unrelated information
6. Use paragraph breaks and formatting that matches the user's style`;

  if (projectData?.note) {
    systemMessage += `\n\nUser's Current Note:\n${projectData.note}`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const assistantResponse = response.choices[0].message.content || "";

    // Store chat messages
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

    // Create embeddings for context
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
        formatAnalysis: projectData?.formatAnalysis
      }
    };
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(error.message || "Failed to generate response");
  }
}