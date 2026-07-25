/**
 * @fileoverview Adapter OpenAI-compatible: traduce la interfaz {@link LLMProvider} a la API REST de OpenAI.
 * Soporta OpenAI, OpenRouter, Groq y Cloudflare Workers AI mediante el SDK `openai`.
 */
import OpenAI from "openai";
import type {
  LLMProvider,
  ChatMessage,
  GenerateResponseOptions,
} from "../interfaces/llm-provider.interface.js";
import type { ChatImagePart, ChecklistResult } from "@theforge/shared-types";
import type { UserLLMRuntime } from "../providers/llm-runtime.types.js";
import { resolveLlmMaxTokensForWorkshopTab } from "../config/llm-config.js";
import { llmDebug } from "../config/llm-debug.util.js";
import { runWithModelFallback } from "../config/llm-model-fallback.js";
import { recordTokenUsageFromContext } from "../utils/token-usage-recorder.js";

function buildOpenAiUserMessage(
  text: string,
  images?: ChatImagePart[],
): OpenAI.Chat.ChatCompletionUserMessageParam {
  const trimmed = text.trim();
  const hasImages = images != null && images.length > 0;
  if (!hasImages) {
    return { role: "user", content: trimmed.length > 0 ? trimmed : "(sin texto)" };
  }
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  parts.push({
    type: "text",
    text:
      trimmed.length > 0
        ? trimmed
        : "(El usuario adjuntó solo imágenes; intégralas según el contexto de la conversación y el documento activo.)",
  });
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }
  return { role: "user", content: parts };
}

function historyToOpenAiMessages(history: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.map((m) => {
    if (m.role === "assistant") {
      return { role: "assistant", content: m.content };
    }
    return { role: "user", content: m.content };
  });
}

function optionalDefaultHeaders(runtime: UserLLMRuntime): Record<string, string> | undefined {
  if (runtime.providerId === "openrouter") {
    const referer =
      (typeof runtime.extras?.httpReferer === "string" && runtime.extras.httpReferer.trim()) ||
      undefined;
    const title =
      (typeof runtime.extras?.appTitle === "string" && runtime.extras.appTitle.trim()) || undefined;
    if (!referer && !title) return undefined;
    return {
      ...(referer ? { "HTTP-Referer": referer } : {}),
      ...(title ? { "X-OpenRouter-Title": title } : {}),
    };
  }

  const raw = runtime.extras?.headers;
  if (raw == null) return undefined;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string" && v.length > 0) out[k] = v;
        }
        return Object.keys(out).length > 0 ? out : undefined;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function chatModelChain(runtime: UserLLMRuntime): string[] {
  const primary = runtime.chatModel;
  const fallbacks = runtime.chatModelFallbacks ?? [];
  const seen = new Set<string>([primary]);
  const chain = [primary];
  for (const m of fallbacks) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    chain.push(m);
  }
  return chain;
}

function visionModelChain(runtime: UserLLMRuntime): string[] {
  const primary = runtime.visionModel?.trim() || "";
  if (!primary) return [];
  const vf =
    typeof runtime.extras?.visionModelFallback === "string"
      ? runtime.extras.visionModelFallback.trim()
      : "";
  const dedupe = (models: string[]) =>
    models.filter((m, i, a) => Boolean(m) && a.indexOf(m) === i);
  return vf ? dedupe([primary, vf]) : [primary];
}

export class OpenAICompatibleAdapter implements LLMProvider {
  private static warnedEmbeddingOff = false;

  private readonly chatClient: OpenAI;
  private readonly embeddingClient: OpenAI;
  private readonly chatModels: string[];
  private readonly visionModels: string[];
  private readonly embeddingModel: string | null;
  private readonly embeddingsEnabled: boolean;
  private readonly label: string;
  private readonly runtime: UserLLMRuntime;

  constructor(runtime: UserLLMRuntime) {
    this.runtime = runtime;
    this.label = `OpenAICompatibleAdapter(${runtime.providerId})`;
    this.chatModels = chatModelChain(runtime);
    this.visionModels = visionModelChain(runtime);
    llmDebug("OpenAICompatibleAdapter", "adapter creado", {
      providerId: runtime.providerId,
      chatModels: this.chatModels,
      visionModels: this.visionModels,
      baseURL: runtime.baseURL ?? null,
    });
    this.embeddingModel = runtime.embeddingModel;
    this.embeddingsEnabled = runtime.embeddingsEnabled && !!runtime.embeddingModel;
    const headers = optionalDefaultHeaders(runtime);
    this.chatClient = new OpenAI({
      apiKey: runtime.apiKey,
      baseURL: runtime.baseURL,
      defaultHeaders: headers,
    });
    this.embeddingClient = new OpenAI({
      apiKey: runtime.apiKey,
      baseURL: runtime.baseURL,
      defaultHeaders: headers,
    });
  }

  async generateResponse(
    prompt: string,
    history: ChatMessage[],
    options?: GenerateResponseOptions,
  ): Promise<string> {
    const hasImages = options?.userMessageImages != null && options.userMessageImages.length > 0;
    const models = hasImages ? this.visionModels : this.chatModels;

    const result = await runWithModelFallback({
      models,
      label: `${this.label}.generateResponse`,
      run: async (activeModel) => {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push(
          ...historyToOpenAiMessages(history),
          buildOpenAiUserMessage(prompt, options?.userMessageImages),
        );

        const completion = await this.chatClient.chat.completions.create({
          model: activeModel,
          messages,
          max_tokens:
            options?.maxTokensOverride ??
            resolveLlmMaxTokensForWorkshopTab(options?.activeTab, {
              welcomeBrief: options?.welcomeBrief,
            }),
          ...(options?.jsonObjectMode ? { response_format: { type: "json_object" as const } } : {}),
        });

        return completion;
      },
    });

    const usage = result.usage;
    if (usage) {
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
      recordTokenUsageFromContext(
        this.runtime.providerId,
        result.model,
        promptTokens,
        completionTokens,
        totalTokens,
      );
    }

    return result.choices[0]?.message?.content ?? "";
  }

  async generateResponseStream(
    prompt: string,
    history: ChatMessage[],
    options?: GenerateResponseOptions,
  ): Promise<AsyncIterable<string>> {
    const hasImages = options?.userMessageImages != null && options.userMessageImages.length > 0;
    const models = hasImages ? this.visionModels : this.chatModels;

    llmDebug("OpenAICompatibleAdapter", "generateResponseStream", {
      label: this.label,
      hasImages,
      models,
      activeTab: options?.activeTab ?? null,
      historyTurns: history.length,
    });

    const stream = await runWithModelFallback({
      models,
      label: `${this.label}.generateResponseStream`,
      run: async (activeModel) => {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push(
          ...historyToOpenAiMessages(history),
          buildOpenAiUserMessage(prompt, options?.userMessageImages),
        );

        return this.chatClient.chat.completions.create({
          model: activeModel,
          messages,
          max_tokens:
            options?.maxTokensOverride ??
            resolveLlmMaxTokensForWorkshopTab(options?.activeTab, {
              welcomeBrief: options?.welcomeBrief,
            }),
          stream: true,
          stream_options: { include_usage: true },
        });
      },
    });

    const providerId = this.runtime.providerId;
    let resolvedModel = models[0] ?? this.runtime.chatModel;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield delta;
          }
          if (chunk.model) resolvedModel = chunk.model;
          const usage = (chunk as { usage?: OpenAI.CompletionUsage | null }).usage;
          if (usage) {
            const promptTokens = usage.prompt_tokens ?? 0;
            const completionTokens = usage.completion_tokens ?? 0;
            const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
            recordTokenUsageFromContext(
              providerId,
              resolvedModel,
              promptTokens,
              completionTokens,
              totalTokens,
            );
          }
        }
      },
    };
  }

  async parseChecklist(text: string): Promise<ChecklistResult> {
    try {
      const response = await runWithModelFallback({
        models: this.chatModels,
        label: `${this.label}.parseChecklist`,
        run: (model) =>
          this.chatClient.chat.completions.create({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Parse the following text and return a JSON object with keys: complete (boolean), items (array of {key, present, value?}).",
              },
              { role: "user", content: text },
            ],
            response_format: { type: "json_object" },
          }),
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
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
    if (!this.embeddingsEnabled || !this.embeddingModel) {
      if (!OpenAICompatibleAdapter.warnedEmbeddingOff) {
        OpenAICompatibleAdapter.warnedEmbeddingOff = true;
        console.warn(
          `[${this.label}] Embeddings desactivados para este usuario/proveedor.`,
        );
      }
      return [];
    }

    try {
      const resp = await this.embeddingClient.embeddings.create({
        model: this.embeddingModel,
        input: text.replace(/\n/g, " "),
      });
      return resp.data[0]?.embedding ?? [];
    } catch (err) {
      console.error(`[${this.label}] generateEmbedding error:`, err);
      return [];
    }
  }
}
