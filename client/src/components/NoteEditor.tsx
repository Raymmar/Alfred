import { useCallback, useState, useEffect } from "react";
import { useNotes } from "@/hooks/use-notes";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  X,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ListOrdered,
  List,
  CheckSquare,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SelectProject } from "@db/schema";
import { TranscriptViewer } from "@/components/TranscriptViewer";
import { cn } from "@/lib/utils";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CharacterCount from "@tiptap/extension-character-count";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TextStyle from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import { common, createLowlight } from "lowlight";
import { useSummary } from "@/hooks/use-summary";

const lowlight = createLowlight(common);

interface NoteEditorProps {
  projectId?: number;
  onClose?: (() => void) | null;
  isDefaultNote?: boolean;
  onContentChange?: (content: string) => void;
  currentTime?: number;
  onTranscriptSegmentSelect?: (start: number, end: number) => void;
}

// Sticky toolbar component
const EditorToolbar = ({ editor }: { editor: Editor | null }) => {
  if (!editor) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-2">
      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("heading", { level: 1 }) && "bg-accent",
          )}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("heading", { level: 2 }) && "bg-accent",
          )}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("heading", { level: 3 }) && "bg-accent",
          )}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          <Heading3 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 px-2", editor.isActive("bold") && "bg-accent")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 px-2", editor.isActive("italic") && "bg-accent")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("underline") && "bg-accent",
          )}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          U
        </Button>
      </div>

      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("bulletList") && "bg-accent",
          )}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("orderedList") && "bg-accent",
          )}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 px-2", editor.isActive("taskList") && "bg-accent")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <CheckSquare className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-r pr-2 mr-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("subscript") && "bg-accent",
          )}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        >
          <SubscriptIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("superscript") && "bg-accent",
          )}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        >
          <SuperscriptIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 px-2",
            editor.isActive("codeBlock") && "bg-accent",
          )}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export function NoteEditor({
  projectId,
  onClose,
  isDefaultNote,
  onContentChange,
  currentTime = 0,
  onTranscriptSegmentSelect,
}: NoteEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch project data first
  const { data: project } = useQuery<SelectProject>({
    queryKey: projectId ? ["projects", projectId] : null,
    queryFn: async ({ queryKey: [_, id] }) => {
      if (!id) return null;
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch project");
      }
      const data = await response.json();
      return data;
    },
    enabled: !!projectId,
    staleTime: 0, // Always refetch when tab changes
  });

  const { content, setContent, isLoading, isSaving } = useNotes({
    projectId,
    isDefaultNote,
    onContentChange,
  });

  const {
    content: summaryContent,
    setContent: setSummaryContent,
    isSaving: isSavingSummary,
  } = useSummary({
    projectId,
  });

  const baseExtensions = [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      bulletList: false,
      orderedList: false,
      codeBlock: false,
    }),
    Typography,
    Underline,
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
    }),
    TextStyle,
  ];

  const editor = useEditor({
    extensions: [
      ...baseExtensions,
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Subscript,
      Superscript,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CharacterCount.configure({
        limit: 10000,
      }),
      Placeholder.configure({
        placeholder: "Type to start writing...",
      }),
      BulletList,
      OrderedList,
    ],
    content: content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (isDefaultNote && html === "<p></p>") {
        setContent("");
      } else {
        setContent(html);
      }
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none",
      },
    },
  });

  const summaryEditor = useEditor({
    extensions: [
      ...baseExtensions,
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'rounded-md bg-muted p-4',
        }
      }),
      Placeholder.configure({
        placeholder: "Edit insights and summary...",
      }),
      BulletList.configure({
        HTMLAttributes: {
          class: 'list-disc pl-6 space-y-2',
        }
      }),
      OrderedList.configure({
        HTMLAttributes: {
          class: 'list-decimal pl-6 space-y-2',
        }
      }),
    ],
    content: summaryContent,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setSummaryContent(html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none [&_.ProseMirror_ul]:my-4 [&_.ProseMirror_ol]:my-4',
      },
    },
  });

  useEffect(() => {
    if (content && editor && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  useEffect(() => {
    if (
      summaryContent &&
      summaryEditor &&
      summaryEditor.getHTML() !== summaryContent
    ) {
      summaryEditor.commands.setContent(summaryContent);
    }
  }, [summaryContent, summaryEditor]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "flex flex-col min-h-0 h-full overflow-hidden mt-4",
        !isDefaultNote && "rounded-lg border",
      )}
    >
      {(isSaving || isSavingSummary) && !isDefaultNote && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-sm text-muted-foreground bg-background/80 px-2 py-1 rounded-md">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Tabs defaultValue="note" className="flex-1 flex flex-col min-h-0">
          {!isDefaultNote && (
            <TabsList className="flex-none border-b justify-start px-2 w-full">
              <div className="grid grid-cols-3 w-full">
                <TabsTrigger value="note" className="w-full">
                  Note
                </TabsTrigger>
                <TabsTrigger value="summary" className="w-full">
                  Insights
                </TabsTrigger>
                <TabsTrigger value="transcript" className="w-full">
                  Transcript
                </TabsTrigger>
              </div>
            </TabsList>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute top-3 right-3 h-9 w-9"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent
              value="note"
              className="h-full m-0 p-0 data-[state=active]:flex flex-col overflow-hidden"
            >
              <div className="flex-1 min-h-0 overflow-auto">
                <div className="h-full relative">
                  {editor && <EditorToolbar editor={editor} />}
                  <div className="h-full relative">
                    <div className="[&_.ProseMirror]:h-full [&_.ProseMirror]:p-4 [&_.ProseMirror]:text-lg [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:font-sans [&_.ProseMirror]:focus:outline-none [&_.ProseMirror]:min-h-[60vh] [&_.ProseMirror_ul]:leading-[120%] [&_.ProseMirror_ol]:leading-[120%] [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ol]:my-2">
                      <EditorContent editor={editor} />
                    </div>
                    {isDefaultNote &&
                      !localStorage.getItem("hideWelcomeOverlay") && (
                        <div className="absolute bottom-4 left-4 right-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-700 dark:text-blue-300 flex items-center justify-between">
                          <p>
                            I'm Alfred. Your new digital butler. I'm here to
                            enhance your notes and make you more productive.
                          </p>
                          <button
                            onClick={() => {
                              setContent(" ");
                              localStorage.setItem(
                                "hideWelcomeOverlay",
                                "true",
                              );
                            }}
                            className="ml-2 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </TabsContent>
            {!isDefaultNote && (
              <>
                <TabsContent
                  value="summary"
                  className="h-full m-0 p-0 data-[state=active]:flex flex-col overflow-hidden"
                >
                  <div className="flex-1 min-h-0 overflow-auto">
                    <div className="h-full relative">
                      {summaryEditor && (
                        <EditorToolbar editor={summaryEditor} />
                      )}
                      <div className="h-full [&_.ProseMirror]:h-full [&_.ProseMirror]:p-4 [&_.ProseMirror]:text-lg [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:font-sans [&_.ProseMirror]:focus:outline-none [&_.ProseMirror]:min-h-[200px] [&_.ProseMirror_ul]:leading-[120%] [&_.ProseMirror_ol]:leading-[120%] [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ol]:my-2">
                        <EditorContent
                          editor={summaryEditor}
                          className="prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent
                  value="transcript"
                  className="h-full m-0 p-0 data-[state=active]:flex flex-col overflow-hidden"
                >
                  <div className="flex-1 min-h-0">
                    {project?.transcription ? (
                      <TranscriptViewer
                        transcript={project.transcription}
                        currentTime={currentTime}
                        onSegmentClick={onTranscriptSegmentSelect}
                        className="h-full"
                      />
                    ) : (
                      <div className="p-4 text-muted-foreground">
                        No transcript available. Process a recording to generate
                        a transcript.
                      </div>
                    )}
                  </div>
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </div>
    </Card>
  );
}