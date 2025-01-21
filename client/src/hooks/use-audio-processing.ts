import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SelectProject } from "@db/schema";

type RequestResult<T = any> = {
  ok: true;
  data: T;
} | {
  ok: false;
  message: string;
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

async function processAudio(projectId: number): Promise<RequestResult<SelectProject>> {
  try {
    console.log('Starting audio processing for project:', projectId);

    const response = await fetch(`/api/projects/${projectId}/process`, {
      method: 'POST',
      credentials: 'include',
    });

    const data = await response.json();
    console.log('Audio processing response:', {
      status: response.status,
      ok: response.ok,
      data: data
    });

    if (!response.ok) {
      console.error('Processing failed:', data);
      return { 
        ok: false, 
        message: data.message || response.statusText 
      };
    }

    return { ok: true, data };
  } catch (e: any) {
    console.error('Audio processing error:', e);
    return { 
      ok: false, 
      message: e.message || 'An unexpected error occurred' 
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
  };
}