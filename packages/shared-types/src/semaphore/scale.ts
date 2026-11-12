import type { SemaphoreStatus } from "./verdict.schema.js";

/** Máximo titular exclusivo para rojo (< 85). */
export const PRECISION_RED_MAX = 85;
/** Mínimo titular para candidato a verde (≥ 90). */
export const PRECISION_GREEN_MIN = 90;

export function statusFromScore(score: number): SemaphoreStatus {
  if (score < PRECISION_RED_MAX) return "red";
  if (score < PRECISION_GREEN_MIN) return "yellow";
  return "green";
}
