import type { ProjectDeliverableSource } from "./stage-deliverable-snapshot.js";
import type { ProjectType } from "./project.js";
import { isDesignFirst } from "./project-type.js";

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

/** Claves MDD-dependent que se pueden limpiar sin borrar diseño / PAG (Design-First). */
export const MDD_DEPENDENT_KEYS_EXCLUDING_DESIGN_ARTIFACTS = [
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
] as const satisfies readonly MddDependentDeliverableKey[];

export function getMddDependentKeys(projectType: ProjectType): readonly MddDependentDeliverableKey[] {
  return isDesignFirst(projectType)
    ? MDD_DEPENDENT_KEYS_EXCLUDING_DESIGN_ARTIFACTS
    : MDD_DEPENDENT_DELIVERABLE_KEYS;
}

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
export function buildClearMddDependentDeliverablesPayload(
  projectType?: ProjectType,
): Record<MddDependentDeliverableKey, null> {
  const keys = projectType ? getMddDependentKeys(projectType) : MDD_DEPENDENT_DELIVERABLE_KEYS;
  return buildNullPayload(keys);
}

/** Payload nulo para Stage — sin columnas project-only. */
export function buildClearStageMddDependentDeliverablesPayload(
  projectType?: ProjectType,
): Record<MddDependentStageDeliverableKey, null> {
  const keys = getMddDependentKeys(projectType ?? "NEW").filter(
    (key): key is Exclude<MddDependentDeliverableKey, MddDependentProjectOnlyKey> =>
      !(MDD_DEPENDENT_PROJECT_ONLY_KEYS as readonly string[]).includes(key),
  );
  return buildNullPayload(keys);
}
