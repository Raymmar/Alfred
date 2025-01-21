import { Pipeline, pipeline } from '@xenova/transformers';
import { db } from '@db';
import { sql } from 'drizzle-orm';
import { embeddings } from '@db/schema';
import type { InsertEmbedding } from '@db/schema';

let embeddingModel: any = null;

async function getEmbeddingModel() {
  if (!embeddingModel) {
    embeddingModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embeddingModel;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const model = await getEmbeddingModel();
    if (!model) {
      throw new Error('Failed to initialize embedding model');
    }
    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

export async function createEmbedding(params: {
  contentType: string;
  contentId: number;
  contentText: string;
}): Promise<any> {
  try {
    const embedding = await generateEmbedding(params.contentText);

    const query = sql`
      INSERT INTO embeddings (content_type, content_id, content_text, embedding, created_at)
      VALUES (
        ${params.contentType},
        ${params.contentId},
        ${params.contentText},
        ${sql.raw(`ARRAY[${embedding.join(',')}]::vector`)},
        NOW()
      )
    `;

    return db.execute(query);
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw new Error('Failed to store embedding');
  }
}

interface SimilarContent {
  content_type: string;
  content_id: number;
  content_text: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export async function findSimilarContent(
  text: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    contentTypes?: string[];
    prioritizeRecordings?: boolean;
  } = {}
): Promise<SimilarContent[]> {
  const {
    limit = 10,
    minSimilarity = 0.5,
    contentTypes = ['chat', 'transcript', 'summary', 'note', 'todo'],
    prioritizeRecordings = false
  } = options;

  try {
    const embedding = await generateEmbedding(text);

    let typeWeights = '';
    if (prioritizeRecordings) {
      typeWeights = `
        CASE 
          WHEN e.content_type = 'transcript' THEN 1.3
          WHEN e.content_type = 'summary' THEN 1.2
          ELSE 1.0
        END`;
    } else {
      typeWeights = '1.0';
    }

    const query = sql`
      WITH similarity_scores AS (
        SELECT 
          e.content_type,
          e.content_id,
          e.content_text,
          (1 - (e.embedding <=> ${sql.raw(`ARRAY[${embedding.join(',')}]::vector`)})) * ${sql.raw(typeWeights)} as similarity,
          CASE 
            WHEN e.content_type = 'chat' THEN (
              SELECT jsonb_build_object(
                'timestamp', c.timestamp,
                'role', c.role,
                'project_id', c.project_id
              )
              FROM chats c WHERE c.id = e.content_id
            )
            WHEN e.content_type = 'transcript' THEN (
              SELECT jsonb_build_object(
                'title', p.title,
                'created_at', p.created_at,
                'has_summary', p.summary IS NOT NULL,
                'recording_url', p.recording_url,
                'project_type', 'recording'
              )
              FROM projects p WHERE p.id = e.content_id
            )
            WHEN e.content_type = 'summary' THEN (
              SELECT jsonb_build_object(
                'title', p.title,
                'created_at', p.created_at,
                'has_transcript', p.transcription IS NOT NULL,
                'recording_url', p.recording_url,
                'project_type', 'recording'
              )
              FROM projects p WHERE p.id = e.content_id
            )
            WHEN e.content_type = 'todo' THEN (
              SELECT jsonb_build_object(
                'completed', t.completed,
                'created_at', t.created_at,
                'project_id', t.project_id,
                'project_title', p.title,
                'project_type', CASE WHEN p.recording_url != 'personal.none' THEN 'recording' ELSE 'project' END
              )
              FROM todos t 
              LEFT JOIN projects p ON p.id = t.project_id 
              WHERE t.id = e.content_id
            )
            WHEN e.content_type = 'note' THEN (
              SELECT jsonb_build_object(
                'title', p.title,
                'created_at', p.created_at,
                'project_type', CASE WHEN p.recording_url != 'personal.none' THEN 'recording' ELSE 'project' END
              )
              FROM projects p WHERE p.id = e.content_id
            )
            ELSE NULL
          END as metadata
        FROM embeddings e
        WHERE e.content_type = ANY(${sql.raw(`ARRAY[${contentTypes.map(t => `'${t}'`).join(',')}]`)})
      )
      SELECT *
      FROM similarity_scores
      WHERE similarity >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    const results = await db.execute(query);
    return (Array.isArray(results) ? results : [results]) as SimilarContent[];
  } catch (error) {
    console.error('Error finding similar content:', error);
    return [];
  }
}

export async function findRecommendedTasks(
  userId: number,
  context: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    includeCompleted?: boolean;
  } = {}
): Promise<{
  recommendations: Array<{
    todoId: number;
    text: string;
    projectId: number | null;
    projectTitle: string | null;
    similarity: number;
    completed: boolean;
    metadata: any;
  }>;
  similarityScore: number;
}> {
  const {
    limit = 5,
    minSimilarity = 0.5,
    includeCompleted = false
  } = options;

  try {
    const embedding = await generateEmbedding(context);

    const query = sql`
      WITH similarity_scores AS (
        SELECT 
          e.content_id as todo_id,
          t.text,
          t.project_id,
          t.completed,
          p.title as project_title,
          1 - (e.embedding <=> ${sql.raw(`ARRAY[${embedding.join(',')}]::vector`)}) as similarity,
          jsonb_build_object(
            'created_at', t.created_at,
            'project_id', t.project_id,
            'column_id', t.column_id,
            'project_title', p.title,
            'project_description', p.description
          ) as metadata
        FROM embeddings e
        JOIN todos t ON t.id = e.content_id
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE e.content_type = 'todo'
        AND (${includeCompleted} OR NOT t.completed)
        AND EXISTS (
          SELECT 1 FROM projects p2 
          WHERE p2.id = t.project_id 
          AND p2.user_id = ${userId}
        )
      )
      SELECT *
      FROM similarity_scores
      WHERE similarity >= ${minSimilarity}
      ORDER BY 
        similarity DESC,
        completed ASC,
        (metadata->>'created_at')::timestamp DESC
      LIMIT ${limit}
    `;

    const results = await db.execute(query);
    const recommendations = (Array.isArray(results) ? results : [results]).map(r => ({
      todoId: r.todo_id,
      text: r.text,
      projectId: r.project_id,
      projectTitle: r.project_title,
      similarity: r.similarity,
      completed: r.completed,
      metadata: r.metadata
    }));

    return {
      recommendations,
      similarityScore: recommendations[0]?.similarity || 0
    };
  } catch (error) {
    console.error('Error finding recommended tasks:', error);
    return {
      recommendations: [],
      similarityScore: 0
    };
  }
}

export async function updateChatContext(userId: number, message: string) {
  try {
    const recordingKeywords = [
      'recording', 'recordings', 'audio', 'transcription', 'transcript',
      'recorded', 'listen', 'playback', 'last recording', 'recent recording'
    ];

    const isAskingAboutRecordings = recordingKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );

    const similarContent = await findSimilarContent(message, {
      limit: 10,
      minSimilarity: 0.5,
      contentTypes: ['chat', 'transcript', 'summary', 'note', 'todo'],
      prioritizeRecordings: isAskingAboutRecordings
    });

    const context = similarContent.map(content => ({
      type: content.content_type,
      id: content.content_id,
      text: content.content_text,
      similarity: content.similarity,
      metadata: content.metadata
    }));

    const sortedContext = context.sort((a, b) => {
      const timeA = a.metadata?.timestamp || a.metadata?.created_at ? 
        new Date(a.metadata.timestamp || a.metadata.created_at).getTime() : 0;
      const timeB = b.metadata?.timestamp || b.metadata?.created_at ? 
        new Date(b.metadata.timestamp || b.metadata.created_at).getTime() : 0;

      const similarityWeight = 0.5;
      const recencyWeight = 0.3;
      const typeWeight = 0.2;

      const getTypeScore = (type: string, metadata: any) => {
        const baseScores: Record<string, number> = {
          transcript: 1.0,
          summary: 0.95,
          chat: 0.9,
          note: 0.85,
          todo: 0.8
        };

        const score = baseScores[type] || 0.5;

        if (metadata?.project_type === 'recording') {
          return score * 1.2;
        }

        return score;
      };

      const scoreA = (a.similarity * similarityWeight) + 
                    (timeA ? (timeA / Date.now()) * recencyWeight : 0) +
                    (getTypeScore(a.type, a.metadata) * typeWeight);

      const scoreB = (b.similarity * similarityWeight) +
                    (timeB ? (timeB / Date.now()) * recencyWeight : 0) +
                    (getTypeScore(b.type, b.metadata) * typeWeight);

      return scoreB - scoreA;
    });

    return {
      enhancedContext: sortedContext,
      similarityScore: sortedContext[0]?.similarity || 0,
      contextCount: sortedContext.length
    };
  } catch (error) {
    console.error('Error in updateChatContext:', error);
    return {
      enhancedContext: [],
      similarityScore: 0,
      contextCount: 0
    };
  }
}