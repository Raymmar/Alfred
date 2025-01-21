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
    queryKey: ['/api/kanban/columns'],
    staleTime: 0,
    refetchOnWindowFocus: true
  });

  const {
    data: todos = [],
    error: todosError,
    isLoading: isLoadingTodos,
  } = useQuery<SelectTodo[]>({
    queryKey: ['/api/todos'],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    select: (data) => data.map(todo => ({
      ...todo,
      order: todo.order ?? todo.id
    })),
  });

  // Update mutation with improved error handling
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
        body: JSON.stringify({ 
          column_id: columnId, 
          completed, 
          order 
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onMutate: async ({ todoId, columnId, completed, order }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/todos'] });
      await queryClient.cancelQueries({ queryKey: ['/api/kanban/columns'] });

      const previousTodos = queryClient.getQueryData<SelectTodo[]>(['/api/todos']);
      const previousColumns = queryClient.getQueryData<SelectKanbanColumn[]>(['/api/kanban/columns']);

      queryClient.setQueryData<SelectTodo[]>(['/api/todos'], (old = []) => 
        old.map(todo => 
          todo.id === todoId
            ? {
                ...todo,
                column_id: columnId ?? todo.column_id,
                completed: completed ?? todo.completed,
                order: order ?? todo.order,
                updated_at: new Date()
              }
            : todo
        )
      );

      return { previousTodos, previousColumns };
    },
    onError: (error, variables, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(['/api/todos'], context.previousTodos);
      }
      if (context?.previousColumns) {
        queryClient.setQueryData(['/api/kanban/columns'], context.previousColumns);
      }
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/todos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/kanban/columns'] });
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