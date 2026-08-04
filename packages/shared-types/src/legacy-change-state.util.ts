import type { LegacyChangeGateInput } from "./legacy-change-gate.js";
import type { StageOrigin } from "./stage-origin.util.js";

/** Legacy flow / change state persisted on Stage.legacyChangeState. */
export type LegacyChangeState = NonNullable<LegacyChangeGateInput["legacyChangeState"]> & {
  /** Provenance: Forge-native vs Ariadne-sourced stage. */
  stageOrigin?: StageOrigin | null;
  codebaseDoc?: string | null;
  suggestedAnswers?: Record<string, string> | null;
  answers?: Record<string, string> | null;
  lastDeliverablesDebug?: Record<string, unknown> | null;
  legacyIndexSddResolution?: {
    choice?: string;
    resolvedAt?: string;
  } | null;
  status?: string | null;
  baselineStageId?: string | null;
  transitionedAt?: string | null;
  hasNavigationMap?: boolean | null;
  routeCount?: number | null;
  /** Tasks importadas desde handoff NEW-LEG / Ariadne — omitir LLM tasks en cascada. */
  integrationHandoffTasks?: import("./integration-handoff-tasks.util.js").IntegrationHandoffTasksMeta | null;
  /** SSOT Ariadne tasks (ariadne_tasks_json_seed | ariadne_cursor_tasks_markdown). */
  tasksSource?: import("./integration-handoff-tasks.util.js").AriadneTasksHydrationSource | null;
  integrationScope?: import("./hydrate-tasks-from-ariadne-pack.util.js").AriadneIntegrationScopePayload | null;
  ariadneChangePack?: {
    version?: string;
    ariadneChangeId?: string | null;
    ariadneRepositoryId?: string | null;
    importedAt?: string;
    handoffPlanType?: import("./ariadne-change-pack.js").AriadneHandoffPlanType | null;
    tasksImportedFromHandoff?: boolean;
  } | null;
};

function readLegacyChangeStateFromUnknown(raw: unknown): LegacyChangeState | null {
  if (raw == null || typeof raw !== "object") return null;
  return raw as LegacyChangeState;
}

/**
 * Reads legacy change state from a stage row. Returns empty object when missing.
 */
export function getLegacyChangeState(
  stage: { legacyChangeState?: unknown } | null | undefined,
): LegacyChangeState {
  return readLegacyChangeStateFromUnknown(stage?.legacyChangeState) ?? {};
}

/**
 * Gate helper: legacy change input from stage only (Project.legacyFlowState removed).
 */
export function getLegacyChangeGateInput(
  stage: {
    ordinal?: number;
    legacyChangeState?: unknown;
    handoffImportedAt?: Date | string | null;
    handoffSnapshot?: unknown;
  } | null | undefined,
): LegacyChangeGateInput {
  return {
    ordinal: stage?.ordinal ?? 1,
    legacyChangeState: readLegacyChangeStateFromUnknown(stage?.legacyChangeState),
    handoffImportedAt: stage?.handoffImportedAt ?? null,
    handoffSnapshot:
      stage?.handoffSnapshot != null && typeof stage.handoffSnapshot === "object"
        ? (stage.handoffSnapshot as LegacyChangeGateInput["handoffSnapshot"])
        : null,
  };
}
