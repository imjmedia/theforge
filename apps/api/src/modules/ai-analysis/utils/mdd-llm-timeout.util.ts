/** Timeout único para SDK LangChain e `invokeLlmWithRetry` (env `LANGGRAPH_LLM_TIMEOUT_MS`). */
export function resolveLlmTimeoutMs(): number {
  return readPositiveIntEnv("LANGGRAPH_LLM_TIMEOUT_MS", 120_000);
}

/**
 * Timeout de *inactividad* para invocaciones en streaming: ms máximos sin recibir
 * un chunk antes de abortar. A diferencia de `resolveLlmTimeoutMs()` (wall-clock
 * total), no penaliza generaciones legítimamente largas — sólo proveedores colgados.
 */
export function resolveLlmIdleTimeoutMs(): number {
  return readPositiveIntEnv("LANGGRAPH_LLM_IDLE_TIMEOUT_MS", 90_000);
}

/**
 * Tope duro por invocación en streaming: red de seguridad para modelos que emiten
 * chunks eternamente (bucles de repetición) sin llegar a terminar nunca.
 */
export function resolveLlmHardTimeoutMs(): number {
  return readPositiveIntEnv("LANGGRAPH_LLM_HARD_TIMEOUT_MS", 600_000);
}

/**
 * Tope duro para nodos tail (Security, Integration) en PostCriticParallel.
 * Evita quemar ~5 min en una sola invocación cuando el proveedor emite lentamente (job 100).
 */
export function resolveMddTailNodeHardTimeoutMs(): number {
  return readPositiveIntEnv("LANGGRAPH_MDD_TAIL_HARD_TIMEOUT_MS", 180_000);
}

/** Tope duro para el borrador del Clarifier (streaming). Fail-fast + retry, sin truncar mid-stream. */
export function resolveMddClarifierHardTimeoutMs(): number {
  return readPositiveIntEnv("LANGGRAPH_MDD_CLARIFIER_HARD_TIMEOUT_MS", 150_000);
}

/** Tope duro wall-clock para el nodo Auditor (LLM + tool loops). */
export function resolveMddAuditorHardTimeoutMs(): number {
  return readPositiveIntEnv("LANGGRAPH_MDD_AUDITOR_HARD_TIMEOUT_MS", 180_000);
}

/** `true` salvo que `LANGGRAPH_LLM_STREAMING` valga `0`/`false`/`off`/`no`. */
export function isLlmStreamingEnabled(): boolean {
  const raw = process.env.LANGGRAPH_LLM_STREAMING?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
