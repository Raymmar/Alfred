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
    try {
      console.log('Creating TranscriptionService for user:', userId);
      const config = await getAIServiceConfig(userId);
      console.log('Got AI service config:', { 
        hasApiKey: !!config.apiKey,
        model: config.model
      });
      return new TranscriptionService(config);
    } catch (error) {
      console.error('Failed to create TranscriptionService:', error);
      throw error;
    }
  }

  async transcribeAudio(filePath: string): Promise<TranscriptionResult> {
    try {
      console.log('Starting audio transcription for file:', filePath);

      if (!fs.existsSync(filePath)) {
        console.error('Audio file not found at path:', filePath);
        throw new Error(`Audio file not found at path: ${filePath}`);
      }

      const fileStream = fs.createReadStream(filePath);
      console.log('Created file stream, sending to OpenAI Whisper API');

      const transcription = await this.client.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
        language: "en",
        response_format: "text",
      });

      console.log('Transcription completed successfully:', {
        transcriptionLength: transcription?.length || 0,
      });

      return {
        text: transcription,
        confidence: 0.95, // Whisper doesn't provide confidence scores
        language: "en"
      };

    } catch (error: any) {
      console.error('Transcription error:', error);
      console.error('Full error details:', {
        message: error.message,
        code: error.code,
        type: error.type,
        param: error.param,
        fileExists: fs.existsSync(filePath),
        filePath
      });

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