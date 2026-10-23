import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { Prisma, type Project, type Stage, type Status } from "@theforge/database";
import type { Estimation } from "@theforge/database";
import { getRequestUserId, getRequestUserRole } from "../../common/request-user.store.js";
import { isAdminOrAbove } from "../../common/roles.js";
import {
  validateDocumentForPersist,
  documentPersistFieldLabel,
} from "../sessions/document-shrink.util.js";
import {
  DocumentSnapshotService,
  type DocumentSnapshotSource,
} from "../document-snapshot/document-snapshot.service.js";
import {
  shouldReplacePhase0SummaryWithBorrador,
  updateProjectSchema,
  type UpdateProjectDto,
  pickDeliverableFieldsFromSource,
  MDD_DEPENDENT_DELIVERABLE_KEYS,
  type ProjectDeliverableSource,
} from "@theforge/shared-types";
import { stampMarkdownIfBodyChanged } from "../engine/document-date-header.util.js";
import { enforceMddGovernancePatternsOnPersist } from "@theforge/shared-types/mdd-governance-patterns";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ChangeLogService } from "../change-log/change-log.service.js";
import { PluginDocumentPipelineService } from "../../plugins/plugin-document-pipeline.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import { mergeProjectFieldsForSemaphore } from "./project-mdd-persist.util.js";
import { ProjectMddPersistService } from "./project-mdd-persist.service.js";
import { ProjectEstimationRecalcService } from "./project-estimation-recalc.service.js";
import { ProjectDeliverableGateService } from "./project-deliverable-gate.service.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import { persistStageAndProjectDeliverables } from "./stage-deliverable-persist.util.js";
import { ProjectsService } from "./projects.service.js";
import {
  buildProjectClearMddDependentDeliverablesUpdate,
  buildStageClearMddDependentDeliverablesUpdate,
} from "./clear-mdd-dependent-deliverables.util.js";

type StageWithEst = Stage & { estimation: Estimation | null };

@Injectable()
export class ProjectUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLog: ChangeLogService,
    private readonly documentSnapshot: DocumentSnapshotService,
    private readonly pluginPipeline: PluginDocumentPipelineService,
    private readonly mddPersist: ProjectMddPersistService,
    private readonly estimationRecalc: ProjectEstimationRecalcService,
    private readonly deliverableGate: ProjectDeliverableGateService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
  ) {}

  private notifyPluginProjectUpdate(projectId: string, projectName: string): void {
    void this.pluginPipeline.runOnProjectUpdate({
      projectId,
      projectName,
      userId: getRequestUserId(),
      timestamp: new Date(),
    });
  }

  private async guardAndSnapshotDocumentField(
    projectId: string,
    field: "dbgaContent" | "specContent",
    current: string | null | undefined,
    next: string | null | undefined,
    source: DocumentSnapshotSource = "patch",
  ): Promise<void> {
    if (next === undefined) return;
    const validation = validateDocumentForPersist(current, next, {
      fieldLabel: documentPersistFieldLabel(field),
    });
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }
    const cur = (current ?? "").trim();
    const nxt = (next ?? "").trim();
    if (cur.length >= 400 && nxt.length > 0 && cur !== nxt) {
      await this.documentSnapshot.snapshotBeforeOverwrite(projectId, field, current, source);
    }
  }

  async listDocumentSnapshots(
    projectId: string,
    options?: { field?: string; limit?: number },
  ) {
    await loadAccessibleProjectWithStages(this.prisma, projectId);
    return this.documentSnapshot.listByProject(projectId, options);
  }

  async restoreDocumentSnapshot(projectId: string, snapshotId: string) {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const snap = await this.documentSnapshot.getSnapshotContent(projectId, snapshotId);
    if (!this.documentSnapshot.isSnapshotField(snap.field)) {
      throw new BadRequestException(`Restauración no soportada para el campo ${snap.field}.`);
    }

    const current =
      snap.field === "dbgaContent"
        ? project.dbgaContent
        : snap.field === "specContent"
          ? project.specContent
          : null;

    if (snap.field === "dbgaContent" || snap.field === "specContent") {
      await this.documentSnapshot.snapshotBeforeOverwrite(
        projectId,
        snap.field,
        current,
        "restore",
      );
      await this.prisma.project.update({
        where: { id: projectId },
        data: { [snap.field]: snap.content },
      });
      await this.changeLog.log(projectId, snap.field, snap.content);
      return this.projects.findOne(projectId);
    }

    throw new BadRequestException(`Restauración no implementada para ${snap.field}.`);
  }

  async update(id: string, data: UpdateProjectDto) {
    const parsed = updateProjectSchema.partial().parse(data);
    const existing = await loadAccessibleProjectWithStages(this.prisma, id);
    const existingRaw = existing as Project & { stages: StageWithEst[] };

    const {
      mddContent: parsedMdd,
      stageId: parsedStageId,
      documentAst: parsedDocumentAst,
      documentVersion: parsedDocumentVersion,
      allowGovernancePatternChange,
      clearMddCompletely,
      mddGovernanceSeedOnly,
      mddFormatOnly,
      clearComplexityPending,
      complexityPending: cpInput,
      groupId: parsedGroupId,
      ...rest
    } = parsed;

    const hasSettingsChange =
      rest.name !== undefined ||
      rest.visibility !== undefined ||
      rest.approach !== undefined ||
      rest.uxDesignSource !== undefined ||
      rest.complexity !== undefined ||
      rest.hasUxTeam !== undefined ||
      rest.projectType !== undefined ||
      rest.theforgeProjectId !== undefined ||
      rest.figmaMapping !== undefined ||
      clearComplexityPending === true ||
      cpInput !== undefined ||
      rest.convergeWebhookUrl !== undefined ||
      rest.convergeWebhookSecret !== undefined;
    if (hasSettingsChange && existingRaw.userId !== getRequestUserId()) {
      throw new BadRequestException("Only the project owner can change project settings");
    }

    if (parsedGroupId !== undefined && parsedGroupId !== existingRaw.groupId) {
      if (!isAdminOrAbove(getRequestUserRole())) {
        throw new ForbiddenException("Solo admin puede mover proyectos entre grupos");
      }
      const targetGroup = await this.prisma.projectGroup.findUnique({
        where: { id: parsedGroupId },
        select: { id: true },
      });
      if (!targetGroup) throw new NotFoundException("Grupo no encontrado");
    }

    const targetStage: StageWithEst | undefined =
      (parsedStageId?.trim() && existingRaw.stages.find((s) => s.id === parsedStageId.trim())) ||
      pickPrimaryStage(existingRaw.stages);
    if (!targetStage) throw new BadRequestException("El proyecto no tiene etapas");

    if (rest.specContent !== undefined) {
      await this.guardAndSnapshotDocumentField(
        id,
        "specContent",
        existingRaw.specContent,
        rest.specContent,
      );
    }

    if (rest.dbgaContent !== undefined) {
      await this.guardAndSnapshotDocumentField(
        id,
        "dbgaContent",
        existingRaw.dbgaContent,
        rest.dbgaContent,
      );
    }

    let mddGovernancePatternsReverted = false;
    let mddForPipeline: string | null | undefined = parsedMdd;
    if (parsedMdd !== undefined && parsedMdd !== null) {
      const enforced = enforceMddGovernancePatternsOnPersist(
        parsedMdd,
        targetStage.mddContent,
        {
          allowPatternChange: allowGovernancePatternChange === true,
          clearMddCompletely: clearMddCompletely === true,
        },
      );
      mddForPipeline = enforced.markdown;
      mddGovernancePatternsReverted = enforced.patternsReverted;
    }

    const mergedForSemaphore = mergeProjectFieldsForSemaphore(existingRaw, rest);

    const updatePayload: Prisma.ProjectUpdateInput = {
      ...rest,
      figmaMapping:
        rest.figmaMapping === null ? undefined : (rest.figmaMapping as Prisma.InputJsonValue),
      pluginData:
        rest.pluginData === null ? undefined : (rest.pluginData as Prisma.InputJsonValue),
    };
    if (parsedGroupId !== undefined) {
      updatePayload.group = { connect: { id: parsedGroupId } };
    }
    if (clearComplexityPending === true) {
      updatePayload.complexityPending = Prisma.JsonNull;
    } else if (cpInput !== undefined) {
      updatePayload.complexityPending =
        cpInput === null ? Prisma.JsonNull : (cpInput as Prisma.InputJsonValue);
    }
    if (rest.uxUiGuideContent !== undefined) {
      updatePayload.uxUiGuideContent = rest.uxUiGuideContent;
    }
    if (rest.dbgaContent !== undefined && rest.dbgaContent !== null) {
      const { ensureJsonCodeFences } = await import("../ai-analysis/state/state-to-markdown.js");
      let dbgaFormatted = ensureJsonCodeFences(rest.dbgaContent);
      if (dbgaFormatted.trim()) {
        dbgaFormatted = stampMarkdownIfBodyChanged(existingRaw.dbgaContent, dbgaFormatted);
      }
      updatePayload.dbgaContent = dbgaFormatted;
      const { isPhase0StructuredMarkdown, markdownToPhase0Document } = await import(
        "../ai-analysis/phase0/phase0-from-markdown.js"
      );
      if (isPhase0StructuredMarkdown(rest.dbgaContent)) {
        if (shouldReplacePhase0SummaryWithBorrador(existing.phase0SummaryContent)) {
          updatePayload.phase0SummaryContent = JSON.stringify(
            markdownToPhase0Document(rest.dbgaContent),
            null,
            2,
          );
        }
      }
    }

    const infraContentForRecalc = rest.infraContent ?? existing.infraContent ?? null;

    let pipelineResult: { sanitizedMdd: string; status: Status; precisionScore: number } | null = null;
    if (mddForPipeline !== undefined && mddForPipeline !== null) {
      pipelineResult = await this.mddPersist.persistMddFromPatch({
        projectId: id,
        stageId: targetStage.id,
        mddMarkdown: mddForPipeline,
        mergedForSemaphore,
        stageBaseline: {
          status: targetStage.status,
          precisionScore: targetStage.precisionScore,
        },
        documentMeta: {
          documentAst: parsedDocumentAst,
          documentVersion: parsedDocumentVersion,
        },
        patchFlags: {
          clearMddCompletely: clearMddCompletely === true,
          mddGovernanceSeedOnly: mddGovernanceSeedOnly === true,
          allowGovernancePatternChange: allowGovernancePatternChange === true,
          mddFormatOnly: mddFormatOnly === true,
        },
      });
    }

    const mddForRecalc = pipelineResult?.sanitizedMdd ?? targetStage.mddContent ?? null;
    const statusForRecalc = pipelineResult?.status ?? targetStage.status;

    if (mddForRecalc != null && (mddForPipeline !== undefined || rest.infraContent !== undefined)) {
      await this.estimationRecalc.recalcAndUpsert(targetStage.id, {
        mddContent: mddForRecalc,
        infraContent: infraContentForRecalc,
        status: statusForRecalc,
      });
    }

    const hasProjectFieldUpdates =
      (Object.keys(rest) as (keyof typeof rest)[]).some((k) => rest[k] !== undefined) ||
      clearComplexityPending === true ||
      cpInput !== undefined ||
      parsedGroupId !== undefined;
    if (hasProjectFieldUpdates) {
      const deliverablePatch = pickDeliverableFieldsFromSource(rest as ProjectDeliverableSource);
      const hasDeliverablePatch = Object.keys(deliverablePatch).length > 0;

      await this.prisma.project.update({
        where: { id },
        data: updatePayload,
      });

      if (hasDeliverablePatch) {
        await persistStageAndProjectDeliverables(this.prisma, targetStage.id, id, deliverablePatch);
      }
      const documentFields = [
        "dbgaContent",
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
      ] as const;
      for (const field of documentFields) {
        if ((rest as Record<string, unknown>)[field] !== undefined) {
          await this.changeLog.log(id, field, (rest as Record<string, string | null | undefined>)[field]);
        }
      }
    }

    const shouldRefreshSemaphoreWithoutMdd =
      (mddForPipeline === undefined || mddForPipeline === null) &&
      (rest.complexity !== undefined ||
        rest.hasUxTeam !== undefined ||
        rest.figmaMapping !== undefined ||
        rest.specContent !== undefined ||
        rest.useCasesContent !== undefined ||
        rest.userStoriesContent !== undefined ||
        rest.tasksContent !== undefined ||
        rest.apiContractsContent !== undefined ||
        rest.uxUiGuideContent !== undefined ||
        rest.logicFlowsContent !== undefined ||
        cpInput !== undefined ||
        clearComplexityPending === true);
    if (shouldRefreshSemaphoreWithoutMdd) {
      await this.deliverableGate.refreshStageSemaphoreFromProject(id);
    }

    const project = await this.projects.findOne(id);
    const mddWasInRequest = mddForPipeline !== undefined && mddForPipeline !== null;
    const notifyLifecycle = () => {
      if (hasProjectFieldUpdates) {
        this.notifyPluginProjectUpdate(id, project.name);
      }
    };
    if (mddGovernancePatternsReverted) {
      notifyLifecycle();
      return {
        ...project,
        mddGovernancePatternsReverted: true as const,
        ...(mddWasInRequest && pipelineResult
          ? { mddPersist: { saved: true as const, stageId: targetStage.id } }
          : {}),
      };
    }
    if (mddWasInRequest && pipelineResult) {
      notifyLifecycle();
      return { ...project, mddPersist: { saved: true as const, stageId: targetStage.id } };
    }
    notifyLifecycle();
    return project;
  }

  /** Vacía entregables SDD regenerados desde el MDD (conserva MDD, DBGA, Fase 0, AEM, BRD). */
  async clearMddDependentDeliverables(
    projectId: string,
    options?: { stageId?: string },
  ) {
    const existing = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const targetStage =
      (options?.stageId?.trim() &&
        existing.stages.find((s) => s.id === options.stageId!.trim())) ||
      pickPrimaryStage(existing.stages);
    if (!targetStage) throw new BadRequestException("El proyecto no tiene etapas");

    const projectClear = buildProjectClearMddDependentDeliverablesUpdate();
    const stageClear = buildStageClearMddDependentDeliverablesUpdate(targetStage.shortTermContext);

    await this.prisma.$transaction([
      this.prisma.project.update({
        where: { id: projectId },
        data: projectClear,
      }),
      this.prisma.stage.update({
        where: { id: targetStage.id },
        data: stageClear,
      }),
    ]);

    for (const field of MDD_DEPENDENT_DELIVERABLE_KEYS) {
      await this.changeLog.log(projectId, field, null);
    }
    await this.changeLog.log(projectId, "tasksContent", null);

    await this.deliverableGate.refreshStageSemaphoreFromProject(projectId);
    return this.projects.findOne(projectId);
  }
}
