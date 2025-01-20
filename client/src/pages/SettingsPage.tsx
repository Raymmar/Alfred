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
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SettingsPage() {
  const { toast } = useToast();
  const { settings, updateSettings, isUpdating } = useSettings();
  const {
    audioInputs,
    selectedAudioInput,
    selectAudioInput,
  } = useMediaDevices();

  // Form state management
  const [formData, setFormData] = useState({
    openaiApiKey: settings?.openaiApiKey || "",
    defaultPrompt: settings?.defaultPrompt || DEFAULT_PRIMARY_PROMPT,
    todoPrompt: settings?.todoPrompt || DEFAULT_TODO_PROMPT,
    systemPrompt: settings?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
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
                      placeholder={formData.defaultPrompt || DEFAULT_PRIMARY_PROMPT}
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
                      value={formData.todoPrompt || DEFAULT_TODO_PROMPT}
                      onChange={handleInputChange}
                      className="min-h-[40vh] resize-y"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chat System Prompt */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Chat System Prompt</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="systemPrompt">
                      Chat Assistant Prompt
                    </label>
                    <p className="text-sm text-muted-foreground mb-2">
                      This prompt defines how the chat assistant behaves when interacting with you.
                      It guides the personality and capabilities of the AI when responding to your messages.
                    </p>
                    <Textarea
                      id="systemPrompt"
                      name="systemPrompt"
                      placeholder={formData.systemPrompt || DEFAULT_SYSTEM_PROMPT}
                      value={formData.systemPrompt}
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