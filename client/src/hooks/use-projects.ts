import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InsertProject, SelectProject } from "@db/schema";

type RequestResult<T = any> = {
  ok: true;
  data: T;
} | {
  ok: false;
  message: string;
};

async function handleRequest<T>(
  url: string,
  method: string,
  body?: any
): Promise<RequestResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    const data = await response.json();

    if (!response.ok) {
      return { 
        ok: false, 
        message: data.message || response.statusText 
      };
    }

    return { ok: true, data };
  } catch (e: any) {
    console.error('Request error:', e);
    return { 
      ok: false, 
      message: e.message || 'An unexpected error occurred' 
    };
  }
}

interface CreateProjectParams extends Omit<InsertProject, 'userId'> {
  initialNoteContent?: string;
}

export function useProjects() {
  const queryClient = useQueryClient();

  // Update to use array query key format
  const { data: projects = [], isLoading } = useQuery<SelectProject[]>({
    queryKey: ['projects'],
    staleTime: Infinity,
    refetchOnWindowFocus: true
  });

  const createProject = useMutation({
    mutationFn: (project: CreateProjectParams) => handleRequest('/api/projects', 'POST', project),
    onSuccess: () => {
      // Update to use array query key format
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const deleteProject = useMutation({
    mutationFn: (projectId: number) => handleRequest(`/api/projects/${projectId}`, 'DELETE'),
    onSuccess: () => {
      // Update to use array query key format
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const renameProject = useMutation({
    mutationFn: ({ projectId, title }: { projectId: number; title: string }) => 
      handleRequest(`/api/projects/${projectId}`, 'PATCH', { title }),
    onSuccess: () => {
      // Update to use array query key format
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return {
    projects,
    isLoading,
    createProject: createProject.mutateAsync,
    deleteProject: deleteProject.mutateAsync,
    renameProject: renameProject.mutateAsync,
  };
}