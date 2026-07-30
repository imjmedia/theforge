/**
 * @fileoverview Estrategia de reintento para llamadas LLM en el pipeline MDD.
 */

/**
 * Retry helper para invocaciones LLM en el pipeline MDD.
 *
 * Por qué existe: los nodos LLM (SoftwareArchitect, Clarifier, LLMFormatter,
 * Auditor) reciben el texto crudo y, si viene vacío, caen a fallback
 * ("borrador sin transformar", "usando fallback", "determinístico con gaps
 * estructurados") que degrada el MDD persistido. El log real (job 92 del
 * proyecto ForgeOps, 2026-07-22 05:35–05:59) muestra 4 de 9 invocaciones
 * devolviendo texto vacío por rate-limit del proveedor, sin reintento.
 *
 * El nodo Security ya tenía retry 1x implementado in-line; este util
 * generaliza el patrón a los demás nodos con backoff exponencial y un
 * validador opcional (p. ej. "el texto no es sólo whitespace y tiene
 * al menos N caracteres").
 *
 * ⚠️  Scope: sólo para los nodos LLM del pipeline MDD. El chat interactivo
 * (SessionsService) sigue su propia política de retry/backoff vía
 * SessionsService.invokeWelcomeLlmWithRetries y modelos rate-limited.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";
import { recordTokenUsageFromContext } from "../../ai/utils/token-usage-recorder.js";
import { isLlmStreamingEnabled, resolveLlmTimeoutMs } from "./mdd-llm-timeout.util.js";
import {
  invokeLlmStreamingWithIdleTimeout,
  supportsStreaming,
  type StreamableLlmLike,
} from "./mdd-llm-stream-invoke.util.js";

const DEFAULT_BACKOFF_MS = [0, 1500, 4000];
const DEFAULT_INVOKE_TIMEOUT_MS = resolveLlmTimeoutMs();

export type LlmToolCallLike = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};

function blockToText(block: unknown): string {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  const o = block as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.content === "string") return o.content;
  if (o.type === "text" && typeof o.text === "string") return o.text;
  return "";
}

function normalizeToolCallArgs(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeToolCallEntry(entry: unknown): LlmToolCallLike | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const fn = o.function as { name?: string; arguments?: unknown } | undefined;
  const name =
    (typeof o.name === "string" && o.name) ||
    (typeof fn?.name === "string" && fn.name) ||
    "";
  if (!name) return null;
  const args = normalizeToolCallArgs(o.args ?? fn?.arguments ?? o.arguments);
  const id = typeof o.id === "string" ? o.id : undefined;
  return { id, name, args };
}

/** Extrae tool_calls de AIMessage en formas LangChain / OpenAI-compat / nested. */
export function extractLlmToolCalls(response: unknown): LlmToolCallLike[] {
  if (response == null || typeof response !== "object") return [];
  const root = response as Record<string, unknown>;
  const candidates: unknown[] = [
    root.tool_calls,
    (root.additional_kwargs as { tool_calls?: unknown } | undefined)?.tool_calls,
    (root.kwargs as { tool_calls?: unknown } | undefined)?.tool_calls,
    (root.response_metadata as { tool_calls?: unknown } | undefined)?.tool_calls,
  ];
  for (const raw of candidates) {
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const parsed = raw
      .map((entry) => normalizeToolCallEntry(entry))
      .filter((tc): tc is LlmToolCallLike => tc != null);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

/** True si la respuesta tiene tool_calls parseables aunque content esté vacío. */
export function llmResponseHasUsableToolCalls(response: unknown): boolean {
  return extractLlmToolCalls(response).length > 0;
}

/** Extrae texto plano de un AIMessage de LangChain (string content o array de bloques). */
export function extractLlmText(response: unknown): string {
  if (response == null) return "";
  if (typeof response === "string") return response;
  if (typeof response !== "object") return "";
  const content = (response as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => blockToText(block)).join("");
  }
  return "";
}

export type InvokeWithRetryOptions = {
  /** Etiqueta corta para logs: "SoftwareArchitect", "Clarifier", etc. */
  tag: string;
  /** Intentos totales incluyendo el primero. Default 3. */
  maxAttempts?: number;
  /** Backoff en ms antes de cada intento (index = intento-1). Default [0, 1500, 4000]. */
  backoffMs?: number[];
  /**
   * Validador del texto devuelto. Si retorna `false`, se considera respuesta
   * vacía/inválida y se reintenta. Default: texto no-vacío tras trim.
   */
  isResponseValid?: (text: string) => boolean;
  /** Si true, tool_calls sin texto cuentan como respuesta válida (loops de herramientas). */
  acceptToolCallsWithoutContent?: boolean;
  /** Timeout por llamada LLM (ms). Si se excede, aborta y reintenta. Default 120_000 (2 min). */
  timeoutMs?: number;
  /**
   * Fuerza el modo no-streaming (wall-clock `timeoutMs`) para esta llamada.
   * Por defecto se usa streaming con timeout de inactividad cuando el runnable
   * expone `.stream()` — ver `mdd-llm-stream-invoke.util.ts`.
   */
  disableStreaming?: boolean;
  /** Ms sin recibir chunk antes de abortar (streaming). Default `LANGGRAPH_LLM_IDLE_TIMEOUT_MS`. */
  idleTimeoutMs?: number;
  /** Tope duro por invocación en streaming. Default `LANGGRAPH_LLM_HARD_TIMEOUT_MS`. */
  hardTimeoutMs?: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Tipo del objeto invocable: BaseChatModel directo o Runnable.bindTools(...).
 * Ambos exponen `.invoke(messages): Promise<unknown>`.
 */
export type InvokableLlm = BaseChatModel | Runnable<BaseMessage[], unknown>;

/**
 * Invoca el LLM con retry automático cuando la respuesta es vacía o falla
 * el validador. Devuelve la respuesta cruda o `null` si TODOS los intentos
 * fallan — el caller decide el fallback (devolver borrador sin transformar,
 * determinístico, etc.).
 */
export async function invokeLlmWithRetry(
  llm: InvokableLlm,
  messages: BaseMessage[],
  options: InvokeWithRetryOptions,
): Promise<unknown> {
  const max = Math.max(1, options.maxAttempts ?? 3);
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const isValid = options.isResponseValid ?? ((t) => t.trim().length > 0);
  const acceptTools = options.acceptToolCallsWithoutContent === true;
  const tag = options.tag || "LLM";
  const promptChars = messages.reduce((acc, m) => {
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string") return acc + c.length;
    if (Array.isArray(c)) {
      return acc + c.reduce((a, b) => a + (typeof b === "string" ? b.length : JSON.stringify(b).length), 0);
    }
    return acc;
  }, 0);

  // Se degrada a no-streaming si el proveedor rechaza `.stream()` (algunos endpoints
  // OpenAI-compat no lo soportan): reintentar en streaming fallaría igual.
  let streamingDegraded = false;
  // La degradación a no-streaming no debe consumir un intento (el fallo es de
  // transporte, no del modelo); se devuelve el intento una única vez.
  let degradeRefundUsed = false;

  for (let attempt = 1; attempt <= max; attempt += 1) {
    const wait = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
    if (wait > 0) await sleep(wait);
    try {
      const useStreaming =
        !options.disableStreaming &&
        !streamingDegraded &&
        isLlmStreamingEnabled() &&
        supportsStreaming(llm);

      let response: unknown;
      if (useStreaming) {
        let result: Awaited<ReturnType<typeof invokeLlmStreamingWithIdleTimeout>>;
        try {
          result = await invokeLlmStreamingWithIdleTimeout(llm as StreamableLlmLike, messages, {
            tag,
            ...(options.idleTimeoutMs != null ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
            ...(options.hardTimeoutMs != null ? { hardTimeoutMs: options.hardTimeoutMs } : {}),
          });
        } catch (streamErr) {
          const streamMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          if (!/abortado por (inactividad|tope duro)/.test(streamMsg)) {
            streamingDegraded = true;
            console.warn(`[${tag}] streaming no disponible (${streamMsg}); usando invoke no-streaming`);
          }
          throw streamErr;
        }
        if (result.chunks === 0) {
          streamingDegraded = true;
          console.warn(`[${tag}] stream sin chunks; reintentando con invoke no-streaming`);
          throw new Error(`[${tag}] stream vacío`);
        }
        response = result.response;
        console.log(
          `[${tag}] stream chunks=${result.chunks} firstChunkMs=${result.firstChunkMs} totalMs=${result.totalMs}`,
        );
      } else {
        const timeoutMs = options?.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
        try {
          response = await (llm as { invoke: (m: BaseMessage[], opts?: { signal?: AbortSignal }) => Promise<unknown> }).invoke(messages, { signal: abortController.signal });
        } finally {
          clearTimeout(timeoutId);
        }
      }
      recordLlmUsageFromMessage(llm, response, tag);
      const text = extractLlmText(response);
      const toolCalls = extractLlmToolCalls(response);
      const toolsOk = acceptTools && toolCalls.length > 0;
      if (toolsOk || isValid(text)) {
        if (attempt > 1) {
          console.log(
            `[${tag}] retry recuperó respuesta válida (attempt ${attempt}/${max}, promptChars=${promptChars}, outLen=${text.length}, tools=${toolCalls.length})`,
          );
        } else {
          console.log(
            `[${tag}] ok promptChars=${promptChars} outLen=${text.length} tools=${toolCalls.length}`,
          );
        }
        return response;
      }
      console.warn(
        `[${tag}] respuesta vacía/inválida (attempt ${attempt}/${max}, promptChars=${promptChars}, outLen=${text.length}, tools=${toolCalls.length}), reintentando...`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (streamingDegraded && !degradeRefundUsed) {
        degradeRefundUsed = true;
        attempt -= 1;
        console.warn(`[${tag}] reintento inmediato sin streaming tras: ${msg}`);
        continue;
      }
      console.warn(
        `[${tag}] error en LLM.invoke (attempt ${attempt}/${max}): ${msg}, reintentando...`,
      );
    }
  }
  console.error(`[${tag}] LLM sin respuesta válida tras ${max} intentos — devolviendo null`);
  return null;
}

/**
 * Extrae usage_metadata de un AIMessage de LangChain y lo registra en `TokenUsage`
 * si hay un contexto de telemetría activo. No-op si el LLM no expone usage.
 * El provider/modelo se derivan del llm pasado por parámetro (duck-typing).
 */
function recordLlmUsageFromMessage(
  llm: InvokableLlm,
  response: unknown,
  _tag: string,
): void {
  if (!response || typeof response !== "object") return;
  const message = response as {
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    response_metadata?: {
      tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
    };
  };
  const usage =
    message.usage_metadata ??
    (message.response_metadata?.tokenUsage
      ? {
          input_tokens: message.response_metadata.tokenUsage.promptTokens,
          output_tokens: message.response_metadata.tokenUsage.completionTokens,
          total_tokens: message.response_metadata.tokenUsage.totalTokens,
        }
      : undefined);
  if (!usage) return;
  const promptTokens = usage.input_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  if (!promptTokens && !completionTokens) return;
  const { providerId, modelId } = deriveLlmIdentity(llm);
  recordTokenUsageFromContext(
    providerId,
    modelId,
    promptTokens,
    completionTokens,
    totalTokens,
  );
}

/**
 * Extrae provider/modelo del `BaseChatModel` para registrar `TokenUsage`.
 *
 * Estrategia en cascada (de más fuerte a más débil):
 *  1. Nombre de clase (`ChatAnthropic`, `ChatGoogleGenerativeAI`, `ChatOpenAI`, …).
 *  2. `baseURL` de la instancia (donde `createDbgaLLM` guarda el endpoint del runtime).
 *     Captura OpenRouter, Cloudflare Workers AI, Groq y custom OpenAI-compat.
 *  3. Heurística del slug del modelo (prefijo upstream `anthropic/`, `openai/`, …
 *     implica OpenRouter; `@cf/…` implica Cloudflare).
 *  4. Default `openai` para ChatOpenAI nativo.
 *
 * Devuelve `"unknown"` para modelId si no se reconoce — el call se sigue
 * registrando, simplemente no se calcula coste.
 */
export function deriveLlmIdentity(llm: InvokableLlm): {
  providerId: string;
  modelId: string;
} {
  const candidate = llm as unknown as Record<string, unknown>;

  // Prioridad 0: providerId/modelId explícitos en el wrapper (telemetría precisa).
  // Los wrappers `OpenRouterFallbackChatModel` y `ChainedFallbackChatModel` envuelven
  // un `ChatOpenAI` (o similar) sin exponer `configuration.baseURL` ni `modelName`;
  // si el factory (create-dbga-llm) pasó `providerId`/`modelId`, los leemos directos.
  const explicitProvider = typeof candidate.providerId === "string" ? candidate.providerId : null;
  if (explicitProvider) {
    const explicitModel = typeof candidate.modelId === "string" ? candidate.modelId : null;
    return {
      providerId: explicitProvider,
      modelId: explicitModel ?? extractModelId(candidate) ?? "unknown",
    };
  }

  const modelId = extractModelId(candidate) ?? "unknown";
  const providerId = detectProviderFromClass(candidate) ?? detectProviderFromBaseURL(candidate) ?? detectProviderFromModelId(modelId) ?? "openai";
  return { providerId, modelId };
}

function extractModelId(candidate: Record<string, unknown>): string | null {
  // ChatOpenAI usa `modelName`; ChatAnthropic / ChatGoogleGenerativeAI / ChatBedrock usan `model`.
  if (typeof candidate.modelName === "string" && candidate.modelName.length > 0) {
    return candidate.modelName;
  }
  if (typeof candidate.model === "string" && candidate.model.length > 0) {
    return candidate.model;
  }
  return null;
}

function detectProviderFromClass(candidate: Record<string, unknown>): string | null {
  const className = (candidate.constructor as { name?: string })?.name ?? "";
  if (/Anthropic/i.test(className)) return "anthropic";
  if (/Bedrock/i.test(className)) return "bedrock";
  if (/Google|Gemini|GenAI/i.test(className)) return "gemini";
  // ChatOpenAI: no devolvemos aquí — esperamos la rama baseURL para distinguir
  // OpenAI directo de OpenRouter / Cloudflare / Groq / custom endpoints.
  return null;
}

function detectProviderFromBaseURL(candidate: Record<string, unknown>): string | null {
  const baseURL = readBaseURL(candidate);
  if (!baseURL) return null;
  if (/openrouter\.ai/i.test(baseURL)) return "openrouter";
  if (/generativelanguage\.googleapis\.com/i.test(baseURL)) return "gemini";
  if (/api\.anthropic\.com/i.test(baseURL)) return "anthropic";
  if (/api\.groq\.com/i.test(baseURL)) return "groq";
  if (/api\.cloudflare\.com/i.test(baseURL)) return "cloudflare";
  if (/api\.openai\.com/i.test(baseURL)) return "openai";
  // baseURL custom desconocido (proxy, OpenAI-compat propia): queda como "openai-compatible"
  // para que la UI lo distinga del nativo. El coste caerá a 0 si no hay pricing override.
  return "openai-compatible";
}

function readBaseURL(candidate: Record<string, unknown>): string | null {
  const tried: unknown[] = [
    candidate.baseURL,
    (candidate as { client?: { baseURL?: string } }).client?.baseURL,
    (candidate as { configuration?: { baseURL?: string } }).configuration?.baseURL,
    (candidate as { lc_kwargs?: { baseURL?: string } }).lc_kwargs?.baseURL,
    (candidate as { anthropicApiUrl?: string }).anthropicApiUrl,
    (candidate as { apiUrl?: string }).apiUrl,
  ];
  for (const value of tried) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function detectProviderFromModelId(modelId: string): string | null {
  if (!modelId || modelId === "unknown") return null;
  // OpenRouter usa slugs upstream con prefijo de proveedor.
  if (/^(anthropic|openai|google|meta-llama|minimax|qwen|cohere|mistralai|nvidia|deepseek)\//i.test(modelId)) {
    return "openrouter";
  }
  // Cloudflare Workers AI usa el prefijo @cf/.
  if (/^@cf\//i.test(modelId)) return "cloudflare";
  return null;
}
