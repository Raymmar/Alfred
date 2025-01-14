import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";
import { useSettings } from "@/hooks/use-settings";

export function ApiKeyAlert() {
  const { settings, isUpdating } = useSettings();

  // Hide alert if settings exist and has API key, or if we're currently updating
  if ((settings?.openaiApiKey) || isUpdating) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 mx-4 mb-4 z-50">
      <Alert variant="destructive" className="bg-white shadow-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>OpenAI API Key Required</AlertTitle>
        <AlertDescription className="flex items-center justify-between mt-2">
          <span>
            You need to add your OpenAI API key to use the application's features. 
            This key is required for audio transcription and chat functionality.
          </span>
          <Link href="/settings">
            <Button variant="outline" size="sm" className="ml-4 whitespace-nowrap">
              Add API Key
            </Button>
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  );
}