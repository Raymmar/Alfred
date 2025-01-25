import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash, MoreVertical, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SelectTodo } from "@db/schema";

interface TaskItemProps {
  todo: SelectTodo;
  onStatusChange: (completed: boolean) => Promise<void>;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
  className?: string;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  editingTaskId?: number | null;
  setEditingTaskId?: (id: number | null) => void;
  nextTaskId?: number | null;
  onTabToNext?: () => void;
}

export function TaskItem({
  todo,
  onStatusChange,
  onEdit,
  onDelete,
  className = "",
  isSelectionMode = false,
  isSelected = false,
  onSelectionChange,
  editingTaskId,
  setEditingTaskId,
  nextTaskId,
  onTabToNext,
}: TaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEdit = () => {
    // If another task is being edited, don't allow editing this one
    if (editingTaskId !== null && editingTaskId !== todo.id) {
      return;
    }
    setEditText(todo.text);
    setIsEditing(true);
    setEditingTaskId?.(todo.id);
  };

  const handleSave = async () => {
    try {
      if (editText.trim() && editText !== todo.text) {
        await onEdit(editText.trim());
        toast({
          title: "Success",
          description: "Task updated successfully",
        });
      }
      setIsEditing(false);
      setEditingTaskId?.(null);
      return true;
    } catch (error) {
      console.error('Error updating todo:', error);
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleDelete = async () => {
    try {
      await onDelete();
      setIsDeleting(false);
      toast({
        title: "Success",
        description: "Task deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting todo:', error);
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      data-task-id={todo.id}
      className={`p-2.5 bg-card hover:bg-accent/50 transition-colors ${className} ${isDragging ? 'z-50' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          className="touch-none flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="w-5 h-5 flex items-center justify-center">
          {isSelectionMode ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={checked => onSelectionChange?.(checked === true)}
              className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            />
          ) : (
            <button
              onClick={async () => {
                try {
                  const newState = !todo.completed;
                  const button = document.getElementById(`todo-button-${todo.id}`);
                  if (button) {
                    button.classList.remove('animate-complete', 'animate-pending');
                    // Force a reflow to restart animation
                    void button.offsetWidth;
                    button.classList.add(newState ? 'animate-complete' : 'animate-pending');
                  }
                  // Delay the state change to allow animation to be visible
                  setTimeout(async () => {
                    await onStatusChange(newState);
                  }, 300); // 300ms delay matches our animation duration
                } catch (error) {
                  console.error('Error updating todo:', error);
                  toast({
                    title: "Error",
                    description: "Failed to update task status",
                    variant: "destructive",
                  });
                }
              }}
              id={`todo-button-${todo.id}`}
              className={`w-4 h-4 rounded-full border-2 cursor-pointer
                ${todo.completed
                  ? "border-green-500 bg-green-500"
                  : "border-red-400 hover:border-red-500"
                }
                relative overflow-hidden
              `}
            >
              <div
                className={`
                  absolute inset-0 transition-opacity duration-300
                  ${todo.completed ? 'opacity-100' : 'opacity-0'}
                `}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              </div>
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center gap-2">
          {isEditing ? (
            <div className="flex-1 flex gap-2">
              <textarea
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                  // Adjust height to fit content
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                className="flex-1 min-h-[40px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-hidden"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSave();
                  } else if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditText(todo.text);
                    setEditingTaskId?.(null);
                  } else if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    handleSave().then(() => {
                      onTabToNext?.();
                    });
                  }
                }}
                onBlur={async () => {
                  if (editText.trim() && editText !== todo.text) {
                    await handleSave();
                  } else {
                    setIsEditing(false);
                    setEditText(todo.text);
                    setEditingTaskId?.(null);
                  }
                }}
                autoFocus
              />
            </div>
          ) : isDeleting ? (
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm text-muted-foreground flex-1">Delete this task?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
              >
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsDeleting(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <span
                className={`text-sm flex-1 cursor-default select-text ${
                  todo.completed ? "line-through text-muted-foreground" : ""
                }`}
                onDoubleClick={handleEdit}
              >
                {todo.text}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={handleEdit}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600"
                    onSelect={() => setIsDeleting(true)}
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}