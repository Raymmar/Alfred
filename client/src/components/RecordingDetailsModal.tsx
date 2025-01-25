import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MediaPlayer } from "@/components/MediaPlayer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TaskList } from "@/components/TaskList";
import { useToast } from "@/hooks/use-toast";
import type { SelectProject, SelectTodo } from "@db/schema";

interface ProjectWithTodos extends SelectProject {
  todos?: SelectTodo[];
}

interface Props {
  project: ProjectWithTodos;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'summary' | 'transcript' | 'tasks';
  onDelete?: () => Promise<void>;
}

export function RecordingDetailsModal({ project, open, onOpenChange, defaultTab = 'summary', onDelete }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    if (open) {
      setActiveTab('summary');
    }
  }, [open]);

  // Subscribe to project updates with proper type handling and array query key
  const { data: projectData } = useQuery<ProjectWithTodos>({
    queryKey: ['projects', project.id],
    enabled: open, // Only fetch when modal is open
    initialData: project,
    staleTime: 0 // Always refetch when modal opens
  });

  const currentProject = projectData || project;

  // Handle project deletion with enhanced cache invalidation
  const handleDelete = async () => {
    try {
      if (onDelete) {
        // Optimistically remove project from cache
        const previousProjects = queryClient.getQueryData<ProjectWithTodos[]>(['projects']);
        const previousTodos = queryClient.getQueryData(['todos']);

        // Optimistically update projects cache
        queryClient.setQueryData<ProjectWithTodos[]>(['projects'], (old = []) => 
          old.filter(p => p.id !== project.id)
        );

        // Optimistically update todos cache by filtering out todos from this project
        queryClient.setQueryData<SelectTodo[]>(['todos'], (old = []) => 
          old.filter(todo => todo.projectId !== project.id)
        );

        try {
          await onDelete();

          // Force immediate cache updates
          queryClient.removeQueries({ queryKey: ['projects', project.id] });

          // After successful deletion, invalidate all related queries
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['projects'] }),
            queryClient.invalidateQueries({ queryKey: ['todos'] }),
            queryClient.invalidateQueries({ queryKey: ['kanban'] })
          ]);

          // Force refetch todos to ensure they're up to date
          await queryClient.refetchQueries({ queryKey: ['todos'] });

          onOpenChange(false);
        } catch (error) {
          // Revert optimistic updates on error
          if (previousProjects) {
            queryClient.setQueryData(['projects'], previousProjects);
          }
          if (previousTodos) {
            queryClient.setQueryData(['todos'], previousTodos);
          }
          throw error;
        }
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      toast({
        title: "Error",
        description: "Failed to delete project",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[625px]">
        <DialogHeader>
          <DialogTitle>{currentProject.title}</DialogTitle>
          <DialogDescription>
            Recorded on {new Date(currentProject.createdAt).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        <div className="aspect-video mb-4">
          <MediaPlayer 
            src={currentProject.recordingUrl ? `/recordings/${currentProject.recordingUrl}` : ''}
            className="w-full h-full"
            showControls={true}
            autoPlay={false}
          />
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="summary">Insights</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <ScrollArea className="h-[400px] rounded-md border p-4">
              {currentProject.summary}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="transcript" className="mt-4">
            <ScrollArea className="h-[400px] rounded-md border p-4">
              {currentProject.transcription}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="tasks" className="mt-4">
            <ScrollArea className="h-[400px] rounded-md border bg-transparent">
              <div className="p-4">
                <TaskList 
                  maintainOrder 
                  className="w-full"
                  projectId={currentProject.id}
                  onRecordingClick={(projectId) => {
                    if (projectId !== currentProject.id) {
                      const newProject = queryClient.getQueryData<ProjectWithTodos[]>(['projects'])?.find(p => p.id === projectId);
                      if (newProject) {
                        onOpenChange(false);
                        setTimeout(() => {
                          onOpenChange(true);
                          queryClient.setQueryData(['projects', projectId], newProject);
                        }, 100);
                      }
                    }
                  }}
                />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}