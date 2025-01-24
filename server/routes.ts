// Keep existing imports

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  try {
    // ... keep existing setup code ...

    setupAuth(app);
    
    // System Chat Endpoint
    app.get("/api/chat/system", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const messages = await db.query.chats.findMany({
          where: and(
            eq(chats.userId, req.user!.id),
            eq(chats.projectId, null),
            eq(chats.chatType, 'system')
          ),
          orderBy: asc(chats.timestamp),
        });
        res.json(messages);
      } catch (error: any) {
        console.error("Error fetching system chat messages:", error);
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    });

    app.post("/api/chat/system", requireAuth, async (req: AuthRequest, res: Response) => {
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
            chatType: 'system',
            timestamp: new Date(),
          }).returning();

          const aiResponse = await createChatCompletion({
            userId: req.user!.id,
            message: message.trim(),
            promptType: 'system'
          });

          const [assistantMsg] = await tx.insert(chats).values({
            userId: req.user!.id,
            role: "assistant",
            content: aiResponse.message,
            projectId: null,
            chatType: 'system',
            timestamp: new Date(),
          }).returning();

          return [userMsg, assistantMsg];
        });

        res.json({
          message: assistantMessage.content,
          messages: [userMessage, assistantMessage]
        });

      } catch (error: any) {
        console.error("System chat error:", error);
        res.status(500).json({
          message: error.message || "Failed to generate response",
        });
      }
    });

    // Insights Chat Endpoint
    app.get("/api/chat/insights", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const messages = await db.query.chats.findMany({
          where: and(
            eq(chats.userId, req.user!.id),
            eq(chats.projectId, null),
            eq(chats.chatType, 'insights')
          ),
          orderBy: asc(chats.timestamp),
        });
        res.json(messages);
      } catch (error: any) {
        console.error("Error fetching insights chat messages:", error);
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    });

    app.post("/api/chat/insights", requireAuth, async (req: AuthRequest, res: Response) => {
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
            chatType: 'insights',
            timestamp: new Date(),
          }).returning();

          const aiResponse = await createChatCompletion({
            userId: req.user!.id,
            message: message.trim(),
            promptType: 'primary'
          });

          const [assistantMsg] = await tx.insert(chats).values({
            userId: req.user!.id,
            role: "assistant",
            content: aiResponse.message,
            projectId: null,
            chatType: 'insights',
            timestamp: new Date(),
          }).returning();

          return [userMsg, assistantMsg];
        });

        res.json({
          message: assistantMessage.content,
          messages: [userMessage, assistantMessage]
        });

      } catch (error: any) {
        console.error("Insights chat error:", error);
        res.status(500).json({
          message: error.message || "Failed to generate response",
        });
      }
    });

    // Tasks Chat Endpoint
    app.get("/api/chat/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
      try {
        const messages = await db.query.chats.findMany({
          where: and(
            eq(chats.userId, req.user!.id),
            eq(chats.projectId, null),
            eq(chats.chatType, 'tasks')
          ),
          orderBy: asc(chats.timestamp),
        });
        res.json(messages);
      } catch (error: any) {
        console.error("Error fetching tasks chat messages:", error);
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    });

    app.post("/api/chat/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
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
            chatType: 'tasks',
            timestamp: new Date(),
          }).returning();

          const aiResponse = await createChatCompletion({
            userId: req.user!.id,
            message: message.trim(),
            promptType: 'todo'
          });

          const [assistantMsg] = await tx.insert(chats).values({
            userId: req.user!.id,
            role: "assistant",
            content: aiResponse.message,
            projectId: null,
            chatType: 'tasks',
            timestamp: new Date(),
          }).returning();

          return [userMsg, assistantMsg];
        });

        res.json({
          message: assistantMessage.content,
          messages: [userMessage, assistantMessage]
        });

      } catch (error: any) {
        console.error("Tasks chat error:", error);
        res.status(500).json({
          message: error.message || "Failed to generate response",
        });
      }
    });

    // Keep existing /api/messages and /api/chat endpoints for backward compatibility
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

            const aiResponse = await createChatCompletion({
              userId: req.user!.id,
              message: message.trim(),
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

    // Keep the rest of the routes as is...
