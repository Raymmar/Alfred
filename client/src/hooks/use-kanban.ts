import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SelectKanbanColumn, SelectTodo } from "@db/schema";
import { useToast } from "@/hooks/use-toast";

export function useKanban() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: columns = [],
    error: columnsError,
    isLoading: isLoadingColumns,
  } = useQuery<SelectKanbanColumn[]>({
    queryKey: ['kanban', 'columns'],
    staleTime: 0,
    refetchOnWindowFocus: true
  });

  const {
    data: todos = [],
    error: todosError,
    isLoading: isLoadingTodos,
  } = useQuery<(SelectTodo & { project: { title: string, createdAt: string } })[]>({
    queryKey: ['todos'],
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
    refetchOnMount: true, // Always refetch when component mounts
    select: (data) => data.map(todo => ({
      ...todo,
      order: todo.order ?? todo.id // Ensure stable order using ID as fallback
    })),
    refetchInterval: 1000 // Poll every second to ensure we catch updates
  });

  // Update mutation with improved cache handling and type safety
  const updateTodoMutation = useMutation({
    mutationFn: async ({ 
      todoId, 
      columnId, 
      completed,
      order
    }: { 
      todoId: number; 
      columnId?: number | null; 
      completed?: boolean | null;
      order?: number;
    }) => {
      const response = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId, completed, order }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onMutate: async ({ todoId, columnId, completed, order }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      await queryClient.cancelQueries({ queryKey: ['kanban', 'columns'] });

      // Snapshot the previous values
      const previousTodos = queryClient.getQueryData<SelectTodo[]>(['todos']);
      const previousColumns = queryClient.getQueryData<SelectKanbanColumn[]>(['kanban', 'columns']);

      // Optimistically update todos cache with proper type handling
      queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => 
        old.map(todo => 
          todo.id === todoId
            ? {
                ...todo,
                ...(columnId !== undefined && { columnId }),
                ...(completed !== undefined && { completed }),
                ...(order !== undefined && { order }),
                updatedAt: new Date()
              }
            : todo
        )
      );

      return { previousTodos, previousColumns };
    },
    onError: (error, variables, context) => {
      // Revert to previous state on error
      if (context?.previousTodos) {
        queryClient.setQueryData(['todos'], context.previousTodos);
      }
      if (context?.previousColumns) {
        queryClient.setQueryData(['kanban', 'columns'], context.previousColumns);
      }
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['kanban', 'columns'] });
    },
  });

  return {
    columns,
    todos,
    isLoading: isLoadingColumns || isLoadingTodos,
    error: columnsError || todosError,
    updateTodo: updateTodoMutation.mutateAsync,
  };
}