import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjects } from "@/hooks/use-projects";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number | string | Date;
}

export interface ChatInterfaceProps {
  className?: string;
  projectId?: number;
}

export function ChatInterface({ className, projectId }: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { projects } = useProjects();
  const queryClient = useQueryClient();

  const selectedProject = projectId 
    ? projects.find(p => p.id === projectId)
    : null;

  const messagesQueryKey = projectId ? ['messages', projectId] : ['messages'];
  const chatEndpoint = projectId ? `/api/projects/${projectId}/chat` : '/api/chat';

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: messagesQueryKey,
    enabled: true,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const currentInput = input.trim();
    setInput("");
    const timestamp = new Date().toISOString();

    try {
      setIsLoading(true);

      const newUserMessage = {
        role: "user" as const,
        content: currentInput,
        timestamp
      };

      queryClient.setQueryData<Message[]>(messagesQueryKey, (old = []) => [
        ...old,
        newUserMessage
      ]);

      const response = await fetch(chatEndpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: currentInput,
          context: selectedProject 
            ? {
                transcription: selectedProject.transcription,
                summary: selectedProject.summary,
              }
            : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();

      if (data.messages?.length === 2) {
        queryClient.setQueryData<Message[]>(messagesQueryKey, (old = []) => {
          const filtered = old.filter(msg => msg.timestamp !== timestamp);
          return [...filtered, ...data.messages];
        });
      }

    } catch (error: any) {
      console.error("Chat error:", error);
      queryClient.setQueryData<Message[]>(messagesQueryKey, (old = []) => 
        old?.filter(msg => msg.timestamp !== timestamp) || []
      );

      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
      setInput(currentInput);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-2">
        <div className="space-y-4">
          {messages.map((message, i) => (
            <div
              key={`${message.role}-${message.timestamp}-${i}`}
              className={cn(
                "flex w-max max-w-[80%] rounded-lg px-3 py-2 text-sm",
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              <div 
                className={cn(
                  "prose prose-sm dark:prose-invert max-w-none break-words",
                  message.role === "user" 
                    ? "prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-code:text-primary-foreground"
                    : "prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:text-muted-foreground"
                )}
                dangerouslySetInnerHTML={{ __html: message.content }}
              />
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground">
              {selectedProject 
                ? "Ask me anything about this recording..."
                : "Ask me anything..."}
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      <form onSubmit={handleSubmit} className="p-2 flex gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1"
          disabled={isLoading}
        />
        <Button 
          type="submit" 
          size="icon"
          disabled={!input.trim() || isLoading}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}