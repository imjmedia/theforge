import {
  pickDeliverableFieldsFromSource,
  readStageDeliverableSnapshot,
  resolveLiveStageDeliverables,
  type ProjectDeliverableSource,
  type StageDeliverableSnapshot,
  type IntegrationHandoffSeedExcludeKey,
} from "@theforge/shared-types";
import { Prisma } from "@theforge/database";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { parseTasksV2 } from "../engine/task-v2/tasks-parser-v2.js";
import { stampMarkdownIfBodyChanged } from "../engine/document-date-header.util.js";

type PrismaStageWriter = Pick<PrismaService, "stage" | "project" | "$transaction">;

export type PersistStageDeliverablesInput = ProjectDeliverableSource & {
  /** SSOT explícito (p. ej. hidratación Ariadne); evita re-parse cuando ya está validado. */
  tasksJson?: unknown | null;
};

export type StageDeliverableRow = ProjectDeliverableSource;

const DELIVERABLE_KEYS = [
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
  "phase0SummaryContent",
  "aemContent",
] as const satisfies readonly (keyof ProjectDeliverableSource)[];

/** Project flat only — not a Stage column; stamped via `ui-screens.service` or project update. */
const PROJECT_ONLY_DELIVERABLE_KEYS = ["uiScreensContent"] as const satisfies readonly (keyof ProjectDeliverableSource)[];

const STAGE_DELIVERABLE_KEYS = DELIVERABLE_KEYS;

/** JSON borrador Fase 0 — no recibe cabecera markdown. */
const STAMP_EXCLUDED_DELIVERABLE_KEYS = new Set<keyof ProjectDeliverableSource>([
  "phase0SummaryContent",
]);

function buildStageUpdateData(fields: ProjectDeliverableSource): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (const key of STAGE_DELIVERABLE_KEYS) {
    if (fields[key] !== undefined) data[key] = fields[key] ?? null;
  }
  return data;
}

function buildProjectUpdateData(fields: ProjectDeliverableSource): Record<string, string | null> {
  const data = buildStageUpdateData(fields);
  for (const key of PROJECT_ONLY_DELIVERABLE_KEYS) {
    if (fields[key] !== undefined) data[key] = fields[key] ?? null;
  }
  return data;
}

/**
 * Writes deliverable fields to Stage (live store) and keeps Project flat fields in sync.
 * Also auto-parses tasksContent into tasksJson v2 when present.
 */
export async function persistStageAndProjectDeliverables(
  prisma: PrismaStageWriter,
  stageId: string,
  projectId: string,
  fields: PersistStageDeliverablesInput,
): Promise<void> {
  const { tasksJson: explicitTasksJson, ...deliverableFields } = fields;
  const picked = pickDeliverableFieldsFromSource(deliverableFields);
  if (Object.keys(picked).length === 0 && explicitTasksJson === undefined) return;

  const [stageRow, projectRow] = await Promise.all([
    prisma.stage.findUnique({
      where: { id: stageId },
      select: Object.fromEntries(STAGE_DELIVERABLE_KEYS.map((k) => [k, true])) as Record<
        string,
        boolean
      >,
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: Object.fromEntries(
        [...STAGE_DELIVERABLE_KEYS, ...PROJECT_ONLY_DELIVERABLE_KEYS].map((k) => [k, true]),
      ) as Record<string, boolean>,
    }),
  ]);

  const stageData: Record<string, unknown> = buildStageUpdateData(picked);
  const projectData: Record<string, unknown> = buildProjectUpdateData(picked);

  const now = new Date();
  const stampKeys = [...STAGE_DELIVERABLE_KEYS, ...PROJECT_ONLY_DELIVERABLE_KEYS] as const;
  for (const key of stampKeys) {
    const val = projectData[key];
    if (
      !STAMP_EXCLUDED_DELIVERABLE_KEYS.has(key) &&
      typeof val === "string" &&
      val.trim().length > 0
    ) {
      const existing = String(
        (stageRow as Record<string, unknown> | null)?.[key] ??
          (projectRow as Record<string, unknown> | null)?.[key] ??
          "",
      );
      const stamped = stampMarkdownIfBodyChanged(existing, val, now);
      if (key in stageData) stageData[key] = stamped;
      projectData[key] = stamped;
    }
  }

  // Auto-parse tasks v2 into structured JSON (SSOT); fallback leaves tasksContent as markdown source
  if (explicitTasksJson !== undefined) {
    if (explicitTasksJson === null) {
      stageData.tasksJson = Prisma.JsonNull;
      projectData.tasksJson = Prisma.JsonNull;
    } else {
      stageData.tasksJson = explicitTasksJson as Prisma.InputJsonValue;
      projectData.tasksJson = explicitTasksJson as Prisma.InputJsonValue;
    }
  } else if (picked.tasksContent === null) {
    stageData.tasksJson = Prisma.JsonNull;
    projectData.tasksJson = Prisma.JsonNull;
  } else if (typeof picked.tasksContent === "string" && picked.tasksContent.trim().length > 0) {
    try {
      const parsed = parseTasksV2(picked.tasksContent);
      if (parsed.tasks.length > 0) {
        stageData.tasksJson = parsed as unknown as Prisma.InputJsonValue;
        projectData.tasksJson = parsed as unknown as Prisma.InputJsonValue;
      } else if (parsed.errors.length > 0) {
        stageData.tasksJson = Prisma.JsonNull;
        projectData.tasksJson = Prisma.JsonNull;
      }
    } catch {
      stageData.tasksJson = Prisma.JsonNull;
      projectData.tasksJson = Prisma.JsonNull;
    }
  }

  await prisma.$transaction([
    prisma.stage.update({ where: { id: stageId }, data: stageData }),
    prisma.project.update({ where: { id: projectId }, data: projectData }),
  ]);
}

/**
 * Seeds live deliverable columns on a newly activated stage from prior snapshot or project flat fields.
 */
export async function seedActiveStageDeliverables(
  prisma: PrismaStageWriter,
  stageId: string,
  projectId: string,
  options?: {
    previousStageId?: string | null;
    excludeDeliverableKeys?: readonly IntegrationHandoffSeedExcludeKey[];
  },
): Promise<void> {
  const [stage, project, previousStage] = await Promise.all([
    prisma.stage.findUnique({
      where: { id: stageId },
      select: {
        specContent: true,
        architectureContent: true,
        useCasesContent: true,
        userStoriesContent: true,
        blueprintContent: true,
        tasksContent: true,
        apiContractsContent: true,
        logicFlowsContent: true,
        infraContent: true,
        agentGovernanceContent: true,
        uxUiGuideContent: true,
        phase0SummaryContent: true,
        aemContent: true,
      },
    }),
    prisma.project.findUnique({ where: { id: projectId } }),
    options?.previousStageId?.trim()
      ? prisma.stage.findUnique({
          where: { id: options.previousStageId.trim() },
          select: { deliverableSnapshot: true },
        })
      : Promise.resolve(null),
  ]);

  if (!stage || !project) return;

  const hasAnyStageContent = STAGE_DELIVERABLE_KEYS.some((key) => {
    const value = stage[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (hasAnyStageContent) return;

  const exclude = new Set(options?.excludeDeliverableKeys ?? []);
  const snapshot = readStageDeliverableSnapshot(previousStage?.deliverableSnapshot);
  let source: ProjectDeliverableSource;
  if (snapshot) {
    source = [...STAGE_DELIVERABLE_KEYS, ...PROJECT_ONLY_DELIVERABLE_KEYS].reduce<ProjectDeliverableSource>(
      (acc, key) => {
        if (exclude.has(key as IntegrationHandoffSeedExcludeKey)) {
          acc[key] = null;
          return acc;
        }
        acc[key] = snapshot[key] ?? project[key] ?? null;
        return acc;
      },
      {},
    );
  } else {
    source = pickDeliverableFieldsFromSource(project);
    for (const key of exclude) {
      source[key] = null;
    }
  }

  if (exclude.has("tasksContent")) {
    source.tasksContent = null;
  }

  await persistStageAndProjectDeliverables(prisma, stageId, projectId, source);
}

export function resolveStageDeliverableSource(
  stage: StageDeliverableRow & { deliverableSnapshot?: unknown },
  project: ProjectDeliverableSource,
  options?: { snapshot?: StageDeliverableSnapshot | null },
): ProjectDeliverableSource {
  const snapshot = options?.snapshot ?? readStageDeliverableSnapshot(stage.deliverableSnapshot);
  if (snapshot) {
    const merged: ProjectDeliverableSource = {};
    for (const key of [...STAGE_DELIVERABLE_KEYS, ...PROJECT_ONLY_DELIVERABLE_KEYS]) {
      merged[key] = snapshot[key] ?? project[key] ?? null;
    }
    return merged;
  }
  return resolveLiveStageDeliverables(stage, project);
}
