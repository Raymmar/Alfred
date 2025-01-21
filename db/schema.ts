import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { DEFAULT_PRIMARY_PROMPT, DEFAULT_TODO_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  openai_api_key: text("openai_api_key"),
  default_prompt: text("default_prompt").default(DEFAULT_PRIMARY_PROMPT),
  todo_prompt: text("todo_prompt").default(DEFAULT_TODO_PROMPT),
  system_prompt: text("system_prompt").default(DEFAULT_SYSTEM_PROMPT),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Settings table
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  openai_api_key: text("openai_api_key"),
  default_prompt: text("default_prompt").default(DEFAULT_PRIMARY_PROMPT),
  todo_prompt: text("todo_prompt").default(DEFAULT_TODO_PROMPT),
  system_prompt: text("system_prompt").default(DEFAULT_SYSTEM_PROMPT),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Projects table
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  description: text("description"),
  recording_url: text("recording_url"),
  transcription: text("transcription"),
  summary: text("summary"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Notes table
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  content: text("content").default(""),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Kanban columns
export const kanban_columns = pgTable("kanban_columns", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  order: integer("order").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Todos
export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  project_id: integer("project_id").references(() => projects.id, { onDelete: 'cascade' }),
  column_id: integer("column_id").references(() => kanban_columns.id, { onDelete: 'set null' }),
  text: text("text").notNull(),
  completed: boolean("completed").default(false),
  order: integer("order").notNull().default(0),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Chats
export const chats = pgTable("chats", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  project_id: integer("project_id").references(() => projects.id, { onDelete: 'cascade' }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Relations
export const userRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  todos: many(todos),
  kanban_columns: many(kanban_columns),
  chats: many(chats),
  settings: many(settings),
}));

export const settingsRelations = relations(settings, ({ one }) => ({
  user: one(users, {
    fields: [settings.user_id],
    references: [users.id],
  }),
}));

export const projectRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.user_id],
    references: [users.id],
  }),
  notes: many(notes),
  todos: many(todos),
  chats: many(chats),
}));

export const noteRelations = relations(notes, ({ one }) => ({
  project: one(projects, {
    fields: [notes.project_id],
    references: [projects.id],
  }),
}));

export const todoRelations = relations(todos, ({ one }) => ({
  user: one(users, {
    fields: [todos.user_id],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [todos.project_id],
    references: [projects.id],
  }),
  column: one(kanban_columns, {
    fields: [todos.column_id],
    references: [kanban_columns.id],
  }),
}));

export const kanbanColumnRelations = relations(kanban_columns, ({ one, many }) => ({
  user: one(users, {
    fields: [kanban_columns.user_id],
    references: [users.id],
  }),
  todos: many(todos),
}));

export const chatRelations = relations(chats, ({ one }) => ({
  user: one(users, {
    fields: [chats.user_id],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [chats.project_id],
    references: [projects.id],
  }),
}));

// Export schemas
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

export const insertNoteSchema = createInsertSchema(notes);
export const selectNoteSchema = createSelectSchema(notes);
export type InsertNote = typeof notes.$inferInsert;
export type SelectNote = typeof notes.$inferSelect;

export const insertTodoSchema = createInsertSchema(todos);
export const selectTodoSchema = createSelectSchema(todos);
export type InsertTodo = typeof todos.$inferInsert;
export type SelectTodo = typeof todos.$inferSelect;

export const insertKanbanColumnSchema = createInsertSchema(kanban_columns);
export const selectKanbanColumnSchema = createSelectSchema(kanban_columns);
export type InsertKanbanColumn = typeof kanban_columns.$inferInsert;
export type SelectKanbanColumn = typeof kanban_columns.$inferSelect;

export const insertChatSchema = createInsertSchema(chats);
export const selectChatSchema = createSelectSchema(chats);
export type InsertChat = typeof chats.$inferInsert;
export type SelectChat = typeof chats.$inferSelect;