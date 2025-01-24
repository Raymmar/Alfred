import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  openaiApiKey: text("openai_api_key"),
  defaultPrompt: text("default_prompt").default(DEFAULT_PRIMARY_PROMPT),
  todoPrompt: text("todo_prompt").default(DEFAULT_TODO_PROMPT),
  storageLocation: text("storage_location"),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  openAiKey: text("openai_api_key"),
  insightPrompt: text("insight_prompt").default(DEFAULT_PRIMARY_PROMPT),
  todoPrompt: text("todo_prompt").default(DEFAULT_TODO_PROMPT),
  systemPrompt: text("system_prompt").default(DEFAULT_SYSTEM_PROMPT),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  recordingUrl: text("recording_url"),
  transcription: text("transcription"),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  content: text("content").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const kanbanColumns = pgTable("kanban_columns", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'cascade' }),
  text: text("text").notNull(),
  completed: boolean("completed").default(false),
  columnId: integer("column_id").references(() => kanbanColumns.id),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chats = pgTable("chats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: 'cascade' }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Define a custom vector type for pgvector
const vector = (size: number) => text("embedding").notNull().$type(`vector(${size})`);

export const embeddings = pgTable("embeddings", {
  id: serial("id").primaryKey(),
  contentType: text("content_type").notNull(),
  contentId: integer("content_id").notNull(),
  contentText: text("content_text").notNull(),
  embedding: vector(384),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const userRelations = relations(users, ({ many, one }) => ({
  projects: many(projects),
  settings: one(settings, {
    fields: [users.id],
    references: [settings.userId],
  }),
}));

export const settingsRelations = relations(settings, ({ one }) => ({
  user: one(users, {
    fields: [settings.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  todos: many(todos),
  note: one(notes, {
    fields: [projects.id],
    references: [notes.projectId],
  }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  project: one(projects, {
    fields: [notes.projectId],
    references: [projects.id],
  }),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  project: one(projects, {
    fields: [todos.projectId],
    references: [projects.id],
  }),
  column: one(kanbanColumns, {
    fields: [todos.columnId],
    references: [kanbanColumns.id],
  }),
}));

export const kanbanColumnsRelations = relations(kanbanColumns, ({ many }) => ({
  todos: many(todos),
}));

export const chatRelations = relations(chats, ({ one }) => ({
  user: one(users, {
    fields: [chats.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
}));

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  project: one(projects, {
    fields: [embeddings.contentId],
    references: [projects.id],
    relationName: "project_embeddings",
  }),
  chat: one(chats, {
    fields: [embeddings.contentId],
    references: [chats.id],
    relationName: "chat_embeddings",
  }),
  todo: one(todos, {
    fields: [embeddings.contentId],
    references: [todos.id],
    relationName: "todo_embeddings",
  }),
}));

// Schema exports
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;

export const insertSettingsSchema = createInsertSchema(settings);
export const selectSettingsSchema = createSelectSchema(settings);
export type InsertSettings = typeof settings.$inferInsert;
export type SelectSettings = typeof settings.$inferSelect;

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);
export type InsertProject = typeof projects.$inferInsert;
export type SelectProject = typeof projects.$inferSelect;

export const insertTodoSchema = createInsertSchema(todos);
export const selectTodoSchema = createSelectSchema(todos);
export type InsertTodo = typeof todos.$inferInsert;
export type SelectTodo = typeof todos.$inferSelect;

export const insertKanbanColumnSchema = createInsertSchema(kanbanColumns);
export const selectKanbanColumnSchema = createSelectSchema(kanbanColumns);
export type InsertKanbanColumn = typeof kanbanColumns.$inferInsert;
export type SelectKanbanColumn = typeof kanbanColumns.$inferSelect;

export const insertNoteSchema = createInsertSchema(notes);
export const selectNoteSchema = createSelectSchema(notes);
export type InsertNote = typeof notes.$inferInsert;
export type SelectNote = typeof notes.$inferSelect;

export const insertChatSchema = createInsertSchema(chats);
export const selectChatSchema = createSelectSchema(chats);
export type InsertChat = typeof chats.$inferInsert;
export type SelectChat = typeof chats.$inferSelect;

export const insertEmbeddingSchema = createInsertSchema(embeddings);
export const selectEmbeddingSchema = createSelectSchema(embeddings);
export type InsertEmbedding = typeof embeddings.$inferInsert;
export type SelectEmbedding = typeof embeddings.$inferSelect;