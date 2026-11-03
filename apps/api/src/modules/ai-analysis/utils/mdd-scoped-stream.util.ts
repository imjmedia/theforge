/**
 * @fileoverview F6 — streaming scoped del Arquitecto: aborta al 2º heading canónico `## N.`.
 */

import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import {
  extractChainedModel,
  recordTokenUsageFromContext,
  recordUsageEstimateOnAbort,
} from "../../ai/utils/token-usage-recorder.js";
import { getActiveTokenUsageContext, type TokenUsageOutcome } from "../token-usage/token-usage.context.js";
import {
  deriveLlmIdentity,
  extractLlmText,
  getActiveLlmAbortSignal,
  invokeLlmWithRetry,
  writeLlmCallLog,
  type InvokableLlm,
} from "./mdd-llm-retry.util.js";
import { createLlmAbortError } from "./mdd-llm-stream-invoke.util.js";
import { resolveLlmHardTimeoutMs, resolveLlmIdleTimeoutMs } from "./mdd-llm-timeout.util.js";

const CANONICAL_HEADING_RE = /^##\s+[1-7]\.\s+/gm;

/** True si el texto acumulado ya tiene ≥2 headings canónicos §1–§7. */
export function hasSecondCanonicalMddHeading(text: string): boolean {
  const re = new RegExp(CANONICAL_HEADING_RE.source, CANONICAL_HEADING_RE.flags);
  let count = 0;
  while (re.exec(text)) {
    count += 1;
    if (count >= 2) return true;
  }
  return false;
}

/** Recorta el texto antes del 2º heading canónico (si existe). */
export function trimBeforeSecondCanonicalMddHeading(text: string): string {
  const re = new RegExp(CANONICAL_HEADING_RE.source, CANONICAL_HEADING_RE.flags);
  let count = 0;
  let secondIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    count += 1;
    if (count === 2) {
      secondIndex = m.index;
      break;
    }
  }
  if (secondIndex < 0) return text;
  return text.slice(0, secondIndex).trimEnd();
}

type StreamableLlm = InvokableLlm & {
  stream?: (
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
};

export type ScopedStreamOptions = {
  tag: string;
  /** Ms sin recibir chunk antes de abortar. Default `LANGGRAPH_LLM_IDLE_TIMEOUT_MS`. */
  idleTimeoutMs?: number;
  /** Tope absoluto del stream. Default `LANGGRAPH_LLM_HARD_TIMEOUT_MS`. */
  hardTimeoutMs?: number;
  /**
   * Cancelación del turno. Si no se pasa se usa `getActiveLlmAbortSignal()` (ALS fijado por el servicio
   * alrededor de `graph.stream`). Al dispararse corta el stream en vuelo, registra la estimación con
   * `outcome: "abort"` y lanza `AbortError` (sin fallback a invoke).
   */
  signal?: AbortSignal;
};

type UsageMetadata = { input_tokens: number; output_tokens: number; total_tokens: number };

function readChunkUsage(chunk: unknown): Partial<UsageMetadata> | undefined {
  if (!chunk || typeof chunk !== "object") return undefined;
  const u = (chunk as { usage_metadata?: Partial<UsageMetadata> }).usage_metadata;
  return u && typeof u === "object" ? u : undefined;
}

/** Los chunks de LangChain llevan usage parcial (se suma, igual que `AIMessageChunk.concat`). */
function addUsage(acc: UsageMetadata | undefined, u: Partial<UsageMetadata>): UsageMetadata {
  const base = acc ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const input = base.input_tokens + (u.input_tokens ?? 0);
  const output = base.output_tokens + (u.output_tokens ?? 0);
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

class ScopedStreamTimeoutError extends Error {}

/**
 * Invoca el LLM en streaming para pasadas scoped; corta si aparece un 2º `## N.`.
 * - Timeout de inactividad (`resolveLlmIdleTimeoutMs`) y tope duro (`resolveLlmHardTimeoutMs`)
 *   con `AbortSignal` hacia el proveedor; ante timeout o error cae a `invokeLlmWithRetry` una vez.
 * - Fallback a invoke sin stream si el modelo no soporta `.stream`.
 * - Devuelve un `AIMessageChunk` con `usage_metadata` (y registra el uso de tokens).
 */
export async function invokeScopedArchitectLlmWithHeadingCap(
  llm: InvokableLlm,
  messages: BaseMessage[],
  options: ScopedStreamOptions,
): Promise<unknown> {
  const streamable = llm as StreamableLlm;
  if (typeof streamable.stream !== "function") {
    return invokeLlmWithRetry(llm, messages, { tag: options.tag });
  }

  const externalSignal = options.signal ?? getActiveLlmAbortSignal();
  if (externalSignal?.aborted) throw createLlmAbortError(options.tag);

  const idleTimeoutMs = options.idleTimeoutMs ?? resolveLlmIdleTimeoutMs();
  const hardTimeoutMs = options.hardTimeoutMs ?? resolveLlmHardTimeoutMs();
  const startedAt = Date.now();
  const abortController = new AbortController();
  let timeoutKind: "idle" | "hard" | null = null;
  let rejectTimeout: ((e: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  // Evita "unhandled rejection" si el stream termina antes de que dispare el timer.
  timeoutPromise.catch(() => undefined);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const fire = (kind: "idle" | "hard"): void => {
    if (timeoutKind) return;
    timeoutKind = kind;
    abortController.abort();
    rejectTimeout?.(
      new ScopedStreamTimeoutError(
        `stream abortado por ${kind === "hard" ? `tope duro ${hardTimeoutMs}ms` : `inactividad ${idleTimeoutMs}ms`}`,
      ),
    );
  };
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fire("idle"), idleTimeoutMs);
  };
  const hardTimer = setTimeout(() => fire("hard"), hardTimeoutMs);
  // Cancelación del turno: se enlaza con el controller propio (que ya llega al proveedor) y corta la carrera.
  let externalAborted = false;
  const onExternalAbort = (): void => {
    if (externalAborted || timeoutKind) return;
    externalAborted = true;
    abortController.abort();
    rejectTimeout?.(createLlmAbortError(options.tag));
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  let acc = "";
  let aborted = false;
  let chunks = 0;
  let usage: UsageMetadata | undefined;
  let modelActual: string | null = null;
  let iterator: AsyncIterator<unknown> | undefined;
  try {
    armIdle();
    const stream = await Promise.race([
      Promise.resolve(streamable.stream(messages, { signal: abortController.signal })),
      timeoutPromise,
    ]);
    iterator = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    for (;;) {
      const step = await Promise.race([iterator.next(), timeoutPromise]);
      if (step.done) break;
      armIdle();
      chunks += 1;
      const chunk = step.value;
      acc += extractLlmText(chunk);
      const u = readChunkUsage(chunk);
      if (u) usage = addUsage(usage, u);
      modelActual ??= extractChainedModel((chunk as { response_metadata?: unknown } | null)?.response_metadata);
      if (hasSecondCanonicalMddHeading(acc)) {
        acc = trimBeforeSecondCanonicalMddHeading(acc);
        aborted = true;
        break;
      }
    }
  } catch (err) {
    if (externalAborted || externalSignal?.aborted) {
      // El proveedor ya procesó el prompt: se estima entrada + parcial (con coste) como `abort`.
      const elapsed = Date.now() - startedAt;
      recordScopedEstimate(llm, messages, acc, "abort", elapsed, modelActual);
      logScopedCall(llm, options.tag, "abort", elapsed, null, modelActual, { kind: "abort", reason: "abort" });
      throw err instanceof Error && err.name === "AbortError" ? err : createLlmAbortError(options.tag);
    }
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof ScopedStreamTimeoutError;
    console.warn(
      `[${options.tag}] scoped stream ${isTimeout ? "timeout" : "error"}: ${msg} (chunks=${chunks}, elapsed=${Date.now() - startedAt}ms); fallback invoke`,
    );
    // El stream cortado no trajo `usage_metadata`: se estima entrada + parcial (un error sin salida
    // no consumió tokens y no se registra; el fallback registra lo suyo).
    if (isTimeout || acc) {
      recordScopedEstimate(llm, messages, acc, isTimeout ? "timeout" : "error", Date.now() - startedAt, modelActual);
    }
    logScopedCall(llm, options.tag, isTimeout ? "timeout" : "error", Date.now() - startedAt, null, modelActual, {
      kind: "retry",
      reason: isTimeout ? "timeout_stream" : "error_stream",
    });
    return invokeLlmWithRetry(llm, messages, {
      tag: `${options.tag}:fallback`,
      disableStreaming: true,
      ...(externalSignal ? { signal: externalSignal } : {}),
    });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    if (iterator && (aborted || timeoutKind || externalAborted)) {
      // No se espera: un stream colgado puede no resolver nunca `return()`.
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    }
    if (aborted && !abortController.signal.aborted) abortController.abort();
  }

  if (!acc.trim()) {
    return invokeLlmWithRetry(llm, messages, { tag: `${options.tag}:empty-stream`, disableStreaming: true });
  }

  if (aborted) {
    console.log(`[${options.tag}] scoped stream abort: 2º heading canónico detectado`);
  }
  const latencyMs = Date.now() - startedAt;
  if (usage && (usage.input_tokens || usage.output_tokens)) {
    try {
      const { providerId, modelId } = deriveLlmIdentity(llm);
      recordTokenUsageFromContext(providerId, modelId, usage.input_tokens, usage.output_tokens, usage.total_tokens, {
        latencyMs,
        attempts: 1,
        outcome: "ok",
        responseMetadata: modelActual ? { chained_model: modelActual } : undefined,
      });
    } catch {
      /* telemetría best-effort */
    }
    logScopedCall(llm, options.tag, "ok", latencyMs, usage, modelActual, null);
  } else {
    // El pase terminó bien pero sin `usage_metadata` (típico al cortar el stream por scope antes
    // del chunk final de uso): se estima chars/4 y la fila queda `estimated`, no se pierde el coste.
    recordScopedEstimate(llm, messages, acc, "ok", latencyMs, modelActual);
    logScopedCall(llm, options.tag, "ok", latencyMs, null, modelActual, null);
  }
  return new AIMessageChunk({ content: acc, ...(usage ? { usage_metadata: usage } : {}) });
}

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

/** Estimación chars/4 del pase scoped sin `usage_metadata`. Best-effort, nunca lanza. */
function recordScopedEstimate(
  llm: InvokableLlm,
  messages: BaseMessage[],
  outputText: string,
  outcome: TokenUsageOutcome,
  latencyMs: number,
  modelActual: string | null,
): void {
  if (!getActiveTokenUsageContext()) return;
  try {
    const { providerId, modelId } = deriveLlmIdentity(llm);
    recordUsageEstimateOnAbort(null, {
      providerId,
      modelId,
      inputText: promptTextOf(messages),
      outputText,
      outcome,
      latencyMs,
      attempts: 1,
      modelActual,
    });
  } catch {
    /* telemetría best-effort */
  }
}

function logScopedCall(
  llm: InvokableLlm,
  tag: string,
  outcome: TokenUsageOutcome,
  latencyMs: number,
  usage: UsageMetadata | null | undefined,
  modelActual: string | null,
  lastError: { kind: string; reason: string } | null,
): void {
  let identity = { providerId: "unknown", modelId: "unknown" };
  try {
    identity = deriveLlmIdentity(llm);
  } catch {
    /* identidad desconocida */
  }
  writeLlmCallLog({
    tag,
    providerId: identity.providerId,
    modelId: identity.modelId,
    modelActual,
    attempts: 1,
    latencyMs,
    outcome,
    promptTokens: usage?.input_tokens ?? null,
    completionTokens: usage?.output_tokens ?? null,
    estimated: !usage,
    kind: lastError?.kind ?? null,
    reason: lastError?.reason ?? null,
  });
}
