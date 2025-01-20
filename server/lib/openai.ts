import OpenAI from "openai";
import { db } from "@db";
import { eq, and } from "drizzle-orm";
import { users, projects, todos, chats } from "@db/schema";
import { createEmbedding } from './embeddings';

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

  // Get project data and user's note
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

      projectData = {
        title: project.title,
        transcription: project.transcription,
        summary: project.summary,
        note: noteContent,
      };
    }
  }

  // The user's note becomes the primary structure for the prompt
  let systemMessage = '';
  if (projectData?.note) {
    systemMessage = `You are assisting with a meeting recording. The user has written the following notes:

${projectData.note}

Your task is to ONLY address and enhance these specific points from the user's notes using the recording's transcript. Follow these strict rules:

1. ONLY respond to the questions and points raised in the user's notes above
2. Keep the exact same format as the user's notes
3. Each answer should be brief and direct - maximum 1-2 sentences
4. Do not add any information that doesn't directly answer the user's notes
5. Preserve any question format if the user wrote questions
6. Use the same style of bullet points or numbering as the user's notes

Focus exclusively on finding specific answers from the transcript for each point in the user's notes. Do not add any general summaries or unrelated information.`;
  } else {
    // Fallback to user's custom prompt or default
    systemMessage = user.defaultPrompt?.trim() || `Create a brief, structured summary of the key points from the transcript. Use bullet points and keep each point to 1-2 sentences.`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemMessage },
        { 
          role: "user", 
          content: projectData?.transcription 
            ? `Please address each point/question from my notes using this transcript:\n\n${projectData.transcription}`
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
        isEnhancingUserNote: true
      }
    };
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    throw new Error(error.message || "Failed to generate response");
  }
}