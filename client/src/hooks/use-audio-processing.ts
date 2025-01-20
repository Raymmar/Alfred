import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SelectProject } from "@db/schema";

type ProcessingStage = 'recording' | 'transcribing' | 'analyzing' | 'completed' | 'error';

type RequestResult<T = any> = {
  ok: true;
  data: T;
  stage?: ProcessingStage;
} | {
  ok: false;
  message: string;
  stage?: ProcessingStage;
};

// Helper function to validate tasks before creation
function isEmptyTaskResponse(text: string): boolean {
  if (!text || typeof text !== 'string') return true;

  const trimmedText = text.trim().toLowerCase();
  if (!trimmedText) return true;

  const excludedPhrases = [
    "no task",
    "no tasks",
    "no deliverable",
    "no deliverables",
    "identified",
    "no tasks identified",
    "no deliverables identified",
    "no tasks or deliverables",
    "not found",
    "none found",
    "none identified",
    "could not identify",
    "unable to identify",
    "no action items",
    "no actions",
    "tasks:",
    "action items:",
    "deliverables:",
    "n/a",
    "none",
    "not applicable",
    "no specific tasks mentioned",
    "no clear tasks",
    "not specified"
  ];

  // Check exact matches
  if (excludedPhrases.includes(trimmedText)) {
    console.log('Frontend task validation: Exact match found:', trimmedText);
    return true;
  }

  // Check for phrases
  return excludedPhrases.some(phrase => {
    if (trimmedText.includes(phrase)) {
      console.log('Frontend task validation: Phrase match found:', phrase);
      return true;
    }
    return false;
  });
}

// Helper function to detect potential duplicate tasks
function isDuplicateTask(newTask: string, existingTasks: Array<{ text: string }> = []): boolean {
  if (!newTask?.trim()) return true;

  const normalizedNewTask = newTask.trim().toLowerCase();
  return existingTasks.some(task => {
    const normalizedExistingTask = task.text.trim().toLowerCase();
    return normalizedExistingTask === normalizedNewTask ||
           normalizedExistingTask.includes(normalizedNewTask) ||
           normalizedNewTask.includes(normalizedExistingTask);
  });
}

// Step 1: Transcribe the audio
async function transcribeAudio(projectId: number): Promise<RequestResult> {
  try {
    const response = await fetch(`/api/projects/${projectId}/transcribe`, {
      method: 'POST',
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      return { 
        ok: false, 
        message: data.message || response.statusText,
        stage: 'transcribing'
      };
    }

    return { ok: true, data, stage: 'transcribing' };
  } catch (e: any) {
    console.error('Transcription error:', e);
    return { 
      ok: false, 
      message: e.message || 'Failed to transcribe audio',
      stage: 'transcribing'
    };
  }
}

// Step 2: Extract insights from transcription
async function extractInsights(projectId: number): Promise<RequestResult<SelectProject>> {
  try {
    const response = await fetch(`/api/projects/${projectId}/analyze`, {
      method: 'POST',
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      return { 
        ok: false, 
        message: data.message || response.statusText,
        stage: 'analyzing'
      };
    }

    // Additional validation of tasks in the response
    if (data.todos) {
      // Get existing tasks for duplicate check
      const existingTasksResponse = await fetch(`/api/projects/${projectId}/todos`);
      const existingTasks = await existingTasksResponse.json();

      // Filter out empty and duplicate tasks
      data.todos = data.todos.filter((todo: any) => {
        if (!todo || typeof todo.text !== 'string') {
          console.log('Frontend filtering: Removed invalid task:', todo);
          return false;
        }

        if (isEmptyTaskResponse(todo.text)) {
          console.log('Frontend filtering: Removed empty task response:', todo.text);
          return false;
        }

        if (isDuplicateTask(todo.text, existingTasks)) {
          console.log('Frontend filtering: Removed duplicate task:', todo.text);
          return false;
        }

        return true;
      });
    }

    return { ok: true, data, stage: 'analyzing' };
  } catch (e: any) {
    console.error('Analysis error:', e);
    return { 
      ok: false, 
      message: e.message || 'Failed to analyze transcription',
      stage: 'analyzing'
    };
  }
}

async function processAudio(projectId: number): Promise<RequestResult<SelectProject>> {
  try {
    // Step 1: Transcribe
    const transcriptionResult = await transcribeAudio(projectId);
    if (!transcriptionResult.ok) {
      return transcriptionResult;
    }

    // Step 2: Extract insights
    const analysisResult = await extractInsights(projectId);
    if (!analysisResult.ok) {
      return analysisResult;
    }

    return { 
      ok: true, 
      data: analysisResult.data,
      stage: 'completed'
    };
  } catch (e: any) {
    console.error('Audio processing error:', e);
    return { 
      ok: false, 
      message: e.message || 'An unexpected error occurred',
      stage: 'error'
    };
  }
}

export function useAudioProcessing() {
  const queryClient = useQueryClient();

  const processAudioMutation = useMutation({
    mutationFn: processAudio,
    onSuccess: (result) => {
      if (result.ok) {
        // Immediately invalidate queries to refresh the UI
        queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['todos'] });
      }
    },
  });

  return {
    processAudio: processAudioMutation.mutateAsync,
    isProcessing: processAudioMutation.isPending,
    processingStage: processAudioMutation.data?.stage || 'recording',
  };
}