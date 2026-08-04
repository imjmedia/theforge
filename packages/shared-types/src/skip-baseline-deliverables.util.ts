import type { DeliverableKind } from "./deliverables-matrix.js";
import { getLegacyChangeState } from "./legacy-change-state.util.js";
import { shouldSkipLegacyTasksGeneration } from "./integration-handoff-tasks.util.js";

/** Maps Ariadne integration_scope.skipBaselineDeliverables → Forge cascade kinds. */
const SKIP_BASELINE_TO_DELIVERABLE_KINDS: Record<string, readonly DeliverableKind[]> = {
  migration_tasks: ["tasks"],
  change_spec: ["spec"],
  data_model: ["architecture", "blueprint"],
  mdd_full: ["mdd_canonical"],
};

export function resolveSkipBaselineDeliverableKinds(
  skipBaselineDeliverables?: readonly string[] | null,
  options?: { skipTasksFromHandoff?: boolean },
): DeliverableKind[] {
  const kinds = new Set<DeliverableKind>();
  if (options?.skipTasksFromHandoff) kinds.add("tasks");
  for (const key of skipBaselineDeliverables ?? []) {
    const mapped = SKIP_BASELINE_TO_DELIVERABLE_KINDS[key.trim()];
    if (mapped) {
      for (const k of mapped) kinds.add(k);
    }
  }
  return [...kinds];
}

/** True when integration handoff must not recommend legacy_generate_deliverables by default. */
export function shouldSkipLegacyGenerateDeliverables(
  skipBaselineDeliverables?: readonly string[] | null,
): boolean {
  return (skipBaselineDeliverables ?? []).some((k) => k.trim() === "migration_tasks");
}

/** Resolves all DeliverableKind values to omit in legacy cascade for a stage. */
export function resolveLegacyCascadeSkipKindsFromStage(stage: {
  legacyChangeState?: unknown;
}): DeliverableKind[] {
  const state = getLegacyChangeState(stage);
  const skipTasks = shouldSkipLegacyTasksGeneration(stage);
  const fromScope = resolveSkipBaselineDeliverableKinds(state.integrationScope?.skipBaselineDeliverables, {
    skipTasksFromHandoff: skipTasks,
  });
  const fromPersisted = resolveSkipBaselineDeliverableKinds(
    (state as { skipBaselineDeliverables?: string[] }).skipBaselineDeliverables,
    { skipTasksFromHandoff: false },
  );
  return [...new Set([...fromScope, ...fromPersisted])];
}
