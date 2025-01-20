import { useState, useRef, useEffect } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useMediaDevices } from "@/hooks/use-media-devices";
import { useProjects } from "@/hooks/use-projects";
import { useAudioProcessing } from "@/hooks/use-audio-processing";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { StopCircle, MoreVertical, Loader2, Pencil, Trash, ChevronUp, ChevronDown, GripVertical, Mic, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaPlayer } from "@/components/MediaPlayer";
import { useUser } from "@/hooks/use-user";
import { Input } from "@/components/ui/input";
import type { SelectProject } from "@db/schema";
import { TaskList } from "@/components/TaskList";
import { Navigation } from "@/components/Navigation";
import { NoteEditor } from "@/components/NoteEditor";
import { useLocation } from "wouter";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import WaveSurfer from 'wavesurfer.js';
import { formatTime } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatInterface } from "@/components/ChatInterface";
import { Progress } from "@/components/ui/progress";

type ProcessingStage = 'recording' | 'transcribing' | 'analyzing' | 'completed' | 'error';

interface ProjectWithTodos extends SelectProject {
  isConverting?: boolean;
}

export default function HomePage() {
  const { user } = useUser();
  const { toast } = useToast();
  const { settings } = useSettings();
  const [selectedProject, setSelectedProject] = useState<ProjectWithTodos | null>(null);
  const [projectToRename, setProjectToRename] = useState<ProjectWithTodos | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('recording'); //Added state for processing stage

  const recordingTimer = useRef<NodeJS.Timeout>();
  const { startRecording, stopRecording } = useRecorder();
  const { processAudio, isProcessing: isAudioProcessing } = useAudioProcessing();
  const defaultNoteRef = useRef<string>('');
  const {
    audioInputs,
    selectedAudioInput,
    selectAudioInput,
  } = useMediaDevices();
  const [isControlsExpanded, setIsControlsExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recordingWaveformRef = useRef<HTMLDivElement>(null);
  const recordingWavesurfer = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (recordingWaveformRef.current) {
      console.log('Recording waveform container status:', {
        hasRef: !!recordingWaveformRef.current,
        dimensions: recordingWaveformRef.current.getBoundingClientRect(),
        isVisible: window.getComputedStyle(recordingWaveformRef.current).display !== 'none'
      });
    }
  }, [isRecording]);

  useEffect(() => {
    if (isRecording) {
      setRecordingTime(0);
      recordingTimer.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      setRecordingTime(0);
    }
    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
    };
  }, [isRecording]);

  const { projects: projectsData, createProject, deleteProject, renameProject } = useProjects();
  const [convertingStates, setConvertingStates] = useState<Record<number, boolean>>({});

  const projects = projectsData
    .filter(p => {
      // Always filter out personal projects from recordings list
      return p.recordingUrl !== 'personal.none';
    })
    .map(p => ({
      ...p,
      isConverting: convertingStates[p.id] || false
    }));

  const setProjectConverting = (projectId: number, converting: boolean) => {
    setConvertingStates(prev => ({
      ...prev,
      [projectId]: converting
    }));
  };

  const handleStartRecording = async () => {
    try {
      if (!selectedAudioInput) {
        toast({
          title: "No microphone selected",
          description: "Please select a microphone before recording",
          variant: "destructive",
        });
        return;
      }

      console.log('Starting recording with waveform ref:', {
        hasRef: !!recordingWaveformRef.current,
        dimensions: recordingWaveformRef.current?.getBoundingClientRect()
      });

      if (!recordingWaveformRef.current) {
        toast({
          title: "Error",
          description: "Recording visualization not ready",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Preparing recording...",
        description: "Setting up your microphone...",
      });

      setIsRecording(true);
      await startRecording({
        audioDeviceId: selectedAudioInput,
        waveformRef: recordingWaveformRef.current,
      });

      toast({
        title: "Recording started",
        description: "Recording audio. Click stop when you're finished.",
      });
    } catch (error: any) {
      console.error('Recording error:', error);
      toast({
        title: "Recording Error",
        description: error.message || "Failed to start recording. Please check your microphone permissions.",
        variant: "destructive",
      });
      setIsRecording(false);
    }
  };

  const handleStopRecording = async () => {
    try {
      setIsSaving(true);
      setProcessingStage('recording'); // Update processing stage

      toast({
        title: "Saving recording...",
        description: "Please wait while we save your recording...",
        duration: 2000,
      });

      setIsRecording(false);
      const { filePath } = await stopRecording();
      const currentNoteContent = defaultNoteRef.current;

      const result = await createProject({
        title: `Recording ${new Date().toLocaleString()}`,
        recordingUrl: filePath,
        initialNoteContent: currentNoteContent,
      });

      if (!result.ok) {
        throw new Error(result.message);
      }

      toast({
        title: "Recording saved",
        description: "Starting audio processing...",
        duration: 2000,
      });

      setIsProcessing(true);
      setProcessingStage('transcribing'); // Update processing stage
      const processResult = await processAudio(result.data.id);

      if (!processResult.ok) {
        // Even if processing fails, the recording is saved
        setProcessingStage('error'); // Update processing stage
        toast({
          title: "Processing incomplete",
          description: `Recording saved but ${processResult.message}. You can try processing again later.`,
          variant: "destructive",
        });
      } else {
        setProcessingStage('completed'); // Update processing stage
        toast({
          title: "Processing complete",
          description: "Your recording has been fully processed!",
        });
      }

      defaultNoteRef.current = '';
    } catch (error: any) {
      setProcessingStage('error'); // Update processing stage
      toast({
        title: "Error",
        description: error.message || "Failed to save recording",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
      setIsProcessing(false);
    }
  };

  const getProcessingProgress = (stage: ProcessingStage): number => {
    switch (stage) {
      case 'recording':
        return 25;
      case 'transcribing':
        return 50;
      case 'analyzing':
        return 75;
      case 'completed':
        return 100;
      case 'error':
        return 100;
      default:
        return 0;
    }
  };

  const getProcessingStatusText = (stage: ProcessingStage): string => {
    switch (stage) {
      case 'recording':
        return 'Saving recording...';
      case 'transcribing':
        return 'Processing transcript...';
      case 'analyzing':
        return 'Extracting insights...';
      case 'completed':
        return 'Processing complete';
      case 'error':
        return 'Processing error';
      default:
        return 'Processing...';
    }
  };

  const handleNoteContentChange = (content: string) => {
    defaultNoteRef.current = content;
  };

  const handleRename = async (projectId: number, newTitle: string) => {
    try {
      const result = await renameProject({ projectId, title: newTitle });
      if (!result.ok) {
        throw new Error(result.message);
      }
      toast({
        title: "Recording renamed",
        description: "The recording has been successfully renamed",
      });
      setProjectToRename(null);
      setNewTitle("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to rename recording",
        variant: "destructive",
      });
    }
  };

  const handleHomeClick = () => {
    setSelectedProject(null);
    setLocation('/');
  };

  return (
    <div className="flex flex-col h-screen">
      <Navigation />
      <ResizablePanelGroup direction="horizontal" className="flex-1 h-[calc(100vh-4rem)]">
        <ResizablePanel defaultSize={25} minSize={20} maxSize={30}>
          <div className="h-full border-r bg-muted/50 overflow-auto">
            <div className="flex flex-col h-full">
              {!selectedProject && (
                <div className="p-4">
                  <Button
                    size="lg"
                    variant={isRecording ? "destructive" : "default"}
                    onClick={isRecording ? handleStopRecording : handleStartRecording}
                    className="w-full relative"
                    disabled={!selectedAudioInput || isProcessing || isSaving || isAudioProcessing}
                  >
                    {isProcessing || isSaving || isAudioProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {isSaving ? "Saving..." : isAudioProcessing ? "Processing Audio..." : "Processing..."}
                      </>
                    ) : isRecording ? (
                      <>
                        <StopCircle className="mr-2 h-4 w-4" />
                        Stop Recording ({String(Math.floor(recordingTime / 60)).padStart(2, '0')}:{String(recordingTime % 60).padStart(2, '0')})
                      </>
                    ) : (
                      <>
                        <Mic className="mr-2 h-4 w-4" />
                        {!selectedAudioInput ? "Select a microphone to start" : "Start Recording"}
                      </>
                    )}
                  </Button>

                  <div className="mt-4">
                    <Select
                      value={selectedAudioInput || undefined}
                      onValueChange={(value) => selectAudioInput(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioInputs.map((device) => (
                          <SelectItem key={device.deviceId} value={device.deviceId}>
                            {device.label || `Microphone ${device.deviceId}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {selectedProject && (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      onClick={handleHomeClick}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to Record
                    </Button>
                  </div>
                  <div className="space-y-2">
                  </div>
                </div>
              )}

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2">
                  <h3 className="text-sm font-medium">Recent Recordings</h3>
                </div>

                <ScrollArea className="flex-1">
                  <div className="space-y-3 px-4">
                    {projects.map((project) => {
                      const isProcessing = !project.transcription;
                      const isCurrentlyProcessing = isProcessing && project.id === selectedProject?.id;

                      return (
                        <Card
                          key={project.id}
                          className={cn(
                            "relative overflow-hidden cursor-pointer bg-background hover:bg-accent/20 transition-all duration-200",
                            selectedProject?.id === project.id && "bg-accent/20 shadow-md border-l-4 border-primary"
                          )}
                          onClick={(e) => {
                            if (e.defaultPrevented) return;
                            setSelectedProject(project);
                          }}
                        >
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <h3 className="font-medium leading-normal mb-1.5">{project.title.trim()}</h3>
                                <p className="text-sm text-muted-foreground leading-normal">
                                  {new Date(project.createdAt).toLocaleString()}
                                </p>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 p-0"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={(e) => {
                                      e.preventDefault();
                                      setProjectToRename(project);
                                      setNewTitle(project.title);
                                    }}
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onSelect={async (e) => {
                                      e.preventDefault();
                                      try {
                                        const result = await deleteProject(project.id);
                                        if (!result.ok) {
                                          throw new Error(result.message);
                                        }
                                        if (selectedProject?.id === project.id) {
                                          setSelectedProject(null);
                                        }
                                        toast({
                                          title: "Recording deleted",
                                          description: "The recording has been successfully deleted",
                                        });
                                      } catch (error: any) {
                                        toast({
                                          title: "Error",
                                          description: error.message || "Failed to delete recording",
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
                            </div>

                            {isCurrentlyProcessing && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Processing recording...
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle>
          <div className="h-4 w-4 flex items-center justify-center">
            <GripVertical className="h-4 w-4" />
          </div>
        </ResizableHandle>
        <ResizablePanel defaultSize={45} minSize={30} maxSize={60}>
          <div className="flex flex-col h-full min-h-0 bg-background">
            <div className="flex-1 overflow-auto">
              {selectedProject ? (
                <div>
                  <div className="sticky top-0 z-10 bg-background pt-4 px-4">
                    <div className="bg-background">
                      <MediaPlayer
                        src={selectedProject.recordingUrl ? `/recordings/${selectedProject.recordingUrl}` : ''}
                        className="w-full"
                        showControls={true}
                        autoPlay={false}
                        onClose={() => setSelectedProject(null)}
                        projectId={selectedProject.id}
                        onRename={(id) => {
                          setProjectToRename(selectedProject);
                          setNewTitle(selectedProject.title);
                        }}
                        onDelete={async (id) => {
                          try {
                            const result = await deleteProject(id);
                            if (!result.ok) {
                              throw new Error(result.message);
                            }
                            setSelectedProject(null);
                            toast({
                              title: "Recording deleted",
                              description: "The recording has been successfully deleted",
                            });
                          } catch (error: any) {
                            toast({
                              title: "Error",
                              description: error.message || "Failed to delete recording",
                              variant: "destructive",
                            });
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 px-4">
                    <NoteEditor
                      projectId={selectedProject.id}
                      onClose={() => setSelectedProject(null)}
                      currentTime={wavesurfer.current?.getCurrentTime() || 0}
                      onTranscriptSegmentSelect={(start, end) => {
                        if (wavesurfer.current) {
                          const duration = wavesurfer.current.getDuration();
                          const region = {
                            start,
                            end,
                            drag: true,
                            resize: true,
                          };
                          wavesurfer.current.regions.clear();
                          wavesurfer.current.regions.add(region);
                          wavesurfer.current.seekTo(start / duration);
                        }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  <div className="mb-4">
                    <div className="bg-background border rounded-md shadow-sm p-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-8 w-8 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shrink-0",
                              "transition-all duration-200 ease-in-out",
                              isRecording && "bg-destructive hover:bg-destructive/90"
                            )}
                            disabled={!selectedAudioInput}
                            onClick={isRecording ? handleStopRecording : handleStartRecording}
                          >
                            {isRecording ? (
                              <StopCircle className="h-4 w-4" />
                            ) : (
                              <Mic className="h-4 w-4" />
                            )}
                          </Button>
                          <div
                            ref={recordingWaveformRef}
                            className={cn(
                              "w-full transition-opacity duration-200 relative rounded-lg border border-input bg-muted/70",
                              (!isRecording || !selectedAudioInput) && "opacity-50",
                              isRecording && "opacity-100"
                            )}
                            style={{
                              height: '32px',
                              minWidth: '200px',
                              display: 'block',
                            }}
                          >
                            {!selectedAudioInput && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-sm text-muted-foreground">Select a microphone to start</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground px-2">
                          <span>{isRecording ? formatTime(recordingTime) : "0:00"}</span>
                          <span>{isRecording ? 'Recording...' : 'Not Recording'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <NoteEditor
                    isDefaultNote={true}
                    onClose={null}
                    onContentChange={handleNoteContentChange}
                  />
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle>
          <div className="h-4 w-4 flex items-center justify-center">
            <GripVertical className="h-4 w-4" />
          </div>
        </ResizableHandle>
        <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
          <div className="h-full border-l bg-muted/50">
            <Tabs defaultValue="tasks" className="h-full flex flex-col">
              <div className="px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="tasks">Tasks</TabsTrigger>
                  <TabsTrigger value="chat">Chat</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="tasks" className="flex-1 p-4 m-0 overflow-auto">
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">Tasks</h2>
                  <TaskList
                    maintainOrder
                    projectId={selectedProject?.id}
                    className="w-full"
                  />
                </div>
              </TabsContent>
              <TabsContent value="chat" className="flex-1 p-4 m-0 overflow-auto">
                <ChatInterface
                  projectId={selectedProject?.id}
                  className="h-full"
                />
              </TabsContent>
            </Tabs>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <Dialog
        open={!!projectToRename}
        onOpenChange={(open) => {
          if (!open) {
            setProjectToRename(null);
            setNewTitle("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Recording</DialogTitle>
            <DialogDescription>
              Enter a new name for your recording.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Input
                id="title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Enter new title"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectToRename(null)}>
              Cancel
            </Button>
            <Button onClick={() => projectToRename && handleRename(projectToRename.id, newTitle)}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {(isProcessing || isSaving || isAudioProcessing) && (
        <div className="absolute inset-x-0 bottom-0 p-4 bg-background/95 border-t shadow-lg">
          <div className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between text-sm mb-2">
              <span>{getProcessingStatusText(processingStage)}</span>
              <span>{getProcessingProgress(processingStage)}%</span>
            </div>
            <Progress value={getProcessingProgress(processingStage)} className="w-full" />
          </div>
        </div>
      )}
    </div>
  );
}