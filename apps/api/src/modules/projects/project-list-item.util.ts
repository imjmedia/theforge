import type { ComplexityLevel, Estimation, Project, ProjectApproach, StageStatus, Status } from "@theforge/database";
import { flattenStageDeliverables, pickPrimaryStage, type StageWithEstimation } from "./stage-helpers.js";

/** Campos de documento que el listado del dashboard no carga (siempre null en `GET /projects`). */
export const PROJECT_LIST_NULL_DOCUMENTS = {
  dbgaContent: null,
  specContent: null,
  architectureContent: null,
  useCasesContent: null,
  userStoriesContent: null,
  mddContent: null,
  blueprintContent: null,
  tasksContent: null,
  apiContractsContent: null,
  logicFlowsContent: null,
  infraContent: null,
  agentGovernanceContent: null,
  uxUiGuideContent: null,
  uxGuideDesignRef: null,
  phase0SummaryContent: null,
  aemContent: null,
  uiScreensContent: null,
  figmaMapping: null,
} as const;

export type ProjectListStageSummary = {
  id: string;
  ordinal: number;
  key: string | null;
  name: string | null;
  workflowStatus: StageStatus;
  status: Status;
  precisionScore: number;
  isLegacy: boolean;
  estimation: Estimation | null;
};

type ProjectListRow = {
  id: string;
  userId: string;
  name: string;
  visibility: "PRIVATE" | "SHARED";
  approach?: ProjectApproach;
  uxDesignSource?: string | null;
  complexity: ComplexityLevel;
  complexityPending: unknown;
  projectType: Project["projectType"];
  theforgeProjectId: string | null;
  hasUxTeam: boolean;
  linkedLegacyProjectId: string | null;
  linkedNewProjectId: string | null;
  groupId: string;
  group?: { name: string };
  createdAt: Date;
  stages: StageWithEstimation[];
};

/**
 * Proyección ligera para el panel de proyectos: metadatos + semáforo de la etapa activa.
 * Sin markdown ni snapshots pesados (MDD, entregables, legacyChangeState, etc.).
 */
export function toApiProjectListItem(
  project: ProjectListRow,
  isFavorite: boolean,
) {
  const stages: ProjectListStageSummary[] = project.stages.map((s) => ({
    id: s.id,
    ordinal: s.ordinal,
    key: s.key,
    name: s.name,
    workflowStatus: s.workflowStatus,
    status: s.status,
    precisionScore: s.precisionScore,
    isLegacy: s.isLegacy,
    estimation: s.estimation ?? null,
  }));

  const flat = flattenStageDeliverables(project.stages, PROJECT_LIST_NULL_DOCUMENTS);

  return {
    id: project.id,
    userId: project.userId,
    name: project.name,
    visibility: project.visibility,
    approach: project.approach ?? "DOMAIN_FIRST",
    uxDesignSource: project.uxDesignSource ?? null,
    complexity: project.complexity,
    complexityPending: project.complexityPending,
    projectType: project.projectType,
    theforgeProjectId: project.theforgeProjectId,
    hasUxTeam: project.hasUxTeam,
    requireBrdTobeGate: false,
    linkedLegacyProjectId: project.linkedLegacyProjectId,
    linkedNewProjectId: project.linkedNewProjectId,
    groupId: project.groupId,
    groupName: project.group?.name,
    createdAt: project.createdAt.toISOString(),
    stages,
    status: flat.status,
    precisionScore: flat.precisionScore,
    estimation: flat.estimation,
    isFavorite,
    ...PROJECT_LIST_NULL_DOCUMENTS,
    /** Etapa activa (referencia rápida sin cargar documentos). */
    activeStageId: pickPrimaryStage(project.stages)?.id ?? null,
  };
}
