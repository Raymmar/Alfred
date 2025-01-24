import passport from "passport";
import { IVerifyOptions, Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, insertUserSchema, type SelectUser } from "@db/schema";
import { db } from "@db";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);
const crypto = {
  hash: async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  },
  compare: async (suppliedPassword: string, storedPassword: string) => {
    const [hashedPassword, salt] = storedPassword.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(
      suppliedPassword,
      salt,
      64
    )) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

export function setupAuth(app: Express) {
  // Initialize MemoryStore with proper error handling
  const MemoryStore = createMemoryStore(session);
  if (!MemoryStore) {
    throw new Error("Failed to initialize MemoryStore");
  }

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || process.env.REPL_ID || "alfred-session-secret",
    resave: false,  // Only save session when data is modified
    saveUninitialized: false, // Don't create session until something stored
    rolling: true,  // Refresh cookie age on each response
    name: 'alfred.sid', // Custom cookie name
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    },
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
      ttl: 24 * 60 * 60 * 1000, // session TTL (24 hours)
      stale: false // delete expired sessions
    })
  };

  // Production settings
  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    sessionSettings.cookie = {
      ...sessionSettings.cookie,
      secure: true,
      sameSite: 'none'
    };
  }

  // Session middleware with error handling
  app.use((req, res, next) => {
    session(sessionSettings)(req, res, (err) => {
      if (err) {
        console.error('Session initialization error:', err);
        return res.status(500).json({ message: "Internal server error" });
      }
      next();
    });
  });

  // Initialize passport with error handling
  app.use((req, res, next) => {
    passport.initialize()(req, res, (err) => {
      if (err) {
        console.error('Passport initialization error:', err);
        return res.status(500).json({ message: "Authentication service error" });
      }
      next();
    });
  });

  // Setup passport session handling
  app.use((req, res, next) => {
    passport.session()(req, res, (err) => {
      if (err) {
        console.error('Passport session error:', err);
        return res.status(500).json({ message: "Session management error" });
      }
      next();
    });
  });

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          return done(null, false, { message: "Incorrect username." });
        }

        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: "Incorrect password." });
        }

        return done(null, user);
      } catch (err) {
        console.error('Authentication error:', err);
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) {
        return done(new Error('User not found'));
      }

      done(null, user);
    } catch (err) {
      console.error('Session deserialization error:', err);
      done(err);
    }
  });

  // Login route with error handling
  app.post("/api/login", (req, res, next) => {
    const result = insertUserSchema.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ 
          message: "Invalid input",
          errors: result.error.issues.map(i => i.message)
        });
    }

    passport.authenticate("local", (err: any, user: Express.User | false, info: IVerifyOptions) => {
      if (err) {
        console.error('Login error:', err);
        return next(err);
      }

      if (!user) {
        return res.status(401).json({ message: info.message || "Authentication failed" });
      }

      req.logIn(user, (err) => {
        if (err) {
          console.error('Login session error:', err);
          return next(err);
        }

        return res.json({
          message: "Login successful",
          user: { id: user.id, username: user.username },
        });
      });
    })(req, res, next);
  });

  // Register route with error handling
  app.post("/api/register", async (req, res, next) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid input",
          errors: result.error.issues.map(i => i.message)
        });
      }

      const { username, password } = result.data;

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await crypto.hash(password);

      const [newUser] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
        })
        .returning();

      req.login(newUser, (err) => {
        if (err) {
          console.error('Registration session error:', err);
          return next(err);
        }
        return res.json({
          message: "Registration successful",
          user: { id: newUser.id, username: newUser.username },
        });
      });
    } catch (error) {
      console.error('Registration error:', error);
      next(error);
    }
  });

  // Logout route with error handling
  app.post("/api/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // User info route
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json(req.user);
  });
}