import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import type { SelectProject } from '@db/schema';
import { DEFAULT_PRIMARY_PROMPT } from '@/lib/constants';

const SAVE_DELAY = 1000; // 1 second debounce

interface UseSummaryProps {
  projectId?: number;
  noteContent?: string;
  defaultPrompt?: string;
}

export function useSummary({ projectId, noteContent, defaultPrompt }: UseSummaryProps) {
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
      const data = await response.json();
      return data;
    },
    enabled: !!projectId,
    staleTime: Infinity,
  });

  // Update content when project data changes, ensuring HTML format
  useEffect(() => {
    if (project?.summary) {
      // If the content doesn't look like HTML (no tags), wrap it in paragraph tags
      const content = project.summary;
      const hasHtmlTags = /<[a-z][\s\S]*>/i.test(content);
      setContent(hasHtmlTags ? content : `<p>${content}</p>`);
    }
  }, [project]);

  // Save mutation with array queryKey format and HTML preservation
  const { mutateAsync: saveSummary } = useMutation({
    mutationFn: async (content: string) => {
      if (!projectId) {
        throw new Error('No project ID provided');
      }

      // Ensure the content is properly formatted as HTML
      const formattedContent = content.trim();

      const response = await fetch(`/api/projects/${projectId}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: formattedContent }),
      });

      if (!response.ok) {
        throw new Error('Failed to save summary');
      }

      return response.json();
    },
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: ['projects', projectId],
        });
      }
    },
  });

  // Generate insights mutation
  const { mutateAsync: generateInsightsMutation } = useMutation({
    mutationFn: async (noteContent: string) => {
      if (!projectId) {
        throw new Error('No project ID provided');
      }

      const response = await fetch(`/api/projects/${projectId}/generate-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          customPrompt: defaultPrompt || DEFAULT_PRIMARY_PROMPT,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate insights');
      }

      const data = await response.json();
      return data.insights;
    },
    onSuccess: (insights) => {
      setContent(insights);
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: ['projects', projectId],
        });
      }
    },
  });

  // Function to trigger insights generation
  const generateInsights = useCallback(async (currentNoteContent: string) => {
    try {
      setIsSaving(true);
      await generateInsightsMutation(currentNoteContent);
      toast({
        title: "Success",
        description: "Insights generated successfully",
      });
    } catch (error) {
      console.error('Failed to generate insights:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate insights",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [generateInsightsMutation, toast]);

  // Debounced save handler with HTML format preservation
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
    generateInsights,
  };
}