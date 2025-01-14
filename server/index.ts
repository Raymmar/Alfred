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

// Setup request logging middleware with enhanced error capture
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log('Starting server initialization...');

    // Ensure the recordings directory exists before setting up routes
    try {
      await ensureStorageDirectory();
      console.log('Storage directory verified');
    } catch (error) {
      console.error('Failed to ensure storage directory:', error);
      throw error;
    }

    // Setup authentication before registering routes
    try {
      setupAuth(app);
      console.log('Authentication setup complete');
    } catch (error) {
      console.error('Failed to setup authentication:', error);
      throw error;
    }

    console.log('Registering routes...');
    const server = await registerRoutes(app);
    console.log('Routes registered successfully');

    // Global error handler with detailed logging
    app.use((err: Error | CustomError, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        console.error('Error after headers sent:', err);
        return;
      }

      console.error('Server error:', {
        error: err.stack || String(err),
        message: err.message || "Internal Server Error",
        details: process.env.NODE_ENV === 'development' ? err : undefined
      });

      const status = (err as CustomError).status || (err as CustomError).statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ 
        message,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    });

    // Setup Vite or static serving based on environment
    console.log('Setting up server environment:', app.get('env'));
    if (app.get("env") === "development") {
      await setupVite(app, server);
      console.log('Vite development server setup complete');
    } else {
      serveStatic(app);
      console.log('Static serving setup complete');
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
})();