/**
 * @fileoverview Adapter Google Gemini: implementa {@link LLMProvider} contra la API generateContent de Gemini.
 * Usa el SDK `@google/generative-ai` con streaming nativo.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  LLMProvider,
  ChatMessage,
  GenerateResponseOptions,
} from "../interfaces/llm-provider.interface.js";
import type { ChatImagePart, ChecklistResult } from "@theforge/shared-types";
import type { UserLLMRuntime } from "../providers/llm-runtime.types.js";
import { recordTokenUsageFromContext } from "../utils/token-usage-recorder.js";

function extractGeminiUsage(metadata: unknown): {
  promptTokens: number;
  completionTokens: number;
} {
  if (!metadata || typeof metadata !== "object") return { promptTokens: 0, completionTokens: 0 };
  const m = metadata as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  return {
    promptTokens: m.promptTokenCount ?? 0,
    completionTokens: m.candidatesTokenCount ?? 0,
  };
}

function historyToGemini(history: ChatMessage[]): { role: string; parts: { text: string }[] }[] {
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function imageParts(images?: ChatImagePart[]): { inlineData: { mimeType: string; data: string } }[] {
  return (images ?? []).map((img) => ({
    inlineData: { mimeType: img.mimeType, data: img.base64 },
  }));
}

export class GeminiAdapter implements LLMProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly chatModel: string;
  private readonly embeddingModel: string | null;
  private readonly embeddingsEnabled: boolean;

  constructor(runtime: UserLLMRuntime) {
    this.genAI = new GoogleGenerativeAI(runtime.apiKey);
    this.chatModel = runtime.chatModel;
    this.embeddingModel = runtime.embeddingModel;
    this.embeddingsEnabled = runtime.embeddingsEnabled && !!runtime.embeddingModel;
  }

  private getModel(systemPrompt?: string) {
    return this.genAI.getGenerativeModel({
      model: this.chatModel,
      systemInstruction: systemPrompt,
    });
  }

  async generateResponse(
    prompt: string,
    history: ChatMessage[],
    options?: GenerateResponseOptions,
  ): Promise<string> {
    const model = this.getModel(options?.systemPrompt);
    const chat = model.startChat({ history: historyToGemini(history) });
    const parts = [{ text: prompt }, ...imageParts(options?.userMessageImages)];
    const res = await chat.sendMessage(parts);
    const usage = extractGeminiUsage(res.response.usageMetadata);
    if (usage.promptTokens || usage.completionTokens) {
      recordTokenUsageFromContext(
        "gemini",
        this.chatModel,
        usage.promptTokens,
        usage.completionTokens,
        usage.promptTokens + usage.completionTokens,
      );
    }
    return res.response.text();
  }

  async generateResponseStream(
    prompt: string,
    history: ChatMessage[],
    options?: GenerateResponseOptions,
  ): Promise<AsyncIterable<string>> {
    const model = this.getModel(options?.systemPrompt);
    const chat = model.startChat({ history: historyToGemini(history) });
    const parts = [{ text: prompt }, ...imageParts(options?.userMessageImages)];
    const res = await chat.sendMessageStream(parts);

    let promptTokens = 0;
    let completionTokens = 0;
    const chatModel = this.chatModel;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of res.stream) {
          const t = chunk.text();
          if (t) yield t;
          const usage = extractGeminiUsage(chunk.usageMetadata);
          if (usage.promptTokens) promptTokens = usage.promptTokens;
          if (usage.completionTokens) completionTokens = usage.completionTokens;
        }
        if (promptTokens || completionTokens) {
          recordTokenUsageFromContext(
            "gemini",
            chatModel,
            promptTokens,
            completionTokens,
            promptTokens + completionTokens,
          );
        }
      },
    };
  }

  async parseChecklist(text: string): Promise<ChecklistResult> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: this.chatModel,
        systemInstruction:
          "Parse the following text and return a JSON object with keys: complete (boolean), items (array of {key, present, value?}).",
      });
      const res = await model.generateContent(text);
      const raw = res.response.text();
      const parsed = JSON.parse(raw) as ChecklistResult;
      return {
        complete: Boolean(parsed.complete),
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    } catch {
      return { complete: false, items: [] };
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingsEnabled || !this.embeddingModel) return [];
    try {
      const model = this.genAI.getGenerativeModel({ model: this.embeddingModel });
      const res = await model.embedContent(text.replace(/\n/g, " "));
      return res.embedding.values ?? [];
    } catch (err) {
      console.error("[GeminiAdapter] generateEmbedding error:", err);
      return [];
    }
  }
}
