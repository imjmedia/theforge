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
