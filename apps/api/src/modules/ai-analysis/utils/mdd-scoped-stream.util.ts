/**
 * @fileoverview F6 — streaming scoped del Arquitecto: aborta al 2º heading canónico `## N.`.
 */

import type { BaseMessage } from "@langchain/core/messages";
import { extractLlmText, invokeLlmWithRetry, type InvokableLlm } from "./mdd-llm-retry.util.js";

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
  stream?: (messages: BaseMessage[]) => AsyncIterable<unknown>;
};

/**
 * Invoca el LLM en streaming para pasadas scoped; corta si aparece un 2º `## N.`.
 * Fallback a invoke sin stream si el modelo no soporta `.stream`.
 */
export async function invokeScopedArchitectLlmWithHeadingCap(
  llm: InvokableLlm,
  messages: BaseMessage[],
  options: { tag: string },
): Promise<unknown> {
  const streamable = llm as StreamableLlm;
  if (typeof streamable.stream !== "function") {
    return invokeLlmWithRetry(llm, messages, { tag: options.tag });
  }

  let acc = "";
  let aborted = false;
  try {
    for await (const chunk of streamable.stream(messages)) {
      acc += extractLlmText(chunk);
      if (hasSecondCanonicalMddHeading(acc)) {
        acc = trimBeforeSecondCanonicalMddHeading(acc);
        aborted = true;
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[${options.tag}] scoped stream error: ${msg}; fallback invoke`);
    return invokeLlmWithRetry(llm, messages, { tag: `${options.tag}:fallback` });
  }

  if (!acc.trim()) {
    return invokeLlmWithRetry(llm, messages, { tag: `${options.tag}:empty-stream` });
  }

  if (aborted) {
    console.log(`[${options.tag}] scoped stream abort: 2º heading canónico detectado`);
  }
  return { content: acc };
}
