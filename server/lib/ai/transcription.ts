import { OpenAI } from 'openai';
import type { TranscriptionResult, AIServiceConfig } from './types';
import { getAIServiceConfig, createOpenAIClient } from './utils';
import path from 'path';
import fs from 'fs';

export class TranscriptionService {
  private client: OpenAI;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = createOpenAIClient(config);
  }

  static async create(userId: number): Promise<TranscriptionService> {
    const config = await getAIServiceConfig(userId);
    return new TranscriptionService(config);
  }

  async transcribeAudio(filePath: string): Promise<TranscriptionResult> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Audio file not found at path: ${filePath}`);
      }

      const fileStream = fs.createReadStream(filePath);
      
      const transcription = await this.client.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
        language: "en",
        response_format: "text",
      });

      return {
        text: transcription,
        confidence: 0.95, // Whisper doesn't provide confidence scores
        language: "en"
      };

    } catch (error: any) {
      console.error('Transcription error:', error);
      return {
        text: "",
        error: error.message || 'Failed to transcribe audio'
      };
    }
  }
}

export async function createTranscriptionService(userId: number): Promise<TranscriptionService> {
  return TranscriptionService.create(userId);
}
