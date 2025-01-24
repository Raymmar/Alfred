import { getOpenAIClient, AIServiceConfig, handleAIError, WHISPER_MODEL } from "./config";
import { createReadStream } from "fs";

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export async function transcribeAudio(
  audioFilePath: string,
  config: AIServiceConfig
): Promise<TranscriptionResult> {
  try {
    const openai = await getOpenAIClient(config.userId);
    const audioStream = createReadStream(audioFilePath);

    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: WHISPER_MODEL,
      response_format: "verbose_json",
      temperature: 0.2,
    });

    return {
      text: transcription.text,
      duration: transcription.duration,
    };
  } catch (error) {
    handleAIError(error);
  }
}

// Utility function to validate audio file before processing
export function validateAudioFile(filePath: string): boolean {
  // TODO: Implement audio file validation
  // For now, we'll assume all files are valid
  return true;
}