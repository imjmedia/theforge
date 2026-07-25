/**
 * @fileoverview Utilidades de debug/tracing para llamadas LLM.
 * Activar con `LLM_DEBUG=1` — imprime modelo, tokens y latencia en consola.
 */

/** Activa trazas detalladas LLM: `LLM_DEBUG=1` o `LLM_DEBUG=true`. */
export function isLlmDebugEnabled(): boolean {
  const v = process.env.LLM_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function llmDebug(scope: string, message: string, meta?: object): void {
  if (!isLlmDebugEnabled()) return;
  const suffix =
    meta != null && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  console.debug(`[LLM_DEBUG][${scope}] ${message}${suffix}`);
}

/** Siempre visible: fallos de cadena de modelos (producción incluida). */
export function llmWarn(scope: string, message: string, meta?: object): void {
  const suffix =
    meta != null && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  console.warn(`[LLM][${scope}] ${message}${suffix}`);
}

export function summarizeRuntimeForLog(runtime: {
  providerId: string;
  chatModel: string;
  chatModelFallbacks?: string[];
  baseURL?: string | null;
  visionModel?: string | null;
}): Record<string, unknown> {
  return {
    providerId: runtime.providerId,
    chatModel: runtime.chatModel,
    fallbacks: runtime.chatModelFallbacks ?? [],
    baseURL: runtime.baseURL ?? null,
    visionModel: runtime.visionModel ?? null,
  };
}
