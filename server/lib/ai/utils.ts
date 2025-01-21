import { marked } from 'marked';
import type { AIServiceConfig } from './types';
import { db } from "@db";
import { settings, users } from "@db/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

// Configure marked for clean HTML output
marked.setOptions({
  gfm: true,
  breaks: true,
});

export function convertMarkdownToHTML(markdown: string): string {
  if (!markdown) return '';

  try {
    const html = marked.parse(markdown);
    if (typeof html === 'string') {
      return html
        .replace(/\sstyle="[^"]*"/g, '')
        .replace(/\sclass="[^"]*"/g, '')
        .replace(/<p>\s*<\/p>/g, '')
        .replace(/\sdata-[^=]*="[^"]*"/g, '')
        .replace(/(\r?\n){3,}/g, '\n\n')
        .replace(/<\/li><li>/g, '</li>\n<li>')
        .replace(/<\/h([1-6])><h([1-6])>/g, '</h$1>\n<h$2>')
        .trim();
    }
    return String(html);
  } catch (error) {
    console.error('Error converting markdown to HTML:', error);
    return `<p>${markdown}</p>`;
  }
}

export async function getAIServiceConfig(userId: number): Promise<AIServiceConfig> {
  try {
    console.log('Getting AI service config for user:', userId);

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      console.error('User not found:', userId);
      throw new Error("User not found");
    }

    console.log('Found user:', { 
      id: user.id, 
      hasOpenAiKey: !!user.openaiApiKey 
    });

    const userSettings = await db.query.settings.findFirst({
      where: eq(settings.userId, userId),
    });

    console.log('User settings:', { 
      hasSettings: !!userSettings,
      hasSettingsApiKey: !!userSettings?.openAiKey 
    });

    // Prefer settings API key over user API key
    const apiKey = userSettings?.openAiKey || user.openaiApiKey;

    if (!apiKey) {
      console.error('OpenAI API key not found for user:', userId);
      throw new Error("OpenAI API key not found. Please add your API key in settings.");
    }

    const config = {
      apiKey,
      model: "gpt-4o",
      temperature: 0.7,
      maxTokens: 1000,
    };

    console.log('Created AI service config:', { 
      hasApiKey: !!config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens
    });

    return config;

  } catch (error) {
    console.error('Error getting AI service config:', error);
    throw error;
  }
}

export function createOpenAIClient(config: AIServiceConfig): OpenAI {
  if (!config.apiKey) {
    console.error('OpenAI API key is missing in config');
    throw new Error("OpenAI API key is required");
  }

  console.log('Creating OpenAI client with config:', {
    hasApiKey: !!config.apiKey,
    model: config.model
  });

  return new OpenAI({
    apiKey: config.apiKey,
  });
}

export function formatContextForPrompt(enhancedContext: any[]): string {
  if (!Array.isArray(enhancedContext) || enhancedContext.length === 0) {
    return 'No relevant context found.';
  }

  return enhancedContext
    .map(ctx => {
      if (!ctx || typeof ctx !== 'object') return '';

      const type = ctx.type || 'Unknown';
      const source = type.charAt(0).toUpperCase() + type.slice(1);
      const metadata = ctx.metadata ?
        `(${new Date(ctx.metadata.timestamp || ctx.metadata.created_at).toLocaleString()})` : '';
      const text = typeof ctx.text === 'string' ? ctx.text : 'No content available';

      return `[${source}] ${metadata}\n${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`;
    })
    .filter(Boolean)
    .join('\n\n');
}