/**
 * @fileoverview Métricas compartidas para nodos MDD que invocan LLM (perf F0).
 */

export type MddLlmMetrics = {
  durationMs: number;
  promptChars: number;
  outputChars: number;
};

/** Calcula métricas estándar de una invocación LLM MDD. */
export function measureMddLlmCall(
  startedAt: number,
  promptChars: number,
  outputChars: number,
): MddLlmMetrics {
  return {
    durationMs: Date.now() - startedAt,
    promptChars,
    outputChars,
  };
}

/**
 * Log unificado: `ok durationMs=%s promptChars=%s outputChars=%s [extras…]`
 * (mismo formato que Clarifier, con extras opcionales al final).
 */
export function logMddLlmMetrics(
  log: (msg: string, ...args: unknown[]) => void,
  metrics: MddLlmMetrics,
  extra?: Record<string, string | number | boolean | undefined>,
): void {
  const extraKeys = extra ? Object.keys(extra) : [];
  const extraFmt = extraKeys.length ? ` ${extraKeys.map((k) => `${k}=%s`).join(" ")}` : "";
  const extraVals = extraKeys.map((k) => extra![k]);
  log(
    `ok durationMs=%s promptChars=%s outputChars=%s${extraFmt}`,
    metrics.durationMs,
    metrics.promptChars,
    metrics.outputChars,
    ...extraVals,
  );
}
