import type { LiveMetricsResult, Status } from "../store/workshop/types";

export type SemaphoreLiveStatus = "red" | "yellow" | "green";

/** Semáforo del panel: prioriza métricas en vivo; sin ellas, no asume VERDE de BD (evita flash). */
export function resolveWorkshopSemaphoreStatus(
  liveMetrics: LiveMetricsResult | null,
  projectStatus: Status,
): SemaphoreLiveStatus {
  if (liveMetrics?.status) return liveMetrics.status;
  if (projectStatus === "ROJO") return "red";
  return "yellow";
}

export function isWorkshopSemaphoreGreen(
  liveMetrics: LiveMetricsResult | null,
  projectStatus: Status,
): boolean {
  return resolveWorkshopSemaphoreStatus(liveMetrics, projectStatus) === "green";
}

/** Campos que el API añade a las métricas en vivo (ver `LiveMetricsResult` del EstimationService). */
export type LiveMetricsAuditorFields = {
  /** Nota del Auditor LLM (0–100) cuando sus gaps describen el MDD evaluado. */
  auditorScore?: number;
  /** "auditor" si `mddQualityScore` viene del Auditor; "regex" si es la heurística determinista. */
  mddQualitySource?: "auditor" | "regex";
};

export type WorkshopHeadlineScore = {
  /** % mostrado como titular (y que alimenta `project.precisionScore`). */
  value: number;
  source: "auditor" | "integral";
  /** Métrica integral (docs + trazabilidad + MDD); secundaria cuando el titular es el Auditor. */
  integral: number | null;
};

/**
 * Titular del panel Semáforo: la nota del Auditor cuando `mddQualitySource === "auditor"`
 * (es la que ve el usuario en la tabla del chat); si no, la métrica integral. El color del semáforo
 * (`liveMetrics.status`) ya viene del mismo origen en el API.
 */
export function resolveWorkshopHeadlineScore(
  liveMetrics: (LiveMetricsResult & LiveMetricsAuditorFields) | null | undefined,
  fallback = 0,
): WorkshopHeadlineScore {
  if (!liveMetrics) return { value: fallback, source: "integral", integral: null };
  const integral = Number.isFinite(liveMetrics.precision) ? liveMetrics.precision : null;
  if (liveMetrics.mddQualitySource === "auditor" && typeof liveMetrics.auditorScore === "number") {
    return { value: Math.round(liveMetrics.auditorScore), source: "auditor", integral };
  }
  return { value: integral ?? fallback, source: "integral", integral };
}
