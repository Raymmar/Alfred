import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import type { SelectProject } from '@db/schema';

const SAVE_DELAY = 1000; // 1 second debounce

interface UseSummaryProps {
  projectId?: number;
}

export function useSummary({ projectId }: UseSummaryProps) {
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeout = useRef<NodeJS.Timeout>();

  // Fetch project data with proper array queryKey typing
  const { data: project } = useQuery<SelectProject | undefined>({
    queryKey: projectId ? ['projects', projectId] : ['projects'],
    queryFn: async ({ queryKey }) => {
      if (!projectId || queryKey.length < 2) {
        return undefined;
      }
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch project');
      }
      return response.json();
    },
    enabled: !!projectId,
    staleTime: Infinity,
  });

  // Update content when project data changes
  useEffect(() => {
    if (project?.summary) {
      setContent(project.summary);
    }
  }, [project]);

  // Save mutation with array queryKey format
  const { mutateAsync: saveSummary } = useMutation({
    mutationFn: async (content: string) => {
      if (!projectId) {
        throw new Error('No project ID provided');
      }

      const response = await fetch(`/api/projects/${projectId}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: content }),
      });

      if (!response.ok) {
        throw new Error('Failed to save summary');
      }

      return response.json();
    },
    onSuccess: () => {
      if (projectId) {
        // Use array format for invalidation
        queryClient.invalidateQueries({
          queryKey: ['projects', projectId],
        });
      }
    },
  });

  // Debounced save handler
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setIsSaving(true);

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    saveTimeout.current = setTimeout(async () => {
      try {
        await saveSummary(newContent);
      } catch (error) {
        console.error('Failed to save summary:', error);
        toast({
          title: "Error",
          description: "Failed to save summary. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    }, SAVE_DELAY);
  }, [projectId, saveSummary, toast]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, []);

  return {
    content,
    setContent: handleContentChange,
    isSaving,
  };
}