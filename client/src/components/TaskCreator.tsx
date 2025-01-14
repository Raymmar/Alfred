import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SelectTodo } from "@db/schema";

export interface TaskCreatorProps {
  className?: string;
  onTaskCreated?: () => void;
  projectId?: number;
}

// Helper function to check if text indicates no tasks
function isEmptyTaskResponse(text: string): boolean {
  const trimmedText = text.trim().toLowerCase();
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
    "tasks:", // Often precedes empty task lists
    "action items:", // Often precedes empty task lists
    "deliverables:" // Often precedes empty task lists
  ];

  // First check exact matches
  if (excludedPhrases.includes(trimmedText)) {
    console.log('Task creation validation: Exact match found:', trimmedText);
    return true;
  }

  // Then check for phrases within the text
  const hasPhrase = excludedPhrases.some(phrase => {
    const includes = trimmedText.includes(phrase);
    if (includes) {
      console.log('Task creation validation: Phrase match found:', phrase);
    }
    return includes;
  });

  return hasPhrase;
}

export function TaskCreator({ className, onTaskCreated, projectId }: TaskCreatorProps) {
  const [text, setText] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();

    if (!trimmedText || isCreating) return;

    // Validate before making the API call
    if (isEmptyTaskResponse(trimmedText)) {
      console.log('Task creation aborted: Empty task response detected:', trimmedText);
      setText("");
      return;
    }

    try {
      setIsCreating(true);

      // Log the request payload for debugging
      console.log('Creating task:', {
        text: trimmedText,
        projectId: projectId || null
      });

      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmedText,
          projectId: projectId || null
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to create task');
      }

      const result = await response.json();

      // Check if the task was actually created (server might have filtered it)
      if (!result.data) {
        console.log('Task creation skipped by server');
        setText("");
        return;
      }

      // Update the cache with the new todo
      queryClient.setQueryData<SelectTodo[]>(['/api/todos'], (old = []) => {
        return [...old, result.data];
      });

      setText("");
      toast({
        title: "Task created",
        description: projectId
          ? "Task added and associated with the current recording"
          : "Task added to your list",
      });

      onTaskCreated?.();

      // Invalidate relevant queries to ensure consistency
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/todos'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/kanban/columns'] })
      ]);
    } catch (error: any) {
      console.error('Error creating todo:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex gap-2">
        <Input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={projectId ? "Add a task for this recording..." : "Add a new task..."}
          className="flex-1 h-[52px] text-sm"
          disabled={isCreating}
        />
        <Button
          type="submit"
          disabled={!text.trim() || isCreating || isEmptyTaskResponse(text.trim())}
          size="icon"
          className="h-[52px] w-[52px]"
        >
          <PlusCircle className="h-5 w-5" />
        </Button>
      </div>
    </form>
  );
}