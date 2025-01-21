export * from './types';
export * from './utils';
export * from './transcription';
export * from './insights';
export * from './tasks';
export * from './chat';

// Factory functions for creating services
export async function createAIServices(userId: number) {
  const [
    transcriptionService,
    insightsService,
    taskExtractionService,
    chatService
  ] = await Promise.all([
    createTranscriptionService(userId),
    createInsightsService(userId),
    createTaskExtractionService(userId),
    createChatService(userId)
  ]);

  return {
    transcription: transcriptionService,
    insights: insightsService,
    tasks: taskExtractionService,
    chat: chatService
  };
}
