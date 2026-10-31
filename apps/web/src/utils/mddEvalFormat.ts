/**
 * Formato puro (sin React ni red) para la pestaña "Evaluación MDD":
 * duración, coste, porcentajes, estados y deltas entre corridas.
 */
import type { MddEvalComplexityDto, MddEvalRunStatus } from "@theforge/shared-types";

export type MddEvalTone = "success" | "warning" | "destructive" | "secondary" | "default";

const EMPTY = "—";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 83_000 → "1m 23s"; 4_500 → "4.5s"; 3_725_000 → "1h 02m". */
export function formatDuration(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Coste en USD: 4 decimales bajo 1 centavo-ish, 2 decimales desde 1 USD. */
export function formatCost(usd: number | null | undefined): string {
  if (!isFiniteNumber(usd) || usd < 0) return EMPTY;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Ratio 0-1 → "75%". */
export function formatPercent(ratio: number | null | undefined): string {
  if (!isFiniteNumber(ratio)) return EMPTY;
  return `${Math.round(ratio * 100)}%`;
}

/** Puntuación (rúbrica/auditor): un decimal solo cuando hace falta. */
export function formatScore(score: number | null | undefined): string {
  if (!isFiniteNumber(score)) return EMPTY;
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Precisión del auditor u otros porcentajes ya expresados 0-100 → "82%". */
export function formatPoints(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EMPTY;
  return `${Math.round(value)}%`;
}

const RUN_STATUS_LABELS: Record<MddEvalRunStatus, string> = {
  queued: "En cola",
  running: "En ejecución",
  completed: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
};

const RUN_STATUS_TONES: Record<MddEvalRunStatus, MddEvalTone> = {
  queued: "secondary",
  running: "default",
  completed: "success",
  failed: "destructive",
  cancelled: "warning",
};

export function runStatusLabel(status: MddEvalRunStatus): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

export function runStatusTone(status: MddEvalRunStatus): MddEvalTone {
  return RUN_STATUS_TONES[status] ?? "secondary";
}

export function isTerminalRunStatus(status: MddEvalRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isActiveRunStatus(status: MddEvalRunStatus): boolean {
  return !isTerminalRunStatus(status);
}

const COMPLEXITY_LABELS: Record<MddEvalComplexityDto, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
};

const COMPLEXITY_TONES: Record<MddEvalComplexityDto, MddEvalTone> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "destructive",
};

export function complexityLabel(complexity: MddEvalComplexityDto): string {
  return COMPLEXITY_LABELS[complexity] ?? complexity;
}

export function complexityTone(complexity: MddEvalComplexityDto): MddEvalTone {
  return COMPLEXITY_TONES[complexity] ?? "secondary";
}

export function passLabel(passed: boolean): "PASS" | "FAIL" {
  return passed ? "PASS" : "FAIL";
}

export type DeltaTone = "positive" | "negative" | "neutral";

export interface DeltaInfo {
  arrow: "▲" | "▼" | "→" | "";
  tone: DeltaTone;
  /** Texto con signo, p. ej. "+4.5" o "-2". Vacío si no hay dato. */
  text: string;
}

/**
 * Delta entre dos valores. `higherIsBetter=false` invierte el color (p. ej. duración o coste).
 * `epsilon` evita marcar como cambio diferencias insignificantes.
 */
export function deltaInfo(
  delta: number | null | undefined,
  options: { higherIsBetter?: boolean; epsilon?: number; format?: (abs: number) => string } = {},
): DeltaInfo {
  if (!isFiniteNumber(delta)) return { arrow: "", tone: "neutral", text: EMPTY };
  const { higherIsBetter = true, epsilon = 0.05, format = formatScore } = options;
  if (Math.abs(delta) < epsilon) return { arrow: "→", tone: "neutral", text: format(0) };
  const up = delta > 0;
  const good = up === higherIsBetter;
  return {
    arrow: up ? "▲" : "▼",
    tone: good ? "positive" : "negative",
    text: `${up ? "+" : "-"}${format(Math.abs(delta))}`,
  };
}

/** Delta calculado a partir de dos valores opcionales; `undefined` si falta alguno. */
export function computeDelta(
  before: number | null | undefined,
  after: number | null | undefined,
): number | undefined {
  if (!isFiniteNumber(before) || !isFiniteNumber(after)) return undefined;
  return after - before;
}

export interface PassTransition {
  label: string;
  tone: DeltaTone;
}

/** "FAIL → PASS" (positivo), "PASS → FAIL" (negativo), "PASS → PASS" (neutro)… */
export function passTransition(
  before: boolean | undefined,
  after: boolean | undefined,
): PassTransition {
  const b = before === undefined ? EMPTY : passLabel(before);
  const a = after === undefined ? EMPTY : passLabel(after);
  let tone: DeltaTone = "neutral";
  if (before === false && after === true) tone = "positive";
  else if (before === true && after === false) tone = "negative";
  return { label: `${b} → ${a}`, tone };
}

export const POLL_FAST_MS = 3000;
export const POLL_SLOW_MS = 10_000;
export const POLL_BACKOFF_AFTER_MS = 5 * 60_000;

/** Intervalo de sondeo: 3 s; tras 5 min de seguimiento, 10 s. */
export function getPollIntervalMs(elapsedMs: number): number {
  return elapsedMs >= POLL_BACKOFF_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
}

/** Progreso 0-100 acotado; total 0 → 0. */
export function progressPercent(done: number, total: number): number {
  if (!isFiniteNumber(done) || !isFiniteNumber(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** Milisegundos transcurridos desde un ISO; `now` inyectable para pruebas. */
export function elapsedSince(iso: string | undefined, now: number = Date.now()): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, now - t);
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

/** Etiqueta legible de una dimensión de rúbrica ("api_contracts" → "Api contracts"). */
export function dimensionLabel(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}
