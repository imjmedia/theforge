/**
 * @fileoverview F6 — streaming scoped del Arquitecto: aborta al 2º heading canónico `## N.`.
 */

import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { recordTokenUsageFromContext } from "../../ai/utils/token-usage-recorder.js";
import {
  deriveLlmIdentity,
  extractLlmText,
  invokeLlmWithRetry,
  type InvokableLlm,
} from "./mdd-llm-retry.util.js";
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

  let acc = "";
  let aborted = false;
  let chunks = 0;
  let usage: UsageMetadata | undefined;
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
      if (hasSecondCanonicalMddHeading(acc)) {
        acc = trimBeforeSecondCanonicalMddHeading(acc);
        aborted = true;
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[${options.tag}] scoped stream ${err instanceof ScopedStreamTimeoutError ? "timeout" : "error"}: ${msg} (chunks=${chunks}, elapsed=${Date.now() - startedAt}ms); fallback invoke`,
    );
    return invokeLlmWithRetry(llm, messages, { tag: `${options.tag}:fallback`, disableStreaming: true });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    if (iterator && (aborted || timeoutKind)) {
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
  if (usage && (usage.input_tokens || usage.output_tokens)) {
    try {
      const { providerId, modelId } = deriveLlmIdentity(llm);
      recordTokenUsageFromContext(providerId, modelId, usage.input_tokens, usage.output_tokens, usage.total_tokens);
    } catch {
      /* telemetría best-effort */
    }
  }
  return new AIMessageChunk({ content: acc, ...(usage ? { usage_metadata: usage } : {}) });
}
