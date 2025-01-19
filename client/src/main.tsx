import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { VideoProvider } from "./contexts/VideoContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import App from './App';
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <VideoProvider>
          <App />
          <Toaster />
        </VideoProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);