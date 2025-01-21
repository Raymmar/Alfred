import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { useKanban } from "@/hooks/use-kanban";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { SelectTodo, SelectKanbanColumn } from "@db/schema";

interface KanbanColumnProps {
  column: SelectKanbanColumn;
  todos: SelectTodo[];
  onAddTodo?: () => void;
}

function KanbanColumn({ column, todos, onAddTodo }: KanbanColumnProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { updateTodo } = useKanban();

  return (
    <Card className="w-80 shrink-0">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">{column.title}</h3>
          {onAddTodo && (
            <Button variant="ghost" size="sm" onClick={onAddTodo}>
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className="flex items-center gap-2 bg-background border rounded p-2"
            >
              <Checkbox
                id={`todo-${todo.id}`}
                checked={todo.completed}
                onCheckedChange={async (checked) => {
                  try {
                    await updateTodo({ 
                      todoId: todo.id, 
                      completed: checked === true
                    });
                  } catch (error) {
                    console.error('Error updating todo:', error);
                    toast({
                      title: "Error",
                      description: "Failed to update task status",
                      variant: "destructive",
                    });
                  }
                }}
              />
              <label
                htmlFor={`todo-${todo.id}`}
                className={`text-sm flex-1 ${
                  todo.completed ? "line-through text-muted-foreground" : ""
                }`}
              >
                {todo.text}
              </label>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export interface KanbanViewProps {
  columns: SelectKanbanColumn[];
  todos: SelectTodo[];
}

export function KanbanView({ columns, todos }: KanbanViewProps) {
  const { updateTodo } = useKanban();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      // Handle movement between columns
      const activeColumnId = active.data.current?.columnId;
      const overColumnId = over.data.current?.columnId;
      
      if (activeColumnId !== overColumnId) {
        const todoId = parseInt(active.id as string);
        try {
          await updateTodo({ 
            todoId, 
            columnId: overColumnId 
          });
        } catch (error) {
          console.error('Error moving todo:', error);
        }
      }
    }
    
    setActiveId(null);
  };

  return (
    <div className="p-8">
      <div className="flex gap-4 overflow-x-auto pb-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              todos={todos.filter((todo) => todo.columnId === column.id)}
            />
          ))}
          <DragOverlay>
            {activeId ? (
              <div className="bg-background border rounded p-2">
                {todos.find((todo) => todo.id === parseInt(activeId))?.text}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        
        <Card className="w-80 shrink-0">
          <CardContent className="p-4">
            <Button variant="ghost" className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Column
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
