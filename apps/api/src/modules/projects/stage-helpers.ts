import { StageStatus, Status, type Stage, type Estimation } from "@theforge/database";
import {
  getLegacyChangeState,
  hasValidTasksJson,
  resolveLiveStageDeliverables,
  type ProjectDeliverableSource,
} from "@theforge/shared-types";

/** Etapa 1 legacy = línea base AS-IS (documentación del sistema actual, sin delta de cambio). */
export function isLegacyBaselineStage(stage: { ordinal: number } | null | undefined): boolean {
  return (stage?.ordinal ?? 1) === 1;
}

/** Etapa “en foco”: ACTIVE; si baseline activa sin tasks Ariadne → última etapa integration con SSOT. */
export function pickPrimaryStage<
  T extends {
    ordinal: number;
    workflowStatus: StageStatus;
    legacyChangeState?: unknown;
    tasksJson?: unknown;
  },
>(stages: T[]): T | undefined {
  if (!stages.length) return undefined;
  const active = stages
    .filter((s) => s.workflowStatus === StageStatus.ACTIVE)
    .sort((a, b) => a.ordinal - b.ordinal);
  const primary = active[0] ?? [...stages].sort((a, b) => a.ordinal - b.ordinal)[0];

  const hasAriadneHydratedTasks = (stage: T): boolean => {
    const state = getLegacyChangeState(stage as { legacyChangeState?: unknown });
    const source =
      (state as { tasksSource?: string }).tasksSource ??
      state.integrationHandoffTasks?.source;
    return (
      typeof source === "string" &&
      source.startsWith("ariadne_") &&
      hasValidTasksJson(stage.tasksJson)
    );
  };

  if (primary && isLegacyBaselineStage(primary) && !hasAriadneHydratedTasks(primary)) {
    const integrationStage = [...stages]
      .filter(
        (s) =>
          s.ordinal >= 2 &&
          s.workflowStatus !== StageStatus.ARCHIVED &&
          hasAriadneHydratedTasks(s),
      )
      .sort((a, b) => b.ordinal - a.ordinal)[0];
    if (integrationStage) return integrationStage;
  }

  return primary;
}

export type StageWithEstimation = Stage & { estimation: Estimation | null };

export type ProjectWithStageDeliverables = {
  mddContent: string | null;
  status: Status;
  precisionScore: number;
  estimation: Estimation | null;
} & ProjectDeliverableSource;

export function flattenStageDeliverables(
  stages: StageWithEstimation[],
  project: ProjectDeliverableSource = {},
): ProjectWithStageDeliverables {
  const active = pickPrimaryStage(stages);
  const deliverables = resolveLiveStageDeliverables(active ?? null, project);
  return {
    mddContent: active?.mddContent ?? null,
    status: active?.status ?? Status.ROJO,
    precisionScore: active?.precisionScore ?? 0,
    estimation: active?.estimation ?? null,
    ...deliverables,
  };
}
