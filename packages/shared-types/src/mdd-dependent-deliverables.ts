import type { ProjectDeliverableSource } from "./stage-deliverable-snapshot.js";

/** Entregables SDD regenerados desde el MDD (no incluye Fase 0, AEM ni el MDD mismo). */
export const MDD_DEPENDENT_DELIVERABLE_KEYS = [
  "specContent",
  "architectureContent",
  "useCasesContent",
  "userStoriesContent",
  "blueprintContent",
  "tasksContent",
  "apiContractsContent",
  "logicFlowsContent",
  "infraContent",
  "agentGovernanceContent",
  "uxUiGuideContent",
  "uiScreensContent",
] as const satisfies readonly (keyof ProjectDeliverableSource)[];

export type MddDependentDeliverableKey = (typeof MDD_DEPENDENT_DELIVERABLE_KEYS)[number];

/** Solo columna de Project — no existe en Stage (ver stage-deliverable-persist.util). */
export const MDD_DEPENDENT_PROJECT_ONLY_KEYS = ["uiScreensContent"] as const satisfies readonly MddDependentDeliverableKey[];

export type MddDependentProjectOnlyKey = (typeof MDD_DEPENDENT_PROJECT_ONLY_KEYS)[number];

/** Entregables MDD-dependent persistidos en Stage (excluye project-only). */
export const MDD_DEPENDENT_STAGE_DELIVERABLE_KEYS = MDD_DEPENDENT_DELIVERABLE_KEYS.filter(
  (key): key is Exclude<MddDependentDeliverableKey, MddDependentProjectOnlyKey> =>
    !(MDD_DEPENDENT_PROJECT_ONLY_KEYS as readonly string[]).includes(key),
);

export type MddDependentStageDeliverableKey = (typeof MDD_DEPENDENT_STAGE_DELIVERABLE_KEYS)[number];

function buildNullPayload<K extends string>(keys: readonly K[]): Record<K, null> {
  return Object.fromEntries(keys.map((key) => [key, null])) as Record<K, null>;
}

/** Payload nulo para limpiar entregables dependientes del MDD en Project (incl. Pantallas). */
export function buildClearMddDependentDeliverablesPayload(): Record<MddDependentDeliverableKey, null> {
  return buildNullPayload(MDD_DEPENDENT_DELIVERABLE_KEYS);
}

/** Payload nulo para Stage — sin columnas project-only. */
export function buildClearStageMddDependentDeliverablesPayload(): Record<MddDependentStageDeliverableKey, null> {
  return buildNullPayload(MDD_DEPENDENT_STAGE_DELIVERABLE_KEYS);
}
