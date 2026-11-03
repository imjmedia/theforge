import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { isModelExhaustionError, runWithModelFallback } from "../../ai/config/llm-model-fallback.js";
import {
  bindToolsOnChatModel,
  invokeAsChatResult,
  streamAsChatChunks,
  type BoundToolsConfig,
} from "./chat-model-generate.js";

/** Motivo del fallback registrado en el log: solo se cambia de modelo antes del primer chunk. */
export const CHAINED_FALLBACK_REASON_BEFORE_FIRST_CHUNK = "before_first_chunk";

/**
 * Anota en `response_metadata` qué modelo de la cadena produjo el mensaje.
 * - `chained_model_index`: índice en la cadena (número: se fusiona sin duplicarse entre chunks).
 * - `chained_model`: nombre del modelo (string; en streaming solo va en el primer chunk, ver arriba).
 */
function stampChainedModel(
  message: BaseMessage,
  model: string,
  index: number,
  { includeName = true }: { includeName?: boolean } = {},
): void {
  const meta: Record<string, unknown> = { ...(message.response_metadata ?? {}) };
  if (includeName) meta.chained_model = model;
  meta.chained_model_index = index;
  message.response_metadata = meta;
}

/**
 * True si el chunk lleva contenido útil para el consumidor: texto no vacío (string o partes de texto con
 * texto) o una llamada a herramienta (`tool_call_chunks`/`tool_calls`/`additional_kwargs`). Un chunk con
 * solo `role`, metadatos o uso (`usage_metadata`) NO cuenta: no hay nada que duplicar si luego se cambia
 * de modelo.
 */
export function chunkHasContent(chunk: ChatGenerationChunk): boolean {
  if (typeof chunk.text === "string" && chunk.text.length > 0) return true;
  const message = chunk.message as unknown as {
    content?: unknown;
    tool_call_chunks?: unknown[];
    tool_calls?: unknown[];
    additional_kwargs?: { tool_calls?: unknown[]; function_call?: unknown };
  };
  const content = message.content;
  if (typeof content === "string" && content.length > 0) return true;
  if (Array.isArray(content)) {
    const hasPart = content.some((part) => {
      if (typeof part === "string") return part.length > 0;
      if (!part || typeof part !== "object") return false;
      const p = part as { type?: unknown; text?: unknown };
      if (p.type === "text" || (p.type === undefined && "text" in p)) {
        return typeof p.text === "string" && p.text.length > 0;
      }
      return true; // tool_use, imagen, etc.
    });
    if (hasPart) return true;
  }
  if ((message.tool_call_chunks?.length ?? 0) > 0) return true;
  if ((message.tool_calls?.length ?? 0) > 0) return true;
  const kwargs = message.additional_kwargs;
  return (kwargs?.tool_calls?.length ?? 0) > 0 || kwargs?.function_call != null;
}

/**
 * Cadena de modelos sobre cualquier BaseChatModel: fallback solo en agotamiento (quota, 429, etc.).
 */
export class ChainedFallbackChatModel extends BaseChatModel {
  constructor(
    private readonly buildLlm: (model: string) => BaseChatModel,
    private readonly models: string[],
    private readonly toolsConfig?: BoundToolsConfig,
    params?: BaseChatModelParams,
    /**
     * Proveedor real para telemetría (TokenUsage). Enviado por `create-dbga-llm`.
     * El wrapper no expone `modelName` de los LLMs internos, así que
     * `deriveLlmIdentity` lee este campo directamente cuando está presente.
     */
    private readonly providerId?: string,
    /**
     * Modelo primario de la cadena de fallback (`models[0]`). Sin esto,
     * `deriveLlmIdentity` cae a `extractModelId` que devuelve `null` para el
     * wrapper → `modelId="unknown"` → coste 0 USD en el catálogo.
     */
    private readonly modelId?: string,
  ) {
    super(params ?? {});
  }

  /** Cadena de modelos efectiva en orden de fallback (solo lectura; la usa la clave de la caché por nodo). */
  get modelChain(): readonly string[] {
    return this.models;
  }

  _llmType(): string {
    return "chained-chat-fallback";
  }

  private resolveLlm(model: string) {
    return bindToolsOnChatModel(this.buildLlm(model), this.toolsConfig);
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    let usedModel = this.models[0];
    const result = await runWithModelFallback({
      models: this.models,
      label: "ChainedFallbackChatModel._generate",
      run: async (model) => {
        const res = await invokeAsChatResult(this.resolveLlm(model), messages, options, runManager);
        usedModel = model;
        return res;
      },
    });
    if (usedModel !== undefined) {
      const index = this.models.indexOf(usedModel);
      for (const gen of result.generations) stampChainedModel(gen.message, usedModel, index);
    }
    return result;
  }

  /**
   * El fallback de modelo solo aplica ANTES del primer contenido (error al abrir el stream o antes de
   * que llegue texto/tool call). Una vez emitido contenido (`chunkHasContent`), cualquier error se
   * relanza tal cual: cambiar de modelo re-streamearía desde cero y el consumidor concatenaría parcial
   * + respuesta completa.
   *
   * Los chunks sin contenido (solo `role`/metadatos/uso, o `content: ""` mientras un modelo con
   * razonamiento "piensa") se reenvían de inmediato SIN retenerlos: sirven de latido para el idle timeout
   * del consumidor. Se reenvían sin sellar (`chained_model`/`chained_model_index` solo se anotan desde el
   * primer chunk con contenido, que es cuando el modelo queda confirmado como el que responde). Si el
   * modelo falla antes de emitir contenido se hace fallback al siguiente aunque ya se hayan reenviado
   * chunks vacíos de este: el consumidor concatena vacío, lo cual es inofensivo. Antes de pasar al
   * siguiente modelo (o si el consumidor abandona el stream) se cierra el iterador abandonado (`return()`).
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    let lastErr: unknown;
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i]!;
      // True desde que sale el primer chunk con contenido: a partir de ahí no hay fallback.
      let emitted = false;
      let firstChunk: ChatGenerationChunk | undefined;
      let rest: AsyncIterator<ChatGenerationChunk> | undefined;
      // `chained_model` (string) solo en el primer chunk con contenido: LangChain concatena los strings de
      // `response_metadata` al fusionar chunks y repetirlo produciría "modelmodel...".
      let named = false;
      try {
        await runWithModelFallback({
          models: [model],
          label: `ChainedFallbackChatModel._stream[${model}]`,
          run: async () => {
            const iter = streamAsChatChunks(this.resolveLlm(model), messages, options, runManager);
            const first = await iter.next();
            if (first.done) throw new Error(`empty stream from ${model}`);
            firstChunk = first.value;
            rest = iter;
          },
        });
        let current: ChatGenerationChunk | undefined = firstChunk;
        while (current) {
          if (emitted || chunkHasContent(current)) {
            emitted = true;
            stampChainedModel(current.message, model, i, { includeName: !named });
            named = true;
          }
          yield current;
          const next = await rest!.next();
          current = next.done ? undefined : next.value;
        }
        return;
      } catch (err) {
        lastErr = err;
        if (emitted) throw err;
        const hasNext = i < this.models.length - 1;
        if (!hasNext || options?.signal?.aborted || !isModelExhaustionError(err)) throw err;
        console.warn(
          `[ChainedFallbackChatModel] modelo ${model} agotado, probando ${this.models[i + 1]} (reason=${CHAINED_FALLBACK_REASON_BEFORE_FIRST_CHUNK})`,
        );
      } finally {
        // Cierra el iterador del modelo (fallback al siguiente, error, o consumidor que abandona el stream
        // por abort/idle timeout): libera la conexión. No-op si ya terminó.
        try {
          await rest?.return?.();
        } catch {
          // best-effort: el error relevante es el original.
        }
      }
    }
    throw lastErr;
  }

  bindTools(
    tools: StructuredToolInterface[],
    kwargs?: Record<string, unknown>,
  ): BaseChatModel {
    return new ChainedFallbackChatModel(
      this.buildLlm,
      this.models,
      { tools, kwargs },
      undefined,
      this.providerId,
      this.modelId,
    );
  }
}
