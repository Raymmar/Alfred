import { useQueryClient } from "@tanstack/react-query";
import { useKanban } from "@/hooks/use-kanban";
import type { SelectTodo } from "@db/schema";

// Helper function to check if text indicates no tasks
function isEmptyTaskResponse(text: string): boolean {
  const trimmedText = text.trim().toLowerCase();
  const excludedPhrases = [
    "no task",
    "no tasks",
    "no deliverable",
    "no deliverables"
  ];

  return excludedPhrases.some(phrase => trimmedText.includes(phrase));
}

export function useTaskOperations() {
  const queryClient = useQueryClient();
  const { updateTodo } = useKanban();
  let previousTodos: SelectTodo[] | undefined;

  const handleStatusChange = async (todoId: number, completed: boolean) => {
    await updateTodo({ 
      todoId, 
      completed
    });
  };

  const handleEdit = async (todoId: number, text: string, options?: { order?: number, completed?: boolean, projectId?: number }) => {
    try {
      // Skip update if the new text indicates no tasks
      if (isEmptyTaskResponse(text.trim())) {
        console.log('Skipping task update - empty task response detected:', text);
        return null;
      }

      console.log('Starting task edit:', { todoId, text, options });

      // Cancel any outgoing refetches for this specific todo
      await queryClient.cancelQueries({ queryKey: ['todos'] });

      // Snapshot the previous values
      previousTodos = queryClient.getQueryData<SelectTodo[]>(['todos']);
      console.log('Previous todos state:', previousTodos?.find(t => t.id === todoId));

      // Prepare the update data
      const updateData = {
        text: text.trim(),
        ...(options?.order !== undefined ? { order: options.order } : {}),
        ...(options?.completed !== undefined ? { completed: options.completed } : {}),
        ...(options?.projectId !== undefined ? { projectId: options.projectId } : {})
      };

      // Optimistically update todos cache
      queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => {
        return old.map(todo => 
          todo.id === todoId
            ? { ...todo, ...updateData }
            : todo
        );
      });

      // Make the API call
      console.log('Sending PATCH request to server:', { 
        url: `/api/todos/${todoId}`,
        body: updateData
      });

      const response = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
        credentials: 'include'
      });

      console.log('Server response status:', response.status);

      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to update task');
      }

      const updatedTodo = await response.json();
      console.log('Server returned updated todo:', updatedTodo);

      // Update cache with the server response
      queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => {
        return old.map(todo => todo.id === todoId ? updatedTodo : todo);
      });

      // Force a refetch to ensure consistency
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['todos'] }),
        queryClient.invalidateQueries({ queryKey: ['kanban', 'columns'] })
      ]);

      return updatedTodo;
    } catch (error: any) {
      console.error('Error updating task:', error);
      // Revert optimistic update on error
      if (previousTodos) {
        queryClient.setQueryData(['todos'], previousTodos);
      }
      throw error;
    }
  };

  const handleDelete = async (todoId: number) => {
    try {
      console.log('Starting task deletion:', todoId);

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      await queryClient.cancelQueries({ queryKey: ['kanban', 'columns'] });

      // Snapshot the previous values
      previousTodos = queryClient.getQueryData<SelectTodo[]>(['todos']);

      // Optimistically remove the todo from the cache
      queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => 
        old.filter(todo => todo.id !== todoId)
      );

      // Make the API call
      const response = await fetch(`/api/todos/${todoId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        // Rollback on error
        if (previousTodos) {
          queryClient.setQueryData(['todos'], previousTodos);
        }
        throw new Error(await response.text() || 'Failed to delete task');
      }

      // Force a refetch to ensure consistency
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['todos'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['kanban', 'columns'] })
      ]);

      console.log('Task deleted successfully:', todoId);
    } catch (error: any) {
      console.error('Error deleting task:', error);
      throw error;
    }
  };

  const handleBatchDelete = async (todoIds: number[]) => {
    try {
      console.log('Starting batch deletion:', todoIds);

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      await queryClient.cancelQueries({ queryKey: ['kanban', 'columns'] });

      // Snapshot the previous values
      previousTodos = queryClient.getQueryData<SelectTodo[]>(['todos']);

      // Optimistically remove the todos from the cache
      queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => 
        old.filter(todo => !todoIds.includes(todo.id))
      );

      // Delete each todo
      await Promise.all(
        todoIds.map(todoId =>
          fetch(`/api/todos/${todoId}`, {
            method: 'DELETE',
            credentials: 'include'
          }).then(response => {
            if (!response.ok) {
              throw new Error(`Failed to delete todo ${todoId}`);
            }
          })
        )
      );

      // Force a refetch to ensure consistency
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['todos'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['kanban', 'columns'] })
      ]);

      console.log('Batch deletion completed successfully:', todoIds);
    } catch (error: any) {
      // Revert optimistic update on error
      if (previousTodos) {
        queryClient.setQueryData(['todos'], previousTodos);
      }
      console.error('Error in batch deletion:', error);
      throw error;
    }
  };

  const handleBatchStatusChange = async (todoIds: number[], completed: boolean) => {
    try {
      console.log('Starting batch status change:', { todoIds, completed });

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] });

      // Snapshot the previous values
      previousTodos = queryClient.getQueryData<SelectTodo[]>(['todos']);

      // Optimistically update todos cache with the new completed status
      queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => {
        if (!old) return [];
        return old.map(todo => 
          todoIds.includes(todo.id)
            ? { ...todo, completed }
            : todo
        );
      });

      // Update each todo
      await Promise.all(
        todoIds.map(todoId =>
          updateTodo({ 
            todoId, 
            completed
          })
        )
      );

      // Force a refetch to ensure consistency
      await queryClient.invalidateQueries({ queryKey: ['todos'] });

      console.log('Batch status change completed successfully:', todoIds);
    } catch (error: any) {
      console.error('Error in batch status change:', error);
      // Revert optimistic update on error
      if (previousTodos) {
        queryClient.setQueryData(['todos'], previousTodos);
      }
      throw error;
    }
  };

  const getTasksAsMarkdown = (todos: SelectTodo[]): string => {
    if (!todos.length) return '';

    // Sort tasks by completion status and order
    const sortedTodos = [...todos].sort((a, b) => {
      // Completed tasks go after pending ones
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      // Then sort by order if available
      return (a.order ?? Infinity) - (b.order ?? Infinity);
    });

    // Format tasks as markdown checklist
    const markdownLines = sortedTodos.map(todo => {
      const checkbox = todo.completed ? '[x]' : '[ ]';
      return `- ${checkbox} ${todo.text}`;
    });

    return markdownLines.join('\n');
  };

  return {
    handleStatusChange,
    handleEdit,
    handleDelete,
    handleBatchDelete,
    handleBatchStatusChange,
    getTasksAsMarkdown,
  };
}