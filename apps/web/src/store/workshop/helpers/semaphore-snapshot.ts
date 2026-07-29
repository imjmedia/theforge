import type { ProjectGenerationStatus } from "@theforge/shared-types";
import type { WorkshopState } from "../workshop-state.types";

/** Limpia métricas del panel Semáforo (evita flash de datos de un MDD anterior). */
export function resetWorkshopSemaphoreSnapshot(): Pick<
  WorkshopState,
  | "liveMetrics"
  | "deliveryGate"
  | "documentCompleteness"
  | "consistencyScore"
  | "conformance"
  | "readinessAudit"
  | "crossDocumentGaps"
  | "precisionBreakdown"
> {
  return {
    liveMetrics: null,
    deliveryGate: null,
    documentCompleteness: null,
    consistencyScore: null,
    conformance: null,
    readinessAudit: null,
    crossDocumentGaps: [],
    precisionBreakdown: null,
  };
}

export function generationStatusWithoutSddGraph(
  status: ProjectGenerationStatus | null,
): ProjectGenerationStatus | null {
  if (!status) return null;
  return { ...status, sddGraph: null };
}
