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

type ProcessingProgress = {
  stage: 'transcribing' | 'summarizing' | 'extracting_tasks';
  percent: number;
  message: string;
};

async function processAudio(projectId: number): Promise<RequestResult<SelectProject>> {
  try {
    // Set up SSE for progress tracking
    const progressEvents = new EventSource(`/api/projects/${projectId}/process/progress`);
    let lastProgress: ProcessingProgress | null = null;

    progressEvents.onmessage = (event) => {
      const progress: ProcessingProgress = JSON.parse(event.data);
      console.log('Processing progress:', progress);
      lastProgress = progress;
    };

    progressEvents.onerror = (error) => {
      console.error('Progress event error:', error);
      progressEvents.close();
    };

    // Make the actual processing request
    const response = await fetch(`/api/projects/${projectId}/process`, {
      method: 'POST',
      credentials: 'include',
    });

    // Close SSE connection
    progressEvents.close();

    const data = await response.json();

    if (!response.ok) {
      return { 
        ok: false, 
        message: data.message || response.statusText 
      };
    }

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
      message: e.message || 'An unexpected error occurred' 
    };
  }
}

export function useAudioProcessing() {
  const queryClient = useQueryClient();

  const processAudioMutation = useMutation({
    mutationFn: processAudio,
    onMutate: async (projectId) => {
      // Optimistically update UI to show processing state
      await queryClient.cancelQueries({ queryKey: ['projects', projectId] });
      const previousProject = queryClient.getQueryData(['projects', projectId]);

      queryClient.setQueryData(['projects', projectId], (old: any) => ({
        ...old,
        status: 'processing',
      }));

      return { previousProject };
    },
    onSuccess: (result) => {
      if (result.ok) {
        // Invalidate both projects and todos queries to refresh task list
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['todos'] });
      }
    },
    onError: (_err, _projectId, context) => {
      // Revert optimistic update on error
      if (context?.previousProject) {
        queryClient.setQueryData(['projects', _projectId], context.previousProject);
      }
    },
  });

  return {
    processAudio: processAudioMutation.mutateAsync,
    isProcessing: processAudioMutation.isPending,
  };
}