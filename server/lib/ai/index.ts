import { TranscriptionService } from './transcription';
import { InsightsService } from './insights';
import { TaskExtractionService } from './tasks';
import { ChatService } from './chat';
import { EmbeddingsService } from './embeddings';

export * from './types';
export * from './utils';
export * from './transcription';
export * from './insights';
export * from './tasks';
export * from './chat';
export * from './embeddings';

// Factory function for creating all services
export async function createAIServices(userId: number) {
  const [
    transcriptionService,
    insightsService,
    taskExtractionService,
    chatService,
    embeddingsService
  ] = await Promise.all([
    TranscriptionService.create(userId),
    InsightsService.create(userId),
    TaskExtractionService.create(userId),
    ChatService.create(userId),
    EmbeddingsService.create(userId)
  ]);

  return {
    transcription: transcriptionService,
    insights: insightsService,
    tasks: taskExtractionService,
    chat: chatService,
    embeddings: embeddingsService
  };
}