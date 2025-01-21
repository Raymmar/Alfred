import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import {
  projects,
  users,
  todos,
  notes,
  chats,
  kanbanColumns
} from "@db/schema";
import { desc, eq, and, asc, or } from "drizzle-orm";
import formidable from "formidable";
import { spawn } from "child_process";
import express from "express";
import path, { join } from "path";
import fs, { existsSync } from "fs";
import { ensureStorageDirectory, getRecordingsPath, cleanupOrphanedRecordings, getAudioContentType, isValidAudioFile } from "./storage";
import { createAIServices, createChatService } from "./lib/ai";
import { RequestHandler } from "express-serve-static-core";
import OpenAI from "openai";

function isEmptyTaskResponse(text: string): boolean {
  const trimmedText = text.trim().toLowerCase();
  const excludedPhrases = [
    "no task",
    "no tasks",
    "no deliverable",
    "no deliverables",
    "identified",
    "no tasks identified",
    "no deliverables identified",
    "no tasks or deliverables",
    "no tasks or deliverables identified",
    "no specific tasks",
    "no specific deliverables",
    "not found",
    "none found",
    "none identified",
    "could not identify",
    "unable to identify",
    "no action items",
    "no actions",
    "tasks:", // Often precedes empty task lists
    "action items:", // Often precedes empty task lists
    "deliverables:", // Often precedes empty task lists
    "n/a",
    "none",
    "not applicable",
    "no specific tasks mentioned",
    "no clear tasks",
    "not specified"
  ];

  // First check exact matches for common AI responses
  if (excludedPhrases.includes(trimmedText)) {
    console.log('Task creation blocked: Exact match found:', trimmedText);
    return true;
  }

  // Then check for phrases within the text
  const hasPhrase = excludedPhrases.some(phrase => {
    const includes = trimmedText.includes(phrase);
    if (includes) {
      console.log('Task creation blocked: Phrase match found:', phrase, 'in:', trimmedText);
    }
    return includes;
  });

  // Check for common patterns that might indicate an empty task message
  const patternChecks = [
    /^no\s+.*\s+found/i,
    /^could\s+not\s+.*\s+any/i,
    /^unable\s+to\s+.*\s+any/i,
    /^did\s+not\s+.*\s+any/i,
    /^doesn't\s+.*\s+any/i,
    /^does\s+not\s+.*\s+any/i,
    /^none\s+.*\s+found/i,
    /^no\s+.*\s+identified/i,
  ];

  const matchesPattern = patternChecks.some(pattern => {
    const matches = pattern.test(trimmedText);
    if (matches) {
      console.log('Task creation blocked: Pattern match found:', pattern, 'in:', trimmedText);
    }
    return matches;
  });

  return hasPhrase || matchesPattern;
}

// Helper function to detect duplicate tasks
async function isDuplicateTask(text: string, projectId: number): Promise<boolean> {
  if (!text?.trim()) return true;

  const normalizedText = text.trim().toLowerCase();

  // Get existing tasks for this project
  const existingTasks = await db.query.todos.findMany({
    where: eq(todos.projectId, projectId)
  });

  return existingTasks.some(task => {
    const normalizedExisting = task.text.trim().toLowerCase();
    return normalizedExisting === normalizedText ||
           normalizedExisting.includes(normalizedText) ||
           normalizedText.includes(normalizedExisting);
  });
}

// Helper function to reassemble chunked recording
async function reassembleChunkedRecording(chunks: string[], isLastChunk: boolean, recordingsDir: string): Promise<string> {
  if (!chunks || chunks.length === 0) {
    throw new Error('No chunks provided for reassembly');
  }

  try {
    // Generate final filename
    const timestamp = Date.now();
    const finalFilename = `recording-${timestamp}-complete.webm`;
    const finalPath = path.join(recordingsDir, finalFilename);

    // Create write stream for final file
    const writeStream = fs.createWriteStream(finalPath);

    // Process each chunk in order
    for (const chunkFilename of chunks) {
      const chunkPath = path.join(recordingsDir, chunkFilename);

      // Check if chunk exists
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`Chunk file not found: ${chunkFilename}`);
      }

      // Read chunk and append to final file
      const chunkData = await fs.promises.readFile(chunkPath);
      writeStream.write(chunkData);

      // Clean up chunk file
      if (isLastChunk) {
        await fs.promises.unlink(chunkPath).catch(err => 
          console.warn('Failed to cleanup chunk:', chunkFilename, err)
        );
      }
    }

    // Close the write stream
    await new Promise((resolve, reject) => {
      writeStream.end(err => {
        if (err) reject(err);
        else resolve(null);
      });
    });

    return finalFilename;
  } catch (error) {
    console.error('Error reassembling chunks:', error);
    throw error;
  }
}

// Helper function to clean up empty tasks
async function cleanupEmptyTasks(projectId: number): Promise<void> {
  const emptyTasks = await db.query.todos.findMany({
    where: and(
      eq(todos.projectId, projectId),
      or(
        eq(todos.text, ''),
        eq(todos.text, ' ')
      )
    ),
  });

  if (emptyTasks.length > 0) {
    console.log('Cleaning up empty tasks:', emptyTasks.map(t => t.id));
    await db.delete(todos).where(t => t.id.in(emptyTasks.map(t => t.id)));
  }
}

// Extend Express Request type to include auth properties
interface AuthRequest extends Request {
  isAuthenticated(): boolean;
  user?: any;
  logout(callback: (err: any) => void): void;
}

function requireAuth(req: AuthRequest, res: Response, next: Function): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  try {
    // Ensure recordings directory exists
    const RECORDINGS_DIR = await ensureStorageDirectory();

    console.log("Using recordings directory:", RECORDINGS_DIR);

    // Handle cleanup in the background without blocking server startup
    cleanupOrphanedRecordings(RECORDINGS_DIR).catch((error) => {
      console.error("Failed to clean up orphaned recordings:", error);
    });

    console.log(
      "Setting up static file serving for recordings directory:",
      RECORDINGS_DIR,
    );

    // Custom middleware for serving audio files with proper streaming support
    app.get('/recordings/*', requireAuth, async (req: AuthRequest, res: Response) => {
      let fileStream: fs.ReadStream | undefined;

      try {
        const filename = path.basename(req.path);
        const recordingsDir = getRecordingsPath();
        const filePath = path.join(recordingsDir, filename);

        console.log('Audio request received:', {
          filename,
          userId: req.user?.id,
          path: filePath,
          exists: fs.existsSync(filePath),
          env: process.env.NODE_ENV,
          timestamp: new Date().toISOString()
        });

        // Check if file exists first
        if (!fs.existsSync(filePath)) {
          console.error('File not found:', {
            filename,
            userId: req.user?.id,
            path: filePath,
            timestamp: new Date().toISOString()
          });
          return res.status(404).json({
            message: "Recording not found",
            details: "The requested audio file does not exist",
            requestInfo: {
              filename,
              userId: req.user?.id,
              timestamp: new Date().toISOString()
            }
          });
        }

        // Get file stats for streaming
        let stats: fs.Stats;
        try {
          stats = await fs.promises.stat(filePath);
        } catch (error) {
          console.error('File stats error:', {
            filename,
            userId: req.user?.id,
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
          return res.status(500).json({
            message: "Error accessing file",
            details: "Could not get file information",
            requestInfo: {
              filename,
              userId: req.user?.id,
              timestamp: new Date().toISOString()
            }
          });
        }

        // Verify file ownership after we know the file exists
        const [project] = await db.query.projects.findMany({
          where: and(
            eq(projects.userId, req.user!.id),
            eq(projects.recordingUrl, filename)
          ),
          limit: 1,
        });

        if (!project) {
          console.warn('Unauthorized file access attempt:', {
            filename,
            userId: req.user?.id,
            timestamp: new Date().toISOString()
          });
          return res.status(403).json({
            message: "Access denied",
            details: "You do not have permission to access this recording",
            requestInfo: {
              filename,
              userId: req.user?.id,
              timestamp: new Date().toISOString()
            }
          });
        }

        const contentType = getAudioContentType(filename);

        // Handle range requests for audio streaming
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
          const chunksize = (end - start) + 1;

          console.log('Processing range request:', {
            filename,
            userId: req.user?.id,
            range,
            start,
            end,
            chunksize,
            timestamp: new Date().toISOString()
          });

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stats.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Content-Type-Options': 'nosniff'
          });

          fileStream = fs.createReadStream(filePath, { start, end });
        } else {
          console.log('Processing full file request:', {
            filename,
            userId: req.user?.id,
            size: stats.size,
            timestamp: new Date().toISOString()
          });

          res.writeHead(200, {
            'Content-Length': stats.size,
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff'
          });

          fileStream = fs.createReadStream(filePath);
        }

        // Handle stream errors
        fileStream.on('error', (error) => {
          console.error('Stream error occurred:', {
            filename,
            userId: req.user?.id,
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
          if (!res.headersSent) {
            res.status(500).json({
              message: "Error streaming audio file",
              error: error instanceof Error ? error.message : String(error)
            });
          }
          fileStream?.destroy();
        });

        // Handle client disconnect
        req.on('close', () => {
          console.log('Client disconnected:', {
            filename,
            userId: req.user?.id,
            timestamp: new Date().toISOString()
          });
          fileStream?.destroy();
        });

        // Start streaming
        fileStream.pipe(res);

      } catch (error) {
        console.error('Fatal error in audio streaming:', {
          error: error instanceof Error ? error.stack : String(error),
          userId: req.user?.id,
          timestamp: new Date().toISOString()
        });
        fileStream?.destroy();
        if (!res.headersSent) {
          res.status(500).json({
            message: "Error serving audio file",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });

    setupAuth(app);
    app.get("/api/messages", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const messages = await db.query.chats.findMany({
            where: and(
              eq(chats.userId, req.user!.id),
              eq(chats.projectId, null)
            ),
            orderBy: asc(chats.timestamp),
          });
          res.json(messages);
        } catch (error: any) {
          console.error("Error fetching chat messages:", error);
          res.status(500).json({ message: "Failed to fetch messages" });
        }
      });
    app.post("/api/chat", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const { message } = req.body;

          if (typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ message: "Invalid message" });
          }

          const [userMessage, assistantMessage] = await db.transaction(async (tx) => {
            const [userMsg] = await tx.insert(chats).values({
              userId: req.user!.id,
              role: "user",
              content: message.trim(),
              projectId: null,
              timestamp: new Date(),
            }).returning();

            const services = await createAIServices(req.user!.id);
            const aiResponse = await services.chat.generateResponse({
              userId: req.user!.id,
              message: message.trim()
            });

            const [assistantMsg] = await tx.insert(chats).values({
              userId: req.user!.id,
              role: "assistant",
              content: aiResponse.message,
              projectId: null,
              timestamp: new Date(),
            }).returning();

            return [userMsg, assistantMsg];
          });

          res.json({
            message: assistantMessage.content,
            messages: [userMessage, assistantMessage]
          });

        } catch (error: any) {
          console.error("Chat error:", error);
          res.status(500).json({
            message: error.message || "Failed to generate response",
          });
        }
      });
    app.get("/api/projects/:projectId/messages", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.projectId);
          if (isNaN(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
          }

          const [project] = await db.query.projects.findMany({
            where: eq(projects.id, projectId),
            limit: 1,
          });

          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }

          if (project.userId !== req.user!.id) {
            return res.status(403).json({ message: "Not authorized" });
          }

          const messages = await db.query.chats.findMany({
            where: and(
              eq(chats.userId, req.user!.id),
              eq(chats.projectId, projectId)
            ),
            orderBy: asc(chats.timestamp),
          });

          res.json(messages);
        } catch (error: any) {
          console.error("Error fetching project chat messages:", error);
          res.status(500).json({ message: "Failed to fetch messages" });
        }
      });
    app.post("/api/projects/:projectId/chat", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.projectId);
          if (isNaN(projectId)) {
            return res.status(400).json({ message: "Invalid project ID" });
          }

          const { message } = req.body;
          if (typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ message: "Invalid message" });
          }

          const [project] = await db.query.projects.findMany({
            where: eq(projects.id, projectId),
            limit: 1,
          });

          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }

          if (project.userId !== req.user!.id) {
            return res.status(403).json({ message: "Not authorized" });
          }

          const [userMessage] = await db.insert(chats).values({
            userId: req.user!.id,
            projectId,
            role: "user",
            content: message.trim(),
            timestamp: new Date(),
          }).returning();

          const services = await createAIServices(req.user!.id);
          const aiResponse = await services.chat.generateResponse({
            userId: req.user!.id,
            message: message.trim(),
            context: {
              transcription: project.transcription,
              summary: project.summary,
              notes: project.notes,
            },
          });

          const [assistantMessage] = await db.insert(chats).values({
            userId: req.user!.id,
            projectId,
            role: "assistant",
            content: aiResponse.message,
            timestamp: new Date(),
          }).returning();

          res.json({
            message: aiResponse.message,
            messages: [userMessage, assistantMessage]
          });
        } catch (error: any) {
          console.error("Project chat error:", error);
          res.status(500).json({
            message: error.message || "Failed to generate response",
          });
        }
      });

    app.get(
      "/api/recordings/:filename/download",
      requireAuth,
      async (req: AuthRequest, res: Response) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
    
        const sendEvent = (event: string, data: any) => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
    
        try {
          const filename = req.params.filename;
          const webmPath = path.join(RECORDINGS_DIR, filename);
    
          try {
            await fs.promises.access(webmPath, fs.constants.R_OK);
          } catch (error) {
            return res.status(404).json({ message: "Recording not found" });
          }
    
          const mp3Filename = filename.replace(".webm", ".mp3");
          const mp3Path = path.join(RECORDINGS_DIR, `temp_${mp3Filename}`);
    
          console.log("Converting WebM to MP3:", {
            source: webmPath,
            destination: mp3Path,
          });
    
          await new Promise<void>((resolve, reject) => {
            sendEvent("status", { state: "started" });
            const ffmpeg = spawn("ffmpeg", [
              "-i",
              webmPath,
              "-vn",
              "-acodec",
              "libmp3lame",
              "-ab",
              "128k",
              "-ar",
              "44100",
              "-af",
              "silenceremove=1:0:-50dB",
              "-progress",
              "pipe:1",
              mp3Path,
            ]);
    
            ffmpeg.on("error", (error) => {
              console.error("FFmpeg process error:", error);
              reject(new Error("FFmpeg process failed to start"));
            });
    
            ffmpeg.stdout.on("data", (data) => {
              console.log("FFmpeg:", data.toString());
            });
    
            ffmpeg.stderr.on("data", (data) => {
              console.log("FFmpeg:", data.toString());
            });
    
            ffmpeg.on("close", (code) => {
              if (code === 0) {
                console.log("Conversion completed successfully");
                resolve();
              } else {
                reject(new Error(`FFmpeg process exited with code ${code}`));
              }
            });
          });
    
          sendEvent("complete", { success: true });
          res.end();
        } catch (error) {
          console.error("Error converting audio:", error);
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Unknown error occurred during conversion";
          sendEvent("error", { message: errorMessage });
          res.end();
        }
    
        req.on("close", () => {
          console.log("Client disconnected from SSE stream");
        });
      },
    );
    app.get(
      "/api/recordings/:filename/download/file",
      requireAuth,
      async (req: AuthRequest, res: Response) => {
        try {
          const filename = req.params.filename;
          const mp3Path = path.join(
            RECORDINGS_DIR,
            `temp_${filename.replace(".webm", ".mp3")}`,
          );
    
          res.setHeader("Content-Type", "audio/mp3");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename.replace(".webm", ".mp3")}"`,
          );
    
          const stream = fs.createReadStream(mp3Path);
          stream.pipe(res);
    
          stream.on("end", () => {
            fs.unlink(mp3Path, (err) => {
              if (err) console.error("Error cleaning up temporary file:", err);
              else console.log("Temporary MP3 file cleaned up");
            });
          });
        } catch (error: any) {
          console.error("Error serving audio:", error);
          res.status(500).json({
            message: "Failed to serve audio",
            error: error.message,
          });
        }
      },
    );
    app.post("/api/recordings/upload", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        // Ensure storage directory exists with proper permissions
        const recordingsDir = await ensureStorageDirectory();
        console.log('Storage directory ready:', recordingsDir);
        const form = formidable({
          uploadDir: recordingsDir,
          keepExtensions: true,
          maxFileSize: 300 * 1024 * 1024, // 300MB max for each chunk
          filter: (part) => {
            if (!part.mimetype) return false;
            console.log('Filtering upload:', {
              mimetype: part.mimetype,
              originalFilename: part.originalFilename,
            });
            // Accept both general audio and specific webm types
            const isValidType = part.mimetype.includes('audio/') || 
                              part.mimetype === 'audio/webm' ||
                              part.mimetype === 'audio/webm;codecs=opus';
            if (!isValidType) {
              console.warn('Invalid mime type:', part.mimetype);
              return false;
            }
            return true;
          }
        });
        console.log('Starting file upload processing');
        const [fields, files] = await form.parse(req);
        console.log('Form parse complete:', { 
          fieldKeys: Object.keys(fields),
          filesReceived: files ? Object.keys(files) : 'none'
        });
        const file = files.recording?.[0];
        if (!file) {
          console.error('No recording file provided in request');
          return res.status(400).json({ 
            message: "No recording file provided",
            details: "The upload request must include a file named 'recording'"
          });
        }
        console.log('Received file:', {
          originalName: file.originalFilename,
          newName: file.newFilename,
          size: file.size,
          type: file.mimetype
        });
        // Get additional chunk information from the request
        const isLastChunk = fields.isLastChunk?.[0] === 'true';
        const previousChunks = fields.previousChunks?.[0] 
          ? JSON.parse(fields.previousChunks[0] as string) 
          : [];
        // If this is part of a chunked upload
        if (previousChunks.length > 0 || !isLastChunk) {
          console.log('Processing chunked upload:', {
            isLastChunk,
            previousChunksCount: previousChunks.length
          });
          // Add current chunk to the list
          const allChunks = [...previousChunks, file.newFilename];
          // If this is the last chunk, reassemble all chunks
          if (isLastChunk) {
            try {
              const finalFilename = await reassembleChunkedRecording(allChunks, true, recordingsDir);
              console.log('Successfully reassembled chunks into:', finalFilename);
              return res.json({ filename: finalFilename });
            } catch (error) {
              console.error('Failed to reassemble chunks:', error);
              return res.status(500).json({
                message: "Failed to reassemble recording chunks",
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
          // If not the last chunk, just return the current filename
          return res.json({ filename: file.newFilename });
        }
        // Single file upload (small recordings)
        if (!file.size || file.size === 0) {
          console.error('Empty recording file received');
          await fs.promises.unlink(file.filepath).catch(err => 
            console.error('Failed to cleanup empty file:', err)
          );
          return res.status(400).json({
            message: "Empty recording",
            details: "The uploaded recording file is empty"
          });
        }
        // Set proper file permissions
        await fs.promises.chmod(file.filepath, 0o666);
        console.log('Successfully saved recording:', {
          filename: file.newFilename,
          size: file.size,
          type: file.mimetype,
          path: file.filepath
        });
        return res.json({ filename: file.newFilename });
      } catch (error: any) {
        console.error('Error handling file upload:', error);
        res.status(500).json({
          message: "Failed to save recording",
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });

    app.get("/api/projects", requireAuth, async (req: AuthRequest, res: Response) => {
        const userProjects = await db.query.projects.findMany({
          where: eq(projects.userId, req.user!.id),
          orderBy: desc(projects.createdAt),
          with: {
            todos: {
              orderBy: desc(todos.createdAt),
            },
          },
        });
        res.json(userProjects);
      });
    app.get("/api/projects/:id", requireAuth, async (req: AuthRequest, res: Response) => {
        const [project] = await db.query.projects.findMany({
          where: eq(projects.id, parseInt(req.params.id)),
          limit: 1,
          with: {
            todos: {
              orderBy: desc(todos.createdAt),
            },
          },
        });
        if (!project) {
          return res.status(404).send("Project not found");
        }
        if (project.userId !== req.user!.id) {
          return res.status(403).send("Not authorized");
        }
        res.json(project);
      });
    app.get("/api/projects/:id/note", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.id);
          const [project] = await db.query.projects.findMany({
            where: and(
              eq(projects.id, projectId),
              eq(projects.userId, req.user!.id),
            ),
            limit: 1,
            with: {
              note: true,
            },
          });
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
          if (!project.note) {
            const [newNote] = await db
              .insert(notes)
              .values({
                projectId,
                content: "",
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            return res.json(newNote);
          }
          res.json(project.note);
        } catch (error: any) {
          console.error("Error getting note:", error);
          res.status(500).json({
            message: "Failed to get note",
            error: error.message,
          });
        }
      });
    app.put("/api/projects/:id/note", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.id);
          const { content } = req.body;
          if (typeof content !== "string") {
            return res.status(400).json({ message: "Invalid note content" });
          }
          const [project] = await db.query.projects.findMany({
            where: and(
              eq(projects.id, projectId),
              eq(projects.userId, req.user!.id),
            ),
            limit: 1,
            with: {
              note: true,
            },
          });
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
          let note;
          if (project.note) {
            [note] = await db
              .update(notes)
              .set({
                content,
                updatedAt: new Date(),
              })
              .where(eq(notes.projectId, projectId))
              .returning();
          } else {
            [note] = await db
              .insert(notes)
              .values({
                projectId,
                content,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
          }
          res.json(note);
        } catch (error: any) {
          console.error("Error saving note:", error);
          res.status(500).json({
            message: "Failed to save note",
            error: error.message,
          });
        }
      });
    app.post("/api/settings", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const { openaiApiKey, defaultPrompt, todoPrompt } = req.body;
          if (
            typeof openaiApiKey !== "string" ||
            typeof defaultPrompt !== "string" ||
            typeof todoPrompt !== "string"
          ) {
            return res.status(400).json({
              message:
                "Invalid input: API key, default prompt, and todo prompt must be strings",
            });
          }
          const [updatedUser] = await db
            .update(users)
            .set({
              openaiApiKey: openaiApiKey || "",
              defaultPrompt: defaultPrompt || "",
              todoPrompt: todoPrompt || "",
            })
            .where(eq(users.id, req.user!.id))
            .returning();
          if (!updatedUser) {
            return res.status(404).json({
              message: "User not found",
            });
          }
          res.json(updatedUser);
        } catch (error: any) {
          console.error("Error updating settings:", error);
          res.status(500).json({
            message: "Failed to update settings",
            error: error.message,
          });
        }
      });
    app.post("/api/projects", requireAuth, async (req: AuthRequest, res: Response) => {
        try {          const { title, description, recordingUrl, initialNoteContent } = req.body;
          const [project] = await db.transaction(async (tx) => {
            const [newProject] = await tx
              .insert(projects)
              .values({
                title,
                description,
                recordingUrl,
                userId: req.user!.id,
              })
              .returning();
            await tx.insert(notes).values({
              projectId: newProject.id,
              content: initialNoteContent || "",
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            return [newProject];
          });
          res.json(project);
        } catch (error: any) {
          console.error("Error creating project:", error);
          res.status(500).json({
            message: "Failed to create project",
            error: error.message,
          });
        }
      });
    app.delete("/api/projects/:id", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.id);
          console.log("Deleting project:", projectId);
          const [project] = await db.query.projects.findMany({
            where: eq(projects.id, projectId),
            limit: 1,
            with: {
              todos: true,
            },
          });
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
          if (project.userId !== req.user!.id) {
            return res.status(403).json({ message: "Not authorized" });
          }
          console.log("Project to delete:", {
            id: project.id,
            title: project.title,
            todoCount: project.todos?.length || 0,
          });
          const [deletedProject] = await db
            .delete(projects)
            .where(eq(projects.id, projectId))
            .returning();
          if (!deletedProject) {
            throw new Error("Failed to delete project");
          }
          if (project.recordingUrl) {
            const recordingPath = path.join(RECORDINGS_DIR, project.recordingUrl);
            try {
              await fs.promises.access(recordingPath, fs.constants.F_OK);
              await fs.promises.unlink(recordingPath);
              console.log("Deleted recording file:", recordingPath);
              const mp4Path = path.join(
                RECORDINGS_DIR,
                `temp_${project.recordingUrl.replace(".webm", ".mp4")}`,
              );
              try {
                await fs.promises.access(mp4Path, fs.constants.F_OK);
                await fs.promises.unlink(mp4Path);
                console.log("Deleted converted MP4 file:", mp4Path);
              } catch (error) {}
            } catch (error) {
              console.warn("Could not delete recording file:", error);
            }
          }
          res.json({
            message: "Project deleted successfully",
            deletedResources: {
              project: {
                id: project.id,
                title: project.title,
              },
              todoCount: project.todos?.length || 0,
              recordingDeleted: !!project.recordingUrl,
            },
          });
        } catch (error: any) {
          console.error("Error deleting project:", error);
          res.status(500).json({
            message: "Failed to delete project",
            error: error.message,
          });
        }
      });
    app.patch("/api/projects/:id", requireAuth, async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.id);
          const { title } = req.body;
          if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ message: "Invalid title" });
          }
          const [project] = await db.query.projects.findMany({
            where: eq(projects.id, projectId),
            limit: 1,
          });
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
          if (project.userId !== req.user!.id) {
            return res.status(403).json({ message: "Not authorized" });
          }
          const [updatedProject] = await db
            .update(projects)
            .set({ title: title.trim() })            .where(eq(projects.id, projectId))
            .returning();
          res.json(updatedProject);
        } catch(error: any) {
          console.error("Error updating project:", error);
          res.status(500).json({
            message: "Failed to update project",
            error: error.message,
          });
        }
      });
    app.post("/api/projects/:id/process", requireAuth, async (req: AuthRequest, res: Response) => {
      let mp3FilePath: string | undefined;

      try {
        const projectId = parseInt(req.params.id);
        if (isNaN(projectId)) {
          return res.status(400).json({ message: "Invalid project ID" });
        }

        const [project] = await db.query.projects.findMany({
          where: and(
            eq(projects.id, projectId),
            eq(projects.userId, req.user!.id)
          ),
          limit: 1,
          with: {
            note: true,
          },
        });

        if (!project) {
          return res.status(404).json({ message: "Project not found" });
        }

        if (!project.recordingUrl) {
          return res.status(400).json({ message: "No recording file associated with this project" });
        }

        const [user] = await db.query.users.findMany({
          where: eq(users.id, req.user!.id),
          limit: 1,
        });

        if (!user.openaiApiKey) {
          return res.status(400).json({ message: "OpenAI API key not set" });
        }

        const openai = new OpenAI({ apiKey: user.openaiApiKey });
        const recordingPath = path.join(RECORDINGS_DIR, project.recordingUrl);

        try {
          await fs.promises.access(recordingPath, fs.constants.R_OK);
        } catch (error) {
          console.error("Recording file access error:", error);
          return res.status(404).json({
            message: "Recording file not found or not accessible",
          });
        }

        // Convert to MP3 for Whisper
        mp3FilePath = path.join(RECORDINGS_DIR, `temp_${Date.now()}.mp3`);
        await new Promise<void>((resolve, reject) => {
          const ffmpeg = spawn("ffmpeg", [
            "-i", recordingPath,
            "-vn",
            "-acodec", "libmp3lame",
            "-ab", "128k",
            "-ar", "44100",
            "-af", "silenceremove=1:0:-50dB",
            "-y",
            mp3FilePath,
          ]);

          ffmpeg.on("error", (error) => {
            console.error("FFmpeg process error:", error);
            reject(new Error(`FFmpeg process failed: ${error.message}`));
          });

          ffmpeg.stdout.on("data", (data) => {
            console.log("FFmpeg stdout:", data.toString());
          });

          ffmpeg.stderr.on("data", (data) => {
            console.log("FFmpeg stderr:", data.toString());
          });

          ffmpeg.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg process exited with code ${code}`));
          });
        });

        // Get transcription
        console.log("Starting Whisper transcription");
        const transcriptionResponse = await openai.audio.transcriptions.create({
          file: fs.createReadStream(mp3FilePath),
          model: "whisper-1",
        });

        if (!transcriptionResponse.text) {
          throw new Error("No transcription received from OpenAI");
        }

        console.log("Transcription successful, length:", transcriptionResponse.text.length);

        // Format transcript with timestamps
        const formattingResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `Format the transcript with only these elements:
1. Chapter Headers:
   - Identify key topic changes and sections
   - Format as: "# Topic Title"
   - Place at natural topic transitions
1. Regular Timestamps:
   - Add timestamps [HH:MM:SS.mmm] every 10-30 seconds
   - Place at natural speech breaks
   - Keep timestamps sequential

Format Rules:
- Be sure to send back all of the text
- Always start at the beginning of the recording at 00:00:00
- Each timestamp must be in [HH:MM:SS.mmm] format
- Begin with a chapter header
- Do not add intro or additional formatting
- Add timestamps every 10-30 seconds
- Preserve original text content exactly`,
            },
            {
              role: "user",
              content: transcriptionResponse.text,
            },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        });

        if (!formattingResponse.choices[0]?.message?.content) {
          throw new Error("No formatted transcript generated");
        }

        const formattedTranscript = formattingResponse.choices[0].message.content.trim();

        // Generate title
        const titleResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "Generate a clear, concise title (max 60 chars) based on the transcript content. Do not insert any additional formatting or punctuation",
            },
            {
              role: "user",
              content: formattedTranscript,
            },
          ],
          temperature: 0.7,
          max_tokens: 60,
        });

        if (!titleResponse.choices[0]?.message?.content) {
          throw new Error("No title generated");
        }

        const title = titleResponse.choices[0].message.content.trim();

        // Use AI services for insights and tasks
        const chatService = await createChatService(req.user!.id);
        
        const summaryResponse = await chatService.createChatCompletion({
          userId: req.user!.id,
          message: formattedTranscript,
          context: {
            projectId,
            transcription: formattedTranscript,
          },
          promptType: 'primary'
        });

        const summary = summaryResponse.message.trim();

        const taskResponse = await chatService.createChatCompletion({
          userId: req.user!.id,
          message: formattedTranscript,
          context: {
            projectId,
            transcription: formattedTranscript,
            summary
          },
          promptType: 'todo'
        });

        const taskContent = taskResponse.message.trim();

        // Only process tasks if we have valid content
        if (!isEmptyTaskResponse(taskContent)) {
          const tasks = taskContent
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => !isEmptyTaskResponse(line));

          for (const task of tasks) {
            if (!(await isDuplicateTask(task, projectId))) {
              await db.insert(todos).values({
                projectId,
                text: task,
                completed: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          }
        }

        // Update project with processed information
        const [updatedProject] = await db.update(projects)
          .set({
            title,
            transcription: formattedTranscript,
            summary,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId))
          .returning();

        // Clean up any empty tasks
        await cleanupEmptyTasks(projectId);

        res.json(updatedProject);

      } catch (error) {
        console.error("Processing error:", error);
        res.status(500).json({
          message: "Failed to process recording",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Cleanup temporary MP3 file
        if (mp3FilePath && fs.existsSync(mp3FilePath)) {
          await fs.promises.unlink(mp3FilePath)
            .catch(err => console.error("Failed to clean up temporary MP3 file:", err));
        }
      }
    });

    app.delete("/api/todos/:id", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const todoId = parseInt(req.params.id);
        const [todo] = await db.query.todos.findMany({
          where: eq(todos.id, todoId),
          limit: 1,
          with: {
            project: true,
          },
        });
        if (!todo) {
          return res.status(404).json({ message: "Todo not found" });
        }
        if (todo.project?.userId !== req.user!.id) {
          return res.status(403).json({ message: "Not authorized" });
        }
        console.log("Deleting todo:", {
          id: todo.id,
          text: todo.text,
          projectId: todo.projectId,
        });
        const [deletedTodo] = await db
          .delete(todos)
          .where(eq(todos.id, todoId))
          .returning();
        if (!deletedTodo) {
          throw new Error("Failed to delete todo");
        }
        res.json({ message: "Todo deleted successfully" });
      } catch (error: any) {
        console.error("Error deleting todo:", error);
        res.status(500).json({
          message: "Failed to delete todo",
          error: error.message,
        });
      }
    });
    app.get("/api/todos", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const userTodos = await db
          .select({
            id: todos.id,
            text: todos.text,
            completed: todos.completed,
            columnId: todos.columnId,
            order: todos.order,
            createdAt: todos.createdAt,
            updatedAt: todos.updatedAt,
            projectId: todos.projectId,
            project: {
              title: projects.title,
            },
          })
          .from(todos)
          .innerJoin(projects, eq(todos.projectId, projects.id))
          .where(eq(projects.userId, req.user!.id))
          .orderBy(desc(projects.createdAt));
        res.json(userTodos);
      } catch (error: any) {
        console.error("Error fetching todos:", error);
        res.status(500).json({
          message: "Failed to fetch todos",
          error: error.message,
        });
      }
    });
    app.get("/api/kanban/columns", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const columns = await db.query.kanbanColumns.findMany({
          orderBy: (columns, { asc }) => [asc(columns.order)],
          with: {
            todos: {
              orderBy: (todos, { asc }) => [asc(todos.order)],
            },
          },
        });
        res.json(columns);
      } catch (error: any) {
        console.error("Error fetching Kanban columns:", error);
        res.status(500).json({
          message: "Failed to fetch Kanban columns",
          error: error.message,
        });
      }
    });
    app.post("/api/kanban/columns", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const { title } = req.body;
        if (typeof title !== "string" || !title.trim()) {
          return res.status(400).json({ message: "Invalid title" });
        }
        const columns = await db.query.kanbanColumns.findMany({
          orderBy: (columns, { desc }) => [desc(columns.order)],
          limit: 1,
        });
        const order = columns.length > 0 ? columns[0].order + 1 : 0;
        const [column] = await db
          .insert(kanbanColumns)
          .values({
            title: title.trim(),
            order,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        res.json(column);
      } catch (error: any) {
        console.error("Error creating Kanban column:", error);
        res.status(500).json({
          message: "Failed to create Kanban column",
          error: error.message,
        });
      }
    });
    app.patch("/api/todos/:id", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const todoId = parseInt(req.params.id);
        const { text, completed, columnId, order } = req.body;
        const [todo] = await db.query.todos.findMany({
          where: eq(todos.id, todoId),
          limit: 1,
          with: {
            project: true,
          },
        });
        if (!todo) {
          return res.status(404).json({ message: "Todo not found" });
        }
        if (todo.project?.userId !== req.user!.id) {
          return res.status(403).json({ message: "Not authorized" });
        }
        const updateData: Partial<typeof todos.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (typeof text === "string" && text.trim()) {
          updateData.text = text.trim();
        }
        if (typeof completed === "boolean") {
          updateData.completed = completed;
        }
        if (typeof columnId === "number") {
          updateData.columnId = columnId;
        }
        if (typeof order === "number") {
          updateData.order = order;
        }
        const [updatedTodo] = await db
          .update(todos)
          .set(updateData)
          .where(eq(todos.id, todoId))
          .returning();
        if (!updatedTodo) {
          throw new Error("Update operation failed");
        }
        res.json(updatedTodo);
      } catch (error: any) {
        console.error("Error updating todo:", error);
        res.status(500).json({
          message: "Failed to update todo",
          error: error.message,
        });
      }
    });
    app.put("/api/projects/:id/summary", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        const { summary } = req.body;
  
        if (typeof summary !== "string") {
          return res.status(400).json({ message: "Invalid summary content" });
        }
  
        const [project] = await db.query.projects.findMany({
          where: eq(projects.id, projectId),
          limit: 1,
        });
  
        if (!project) {
          return res.status(404).json({ message: "Project not found" });
        }
  
        if (project.userId !== req.user!.id) {
          return res.status(403).json({ message: "Not authorized" });
        }
  
        const [updatedProject] = await db
          .update(projects)
          .set({
            summary,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId))
          .returning();
  
        res.json(updatedProject);
      } catch (error: any) {
        console.error("Error updating project summary:", error);
        res.status(500).json({
          message: "Failed to update project summary",
          error: error.message,
        });
      }
    });
    app.get("/api/chats/:projectId?", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const projectId = req.params.projectId
          ? parseInt(req.params.projectId)
          : undefined;
        const conditions = [eq(chats.userId, req.user!.id)];
  
        if (projectId) {
          conditions.push(eq(chats.projectId, projectId));
        }
  
        const messages = await db.query.chats.findMany({
          where: and(...conditions),
          orderBy: asc(chats.timestamp),
        });
        res.json(messages);
      } catch (error: any) {
        console.error("Error fetching chats:", error);
        res.status(500).json({
          message: "Failed to fetch chats",
          error: error.message,
        });
      }
    });
    app.post("/api/todos", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const { text, projectId } = req.body;
        if (typeof text !== "string" || !text.trim()) {
          return res.status(400).json({ message: "Invalid task text" });
        }
  
        // If no projectId is provided, find or create personal project
        let effectiveProjectId = projectId;
        if (!projectId) {
          // Find personal project
          const [personalProject] = await db.query.projects.findMany({
            where: and(
              eq(projects.userId, req.user!.id),
              eq(projects.recordingUrl, 'personal.none')
            ),
            limit: 1,
          });
  
          if (personalProject) {
            effectiveProjectId = personalProject.id;
          } else {
            // Create personal project if it doesn't exist
            const [newPersonalProject] = await db.insert(projects)
              .values({
                userId: req.user!.id,
                title: 'Personal Tasks',
                description: 'Your personal tasks',
                recordingUrl: 'personal.none',
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            effectiveProjectId = newPersonalProject.id;
          }
        }
  
        const [todo] = await db.insert(todos)
          .values({
            text: text.trim(),
            projectId: effectiveProjectId,
            completed: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            order: 0,
          })
          .returning();
  
        res.json(todo);
      } catch (error: any) {
        console.error("Error creating todo:", error);
        res.status(500).json({
          message: "Failed to create todo",
          error: error.message,
        });
      }
    });
  
    app.patch("/api/todos/:id", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const todoId = parseInt(req.params.id);
        const { text, completed, columnId, order } = req.body;
        console.log("Received todo update request:", {
          todoId,
          body: req.body,
          userId: req.user?.id,
        });
        const [todo] = await db.query.todos.findMany({
          where: eq(todos.id, todoId),
          limit: 1,
          with: {
            project: {
              columns: {
                userId: true,
              },
            },
          },
        });
        console.log("Found todo:", todo);
        if (!todo) {
          console.log("Todo not found:", todoId);
          return res.status(404).json({ message: "Todo not found" });
        }
        if (todo.project?.userId !== req.user!.id) {
          console.log("Authorization failed:", {
            todoUserId: todo.project?.userId,
            requestUserId: req.user!.id,
          });
          return res.status(403).json({ message: "Notauthorized" });
        }
        const updateData: Partial<typeof todos.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (typeof text === "string" && text.trim()) {
          console.log("Updating text to:", text.trim());
          updateData.text = text.trim();
        }
        if (typeof completed === "boolean") {
          updateData.completed = completed;
        }
        if (typeof columnId === "number") {
          updateData.columnId = columnId;
        }
        if (typeof order === "number") {
          updateData.order = order;
        }
        console.log("Applying updates:", updateData);
        const [updatedTodo] = await db
          .update(todos)
          .set(updateData)
          .where(eq(todos.id, todoId))
          .returning();
        console.log("Update result:", updatedTodo);
        res.json(updatedTodo);
      } catch (error: any) {
        console.error("Error updating todo:", error);
        res.status(500).json({
          message: "Failed to update todo",
          error: error.message,
        });
      }
    });
    app.patch(
      "/api/projects/:projectId/todos/reorder",
      requireAuth,
      async (req: AuthRequest, res: Response) => {
        try {
          const projectId = parseInt(req.params.projectId);
          const { todoIds } = req.body;
          if (!Array.isArray(todoIds)) {
            return res.status(400).json({ message: "Invalid todo IDs" });
          }
          const [project] = await db.query.projects.findMany({
            where: eq(projects.id, projectId),
            limit: 1,
          });
          if (!project) {
            return res.status(404).json({ message: "Project not found" });
          }
          if (project.userId !== req.user!.id) {
            return res.status(403).json({ message: "Not authorized" });
          }
          for (let i = 0; i < todoIds.length; i++) {
            await db
              .update(todos)
              .set({
                updatedAt: new Date(),
              })
              .where(eq(todos.id, todoIds[i]));
          }
          res.json({ message: "Todo order updated successfully" });
        } catch (error: any) {
          console.error("Error reordering todos:", error);
          res.status(500).json({
            message: "Failed to reorder todos",
            error: error.message,
          });
        }
      },
    );
    app.post("/api/logout", (req: AuthRequest, res: Response) => {
      req.logout((err) => {
        if (err) {
          return res.status(500).send("Logout failed");
        }
        res.json({ message: "Logout successful" });
      });
    });
    app.get("/api/user", (req: AuthRequest, res: Response) => {
      if (req.isAuthenticated()) {
        return res.json(req.user);
      }
      res.status(401).send("Not logged in");
    });
    return httpServer;
  } catch (error) {
    console.error("Error during route registration:", error);
    throw error; // Let the main error handler deal with it
  }
}

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.webm': return 'audio/webm';
    default: return 'application/octet-stream';
  }
}