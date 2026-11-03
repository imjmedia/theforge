import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI, type ChatOpenAICallOptions } from "@langchain/openai";
import { isModelExhaustionError, runWithModelFallback } from "../../ai/config/llm-model-fallback.js";
import {
  bindToolsOnChatModel,
  invokeAsChatResult,
  streamAsChatChunks,
  type BoundToolsConfig,
} from "./chat-model-generate.js";

/**
 * ChatOpenAI con cadena de modelos: solo hace fallback en errores de agotamiento (quota, 429 opcional, etc.).
 */
export class OpenRouterFallbackChatModel extends BaseChatModel {
  constructor(
    private readonly buildLlm: (model: string) => ChatOpenAI,
    private readonly models: string[],
    private readonly toolsConfig?: BoundToolsConfig,
    /**
     * Proveedor real para telemetría (TokenUsage). Enviado por `create-dbga-llm`.
     * El wrapper no expone `configuration.baseURL` de los `ChatOpenAI` internos,
     * así que `deriveLlmIdentity` lee este campo directamente cuando está presente.
     */
    private readonly providerId?: string,
    /**
     * Modelo primario de la cadena de fallback (`models[0]`). Sin esto,
     * `deriveLlmIdentity` cae a `extractModelId` que devuelve `null` para el
     * wrapper → `modelId="unknown"` → coste 0 USD en el catálogo.
     */
    private readonly modelId?: string,
  ) {
    super({});
  }

  /** Cadena de modelos efectiva en orden de fallback (solo lectura; la usa la clave de la caché por nodo). */
  get modelChain(): readonly string[] {
    return this.models;
  }

  _llmType(): string {
    return "openrouter-chat-fallback";
  }

  private resolveLlm(model: string) {
    return bindToolsOnChatModel(this.buildLlm(model), this.toolsConfig);
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const openAiOptions = options as ChatOpenAICallOptions;
    return runWithModelFallback({
      models: this.models,
      label: "OpenRouterFallbackChatModel._generate",
      run: async (model) => invokeAsChatResult(this.resolveLlm(model), messages, openAiOptions, runManager),
    });
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const openAiOptions = options as ChatOpenAICallOptions;
    let lastErr: unknown;
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i]!;
      let firstChunk: ChatGenerationChunk | undefined;
      let rest: AsyncIterator<ChatGenerationChunk> | undefined;
      try {
        await runWithModelFallback({
          models: [model],
          label: `OpenRouterFallbackChatModel._stream[${model}]`,
          run: async () => {
            const iter = streamAsChatChunks(this.resolveLlm(model), messages, openAiOptions, runManager);
            const first = await iter.next();
            if (first.done) throw new Error(`empty stream from ${model}`);
            firstChunk = first.value;
            rest = iter;
          },
        });
        yield firstChunk!;
        while (rest) {
          const next = await rest.next();
          if (next.done) break;
          yield next.value;
        }
        return;
      } catch (err) {
        lastErr = err;
        const hasNext = i < this.models.length - 1;
        if (!hasNext || !isModelExhaustionError(err)) throw err;
        console.warn(
          `[OpenRouterFallbackChatModel] modelo ${model} agotado, probando ${this.models[i + 1]}`,
        );
      }
    }
    throw lastErr;
  }

  bindTools(
    tools: Parameters<ChatOpenAI["bindTools"]>[0],
    kwargs?: Parameters<ChatOpenAI["bindTools"]>[1],
  ): BaseChatModel {
    return new OpenRouterFallbackChatModel(
      this.buildLlm,
      this.models,
      { tools, kwargs },
      this.providerId,
      this.modelId,
    );
  }
}
