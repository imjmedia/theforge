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
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import {
  extractChainedModel,
  recordTokenUsageFromContext,
  recordUsageEstimateOnAbort,
} from "../../ai/utils/token-usage-recorder.js";
import {
  getActiveTokenUsageContext,
  type TokenUsageOutcome,
} from "../token-usage/token-usage.context.js";
import { isLlmStreamingEnabled, resolveLlmTimeoutMs } from "./mdd-llm-timeout.util.js";
import {
  createLlmAbortError,
  getActiveLlmAbortSignal,
  invokeLlmStreamingWithIdleTimeout,
  readPartialText,
  supportsStreaming,
  type StreamableLlmLike,
} from "./mdd-llm-stream-invoke.util.js";

import { classifyLlmError } from "./llm-error-classify.util.js";
import {
  extractLlmFinishReason,
  isLlmOutputTruncated,
  LLM_TRUNCATION_CONTINUATION_PROMPT,
  LlmOutputTruncatedError,
} from "./llm-output-truncation.util.js";

export {
  extractLlmFinishReason,
  isLlmOutputTruncated,
  LlmOutputTruncatedError,
} from "./llm-output-truncation.util.js";

export { getActiveLlmAbortSignal, runWithLlmAbortSignal } from "./mdd-llm-stream-invoke.util.js";

const DEFAULT_BACKOFF_MS = [0, 1500, 4000];
const DEFAULT_INVOKE_TIMEOUT_MS = resolveLlmTimeoutMs();
/** Jitter del backoff: ±20 % para evitar reintentos sincronizados entre nodos paralelos. */
const BACKOFF_JITTER_RATIO = 0.2;

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
   * El segundo argumento es la respuesta cruda (p. ej. `{ raw, parsed }` de structured output con
   * `includeRaw`), para validar objetos que no viajan en el texto. Una respuesta inválida se traza como `invalid`.
   */
  isResponseValid?: (text: string, response: unknown) => boolean;
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
  /**
   * Señal externa de cancelación (p. ej. `config.signal` de LangGraph). Si no se pasa se usa
   * `getActiveLlmAbortSignal()` (AsyncLocalStorage fijado por el servicio alrededor de `graph.stream`).
   * Al dispararse: se aborta la llamada en vuelo, se corta el backoff y NO se reintenta (lanza AbortError).
   */
  signal?: AbortSignal;
  /**
   * Sólo para pruebas: espera inyectable (por defecto un sleep cancelable real). Recibe los ms
   * efectivos de cada espera (backoff con jitter o `retry-after` del proveedor).
   */
  waitFn?: (ms: number, signal: AbortSignal | undefined, tag: string) => Promise<void>;
  /** Sólo para pruebas: fuente de aleatoriedad `[0,1)` del jitter. Default `Math.random`. */
  random?: () => number;
  /** Sólo para pruebas: reloj (ms) con el que se mide la latencia por intento. Default `Date.now`. */
  now?: () => number;
  /**
   * Si true (default), ante truncado por límite de tokens se reintenta una vez pidiendo continuación.
   * Si sigue truncado, lanza `LlmOutputTruncatedError`.
   */
  allowTruncationContinuation?: boolean;
  /**
   * Identidad (proveedor/modelo configurado) con la que se registra el uso. Obligatoria en la práctica
   * cuando se invoca un runnable derivado del modelo (`withStructuredOutput`, `bindTools`…), que no
   * expone identidad: sin ella la fila saldría con modelo `unknown`. Pasar `deriveLlmIdentity(llmBase)`.
   */
  identityOverride?: { providerId: string; modelId: string };
};

/** Traza de una invocación completa (todos sus intentos) para el log `[MDD:LlmCall]` (O14). */
type LlmCallTrace = {
  tag: string;
  /** Último intento lanzado (1-based). */
  attempts: number;
  /** Latencia del último intento (ms): la misma que se registra en `TokenUsage`. */
  latencyMs: number | null;
  /** Desde el primer intento hasta salir, incluyendo backoff (ms). */
  totalMs: number;
  outcome: TokenUsageOutcome;
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: boolean;
  modelActual: string | null;
  lastError: { kind: string; reason: string } | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sleep cancelable: resuelve al cumplirse `ms` o rechaza con AbortError si la señal dispara. */
function sleepAbortable(ms: number, signal: AbortSignal | undefined, tag: string): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(createLlmAbortError(tag));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(createLlmAbortError(tag));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Backoff ±20 % (acotado a >= 0). */
function applyJitter(ms: number, random: () => number): number {
  const factor = 1 + (random() * 2 - 1) * BACKOFF_JITTER_RATIO;
  return Math.max(0, Math.round(ms * factor));
}

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
  const now = options.now ?? Date.now;
  const startedAt = now();
  const trace: LlmCallTrace = {
    tag: options.tag || "LLM",
    attempts: 0,
    latencyMs: null,
    totalMs: 0,
    outcome: "error",
    promptTokens: null,
    completionTokens: null,
    estimated: false,
    modelActual: null,
    lastError: null,
  };
  try {
    return await invokeLlmWithRetryInner(llm, messages, options, trace, now);
  } catch (err) {
    if (trace.outcome === "ok" || trace.outcome === "invalid") trace.outcome = "error";
    throw err;
  } finally {
    trace.totalMs = Math.max(0, now() - startedAt);
    logLlmCall(llm, trace, options.identityOverride);
  }
}

/**
 * Resultado de traza para una cancelación externa: `timeout` si la causa es el agotamiento del presupuesto
 * del nodo (DeadlineExceededError, ver mdd-llm-structured), `abort` en cualquier otro caso.
 */
function externalAbortOutcome(signal: AbortSignal): TokenUsageOutcome {
  return (signal.reason as { name?: unknown } | undefined)?.name === "DeadlineExceededError" ? "timeout" : "abort";
}

async function invokeLlmWithRetryInner(
  llm: InvokableLlm,
  messages: BaseMessage[],
  options: InvokeWithRetryOptions,
  trace: LlmCallTrace,
  now: () => number,
): Promise<unknown> {
  const max = Math.max(1, options.maxAttempts ?? 3);
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const isValid = options.isResponseValid ?? ((t) => t.trim().length > 0);
  const acceptTools = options.acceptToolCallsWithoutContent === true;
  const tag = options.tag || "LLM";
  const externalSignal = options.signal ?? getActiveLlmAbortSignal();
  const waitFn = options.waitFn ?? sleepAbortable;
  const random = options.random ?? Math.random;
  const startedAt = now();
  // Espera impuesta por el proveedor (`retry-after`) para el siguiente intento; sustituye al backoff.
  let providerWaitMs: number | undefined;
  const promptChars = messages.reduce((acc, m) => {
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string") return acc + c.length;
    if (Array.isArray(c)) {
      return acc + c.reduce((a, b) => a + (typeof b === "string" ? b.length : JSON.stringify(b).length), 0);
    }
    return acc;
  }, 0);
  const getPromptText = (): string => promptTextOf(messages);
  /**
   * Estimación chars/4 de un intento sin `usage_metadata` (abort, timeout, error). Best-effort.
   * Un `error` sin salida parcial (400/401/403/contexto, 429 sin presupuesto, 5xx) no fue facturado por
   * el proveedor: la fila se registra con tokens 0 y coste desconocido (`skipCost`), no con todo el prompt.
   * `abort`/`timeout` (o un error con parcial recibido) sí consumieron tokens: se estima con coste.
   */
  const estimateFailedAttempt = (
    outcome: TokenUsageOutcome,
    attempt: number,
    attemptStartedAt: number,
    partialText: string,
  ): void => {
    if (!getActiveTokenUsageContext()) return;
    try {
      const { providerId, modelId } = options.identityOverride ?? deriveLlmIdentity(llm);
      const billed = outcome !== "error" || partialText.length > 0;
      recordUsageEstimateOnAbort(null, {
        providerId,
        modelId,
        inputText: billed ? getPromptText() : "",
        outputText: partialText,
        outcome,
        latencyMs: Math.max(0, now() - attemptStartedAt),
        attempts: attempt,
        ...(billed ? {} : { skipCost: true }),
      });
      trace.estimated = true;
    } catch {
      /* telemetría best-effort */
    }
  };
  // Último fallo con excepción ya registrado como estimación (evita duplicar al agotar intentos).
  let lastFailureRecorded = false;
  let lastFailureWasException = false;
  let lastAttemptStartedAt = now();

  // Se degrada a no-streaming si el proveedor rechaza `.stream()` (algunos endpoints
  // OpenAI-compat no lo soportan): reintentar en streaming fallaría igual.
  let streamingDegraded = false;
  // La degradación a no-streaming no debe consumir un intento (el fallo es de
  // transporte, no del modelo); se devuelve el intento una única vez.
  let degradeRefundUsed = false;
  let truncationContinuationUsed = false;
  let workingMessages = messages;

  for (let attempt = 1; attempt <= max; attempt += 1) {
    if (externalSignal?.aborted) {
      trace.outcome = externalAbortOutcome(externalSignal);
      trace.lastError = { kind: "abort", reason: "abort" };
      throw createLlmAbortError(tag);
    }
    const baseWait = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
    const wait =
      providerWaitMs ?? (baseWait > 0 ? applyJitter(baseWait, random) : 0);
    providerWaitMs = undefined;
    if (wait > 0) {
      try {
        await waitFn(wait, externalSignal, tag);
      } catch (err) {
        // Cancelación durante el backoff: ocurre fuera del try del intento, así que la traza se actualiza aquí
        // (si no, conservaría el resultado del intento anterior).
        if (externalSignal?.aborted) {
          trace.outcome = externalAbortOutcome(externalSignal);
          trace.lastError = { kind: "abort", reason: "abort" };
        }
        throw err;
      }
    }
    trace.attempts = attempt;
    const attemptStartedAt = now();
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
          result = await invokeLlmStreamingWithIdleTimeout(llm as StreamableLlmLike, workingMessages, {
            tag,
            ...(options.idleTimeoutMs != null ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
            ...(options.hardTimeoutMs != null ? { hardTimeoutMs: options.hardTimeoutMs } : {}),
            ...(externalSignal ? { signal: externalSignal } : {}),
          });
        } catch (streamErr) {
          const streamMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          // Sólo se degrada ante fallos de transporte/desconocidos (`retry`): un 401/429/contexto
          // excedido no depende de `.stream()` y degradar sólo gastaría una llamada extra.
          if (
            !/abortado por (inactividad|tope duro)/.test(streamMsg) &&
            classifyLlmError(streamErr).kind === "retry"
          ) {
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
        const onExternalAbort = (): void => abortController.abort();
        externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
        try {
          response = await (llm as { invoke: (m: BaseMessage[], opts?: { signal?: AbortSignal }) => Promise<unknown> }).invoke(workingMessages, { signal: abortController.signal });
        } finally {
          clearTimeout(timeoutId);
          externalSignal?.removeEventListener("abort", onExternalAbort);
        }
      }
      const latencyMs = Math.max(0, now() - attemptStartedAt);
      const allowTruncationContinuation = options.allowTruncationContinuation !== false;
      if (allowTruncationContinuation && isLlmOutputTruncated(response)) {
        const finishReason = extractLlmFinishReason(response) ?? "length";
        if (!truncationContinuationUsed) {
          truncationContinuationUsed = true;
          const partial = extractLlmText(response);
          workingMessages = [
            ...workingMessages,
            new AIMessage(partial),
            new HumanMessage(LLM_TRUNCATION_CONTINUATION_PROMPT),
          ];
          console.warn(
            `[${tag}] salida truncada (${finishReason}); reintentando con prompt de continuación`,
          );
          attempt -= 1;
          continue;
        }
        throw new LlmOutputTruncatedError(tag, finishReason);
      }
      const text = extractLlmText(response);
      const toolCalls = extractLlmToolCalls(response);
      const toolsOk = acceptTools && toolCalls.length > 0;
      let valid = false;
      let validatorError: unknown;
      try {
        valid = toolsOk || isValid(text, response);
      } catch (e) {
        validatorError = e;
      }
      lastFailureRecorded = false;
      lastFailureWasException = false;
      // El uso se registra aunque la respuesta no valide: los tokens se gastaron igual.
      recordLlmUsageFromMessage(llm, response, {
        identityOverride: options.identityOverride,
        promptText: getPromptText,
        latencyMs,
        attempts: attempt,
        outcome: valid ? "ok" : "invalid",
        trace,
      });
      if (validatorError !== undefined) throw validatorError;
      if (valid) {
        trace.outcome = "ok";
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
      trace.outcome = "invalid";
      trace.lastError = { kind: "retry", reason: "respuesta_invalida" };
      console.warn(
        `[${tag}] respuesta vacía/inválida (attempt ${attempt}/${max}, kind=retry, reason=respuesta_invalida, promptChars=${promptChars}, outLen=${text.length}, tools=${toolCalls.length}), reintentando...`,
      );
    } catch (err) {
      if (err instanceof LlmOutputTruncatedError) throw err;
      trace.latencyMs = Math.max(0, now() - attemptStartedAt);
      lastAttemptStartedAt = attemptStartedAt;
      // Cancelación externa: cortar de inmediato, sin reintentos ni refund de streaming.
      if (externalSignal?.aborted) {
        // Agotamiento del presupuesto de la llamada (DeadlineExceededError, ver mdd-llm-structured): es un timeout, no una cancelación.
        const abortOutcome = externalAbortOutcome(externalSignal);
        estimateFailedAttempt(abortOutcome, attempt, attemptStartedAt, readPartialText(err));
        trace.outcome = abortOutcome;
        trace.lastError = { kind: "abort", reason: "abort" };
        throw err instanceof Error && err.name === "AbortError" ? err : createLlmAbortError(tag);
      }
      const msg = err instanceof Error ? err.message : String(err);
      let verdict = classifyLlmError(err);
      // Un AbortError sin cancelación externa es un timeout propio (abortController local): reintentable.
      if (verdict.kind === "abort") verdict = { kind: "retry", reason: "timeout_interno" };
      trace.lastError = { kind: verdict.kind, reason: verdict.reason };
      lastFailureWasException = true;
      const isTimeout =
        /abortado por (inactividad|tope duro)/.test(msg) ||
        verdict.reason === "timeout_interno" ||
        /timeout/.test(verdict.reason);
      lastFailureRecorded = isTimeout;
      trace.outcome = isTimeout ? "timeout" : "error";
      // Timeout: el proveedor pudo generar tokens (parcial en streaming); se estima entrada + parcial.
      // Otros errores transitorios (429/5xx) no consumen tokens: sólo se registra el agotamiento o `no_retry`.
      if (isTimeout) estimateFailedAttempt("timeout", attempt, attemptStartedAt, readPartialText(err));
      // Fallo determinista (credenciales, petición inválida, contexto excedido, cuota): otro intento
      // fallaría igual y gastaría cuota; se corta y se mantiene el contrato (`null`).
      if (verdict.kind === "no_retry") {
        estimateFailedAttempt("error", attempt, attemptStartedAt, "");
        console.error(
          `[${tag}] error no reintentable en LLM.invoke (attempt ${attempt}/${max}, kind=no_retry, reason=${verdict.reason}): ${msg} — devolviendo null`,
        );
        return null;
      }
      if (streamingDegraded && !degradeRefundUsed) {
        degradeRefundUsed = true;
        attempt -= 1;
        console.warn(`[${tag}] reintento inmediato sin streaming tras: ${msg}`);
        continue;
      }
      let waitNote = "";
      if (verdict.kind === "retry_after" && verdict.retryAfterMs !== undefined && attempt < max) {
        const remaining =
          options.hardTimeoutMs != null ? options.hardTimeoutMs - (now() - startedAt) : Infinity;
        if (verdict.retryAfterMs >= remaining) {
          console.error(
            `[${tag}] error en LLM.invoke (attempt ${attempt}/${max}, kind=retry_after, reason=${verdict.reason}): ${msg} — retry-after ${verdict.retryAfterMs}ms no cabe en el presupuesto restante (${Math.max(0, Math.round(remaining))}ms), devolviendo null`,
          );
          if (!lastFailureRecorded) estimateFailedAttempt("error", attempt, attemptStartedAt, "");
          return null;
        }
        providerWaitMs = verdict.retryAfterMs;
        waitNote = ` (esperando retry-after ${verdict.retryAfterMs}ms)`;
      }
      console.warn(
        `[${tag}] error en LLM.invoke (attempt ${attempt}/${max}, kind=${verdict.kind}, reason=${verdict.reason}): ${msg}, reintentando...${waitNote}`,
      );
    }
  }
  console.error(`[${tag}] LLM sin respuesta válida tras ${max} intentos — devolviendo null`);
  // Agotamiento por errores (no por respuestas inválidas, que ya registraron su uso real).
  if (lastFailureWasException && !lastFailureRecorded) {
    estimateFailedAttempt("error", trace.attempts, lastAttemptStartedAt, "");
  }
  return null;
}

/** Prompt concatenado como texto (bloques no string se serializan); sólo para estimar tokens. */
function promptTextOf(messages: BaseMessage[]): string {
  return messages
    .map((m) => {
      const c = (m as { content?: unknown }).content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : JSON.stringify(b))).join("");
      return "";
    })
    .join("");
}

type LlmUsageRecordContext = {
  identityOverride?: { providerId: string; modelId: string };
  promptText: () => string;
  latencyMs: number;
  attempts: number;
  outcome: TokenUsageOutcome;
  trace: LlmCallTrace;
};

/**
 * Extrae usage_metadata de un AIMessage de LangChain y lo registra en `TokenUsage`
 * si hay un contexto de telemetría activo, con la latencia, el intento y el resultado medidos
 * aquí y el modelo real (`response_metadata.chained_model`). Si el mensaje no trae uso, registra una
 * estimación chars/4 marcada `estimated` (la fila existe aunque el proveedor no reporte tokens).
 * El provider/modelo configurados se derivan del llm pasado por parámetro (duck-typing) o de
 * `identityOverride`; el modelo real va aparte en `modelActual`.
 *
 * Si la respuesta es el objeto de `withStructuredOutput({ includeRaw: true })` (`{ raw, parsed }`), el
 * uso y los metadatos se leen del mensaje `raw`, que es el que trae `usage_metadata`.
 */
function recordLlmUsageFromMessage(
  llm: InvokableLlm,
  response: unknown,
  rec: LlmUsageRecordContext,
): void {
  const { trace } = rec;
  trace.latencyMs = rec.latencyMs;
  if (!response || typeof response !== "object") return;
  const message = unwrapRawMessage(response) as {
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
  const responseMetadata = (message as { response_metadata?: unknown }).response_metadata;
  const { providerId, modelId } = rec.identityOverride ?? deriveLlmIdentity(llm);
  const modelActual = extractChainedModel(responseMetadata);
  trace.modelActual = modelActual;
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  if (usage && (promptTokens || completionTokens)) {
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
    trace.promptTokens = promptTokens;
    trace.completionTokens = completionTokens;
    trace.estimated = false;
    recordTokenUsageFromContext(providerId, modelId, promptTokens, completionTokens, totalTokens, {
      latencyMs: rec.latencyMs,
      attempts: rec.attempts,
      outcome: rec.outcome,
      responseMetadata,
    });
    return;
  }
  // Sin `usage_metadata` (proveedor que no lo reporta): estimación marcada en vez de perder la fila.
  trace.estimated = true;
  if (!getActiveTokenUsageContext()) return;
  recordUsageEstimateOnAbort(null, {
    providerId,
    modelId,
    inputText: rec.promptText(),
    outputText: extractLlmText(message),
    outcome: rec.outcome,
    latencyMs: rec.latencyMs,
    attempts: rec.attempts,
    modelActual,
  });
}

/** Mensaje `raw` de la salida de `withStructuredOutput({ includeRaw: true })`; si no aplica, la propia respuesta. */
function unwrapRawMessage(response: object): object {
  const raw = (response as { raw?: unknown }).raw;
  return raw && typeof raw === "object" ? raw : response;
}

/**
 * Una línea JSON por invocación (`[MDD:LlmCall]`): nodo, etiqueta, modelo configurado y real,
 * intentos, latencia, resultado y tokens (o `estimated`), más `kind/reason` del último error.
 * Nunca incluye prompts ni respuestas.
 */
function logLlmCall(
  llm: InvokableLlm,
  trace: LlmCallTrace,
  identityOverride?: { providerId: string; modelId: string },
): void {
  let identity = { providerId: "unknown", modelId: "unknown" };
  try {
    identity = identityOverride ?? deriveLlmIdentity(llm);
  } catch {
    /* identidad desconocida */
  }
  writeLlmCallLog({
    tag: trace.tag,
    providerId: identity.providerId,
    modelId: identity.modelId,
    modelActual: trace.modelActual,
    attempts: trace.attempts,
    latencyMs: trace.latencyMs,
    totalMs: trace.totalMs,
    outcome: trace.outcome,
    promptTokens: trace.promptTokens,
    completionTokens: trace.completionTokens,
    estimated: trace.estimated,
    kind: trace.lastError?.kind ?? null,
    reason: trace.lastError?.reason ?? null,
  });
}

export type LlmCallLogFields = {
  tag: string;
  providerId: string;
  modelId: string;
  modelActual: string | null;
  attempts: number;
  latencyMs: number | null;
  totalMs?: number;
  outcome: TokenUsageOutcome;
  promptTokens: number | null;
  completionTokens: number | null;
  estimated: boolean;
  kind: string | null;
  reason: string | null;
};

/** Escribe la línea `[MDD:LlmCall]` (JSON de una línea; `node` sale del contexto de tokens activo). */
export function writeLlmCallLog(fields: LlmCallLogFields): void {
  try {
    const { estimated, ...rest } = fields;
    const line = { node: getActiveTokenUsageContext()?.node ?? null, ...rest, ...(estimated ? { estimated: true } : {}) };
    console.log(`[MDD:LlmCall] ${JSON.stringify(line)}`);
  } catch {
    /* log best-effort */
  }
}

/**
 * Extrae provider/modelo CONFIGURADOS del `BaseChatModel` para registrar `TokenUsage`.
 * El modelo que respondió de verdad (fallback de la cadena) no se mezcla aquí: va aparte como
 * `modelActual` (`extractChainedModel(response_metadata)`) y el servicio tarifa con él.
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
