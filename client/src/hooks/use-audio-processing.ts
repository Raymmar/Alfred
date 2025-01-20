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
    "deliverables:"
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

async function processAudio(projectId: number): Promise<RequestResult<SelectProject>> {
  try {
    const response = await fetch(`/api/projects/${projectId}/process`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { 
        ok: false, 
        message: errorData.message || response.statusText 
      };
    }

    const data = await response.json();

    // Additional validation of tasks in the response
    if (data.todos) {
      data.todos = data.todos.filter((todo: any) => {
        if (!todo || typeof todo.text !== 'string') return false;

        const shouldKeep = !isEmptyTaskResponse(todo.text);
        if (!shouldKeep) {
          console.log('Frontend filtering: Removed empty task response:', todo.text);
        }
        return shouldKeep;
      });
    }

    return { ok: true, data };
  } catch (e: any) {
    console.error('Audio processing error:', e);
    return { 
      ok: false, 
      message: e.message || 'An unexpected error occurred while processing audio' 
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