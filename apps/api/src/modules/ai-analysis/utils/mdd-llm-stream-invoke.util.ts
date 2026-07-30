/**
 * @fileoverview Invocación LLM en streaming con timeout de *inactividad*.
 *
 * Por qué existe: `invokeLlmWithRetry` abortaba con un `AbortController` de
 * wall-clock total (`LANGGRAPH_LLM_TIMEOUT_MS`, 120s). Los nodos de salida larga
 * (Clarifier:draft ~10–20k tokens, Section5, SoftwareArchitect) superan ese
 * presupuesto **generando normalmente**, no por proveedor colgado: el fetch se
 * aborta ("The user aborted a request"), se descarta todo el texto ya emitido y
 * el retry reenvía el prompt entero (job 90: Clarifier ~7 min aunque "funcione").
 *
 * En streaming el reloj se reinicia con cada chunk, así que el timeout mide lo
 * que de verdad importa — que el proveedor deje de emitir — y una generación de
 * 5 minutos que fluye no se aborta nunca. `resolveLlmHardTimeoutMs()` mantiene un
 * tope absoluto para bucles de repetición.
 */

import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import {
  resolveLlmHardTimeoutMs,
  resolveLlmIdleTimeoutMs,
} from "./mdd-llm-timeout.util.js";

export type StreamableLlmLike = {
  invoke: (messages: BaseMessage[], options?: unknown) => Promise<unknown>;
  stream?: (messages: BaseMessage[], options?: unknown) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
};

export type StreamInvokeOptions = {
  tag: string;
  /** Ms sin recibir chunk antes de abortar. Default `LANGGRAPH_LLM_IDLE_TIMEOUT_MS` (90s). */
  idleTimeoutMs?: number;
  /** Tope absoluto por invocación. Default `LANGGRAPH_LLM_HARD_TIMEOUT_MS` (10 min). */
  hardTimeoutMs?: number;
};

export type StreamInvokeResult = {
  /** AIMessageChunk agregado (texto + tool_calls + usage) o `null` si no hubo chunks. */
  response: unknown | null;
  chunks: number;
  /** Ms transcurridos hasta el primer chunk (latencia real del proveedor). */
  firstChunkMs: number | null;
  totalMs: number;
  idleTimedOut: boolean;
  hardTimedOut: boolean;
};

/** True si el runnable expone `.stream()` (BaseChatModel y Runnable de bindTools lo hacen). */
export function supportsStreaming(llm: unknown): llm is StreamableLlmLike & { stream: NonNullable<StreamableLlmLike["stream"]> } {
  return typeof (llm as StreamableLlmLike | null)?.stream === "function";
}

function toAIMessageChunk(chunk: unknown): AIMessageChunk | null {
  if (chunk instanceof AIMessageChunk) return chunk;
  if (chunk && typeof chunk === "object") {
    const content = (chunk as { content?: unknown }).content;
    if (content !== undefined) {
      // Mensajes no-chunk (algunos wrappers devuelven AIMessage completo).
      return new AIMessageChunk(chunk as ConstructorParameters<typeof AIMessageChunk>[0]);
    }
  }
  return null;
}

/**
 * Consume `llm.stream()` agregando chunks con `AIMessageChunk.concat`, que ya
 * fusiona `content`, `tool_call_chunks` (→ `tool_calls` parseados) y
 * `usage_metadata`, de modo que el resultado es equivalente a un `invoke()`.
 *
 * Aborta si pasan `idleTimeoutMs` sin chunk o `hardTimeoutMs` en total.
 * Lanza el error del proveedor tal cual: el caller decide reintento/fallback.
 */
export async function invokeLlmStreamingWithIdleTimeout(
  llm: StreamableLlmLike,
  messages: BaseMessage[],
  options: StreamInvokeOptions,
): Promise<StreamInvokeResult> {
  const idleTimeoutMs = options.idleTimeoutMs ?? resolveLlmIdleTimeoutMs();
  const hardTimeoutMs = options.hardTimeoutMs ?? resolveLlmHardTimeoutMs();
  const startedAt = Date.now();

  const abortController = new AbortController();
  let idleTimedOut = false;
  let hardTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const armIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      abortController.abort();
    }, idleTimeoutMs);
  };
  const hardTimer = setTimeout(() => {
    hardTimedOut = true;
    abortController.abort();
  }, hardTimeoutMs);

  let merged: AIMessageChunk | null = null;
  let chunks = 0;
  let firstChunkMs: number | null = null;

  const timeoutError = (): Error => {
    const kind = hardTimedOut ? `tope duro ${hardTimeoutMs}ms` : `inactividad ${idleTimeoutMs}ms`;
    return new Error(
      `[${options.tag}] stream abortado por ${kind} (chunks=${chunks}, elapsed=${Date.now() - startedAt}ms)`,
    );
  };

  try {
    armIdleTimer();
    const stream = await (llm.stream as NonNullable<StreamableLlmLike["stream"]>)(messages, {
      signal: abortController.signal,
    });
    for await (const raw of stream as AsyncIterable<unknown>) {
      // No todos los transportes honran el AbortSignal (wrappers propios, mocks,
      // proxies OpenAI-compat): sin este corte el timeout no serviría de nada.
      if (idleTimedOut || hardTimedOut) throw timeoutError();
      armIdleTimer();
      chunks += 1;
      if (firstChunkMs === null) firstChunkMs = Date.now() - startedAt;
      const chunk = toAIMessageChunk(raw);
      if (!chunk) continue;
      merged = merged === null ? chunk : (merged.concat(chunk) as AIMessageChunk);
    }
    if (idleTimedOut || hardTimedOut) throw timeoutError();
  } catch (err) {
    if (idleTimedOut || hardTimedOut) throw timeoutError();
    throw err;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  }

  return {
    response: merged,
    chunks,
    firstChunkMs,
    totalMs: Date.now() - startedAt,
    idleTimedOut,
    hardTimedOut,
  };
}
