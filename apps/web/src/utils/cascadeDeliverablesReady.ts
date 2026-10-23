import {
  buildDeliverableReadiness,
  flattenDeliverableWaves,
  type ComplexityLevel,
  type DeliverableKind,
  type ProjectApproach,
} from "@theforge/shared-types";

/** True cuando todos los pasos de oleada de la cascada (sin ui_screens_sync) tienen contenido persistido. */
export function projectCascadeWaveDeliverablesReady(project: {
  complexity?: ComplexityLevel | null;
  approach?: ProjectApproach | null;
}): boolean {
  const complexity = (project.complexity ?? "HIGH") as ComplexityLevel;
  const readiness = buildDeliverableReadiness(project as Record<string, unknown>);
  const steps = flattenDeliverableWaves(complexity, {
    approach: project.approach ?? undefined,
  }).filter((s) => s !== "ui_screens_sync");
  return steps.every((step) => readiness[step as DeliverableKind] === true);
}
