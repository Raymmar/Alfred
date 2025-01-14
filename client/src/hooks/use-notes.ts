import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { SelectNote } from '@db/schema';
import { queryClient } from '@/lib/queryClient';

const SAVE_DELAY = 1000; // 1 second debounce

interface UseNotesProps {
  projectId?: number;
  isDefaultNote?: boolean;
  onContentChange?: (content: string) => void;
}

export function useNotes({ projectId, isDefaultNote, onContentChange }: UseNotesProps) {
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeout = useRef<NodeJS.Timeout>();

  // Fetch note data with proper array queryKey typing
  const { data: note } = useQuery<SelectNote | undefined>({
    queryKey: projectId && !isDefaultNote ? ['notes', projectId] : ['notes'],
    queryFn: async ({ queryKey }) => {
      if (!projectId || isDefaultNote || queryKey.length < 2) {
        return undefined;
      }
      const response = await fetch(`/api/projects/${projectId}/note`);
      if (!response.ok) {
        throw new Error('Failed to fetch note');
      }
      return response.json();
    },
    enabled: !!projectId && !isDefaultNote,
  });

  // Update content when note data changes
  useEffect(() => {
    if (note?.content) {
      setContent(note.content);
    } else if (isDefaultNote) {
      // If it's a default note and no content is loaded, start with empty content
      setContent('');
    }
  }, [note, isDefaultNote]);

  // Save mutation with proper query key array format
  const { mutateAsync: saveNote } = useMutation({
    mutationFn: async (content: string) => {
      if (!projectId || isDefaultNote) {
        // For default note, just update local state
        return { content } as SelectNote;
      }

      const response = await fetch(`/api/projects/${projectId}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error('Failed to save note');
      }

      return response.json() as Promise<SelectNote>;
    },
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: ['notes', projectId],
        });
      }
    },
  });

  // Debounced save handler
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);

    // Notify parent component about content change if it's a default note
    if (isDefaultNote && onContentChange) {
      onContentChange(newContent);
    }

    if (!isDefaultNote) {
      setIsSaving(true);
    }

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    saveTimeout.current = setTimeout(async () => {
      try {
        await saveNote(newContent);
      } catch (error) {
        console.error('Failed to save note:', error);
        toast({
          title: "Error",
          description: "Failed to save note. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    }, SAVE_DELAY);
  }, [projectId, saveNote, toast, isDefaultNote, onContentChange]);

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
    isLoading: false,
    isSaving,
  };
}