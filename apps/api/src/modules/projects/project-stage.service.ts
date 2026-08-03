import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, StageStatus, Status } from "@theforge/database";
import {
  createStageBodySchema,
  patchStageBodySchema,
  transitionStageBodySchema,
  getAllowedStageTransitions,
} from "@theforge/shared-types";
import { getRequestUserId } from "../../common/request-user.store.js";
import { prependDocumentTimestamps } from "../engine/document-date-header.util.js";
import { ChangeLogService } from "../change-log/change-log.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  loadAccessibleProjectWithStages,
  projectWhereForOwner,
} from "./project-access.util.js";
import { ProjectEstimationRecalcService } from "./project-estimation-recalc.service.js";
import {
  ensureStageDeliverableSnapshotIfMissing,
} from "./stage-deliverable-snapshot.util.js";
import { seedActiveStageDeliverables } from "./stage-deliverable-persist.util.js";
import { resolveStageDeliverables } from "./stage-deliverables.util.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import type { Estimation, Stage } from "@theforge/database";

type StageWithEst = Stage & { estimation: Estimation | null };

@Injectable()
export class ProjectStageService {
  private readonly logger = new Logger(ProjectStageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estimationRecalc: ProjectEstimationRecalcService,
    private readonly changeLog: ChangeLogService,
  ) {}

  /** Una sola etapa ACTIVE por proyecto: demueve las demás ACTIVE a SUPERSEDED. */
  async activateStageExclusive(
    projectId: string,
    stageId: string,
    options?: { seedExcludeDeliverableKeys?: readonly ("tasksContent" | "userStoriesContent")[] },
  ): Promise<void> {
    const uid = getRequestUserId();
    const stage = await this.prisma.stage.findFirst({
      where: {
        id: stageId,
        projectId,
        project: { id: projectId, userId: uid },
      },
    });
    if (!stage) throw new NotFoundException("Etapa no encontrada");

    const previousActive = await this.prisma.stage.findMany({
      where: { projectId, workflowStatus: StageStatus.ACTIVE, NOT: { id: stageId } },
      select: { id: true, ordinal: true, deliverableSnapshot: true },
    });

    for (const prev of previousActive) {
      if (prev.ordinal >= 1) {
        await ensureStageDeliverableSnapshotIfMissing(this.prisma, prev.id, projectId, {
          source: "cascade",
        }).catch((err) =>
          this.logger.warn(
            `[Stage] snapshot before activate: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.stage.updateMany({
        where: { projectId, workflowStatus: StageStatus.ACTIVE },
        data: { workflowStatus: StageStatus.SUPERSEDED },
      }),
      this.prisma.stage.update({
        where: { id: stageId },
        data: { workflowStatus: StageStatus.ACTIVE },
      }),
    ]);

    const previousStageId = previousActive.sort((a, b) => a.ordinal - b.ordinal)[0]?.id;
    await seedActiveStageDeliverables(this.prisma, stageId, projectId, {
      previousStageId: previousStageId ?? null,
      excludeDeliverableKeys: options?.seedExcludeDeliverableKeys,
    }).catch((err) =>
      this.logger.warn(
        `[Stage] seed deliverables on activate: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  async createStage(projectId: string, body: unknown) {
    const dto = createStageBodySchema.parse(body);
    const project = await this.prisma.project.findFirst({
      where: projectWhereForOwner(projectId),
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!project) throw new NotFoundException("Project not found");

    const maxOrd = project.stages.length ? Math.max(...project.stages.map((s) => s.ordinal)) : 0;
    const ordinal = dto.ordinal ?? maxOrd + 1;
    if (project.stages.some((s) => s.ordinal === ordinal)) {
      throw new BadRequestException(`Ya existe una etapa con ordinal ${ordinal}`);
    }

    let mddContent: string | null = null;
    let stStatus: Status = Status.ROJO;
    let precisionScore = 0;
    let legacyChangeState: object | null = null;
    if (dto.copyMddFromStageId?.trim()) {
      const copyFrom = dto.copyMddFromStageId.trim();
      const src = project.stages.find((s) => s.id === copyFrom);
      if (!src) throw new BadRequestException("copyMddFromStageId no pertenece al proyecto");
      mddContent = src.mddContent;
      stStatus = src.status;
      precisionScore = src.precisionScore;
    }
    if (dto.copyLegacyChangeFromStageId?.trim()) {
      const copyFrom = dto.copyLegacyChangeFromStageId.trim();
      const src = project.stages.find((s) => s.id === copyFrom);
      if (!src) throw new BadRequestException("copyLegacyChangeFromStageId no pertenece al proyecto");
      legacyChangeState = src.legacyChangeState as object | null;
    }

    const isLegacy = project.projectType === "LEGACY";
    const newStage = await this.prisma.stage.create({
      data: {
        projectId,
        ordinal,
        key: dto.key ?? `stage_${ordinal}`,
        name: dto.name?.trim() ?? `Etapa ${ordinal}`,
        workflowStatus: StageStatus.DRAFT,
        mddContent,
        status: stStatus,
        precisionScore,
        legacyChangeState:
          legacyChangeState === null ? Prisma.JsonNull : legacyChangeState,
        isLegacy,
        theforgeProjectId: project.theforgeProjectId,
      },
    });

    if (dto.activate !== false) {
      await this.activateStageExclusive(projectId, newStage.id, {
        seedExcludeDeliverableKeys: dto.seedExcludeDeliverableKeys,
      });
    }

    const withEst = await this.prisma.stage.findUnique({
      where: { id: newStage.id },
      include: { estimation: true },
    });
    if (withEst?.mddContent?.trim()) {
      await this.estimationRecalc.recalcAndUpsert(withEst.id, {
        mddContent: withEst.mddContent,
        infraContent: project.infraContent ?? null,
        status: withEst.status,
      });
    }

    const out = await this.prisma.stage.findFirst({
      where: { id: newStage.id },
      include: { estimation: true },
    });
    if (!out) throw new NotFoundException("Etapa no encontrada tras crear");

    return { stage: out };
  }

  async patchStage(projectId: string, stageId: string, body: unknown) {
    const dto = patchStageBodySchema.parse(body);
    const uid = getRequestUserId();
    await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, projectId },
      include: { estimation: true },
    });
    if (!stage) throw new NotFoundException("Etapa no encontrada");

    const ownerId = (await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } }))?.userId;
    const isOwner = ownerId === uid;
    if ((dto.activate === true || dto.ordinal !== undefined) && !isOwner) {
      throw new BadRequestException("Only the project owner can restructure stages");
    }
    if (dto.activate === true) {
      await this.activateStageExclusive(projectId, stageId);
    }

    const data: Prisma.StageUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.key !== undefined) data.key = dto.key.trim();
    if (dto.brdContent !== undefined) {
      const trimmed = dto.brdContent.trim();
      data.brdContent = trimmed ? prependDocumentTimestamps(trimmed) : null;
    }
    if (dto.ordinal !== undefined) {
      const clash = await this.prisma.stage.findFirst({
        where: {
          projectId,
          ordinal: dto.ordinal,
          NOT: { id: stageId },
        },
      });
      if (clash) throw new BadRequestException(`Ordinal ${dto.ordinal} ya está en uso`);
      data.ordinal = dto.ordinal;
    }

    const terminalStatuses: StageStatus[] = [
      StageStatus.COMPLETED,
      StageStatus.ARCHIVED,
      StageStatus.SUPERSEDED,
    ];
    if (dto.workflowStatus !== undefined) {
      data.workflowStatus = dto.workflowStatus as StageStatus;
      if (terminalStatuses.includes(dto.workflowStatus as StageStatus)) {
        await ensureStageDeliverableSnapshotIfMissing(this.prisma, stageId, projectId, {
          source: "manual",
        }).catch((err) =>
          this.logger.warn(
            `[Stage] snapshot on ${dto.workflowStatus}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      if (dto.workflowStatus === StageStatus.ACTIVE) {
        await this.activateStageExclusive(projectId, stageId);
      }
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.stage.update({ where: { id: stageId }, data });
    }

    if (dto.brdContent !== undefined) {
      await this.changeLog.log(projectId, "brdContent", dto.brdContent);
    }

    const out = await this.prisma.stage.findFirst({
      where: { id: stageId, projectId },
      include: { estimation: true },
    });
    if (!out) throw new NotFoundException("Etapa no encontrada");
    return { stage: out };
  }

  async transitionStage(projectId: string, stageId: string, body: unknown) {
    const dto = transitionStageBodySchema.parse(body);
    await loadAccessibleProjectWithStages(this.prisma, projectId);

    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, projectId },
      include: { estimation: true },
    });
    if (!stage) throw new NotFoundException("Etapa no encontrada");

    const allowed = getAllowedStageTransitions(stage.workflowStatus);
    if (!allowed.includes(dto.action)) {
      throw new BadRequestException({
        message: `Transición "${dto.action}" no permitida desde estado ${stage.workflowStatus}`,
        code: "STAGE_TRANSITION_NOT_ALLOWED",
        currentStatus: stage.workflowStatus,
        allowedTransitions: allowed,
      });
    }

    const previousStatus = stage.workflowStatus;

    if (dto.action === "activate") {
      const uid = getRequestUserId();
      const ownerId = (
        await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } })
      )?.userId;
      if (ownerId !== uid) {
        throw new BadRequestException("Only the project owner can activate stages");
      }
      await this.activateStageExclusive(projectId, stageId);
    } else if (dto.action === "complete") {
      await this.patchStage(projectId, stageId, { workflowStatus: StageStatus.COMPLETED });
    } else if (dto.action === "archive") {
      await this.patchStage(projectId, stageId, { workflowStatus: StageStatus.ARCHIVED });
    } else if (dto.action === "reopen") {
      await this.prisma.stage.update({
        where: { id: stageId },
        data: { workflowStatus: StageStatus.DRAFT },
      });
    }

    const out = await this.prisma.stage.findFirst({
      where: { id: stageId, projectId },
      include: { estimation: true },
    });
    if (!out) throw new NotFoundException("Etapa no encontrada");

    return {
      stage: out,
      transition: {
        action: dto.action,
        reason: dto.reason ?? null,
        previousStatus,
        newStatus: out.workflowStatus,
      },
    };
  }

  async listStages(projectId: string) {
    await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stages = await this.prisma.stage.findMany({
      where: { projectId },
      orderBy: { ordinal: "asc" },
      include: { estimation: true },
    });
    return { stages };
  }

  async getStageDeliverables(projectId: string, stageId: string) {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stage = project.stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("Etapa no encontrada");
    return resolveStageDeliverables(project, stage, "workshop");
  }

  async getStageDetail(projectId: string, stageId: string) {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stage = project.stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("Etapa no encontrada");

    const resolved = resolveStageDeliverables(project, stage, "workshop");
    const stageDocFields = ["mddContent", "brdContent", "changeSpecContent"] as const;
    const stageDocuments: Record<string, { exists: boolean; wordCount: number }> = {};
    for (const field of stageDocFields) {
      const text = (stage[field] ?? "") as string;
      stageDocuments[field] = {
        exists: text.trim().length > 0,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
      };
    }

    const cascadeSummary: Record<string, { exists: boolean; wordCount: number }> = {};
    for (const [key, val] of Object.entries(resolved.deliverables)) {
      const text = typeof val === "string" ? val : "";
      cascadeSummary[key] = {
        exists: text.trim().length > 0,
        wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
      };
    }

    return {
      stage: {
        id: stage.id,
        ordinal: stage.ordinal,
        key: stage.key,
        name: stage.name,
        workflowStatus: stage.workflowStatus,
        status: stage.status,
        precisionScore: stage.precisionScore,
        isLegacy: stage.isLegacy,
        estimation: stage.estimation,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      },
      deliverables: {
        source: resolved.source,
        readOnly: resolved.readOnly,
        snapshotCapturedAt: resolved.snapshotCapturedAt ?? null,
        stageDocuments,
        cascadeSummary,
      },
      allowedTransitions: getAllowedStageTransitions(stage.workflowStatus),
      activeStageId: pickPrimaryStage(project.stages as StageWithEst[])?.id ?? null,
    };
  }
}
