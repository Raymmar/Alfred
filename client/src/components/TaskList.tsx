import { useState } from "react";
import { useKanban } from "@/hooks/use-kanban";
import { TaskCreator } from "@/components/TaskCreator";
import { TaskItem } from "@/components/TaskItem";
import { Loader2, GripVertical, Check, X, Copy, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTaskOperations } from "@/hooks/use-task-operations";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { SelectTodo } from "@db/schema";

export interface TaskListProps {
  className?: string;
  maintainOrder?: boolean;
  projectId?: number;
  onRecordingClick?: (projectId: number) => void;
}

export function TaskList({ className = "", maintainOrder = false, projectId, onRecordingClick }: TaskListProps) {
  const { todos = [], isLoading, error } = useKanban();
  const { handleStatusChange, handleEdit, handleDelete, handleBatchDelete, handleBatchStatusChange, getTasksAsMarkdown } = useTaskOperations();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "pending">("pending");
  const [selectedTodos, setSelectedTodos] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);

  // Apply project and status filters
  const filteredTodos = todos
    .filter(todo => {
      // If a specific project is requested, filter for that project
      if (projectId !== undefined) {
        return todo.projectId === projectId;
      }
      // For the main task list (no specific project), show all tasks
      return true;
    })
    .filter(todo => {
      // Then apply status filter
      return statusFilter === "all" ||
        (statusFilter === "completed" && todo.completed) ||
        (statusFilter === "pending" && !todo.completed);
    });

  const handleFilterChange = (value: string) => {
    if (value === "select_all") {
      // Enable selection mode and select all visible todos
      setIsSelectionMode(true);
      const todosToSelect = new Set(filteredTodos.map(todo => todo.id));
      setSelectedTodos(todosToSelect);
      return;
    }

    // Update filter and clear selections when changing filters
    setStatusFilter(value as "all" | "completed" | "pending");
    setSelectedTodos(new Set());
    setIsSelectionMode(false);
  };

  const [activeId, setActiveId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sort todos based on their status and timestamps
  const sortedTodos = [...filteredTodos].sort((a, b) => {
    // If we're looking at completed tasks, sort by completion time
    if (a.completed && b.completed) {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }

    // If only one is completed, keep completed items after pending ones
    if (a.completed) return 1;
    if (b.completed) return -1;

    // For pending tasks, use manual order if set
    if (typeof a.order === 'number' && typeof b.order === 'number') {
      return a.order - b.order;
    }
    // If only one has an order, prioritize the one with order
    if (typeof a.order === 'number') return -1;
    if (typeof b.order === 'number') return 1;
    // If neither has an order, sort by creation date
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Handle drag end with updated query key format
  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const oldIndex = sortedTodos.findIndex(todo => todo.id === active.id);
      const newIndex = sortedTodos.findIndex(todo => todo.id === over.id);

      try {
        const reorderedTodos = arrayMove(sortedTodos, oldIndex, newIndex);

        // Cancel any outgoing refetches
        await queryClient.cancelQueries({ queryKey: ['todos'] });

        // Optimistically update todos cache with array query key
        queryClient.setQueryData(['todos'], (old: SelectTodo[] = []) => {
          if (!old) return old;
          return old.map(todo => {
            const reorderedTodo = reorderedTodos.find(t => t.id === todo.id);
            if (reorderedTodo) {
              return {
                ...todo,
                order: reorderedTodos.indexOf(reorderedTodo)
              };
            }
            return todo;
          });
        });

        // Update orders in the background
        const updates = reorderedTodos.map((todo, index) =>
          handleEdit(todo.id, todo.text, {
            order: index,
            completed: todo.completed,
            projectId: todo.projectId
          })
        );

        await Promise.all(updates);
      } catch (error) {
        console.error('Error reordering todos:', error);
        queryClient.invalidateQueries({ queryKey: ['todos'] });
        toast({
          title: "Error",
          description: "Failed to reorder tasks",
          variant: "destructive",
        });
      }
    }
  };

  const renderTaskItem = (todo: SelectTodo, index: number) => {
    const nextTodo = sortedTodos[index + 1];
    return (
      <TaskItem
        key={todo.id}
        todo={todo}
        onStatusChange={(completed) => handleStatusChange(todo.id, completed)}
        onEdit={(text) => handleEdit(todo.id, text)}
        onDelete={() => handleDelete(todo.id)}
        isSelectionMode={isSelectionMode}
        isSelected={selectedTodos.has(todo.id)}
        editingTaskId={editingTaskId}
        setEditingTaskId={setEditingTaskId}
        nextTaskId={nextTodo?.id ?? null}
        onTabToNext={() => {
          if (nextTodo) {
            setEditingTaskId(nextTodo.id);
            // Force the task into edit mode
            const nextTaskElement = document.querySelector(`[data-task-id="${nextTodo.id}"]`);
            if (nextTaskElement) {
              const input = nextTaskElement.querySelector('input');
              if (input) {
                setTimeout(() => {
                  input.focus();
                  input.select();
                }, 0);
              }
            }
          }
        }}
        onSelectionChange={(selected) => {
          const newSelectedTodos = new Set(selectedTodos);
          if (selected) {
            newSelectedTodos.add(todo.id);
          } else {
            newSelectedTodos.delete(todo.id);
          }
          setSelectedTodos(newSelectedTodos);
        }}
        onRecordingClick={onRecordingClick}
      />
    );
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="sticky top-0 backdrop-blur supports-[backdrop-filter]:bg-background/30 z-10 pb-3 space-y-3">
        <TaskCreator projectId={projectId} />
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={isSelectionMode}
              onCheckedChange={(checked) => {
                setIsSelectionMode(checked === true);
                if (!checked) {
                  setSelectedTodos(new Set());
                }
              }}
              className="cursor-pointer"
            />
            <div className="border-l h-4 mx-3" />
            <div>
              <Select
                value={statusFilter}
                onValueChange={handleFilterChange}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter tasks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="all">View All</SelectItem>
                  <SelectItem value="select_all">Select All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isSelectionMode && selectedTodos.size > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    Bulk Actions ({selectedTodos.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(statusFilter === "pending" || statusFilter === "all") && (
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          const pendingTodos = Array.from(selectedTodos).filter(
                            id => todos.find(t => t.id === id)?.completed === false
                          );
                          if (pendingTodos.length === 0) {
                            toast({
                              title: "Info",
                              description: "No pending tasks selected",
                            });
                            return;
                          }
                          await handleBatchStatusChange(pendingTodos, true);
                          setSelectedTodos(new Set());
                          setIsSelectionMode(false);
                          toast({
                            title: "Success",
                            description: `${pendingTodos.length} tasks marked as completed`,
                          });
                        } catch (error) {
                          toast({
                            title: "Error",
                            description: "Failed to update tasks",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Mark as Completed
                    </DropdownMenuItem>
                  )}
                  {(statusFilter === "completed" || statusFilter === "all") && (
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          const completedTodos = Array.from(selectedTodos).filter(
                            id => todos.find(t => t.id === id)?.completed === true
                          );
                          if (completedTodos.length === 0) {
                            toast({
                              title: "Info",
                              description: "No completed tasks selected",
                            });
                            return;
                          }
                          await handleBatchStatusChange(completedTodos, false);
                          setSelectedTodos(new Set());
                          setIsSelectionMode(false);
                          toast({
                            title: "Success",
                            description: `${completedTodos.length} tasks marked as pending`,
                          });
                        } catch (error) {
                          toast({
                            title: "Error",
                            description: "Failed to update tasks",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Mark as Pending
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      try {
                        const selectedTasksData = todos.filter(todo => selectedTodos.has(todo.id));
                        if (selectedTasksData.length === 0) {
                          toast({
                            title: "Info",
                            description: "No tasks selected to copy",
                          });
                          return;
                        }
                        const markdownText = getTasksAsMarkdown(selectedTasksData);
                        navigator.clipboard.writeText(markdownText)
                          .then(() => {
                            toast({
                              title: "Success",
                              description: `${selectedTasksData.length} tasks copied as markdown`,
                            });
                          })
                          .catch((error) => {
                            console.error('Error copying to clipboard:', error);
                            toast({
                              title: "Error",
                              description: "Failed to copy tasks to clipboard",
                              variant: "destructive",
                            });
                          });
                      } catch (error) {
                        console.error('Error preparing markdown:', error);
                        toast({
                          title: "Error",
                          description: "Failed to prepare tasks for copying",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy as Markdown
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={async () => {
                      try {
                        await handleBatchDelete(Array.from(selectedTodos));
                        setSelectedTodos(new Set());
                        setIsSelectionMode(false);
                        toast({
                          title: "Success",
                          description: `${selectedTodos.size} tasks deleted successfully`,
                        });
                      } catch (error) {
                        toast({
                          title: "Error",
                          description: "Failed to delete tasks",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-32 text-destructive">
          <p>Failed to load tasks. Please try again.</p>
        </div>
      ) : sortedTodos.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <p>No tasks found.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          onDragStart={(event) => setActiveId(Number(event.active.id))}
        >
          <SortableContext
            items={sortedTodos.map(todo => todo.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {sortedTodos.map((todo, index) => renderTaskItem(todo, index))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeId ? renderTaskItem(sortedTodos.find(todo => todo.id === activeId)!, 0) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}