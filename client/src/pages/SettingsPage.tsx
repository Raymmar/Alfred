import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMediaDevices } from "@/hooks/use-media-devices";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useSettings } from "@/hooks/use-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_PRIMARY_PROMPT = `"System/Role Instructions:
You are a world-class personal assistant and meeting note-taker. You receive two inputs:

1 - A transcript of a recorded meeting.
2 - A user note containing partial or fragmented thoughts.

Your job is to blend key, relevant details from the transcript into the user’s note—only where those details provide critical context, clarify incomplete thoughts, or add essential information. The user’s note is the guiding structure for your final output.

You are simply a second pair of ears that captures any vital information the user might have missed or only partially wrote down.

Follow these rules:

If there is no note from the user then highlight the most important elements of the transcript as succinct bullets. 

Each individual thought/response should start a new paragraph

Do not summarize the entire transcript, only enhance the user’s note with the related and necessary context.

Leverage the user’s note as your summary outline. Keep the same headings or bullet point structure.

Fill in the gaps. Where the user’s note is incomplete, use the transcript to finish the thought. Keep your supplement to a sentence max.

Be very concise!! Do not add disclaimers or mention your role as an AI model.

Keep each point to one or two sentences at most.

Only include the most important snippets directly tied to the user’s note. Avoid general summaries of unrelated transcript sections.

No extra fluff. Your response should read like a complete, clarified version of the user’s note, rather than a separate summary.

Short, relevant expansions. If a section of the user’s note needs only one or two supporting details from the transcript, add them succinctly.

Focus on next steps and key points. If the transcript indicates any tasks, dates, or decisions relevant to the note, include them. Otherwise, leave them out.

Incorporate exact phrasing from the transcript if it is needed to clarify context. Minimal quotes where necessary; paraphrase where possible.

Output Formatting Requirements

Format the final “enhanced” user note using bullets, headings, and paragraphs that align with how the user’s original note.
Default to bullets if the user’s note is not structured.
Every new thought or item should start a new paragraph.
Do not mention the note. You are simply re-writing it as if it were theirs. 
`;

const DEFAULT_TODO_PROMPT = `System/Role Instructions
You are a world-class personal assistant responsible for identifying and listing clearly defined tasks and deliverables that emerge from a meeting transcript. You receive two inputs:

1 - The transcript of a recorded meeting.
2 - The user note, which provides context and highlights.
The users note should be your core focus for organizing and curating tasks and deliverables. Your response should mimic it as closely as possible. Especially as it relates to formatting and layout. 

Your job is to extract only the tasks and deliverables that are:

- Directly actionable
- Clearly assigned to a person or team (or can easily be inferred)
- Strongly implied by the conversation and/or user note (no speculative tasks)
- Specific enough that someone reading them would know exactly what to do next

Rules & Output Requirements

- List format only: Each task must be on a new line with no bullets, numbers, or extra punctuation.
- Clear assignment: Where possible, indicate who is responsible and what they need to deliver.
- Concise: Keep the task description short. Omit any non-essential fluff or speculative tasks.
- Original wording: Use key phrases from the transcript or user note only if needed to clarify. Otherwise, paraphrase.
- No disclaimers: Do not mention AI or your role.
- No extra commentary: Do not include any text beyond the tasks themselves.
- Empty response: If no actionable tasks are found, return an empty response. Never include text indicating there are no tasks.

Purpose
The purpose is to produce a simple, easily readable list of tasks or deliverables that any participant can quickly act on. If no tasks are found, return an empty response rather than stating there are no tasks.`;

export default function SettingsPage() {
  const { toast } = useToast();
  const { settings, updateSettings, isUpdating } = useSettings();
  const {
    audioInputs,
    videoInputs,
    selectedAudioInput,
    selectedVideoInput,
    selectAudioInput,
    selectVideoInput,
  } = useMediaDevices();

  // Form state management
  const [formData, setFormData] = useState({
    openaiApiKey: settings?.openaiApiKey || "",
    defaultPrompt: settings?.defaultPrompt || DEFAULT_PRIMARY_PROMPT,
    todoPrompt: settings?.todoPrompt || DEFAULT_TODO_PROMPT,
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (formData.openaiApiKey && !formData.openaiApiKey.startsWith("sk-")) {
        toast({
          title: "Invalid API Key",
          description: "OpenAI API keys should start with 'sk-'",
          variant: "destructive",
        });
        return;
      }

      const result = await updateSettings(formData);
      if (!result.ok) {
        throw new Error(result.message);
      }
      toast({
        title: "Success",
        description: "Settings saved successfully",
      });
    } catch (error) {
      console.error("Settings update error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save settings",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
          {/* Device Settings */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Recording Settings</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Microphone</label>
                    <Select
                      value={selectedAudioInput || undefined}
                      onValueChange={selectAudioInput}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioInputs.map((device) => (
                          <SelectItem key={device.deviceId} value={device.deviceId}>
                            {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* OpenAI Settings */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">OpenAI Settings</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="openaiApiKey">
                      API Key
                    </label>
                    <Input
                      id="openaiApiKey"
                      type="password"
                      name="openaiApiKey"
                      placeholder="sk-..."
                      value={formData.openaiApiKey}
                      onChange={handleInputChange}
                      autoComplete="off"
                    />
                    <p className="text-sm text-muted-foreground">
                      Your OpenAI API key will be used for both Whisper (audio
                      transcription) and GPT (summary generation). Get your API key
                      from{" "}
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-bold"
                      >
                        platform.openai.com/api-keys
                      </a>
                      . The key is stored securely and never shared.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Primary Processing Prompt */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Summary Processing</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="defaultPrompt">
                      Processing Prompt
                    </label>
                    <p className="text-sm text-muted-foreground mb-2">
                      This prompt will be used to generate the main summary of your
                      recordings.
                    </p>
                    <Textarea
                      id="defaultPrompt"
                      name="defaultPrompt"
                      placeholder={DEFAULT_PRIMARY_PROMPT}
                      value={formData.defaultPrompt}
                      onChange={handleInputChange}
                      className="min-h-[40vh] resize-y"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Task Extraction Prompt */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Task Processing</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="todoPrompt">
                      Processing Prompt
                    </label>
                    <p className="text-sm text-muted-foreground mb-2">
                      This prompt will be used specifically for extracting tasks and
                      action items from your recordings.
                    </p>
                    <Textarea
                      id="todoPrompt"
                      name="todoPrompt"
                      placeholder={DEFAULT_TODO_PROMPT}
                      value={formData.todoPrompt}
                      onChange={handleInputChange}
                      className="min-h-[40vh] resize-y"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" disabled={isUpdating}>
            {isUpdating ? "Saving..." : "Save Settings"}
          </Button>
        </form>
      </main>
    </div>
  );
}