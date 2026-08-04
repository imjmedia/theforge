import type {
  GenerationJobSnapshot,
  GenerationJobType,
  ProjectGenerationStatus,
} from "@theforge/shared-types";

const DELIVERABLES_GENERATION_JOB_TYPES = new Set<GenerationJobType>([
  "cascade",
  "cascade-delta",
  "repair-sdd-gaps",
]);

export type DeliverablesCascadeLoadingReason =
  | "deliverables-cascade"
  | "legacy-deliverables"
  | "repair-sdd-gaps";

/** Job de cascada / reparación SDD activo o en cola según generation-status. */
export function activeDeliverablesGenerationJob(
  status: ProjectGenerationStatus | null | undefined,
): GenerationJobSnapshot | null {
  if (!status?.busy) return null;
  const job = status.activeJob ?? status.queuedJobs?.[0] ?? null;
  if (!job || !DELIVERABLES_GENERATION_JOB_TYPES.has(job.type)) return null;
  return job;
}

export function isDeliverablesCascadeLoadingReason(
  reason: string | null | undefined,
): reason is DeliverablesCascadeLoadingReason {
  return (
    reason === "deliverables-cascade" ||
    reason === "legacy-deliverables" ||
    reason === "repair-sdd-gaps"
  );
}

export function loadingReasonForDeliverablesJobType(
  type: GenerationJobType,
): DeliverablesCascadeLoadingReason {
  return type === "repair-sdd-gaps" ? "repair-sdd-gaps" : "deliverables-cascade";
}

/** True cuando la UI debe mostrar progreso de cascada/reparación (sesión local o job servidor). */
export function isDeliverablesCascadeUiActive(input: {
  loading: boolean;
  loadingReason: string | null;
  generationStatus: ProjectGenerationStatus | null | undefined;
}): boolean {
  if (input.loading && isDeliverablesCascadeLoadingReason(input.loadingReason)) {
    return true;
  }
  return activeDeliverablesGenerationJob(input.generationStatus) != null;
}
