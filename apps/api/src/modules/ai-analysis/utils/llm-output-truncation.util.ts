/**
 * Detecta salidas LLM cortadas por límite de tokens (`finish_reason` / `stop_reason` = length).
 * OpenRouter/OpenAI suelen usar `response_metadata.finish_reason`; Anthropic `stop_reason`.
 */

const TRUNCATION_REASONS = new Set([
  "length",
  "max_tokens",
  "model_length",
  "token_limit",
  "context_length_exceeded",
]);

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toLowerCase();
}

function reasonIndicatesTruncation(reason: string | null): boolean {
  if (!reason) return false;
  if (TRUNCATION_REASONS.has(reason)) return true;
  return /(?:max|token|length).*limit|limit.*(?:token|length)/i.test(reason);
}

function collectReasonCandidates(meta: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    const n = normalizeReason(v);
    if (n) out.push(n);
  };
  push(meta.finish_reason);
  push(meta.stop_reason);
  push(meta.stopReason);
  push(meta.completion_reason);
  const nested = meta.token_usage;
  if (nested && typeof nested === "object") {
    const tu = nested as Record<string, unknown>;
    push(tu.finish_reason);
    push(tu.stop_reason);
  }
  return out;
}

function unwrapRawMessage(response: unknown): unknown {
  if (!response || typeof response !== "object") return response;
  const raw = (response as { raw?: unknown }).raw;
  return raw && typeof raw === "object" ? raw : response;
}

/** Extrae `finish_reason` / `stop_reason` de AIMessage (`response_metadata` y `usage_metadata`). */
export function extractLlmFinishReason(response: unknown): string | null {
  const message = unwrapRawMessage(response);
  if (!message || typeof message !== "object") return null;
  const root = message as Record<string, unknown>;
  const candidates: string[] = [];
  const responseMeta = root.response_metadata;
  if (responseMeta && typeof responseMeta === "object") {
    candidates.push(...collectReasonCandidates(responseMeta as Record<string, unknown>));
  }
  const usageMeta = root.usage_metadata;
  if (usageMeta && typeof usageMeta === "object") {
    candidates.push(...collectReasonCandidates(usageMeta as Record<string, unknown>));
  }
  for (const reason of candidates) {
    if (reasonIndicatesTruncation(reason)) return reason;
  }
  return candidates[0] ?? null;
}

/** True si los metadatos indican truncado por límite de salida. */
export function isLlmOutputTruncated(response: unknown): boolean {
  const reason = extractLlmFinishReason(response);
  return reason !== null && reasonIndicatesTruncation(reason);
}

export class LlmOutputTruncatedError extends Error {
  readonly finishReason: string;

  constructor(tag: string, finishReason: string) {
    super(`[${tag}] salida LLM truncada (${finishReason})`);
    this.name = "LlmOutputTruncatedError";
    this.finishReason = finishReason;
  }
}

/** Mensaje de continuación tras un corte por límite de tokens (un reintento). */
export const LLM_TRUNCATION_CONTINUATION_PROMPT =
  "Tu respuesta anterior se cortó por límite de tokens del modelo. Continúa exactamente donde quedó, sin repetir el inicio ni un resumen.";
