import type { MddSemaphoreVerdict } from "@theforge/shared-types";
import type { LiveMetricsResult, Status } from "../store/workshop/types";

export type SemaphoreLiveStatus = "red" | "yellow" | "green";

/** Campos de métricas en vivo añadidos por el API (`LiveMetricsResult` + auditor). */
export type LiveMetricsAuditorFields = {
  auditorScore?: number;
  mddQualitySource?: "auditor" | "regex";
};

export type LiveMetricsWithSemaphore = LiveMetricsResult & {
  semaphore?: MddSemaphoreVerdict;
  persistedStale?: boolean;
};

/** Color del panel: veredicto del núcleo cuando existe; si no, heurística legacy. */
export function resolveWorkshopSemaphoreStatus(
  liveMetrics: LiveMetricsWithSemaphore | null,
  projectStatus: Status,
): SemaphoreLiveStatus {
  const fromCore = liveMetrics?.semaphore?.status ?? liveMetrics?.status;
  if (fromCore) return fromCore;
  if (projectStatus === "ROJO") return "red";
  return "yellow";
}

export function isWorkshopSemaphoreGreen(
  liveMetrics: LiveMetricsWithSemaphore | null,
  projectStatus: Status,
): boolean {
  return resolveWorkshopSemaphoreStatus(liveMetrics, projectStatus) === "green";
}

export type WorkshopHeadlineScore = {
  value: number;
  source: "auditor" | "integral";
  integral: number | null;
};

/**
 * Titular del panel: `semaphore.headline` del núcleo; si no hay veredicto, métricas legacy.
 */
export function resolveWorkshopHeadlineScore(
  liveMetrics: LiveMetricsWithSemaphore | null | undefined,
  fallback = 0,
): WorkshopHeadlineScore {
  const verdict = liveMetrics?.semaphore;
  if (verdict) {
    const integral = verdict.integral;
    if (verdict.headlineSource === "auditor") {
      return { value: Math.round(verdict.headline), source: "auditor", integral };
    }
    return { value: Math.round(verdict.headline), source: "integral", integral };
  }
  if (!liveMetrics) return { value: fallback, source: "integral", integral: null };
  const integral = Number.isFinite(liveMetrics.precision) ? liveMetrics.precision : null;
  if (liveMetrics.mddQualitySource === "auditor" && typeof liveMetrics.auditorScore === "number") {
    return { value: Math.round(liveMetrics.auditorScore), source: "auditor", integral };
  }
  return { value: integral ?? fallback, source: "integral", integral };
}
