import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { users, projects, todos, chats } from "@db/schema";
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

  // Get project data and note structure
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

      // Extract the structure of the user's note
      const noteLines = noteContent.split('\n').map(line => line.trim()).filter(Boolean);
      const hasQuestions = noteLines.some(line => line.includes('?'));
      const hasBullets = noteLines.some(line => line.startsWith('-') || line.startsWith('•'));

      projectData = {
        title: project.title,
        transcription: project.transcription,
        summary: project.summary,
        note: noteContent,
        structure: {
          lines: noteLines,
          isQuestionBased: hasQuestions,
          hasBullets: hasBullets
        }
      };
    }
  }

  // Build a focused system message that uses the note as the exact response structure
  let systemMessage = '';
  if (projectData?.note) {
    const { structure } = projectData;

    systemMessage = `Your task is to provide specific information from the transcript for each point in the user's note. Here is the user's original note structure:

${projectData.note}

Follow these exact requirements:
1. Use the user's note VERBATIM as your response template
2. For each line in their note:
   ${structure.isQuestionBased ? 
     '- If it is a question, provide a direct, specific answer from the transcript\n   - Keep the original question and add the answer below it' :
     '- Add relevant details from the transcript that specifically relate to that point'}
3. Maintain the exact same formatting:
   ${structure.hasBullets ? '- Use the same bullet points/formatting as the original note' : '- Keep the same paragraph structure'}
4. Each response should be 1-2 sentences maximum
5. Only include information that directly relates to each specific point
6. Do not add any new points or general summaries

Important: Your response must follow the user's note structure EXACTLY, point by point, with no additional content.`;

  } else {
    // Use the user's default prompt or fallback
    systemMessage = user.defaultPrompt?.trim() || 'Create a brief, structured summary of the key points from the transcript. Use bullet points and keep each point to 1-2 sentences.';
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemMessage },
        { 
          role: "user", 
          content: projectData?.transcription 
            ? `Using this transcript, provide specific information ONLY for the points in my note above:\n\n${projectData.transcription}`
            : message
        }
      ],
      temperature: 0.3, // Lower temperature for more focused responses
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
        isEnhancingUserNote: true,
        noteStructure: projectData?.structure
      }
    };
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(error.message || "Failed to generate response");
  }
}