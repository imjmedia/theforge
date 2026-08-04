/**
 * Helpers MCP para SSOT tasks y bundle version desde respuestas API.
 */

import {
  getLegacyChangeState,
  hasValidTasksJson,
  readStageDeliverableSnapshot,
  resolveTasksForConsume,
  type ResolvedTasksSource,
} from "@theforge/shared-types";

function isLegacyBaselineStage(stage: Record<string, unknown>): boolean {
  return Number(stage.ordinal ?? 1) === 1;
}

function hasAriadneHydratedTasks(stage: Record<string, unknown>): boolean {
  const state = getLegacyChangeState(stage as { legacyChangeState?: unknown });
  const source =
    (state as { tasksSource?: string }).tasksSource ??
    state.integrationHandoffTasks?.source;
  return (
    typeof source === "string" &&
    source.startsWith("ariadne_") &&
    hasValidTasksJson(stage.tasksJson)
  );
}

export function pickPrimaryStageFromApi(stages: unknown[]): Record<string, unknown> | null {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const typed = stages.filter(
    (s): s is Record<string, unknown> => s != null && typeof s === "object",
  );
  const active = typed
    .filter((s) => s.workflowStatus === "ACTIVE")
    .sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0));
  const primary = active[0] ?? [...typed].sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0))[0];

  if (
    primary &&
    isLegacyBaselineStage(primary) &&
    !hasAriadneHydratedTasks(primary)
  ) {
    const integrationStage = [...typed]
      .filter(
        (s) =>
          Number(s.ordinal ?? 0) >= 2 &&
          s.workflowStatus !== "ARCHIVED" &&
          hasAriadneHydratedTasks(s),
      )
      .sort((a, b) => Number(b.ordinal ?? 0) - Number(a.ordinal ?? 0))[0];
    if (integrationStage) return integrationStage;
  }

  return primary ?? null;
}

export function resolveTasksSsotFromProjectApi(
  project: Record<string, unknown>,
  primaryStage: Record<string, unknown> | null,
): {
  source: ResolvedTasksSource;
  hasTasksJson: boolean;
  taskCount: number;
  tasksJson: unknown;
  deliverableBundleVersion: string | null;
  /** Origen Ariadne (p. ej. ariadne_tasks_json_seed) cuando hidratado en import. */
  ariadneTasksSource?: string | null;
  /** Etapa usada para resolver SSOT (puede diferir de ACTIVE si baseline sin tasks Ariadne). */
  stageId?: string | null;
  stageOrdinal?: number | null;
} {
  const resolved = resolveTasksForConsume({
    tasksContent: typeof project.tasksContent === "string" ? project.tasksContent : null,
    tasksJson: primaryStage?.tasksJson ?? project.tasksJson,
  });
  const legacyState =
    primaryStage?.legacyChangeState != null && typeof primaryStage.legacyChangeState === "object"
      ? (primaryStage.legacyChangeState as Record<string, unknown>)
      : null;
  const handoffTasks =
    legacyState?.integrationHandoffTasks != null &&
    typeof legacyState.integrationHandoffTasks === "object"
      ? (legacyState.integrationHandoffTasks as Record<string, unknown>)
      : null;
  const ariadneTasksSource =
    (typeof legacyState?.tasksSource === "string" ? legacyState.tasksSource : null) ??
    (typeof handoffTasks?.tasksSource === "string" ? handoffTasks.tasksSource : null) ??
    (typeof handoffTasks?.source === "string" ? handoffTasks.source : null);

  const snapshot = readStageDeliverableSnapshot(primaryStage?.deliverableSnapshot);
  return {
    source: resolved.source,
    hasTasksJson: resolved.hasTasksJson,
    taskCount: resolved.taskCount,
    tasksJson: resolved.tasksJson,
    deliverableBundleVersion: snapshot?.bundleVersion ?? null,
    ariadneTasksSource,
    stageId: typeof primaryStage?.id === "string" ? primaryStage.id : null,
    stageOrdinal: typeof primaryStage?.ordinal === "number" ? primaryStage.ordinal : null,
  };
}

export function enrichStagesWithBundleMeta(stages: unknown[]): unknown[] {
  if (!Array.isArray(stages)) return [];
  return stages.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const stage = raw as Record<string, unknown>;
    const snapshot = readStageDeliverableSnapshot(stage.deliverableSnapshot);
    return {
      ...stage,
      deliverableBundleVersion: snapshot?.bundleVersion ?? null,
      deliverableBundleGeneratedAt: snapshot?.bundleGeneratedAt ?? null,
    };
  });
}
