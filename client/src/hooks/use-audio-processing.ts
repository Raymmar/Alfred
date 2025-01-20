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
    // Extended timeout for larger file processing (90 minutes)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90 * 60 * 1000);

    const response = await fetch(`/api/projects/${projectId}/process`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      console.error('Processing failed:', {
        status: response.status,
        error: data.message || response.statusText
      });
      return { 
        ok: false, 
        message: data.message || response.statusText 
      };
    }

    // Add logging for debugging processing times
    console.log('Audio processing completed:', {
      projectId,
      processingTime: Date.now() - (response.headers.get('X-Processing-Start') ? parseInt(response.headers.get('X-Processing-Start')!) : 0),
      responseSize: JSON.stringify(data).length
    });

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

    return { ok: true, data };
  } catch (e: any) {
    // Better error handling for timeouts and network issues
    let errorMessage = e.message || 'An unexpected error occurred';
    if (e.name === 'AbortError') {
      errorMessage = 'The request timed out. The recording may be too large or the server is busy.';
    } else if (!navigator.onLine) {
      errorMessage = 'You appear to be offline. Please check your internet connection.';
    }

    console.error('Audio processing error:', {
      error: e,
      message: errorMessage,
      projectId
    });

    return { 
      ok: false, 
      message: errorMessage
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