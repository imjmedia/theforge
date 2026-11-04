import { Prisma, type Estimation, type Project, type Stage } from "@theforge/database";
import type { CloneProjectBody, Visibility } from "@theforge/shared-types";

type StageWithEst = Stage & { estimation: Estimation | null };

export type ProjectCloneSource = Project & { stages: StageWithEst[] };

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === null || value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

function buildStageCloneCreateInput(stage: StageWithEst): Prisma.StageCreateWithoutProjectInput {
  return {
    ordinal: stage.ordinal,
    key: stage.key,
    name: stage.name,
    workflowStatus: stage.workflowStatus,
    mddContent: stage.mddContent,
    brdContent: stage.brdContent,
    designSpec: jsonValue(stage.designSpec),
    designSpecRevision: stage.designSpecRevision,
    architectureGraph: jsonValue(stage.architectureGraph),
    architectureGraphSourceHash: stage.architectureGraphSourceHash,
    status: stage.status,
    precisionScore: stage.precisionScore,
    legacyChangeState: jsonValue(stage.legacyChangeState),
    handoffSnapshot: jsonValue(stage.handoffSnapshot),
    handoffImportedAt: stage.handoffImportedAt,
    deliverableSnapshot: jsonValue(stage.deliverableSnapshot),
    specContent: stage.specContent,
    architectureContent: stage.architectureContent,
    useCasesContent: stage.useCasesContent,
    userStoriesContent: stage.userStoriesContent,
    blueprintContent: stage.blueprintContent,
    tasksContent: stage.tasksContent,
    apiContractsContent: stage.apiContractsContent,
    logicFlowsContent: stage.logicFlowsContent,
    infraContent: stage.infraContent,
    agentGovernanceContent: stage.agentGovernanceContent,
    uxUiGuideContent: stage.uxUiGuideContent,
    phase0SummaryContent: stage.phase0SummaryContent,
    aemContent: stage.aemContent,
    changeSpecContent: stage.changeSpecContent,
    isLegacy: stage.isLegacy,
    theforgeProjectId: stage.theforgeProjectId,
    shortTermContext: jsonValue(stage.shortTermContext),
    estimation: stage.estimation
      ? {
          create: {
            totalHours: stage.estimation.totalHours,
            totalMxn: stage.estimation.totalMxn,
            teamStructure: stage.estimation.teamStructure as Prisma.InputJsonValue,
          },
        }
      : undefined,
  };
}

export function buildProjectCloneCreateInput(
  source: ProjectCloneSource,
  options: { userId: string; name: string; visibility: Visibility },
): Prisma.ProjectCreateInput {
  const stages = [...source.stages].sort((a, b) => a.ordinal - b.ordinal);

  return {
    user: { connect: { id: options.userId } },
    group: { connect: { id: source.groupId } },
    name: options.name,
    visibility: options.visibility,
    hasUxTeam: source.hasUxTeam,
    complexity: source.complexity,
    complexityPending: jsonValue(source.complexityPending),
    projectType: source.projectType,
    theforgeProjectId: source.theforgeProjectId,
    uxGuideDesignRef: source.uxGuideDesignRef,
    figmaMapping: jsonValue(source.figmaMapping),
    dbgaContent: source.dbgaContent,
    specContent: source.specContent,
    architectureContent: source.architectureContent,
    useCasesContent: source.useCasesContent,
    userStoriesContent: source.userStoriesContent,
    blueprintContent: source.blueprintContent,
    tasksContent: source.tasksContent,
    apiContractsContent: source.apiContractsContent,
    logicFlowsContent: source.logicFlowsContent,
    infraContent: source.infraContent,
    agentGovernanceContent: source.agentGovernanceContent,
    uxUiGuideContent: source.uxUiGuideContent,
    phase0SummaryContent: source.phase0SummaryContent,
    phase0Status: source.phase0Status,
    phase0Gaps: source.phase0Gaps,
    phase0Questions: source.phase0Questions,
    aemContent: source.aemContent,
    stages: {
      create: stages.map((stage) => buildStageCloneCreateInput(stage)),
    },
  };
}

export function defaultCloneProjectName(sourceName: string): string {
  const trimmed = sourceName.trim();
  const prefix = "Copia de ";
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed;
  return `${prefix}${trimmed}`;
}

export function resolveCloneProjectOptions(
  source: Pick<Project, "name">,
  body: CloneProjectBody,
): { name: string; visibility: Visibility } {
  const name = body.name?.trim() || defaultCloneProjectName(source.name);
  return {
    name,
    visibility: body.visibility ?? "PRIVATE",
  };
}
