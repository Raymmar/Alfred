import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { ensureStorageDirectory } from "./storage";
import { setupAuth } from "./auth";

interface CustomError extends Error {
  status?: number;
  statusCode?: number;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Setup request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path.startsWith("/api")) {
      log(`${req.method} ${req.path} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});

async function startServer() {
  try {
    // Ensure storage directory exists
    await ensureStorageDirectory();

    // Setup authentication
    setupAuth(app);

    // Register routes
    const server = await registerRoutes(app);

    // Global error handler
    app.use((err: Error | CustomError, _req: Request, res: Response, _next: NextFunction) => {
      console.error('Server error:', err);
      const status = (err as CustomError).status || (err as CustomError).statusCode || 500;
      res.status(status).json({ 
        message: err.message || "Internal Server Error",
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    });

    // Setup Vite in development, static files in production
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Start the server
    const PORT = 5000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server listening on port ${PORT}`);
    });

  } catch (error) {
    console.error('Fatal error during server startup:', error);
    process.exit(1);
  }
}

// Start the server
startServer();