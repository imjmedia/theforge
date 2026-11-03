/**
 * @fileoverview Helper transversal que consume el `TokenUsageContext` activo y
 * persiste un evento de uso si hay un LlmUsageService disponible vía global.
 *
 * El servicio no se inyecta directamente (rompería adapters sin DI); se recupera
 * del `globalThis` si fue publicado. El publicador es `TokenUsageService` que se
 * auto-registra en su `onModuleInit` (NestJS).
 *
 * Esto evita acoplar adapters a NestJS DI y permite invocarlos desde sitios
 * puramente síncronos (scripts, tests).
 */

import {
  getActiveTokenUsageContext,
  type TokenUsageContextPayload,
  type TokenUsageOutcome,
} from "../../ai-analysis/token-usage/token-usage.context.js";

/** Telemetría por llamada que acompaña a un evento (O14). */
interface RecorderTelemetry {
  capability?: string | null;
  latencyMs?: number | null;
  attempts?: number | null;
  outcome?: TokenUsageOutcome | null;
  costKnown?: boolean | null;
  estimated?: boolean | null;
  modelActual?: string | null;
  /**
   * true cuando el proveedor no facturó la llamada (p. ej. 400/401/429 sin salida): la fila se
   * registra con `costUsd` 0 y `costKnown` false en vez de inventar un coste.
   */
  skipCost?: boolean | null;
}

interface RecorderEvent extends RecorderTelemetry {
  projectId: string;
  stageId?: string | null;
  documentField: string;
  context: string;
  node?: string | null;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  jobId?: string | null;
}

interface RecorderEstimateInput extends RecorderTelemetry {
  projectId: string;
  stageId?: string | null;
  documentField: string;
  context: string;
  node?: string | null;
  providerId: string;
  modelId: string;
  jobId?: string | null;
  inputChars: number;
  outputChars: number;
  outcome: TokenUsageOutcome;
}

interface Recorder {
  recordAsync(event: RecorderEvent): void;
  recordEstimatedAsync?(input: RecorderEstimateInput): void;
}

const GLOBAL_KEY = "__theforgeTokenUsageRecorder";

export function registerTokenUsageRecorder(recorder: Recorder): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = recorder;
}

function getRecorder(): Recorder | null {
  const value = (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  return (value as Recorder | undefined) ?? null;
}

/**
 * Extrae el modelo real que respondió desde `response_metadata.chained_model`
 * (lo fija `ChainedFallbackChatModel`). Devuelve null si no hay un string no vacío.
 */
export function extractChainedModel(responseMetadata: unknown): string | null {
  if (!responseMetadata || typeof responseMetadata !== "object") return null;
  const value = (responseMetadata as Record<string, unknown>).chained_model;
  return typeof value === "string" && value.trim() ? value : null;
}

export function recordTokenUsageFromContext(
  providerId: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  overrides?: {
    documentField?: string;
    context?: string;
    node?: string | null;
    /** `response_metadata` del mensaje: de aquí sale `modelActual` (`chained_model`). */
    responseMetadata?: unknown;
    /** Telemetría medida por el caller; pisa a la del contexto activo. */
    latencyMs?: number | null;
    attempts?: number | null;
    outcome?: TokenUsageOutcome | null;
    costKnown?: boolean | null;
  },
): void {
  const ctx = getActiveTokenUsageContext();
  if (!ctx) return;
  const recorder = getRecorder();
  if (!recorder) return;
  recorder.recordAsync({
    projectId: ctx.projectId,
    stageId: ctx.stageId ?? null,
    documentField: overrides?.documentField ?? ctx.documentField,
    context: overrides?.context ?? ctx.context,
    node: overrides?.node !== undefined ? overrides.node : ctx.node ?? null,
    capability: ctx.capability ?? null,
    providerId,
    modelId,
    promptTokens,
    completionTokens,
    totalTokens,
    jobId: ctx.jobId ?? null,
    latencyMs: overrides?.latencyMs ?? ctx.latencyMs ?? null,
    attempts: overrides?.attempts ?? ctx.attempts ?? null,
    outcome: overrides?.outcome ?? ctx.outcome ?? "ok",
    costKnown: overrides?.costKnown ?? ctx.costKnown ?? null,
    // Uso real reportado por el proveedor: nunca es estimación.
    estimated: false,
    modelActual: extractChainedModel(overrides?.responseMetadata) ?? ctx.modelActual ?? null,
  });
}

/**
 * Registra una estimación chars/4 cuando la llamada terminó sin `usage_metadata`
 * (abort, timeout, stream cortado). La fila queda con `estimated: true`.
 *
 * `ctx` es el contexto de telemetría (si es null se usa el activo); el proveedor y
 * modelo vienen en `params` porque el contexto no los conoce. Sin contexto o sin
 * recorder registrado es un no-op; nunca lanza (telemetría best-effort).
 */
export function recordUsageEstimateOnAbort(
  ctx: TokenUsageContextPayload | null,
  params: {
    providerId: string;
    modelId: string;
    inputText: string;
    outputText: string;
    outcome: TokenUsageOutcome;
    latencyMs?: number | null;
    attempts?: number | null;
    modelActual?: string | null;
    /** El proveedor no facturó la llamada: coste 0 y `costKnown` false (ver `RecorderTelemetry`). */
    skipCost?: boolean;
  },
): void {
  try {
    const context = ctx ?? getActiveTokenUsageContext();
    if (!context) return;
    const recorder = getRecorder();
    if (!recorder?.recordEstimatedAsync) return;
    recorder.recordEstimatedAsync({
      projectId: context.projectId,
      stageId: context.stageId ?? null,
      documentField: context.documentField,
      context: context.context,
      node: context.node ?? null,
      capability: context.capability ?? null,
      providerId: params.providerId,
      modelId: params.modelId,
      jobId: context.jobId ?? null,
      inputChars: params.inputText.length,
      outputChars: params.outputText.length,
      outcome: params.outcome,
      latencyMs: params.latencyMs ?? context.latencyMs ?? null,
      attempts: params.attempts ?? context.attempts ?? null,
      modelActual: params.modelActual ?? context.modelActual ?? null,
      ...(params.skipCost ? { skipCost: true } : {}),
    });
  } catch {
    /* telemetría best-effort */
  }
}
