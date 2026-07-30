import {
  buildDeliverableReadiness,
  flattenDeliverableWaves,
  type ComplexityLevel,
  type DeliverableKind,
} from "@theforge/shared-types";

/** True cuando todos los pasos de oleada de la cascada (sin ui_screens_sync) tienen contenido persistido. */
export function projectCascadeWaveDeliverablesReady(
  project: Record<string, unknown> & { complexity?: ComplexityLevel | null },
): boolean {
  const complexity = (project.complexity ?? "HIGH") as ComplexityLevel;
  const readiness = buildDeliverableReadiness(project);
  const steps = flattenDeliverableWaves(complexity).filter((s) => s !== "ui_screens_sync");
  return steps.every((step) => readiness[step as DeliverableKind] === true);
}
