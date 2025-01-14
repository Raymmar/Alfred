import { useState } from "react";
import { useKanban } from "@/hooks/use-kanban";
import { Loader2, GripVertical, Layers, List } from "lucide-react";
import { Navigation } from "@/components/Navigation";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SelectTodo } from "@db/schema";
import { TaskList } from "@/components/TaskList";

export default function TasksPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="container mx-auto p-8 max-w-4xl bg-transparent">
        <div className="space-y-8">
          <h1 className="text-3xl font-bold">Tasks</h1>
          <TaskList className="w-full max-w-2xl" />
        </div>
      </div>
    </div>
  );
}