import type { MDDStateType } from "../../state/index.js";

export const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Manager] ${msg}`, ...args);

export function hasRealBenchmark(state: MDDStateType): boolean {
  const c = (state.dbgaContent ?? "").trim();
  return c.length > 0 && !/^\(sin\s+benchmark|sin\s+contexto/i.test(c);
}

export function mddHasContent(state: MDDStateType): boolean {
  return (state.mddDraft?.trim()?.length ?? 0) > 100;
}
