import { getOpenAIClient, AIServiceConfig, handleAIError, CHAT_MODEL } from "./config";

export interface TitleGenerationOptions extends AIServiceConfig {
  maxLength?: number;
}

export interface TitleResult {
  title: string;
  confidence: number;
}

const DEFAULT_TITLE_PROMPT = `Generate a concise, descriptive title for this content. The title should:
- Be clear and informative
- Not exceed 60 characters
- Capture the main topic or purpose
- Not include generic phrases like "Meeting Notes" or "Discussion About"
- Be professional and straightforward

Respond in JSON format with:
{
  "title": "The generated title",
  "confidence": 0.95 // confidence score between 0 and 1
}`;

export async function generateTitle(
  text: string,
  options: TitleGenerationOptions
): Promise<TitleResult> {
  try {
    const openai = await getOpenAIClient(options.userId);

    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { 
          role: "system", 
          content: DEFAULT_TITLE_PROMPT
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const result = JSON.parse(content || "{}");

    return {
      title: result.title || "Untitled Project",
      confidence: result.confidence || 0,
    };
  } catch (error) {
    handleAIError(error);
  }
}
