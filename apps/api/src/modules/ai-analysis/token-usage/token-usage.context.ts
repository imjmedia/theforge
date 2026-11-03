/**
 * @fileoverview AsyncLocalStorage que propaga el contexto de telemetría de tokens
 * (projectId, stageId, documentField, context, node, jobId) a través de las llamadas
 * LLM asíncronas. Los adapters consumen este contexto en cada llamada para registrar
 * consumo sin inflar las firmas.
 *
 * Patrón: en cada punto de entrada (controller, MDD pipeline, generator de cascada)
 * se llama `runWithTokenUsageContext(ctx, fn)` y dentro de `fn` los adapters ya
 * pueden leer el contexto de fondo.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Resultado de una llamada LLM para la telemetría (`TokenUsage.outcome`). */
export type TokenUsageOutcome = "ok" | "timeout" | "abort" | "error" | "invalid";

/**
 * Regla única para contar llamadas a partir de una fila de `TokenUsage` (la usan el eval y el resumen por
 * documento/modelo):
 * - `measured`: llamada con resultado. `ok`/`invalid`; sin `outcome` (filas antiguas) si `costKnown !== false`.
 * - `failed`: `error`/`timeout`/`abort`.
 * - `unknown`: sin `outcome` y con `costKnown === false`. No cuenta ni como medida ni como fallida.
 */
export function classifyTokenUsageOutcome(row: {
  outcome?: string | null;
  costKnown?: boolean | null;
}): "measured" | "failed" | "unknown" {
  const outcome = row.outcome ?? null;
  if (outcome === "error" || outcome === "timeout" || outcome === "abort") return "failed";
  if (outcome === "ok" || outcome === "invalid") return "measured";
  return row.costKnown !== false ? "measured" : "unknown";
}

export interface TokenUsageContextPayload {
  projectId: string;
  stageId?: string | null;
  documentField: string;
  context: string;
  node?: string | null;
  /**
   * Capacidad/etiqueta lógica de la llamada (p. ej. "scoped_high"). No tiene columna propia:
   * el servicio la usa como `node` cuando este no viene.
   */
  capability?: string | null;
  /** Telemetría por llamada (la fijan `withTokenUsageContextPatch` o el helper que mide). */
  latencyMs?: number | null;
  attempts?: number | null;
  outcome?: TokenUsageOutcome | null;
  /** false cuando no hay tarifa y el coste es `unknown`. Si no viene, el servicio lo deduce del catálogo. */
  costKnown?: boolean | null;
  /** true cuando los tokens son una estimación chars/4. */
  estimated?: boolean | null;
  /** Modelo real que respondió, si difiere del configurado. */
  modelActual?: string | null;
  jobId?: string | null;
}

/**
 * Campos de telemetría por llamada que el patch del contexto puede fijar
 * (subconjunto de `TokenUsageContextPayload`).
 */
export type TokenUsageContextPatch = Partial<TokenUsageContextPayload>;

export interface TokenUsageContextValue {
  payload: TokenUsageContextPayload;
}

const storage = new AsyncLocalStorage<TokenUsageContextValue>();

export function runWithTokenUsageContext<T>(
  payload: TokenUsageContextPayload,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run({ payload }, fn) as T | Promise<T>;
}

export function getActiveTokenUsageContext(): TokenUsageContextPayload | null {
  return storage.getStore()?.payload ?? null;
}

/**
 * Patch parcial del contexto activo (ej. cuando entramos en una fase del pipeline
 * que debemos atribuir a un nodo concreto). Si no hay contexto activo, es un no-op.
 */
export function withTokenUsageContextPatch<T>(
  patch: TokenUsageContextPatch,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const current = storage.getStore();
  if (!current) return fn();
  return storage.run(
    { payload: { ...current.payload, ...patch } },
    fn,
  ) as T | Promise<T>;
}
