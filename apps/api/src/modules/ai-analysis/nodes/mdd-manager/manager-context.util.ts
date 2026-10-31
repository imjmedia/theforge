import type { MDDStateType } from "../../state/index.js";

export const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Manager] ${msg}`, ...args);

export function hasRealBenchmark(state: MDDStateType): boolean {
  const c = (state.dbgaContent ?? "").trim();
  return c.length > 0 && !/^\(sin\s+benchmark|sin\s+contexto/i.test(c);
}

export function mddHasContent(state: MDDStateType): boolean {
  return (state.mddDraft?.trim()?.length ?? 0) > 100;
}

/**
 * Texto del usuario que se anexa a `dbgaContent` SOLO cuando no hay Benchmark real (placeholder o vacío),
 * donde dbgaContent hace de "entrada del usuario". Con Benchmark real se conserva intacto: las peticiones
 * ya viven en `userInputAccumulated` (y de ahí las lee getLastSubstantiveUserMessage / getPlanDirective);
 * mutarlo con "Petición: …" contaminaba el benchmark que ven Clarifier, Auditor y §5.
 */
export function dbgaContentWithUserText(state: MDDStateType, text: string | undefined): string | undefined {
  if (!text?.trim()) return state.dbgaContent;
  if (hasRealBenchmark(state)) return state.dbgaContent;
  const current = (state.dbgaContent ?? "").trim();
  return [current, text.trim()].filter(Boolean).join("\n\n");
}
