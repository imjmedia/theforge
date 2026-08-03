import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  buildStageChangeSpecContent,
  createHandoffItemBodySchema,
  integrationHandoffItemSchema,
  integrationLinkBodySchema,
  parseIntegrationHandoff,
  nextNewLegId,
  promoteHandoffToStageBodySchema,
  updateHandoffItemBodySchema,
  updateIntegrationTraceBodySchema,
  type IntegrationContextResponse,
  type IntegrationHandoff,
  type IntegrationHandoffItem,
  type IntegrationStatusResponse,
  type AbandonIntegrationHandoffResponse,
  type IntegrationTraceRow,
  type PromoteHandoffToStageResponse,
  type ReconcileHandoffStageResponse,
  abandonIntegrationHandoffBodySchema,
  reconcileHandoffStageBodySchema,
  createStageFromAriadneChangePackInputSchema,
  type CreateStageFromAriadneChangePackOutput,
  INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS,
  isAriadneMigrationTasksPack,
  resolveIntegrationHandoffTasksMarkdown,
} from "@theforge/shared-types";
import { StageStatus } from "@theforge/database";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { getRequestUserId } from "../../../common/request-user.store.js";
import { ChangeLogService } from "../../change-log/change-log.service.js";
import { TheForgeService } from "../../theforge/theforge.service.js";
import { LegacyCoordinatorService } from "../../legacy-flow/legacy-coordinator.service.js";
import { ProjectsService } from "../projects.service.js";
import { prependDocumentTimestamps } from "../../engine/document-date-header.util.js";
import { isLegacyHandoffAutoLegacyStartEnabled } from "./legacy-handoff-auto-start.util.js";
import { persistStageDeliverableSnapshotFromProject, ensureStageDeliverableSnapshotIfMissing } from "../stage-deliverable-snapshot.util.js";
import { persistStageAndProjectDeliverables } from "../stage-deliverable-persist.util.js";
import {
  buildExternalLegacyContextBlock,
  buildHandoffImportDescription,
  extractLegacyAsIsApiSection,
  extractLegacyAsIsContextSection,
  mergeHandoffIntoLegacyDescription,
  parseSatisfiesLinksFromUserStories,
} from "./integration-context.util.js";
import {
  pickHandoffItemsForPromotion,
  selectPromotableHandoffItemIds,
} from "./promote-handoff.util.js";
import {
  resolveHandoffDescriptionForStage,
  stageHasHandoffPayload,
} from "./reconcile-handoff.util.js";
import {
  handoffItemIdsFromStageSnapshot,
  pickActivateStageIdAfterAbandon,
  releaseHandoffItemsForAbandonedStage,
} from "./abandon-handoff.util.js";
import {
  buildLegacyChangeStateFromAriadnePack,
  buildRecommendedNextToolsAfterAriadnePack,
  defaultStageNameFromAriadnePack,
  preprocessCreateStageFromAriadneChangePackBody,
  shouldRunLegacyStartForAriadnePack,
} from "../../theforge/apply-ariadne-change-pack.util.js";

type ProjectRow = {
  id: string;
  name: string;
  projectType: "NEW" | "LEGACY";
  userId: string;
  visibility: string;
  linkedLegacyProjectId: string | null;
  linkedNewProjectId: string | null;
  theforgeProjectId: string | null;
  integrationHandoff: unknown;
  integrationHandoffUpdatedAt: Date | null;
  stages: {
    id: string;
    ordinal: number;
    name: string | null;
    workflowStatus: string;
    mddContent: string | null;
    handoffSnapshot: unknown;
    handoffImportedAt: Date | null;
    linkedNewProjectId: string | null;
    legacyChangeState: unknown;
  }[];
};

@Injectable()
export class ProjectIntegrationService {
  private readonly logger = new Logger(ProjectIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLog: ChangeLogService,
    private readonly theforge: TheForgeService,
    @Inject(forwardRef(() => LegacyCoordinatorService))
    private readonly legacyCoordinator: LegacyCoordinatorService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
  ) {}

  private async assertAccess(projectId: string): Promise<ProjectRow> {
    const userId = getRequestUserId();
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (project.userId !== userId && project.visibility !== "SHARED") {
      throw new NotFoundException("Project not found");
    }
    return project as ProjectRow;
  }

  private baselineStage(project: ProjectRow) {
    return project.stages.find((s) => s.ordinal === 1) ?? project.stages[0] ?? null;
  }

  private handoffFromProject(project: ProjectRow): IntegrationHandoff {
    return parseIntegrationHandoff(project.integrationHandoff);
  }

  async getStatus(projectId: string): Promise<IntegrationStatusResponse> {
    const project = await this.assertAccess(projectId);
    const warnings = this.buildWarnings(project);
    const handoff = this.handoffFromProject(project);
    const stage2 = project.stages.find((s) => s.ordinal >= 2);
    const linkedNewHandoff =
      project.projectType === "LEGACY" && project.linkedNewProjectId
        ? this.handoffFromProject(await this.assertAccess(project.linkedNewProjectId))
        : handoff;
    const traceHandoff = project.projectType === "LEGACY" ? linkedNewHandoff : handoff;
    const tracesForProject = await this.listTraceRows(projectId, traceHandoff);
    return {
      linkedLegacyProject: await this.summarizeLinked(project.linkedLegacyProjectId),
      linkedNewProject: await this.summarizeLinked(project.linkedNewProjectId),
      handoff,
      traces: tracesForProject,
      warnings,
      handoffImportedAt: stage2?.handoffImportedAt?.toISOString() ?? null,
      promotableItemIds:
        project.projectType === "LEGACY"
          ? selectPromotableHandoffItemIds(tracesForProject)
          : undefined,
      linkedNewHandoff: project.projectType === "LEGACY" ? linkedNewHandoff : undefined,
    };
  }

  private buildWarnings(project: ProjectRow): string[] {
    const warnings: string[] = [];
    const handoff = this.handoffFromProject(project);
    if (project.projectType === "NEW" && !project.linkedLegacyProjectId) {
      warnings.push("Vincula un proyecto LEGACY para declarar dependencia AS-IS.");
    }
    if (project.projectType === "NEW" && handoff.items.length === 0) {
      warnings.push("Añade ítems handoff NEW-LEG antes de enviar al equipo legacy.");
    }
    const sent = handoff.items.filter((i) => i.status === "sent" || i.status === "accepted");
    if (project.projectType === "LEGACY" && project.linkedNewProjectId && sent.length > 0) {
      const stage2plus = project.stages.filter((s) => s.ordinal >= 2);
      const imported = stage2plus.some((s) => s.handoffImportedAt);
      if (!imported) {
        warnings.push("Importa el handoff en etapa 2+ antes de generate-mdd de cambio.");
      }
    }
    return warnings;
  }

  private async summarizeLinked(id: string | null | undefined) {
    if (!id?.trim()) return null;
    const p = await this.prisma.project.findFirst({
      where: { id: id.trim() },
      include: { stages: { where: { ordinal: 1 }, take: 1 } },
    });
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      projectType: p.projectType as "NEW" | "LEGACY",
      hasBaselineMdd: !!(p.stages[0]?.mddContent ?? "").trim(),
    };
  }

  async listPickerProjects(targetType: "NEW" | "LEGACY", q?: string) {
    const userId = getRequestUserId();
    const where = {
      archivedAt: null,
      projectType: targetType as "NEW" | "LEGACY",
      OR: [{ userId }, { visibility: "SHARED" as const }],
      ...(q?.trim()
        ? { name: { contains: q.trim(), mode: "insensitive" as const } }
        : {}),
    };
    const rows = await this.prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { stages: { where: { ordinal: 1 }, take: 1, select: { mddContent: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      projectType: p.projectType,
      hasBaselineMdd: !!(p.stages[0]?.mddContent ?? "").trim(),
    }));
  }

  async patchLink(projectId: string, body: unknown) {
    const dto = integrationLinkBodySchema.parse(body);
    const project = await this.assertAccess(projectId);

    if (dto.linkedLegacyProjectId !== undefined) {
      if (project.projectType !== "NEW") {
        throw new BadRequestException("linkedLegacyProjectId solo aplica a proyectos NEW");
      }
      const legacyId = dto.linkedLegacyProjectId;
      if (legacyId) {
        const legacy = await this.assertAccess(legacyId);
        if (legacy.projectType !== "LEGACY") {
          throw new BadRequestException("El proyecto enlazado debe ser LEGACY");
        }
        await this.prisma.project.update({
          where: { id: projectId },
          data: { linkedLegacyProjectId: legacyId },
        });
        await this.prisma.project.update({
          where: { id: legacyId },
          data: { linkedNewProjectId: projectId },
        });
      } else {
        const prev = project.linkedLegacyProjectId;
        await this.prisma.project.update({
          where: { id: projectId },
          data: { linkedLegacyProjectId: null },
        });
        if (prev) {
          await this.prisma.project.updateMany({
            where: { id: prev, linkedNewProjectId: projectId },
            data: { linkedNewProjectId: null },
          });
        }
      }
    }

    if (dto.linkedNewProjectId !== undefined) {
      if (project.projectType !== "LEGACY") {
        throw new BadRequestException("linkedNewProjectId solo aplica a proyectos LEGACY");
      }
      const newId = dto.linkedNewProjectId;
      if (newId) {
        const np = await this.assertAccess(newId);
        if (np.projectType !== "NEW") {
          throw new BadRequestException("El proyecto enlazado debe ser NEW");
        }
        await this.prisma.project.update({
          where: { id: projectId },
          data: { linkedNewProjectId: newId },
        });
        await this.prisma.project.update({
          where: { id: newId },
          data: { linkedLegacyProjectId: projectId },
        });
      } else {
        const prev = project.linkedNewProjectId;
        await this.prisma.project.update({
          where: { id: projectId },
          data: { linkedNewProjectId: null },
        });
        if (prev) {
          await this.prisma.project.updateMany({
            where: { id: prev, linkedLegacyProjectId: projectId },
            data: { linkedLegacyProjectId: null },
          });
        }
      }
    }

    return this.getStatus(projectId);
  }

  async getLegacyContextForNew(projectId: string): Promise<IntegrationContextResponse | null> {
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "NEW" || !project.linkedLegacyProjectId) return null;
    const legacy = await this.assertAccess(project.linkedLegacyProjectId);
    const baseline = this.baselineStage(legacy);
    const mdd = baseline?.mddContent?.trim() ?? "";
    if (!mdd) {
      throw new BadRequestException("El legacy enlazado no tiene MDD AS-IS (etapa 1)");
    }
    return {
      legacyProjectId: legacy.id,
      legacyProjectName: legacy.name,
      contextSectionMarkdown: extractLegacyAsIsContextSection(mdd),
      apiSectionMarkdown: extractLegacyAsIsApiSection(mdd),
      baselineStageOrdinal: baseline?.ordinal ?? 1,
    };
  }

  async createHandoffItem(projectId: string, body: unknown) {
    const dto = createHandoffItemBodySchema.parse(body);
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "NEW") {
      throw new BadRequestException("Handoff solo en proyectos NEW");
    }
    const handoff = this.handoffFromProject(project);
    const item: IntegrationHandoffItem = integrationHandoffItemSchema.parse({
      id: nextNewLegId(handoff.items),
      ...dto,
      status: "draft",
    });
    handoff.items.push(item);
    await this.persistHandoff(projectId, handoff);
    return this.getStatus(projectId);
  }

  async updateHandoffItem(projectId: string, itemId: string, body: unknown) {
    const dto = updateHandoffItemBodySchema.parse(body);
    const project = await this.assertAccess(projectId);
    const handoff = this.handoffFromProject(project);
    const idx = handoff.items.findIndex((i) => i.id === itemId);
    if (idx < 0) throw new NotFoundException("Handoff item not found");
    handoff.items[idx] = integrationHandoffItemSchema.parse({ ...handoff.items[idx], ...dto });
    await this.persistHandoff(projectId, handoff);
    if (dto.legacyStoryId && project.linkedLegacyProjectId) {
      await this.prisma.integrationTrace.updateMany({
        where: { newProjectId: projectId, newLegId: itemId },
        data: { legacyStoryId: dto.legacyStoryId },
      });
    }
    return this.getStatus(projectId);
  }

  async deleteHandoffItem(projectId: string, itemId: string) {
    const project = await this.assertAccess(projectId);
    const handoff = this.handoffFromProject(project);
    handoff.items = handoff.items.filter((i) => i.id !== itemId);
    await this.persistHandoff(projectId, handoff);
    await this.prisma.integrationTrace.deleteMany({
      where: { newProjectId: projectId, newLegId: itemId },
    });
    return this.getStatus(projectId);
  }

  async sendHandoff(projectId: string) {
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "NEW") {
      throw new BadRequestException("sendHandoff solo en proyectos NEW");
    }
    if (!project.linkedLegacyProjectId) {
      throw new BadRequestException("Vincula un proyecto LEGACY antes de enviar handoff");
    }
    const handoff = this.handoffFromProject(project);
    if (!handoff.items.length) {
      throw new BadRequestException("No hay ítems handoff para enviar");
    }
    handoff.items = handoff.items.map((i) =>
      i.status === "draft" ? { ...i, status: "sent" as const } : i,
    );
    await this.persistHandoff(projectId, handoff);
    await this.syncTracesFromHandoff(projectId, project.linkedLegacyProjectId, handoff);
    await this.changeLog.log(project.linkedLegacyProjectId, "integrationHandoff", JSON.stringify(handoff));
    await this.changeLog.log(projectId, "integrationHandoff", "Handoff enviado al legacy");
    return this.getStatus(projectId);
  }

  async importHandoffToStage(projectId: string, stageId: string) {
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "LEGACY") {
      throw new BadRequestException("importHandoff solo en proyectos LEGACY");
    }
    const stage = project.stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("Stage not found");
    if (stage.ordinal < 2) {
      throw new BadRequestException("Importa handoff en etapa 2 o superior");
    }
    const newProjectId = stage.linkedNewProjectId ?? project.linkedNewProjectId;
    if (!newProjectId) {
      throw new BadRequestException("Vincula un proyecto NEW antes de importar handoff");
    }
    const newProject = await this.assertAccess(newProjectId);
    const handoff = this.handoffFromProject(newProject);
    const activeItems = handoff.items.filter(
      (i) => i.status === "sent" || i.status === "accepted" || i.status === "implemented",
    );
    if (!activeItems.length) {
      throw new BadRequestException("El proyecto NEW no tiene handoff enviado");
    }

    const snapshot = {
      items: activeItems,
      importedAt: new Date().toISOString(),
      fromProjectId: newProjectId,
    };
    const handoffDesc = buildHandoffImportDescription(activeItems, newProject.name);

    await this.applyHandoffPayloadToStage(stageId, newProjectId, snapshot, handoffDesc);
    await this.syncTracesFromHandoff(newProjectId, projectId, { items: activeItems }, stageId);
    await this.persistHandoffItemsLegacyStage(newProjectId, activeItems.map((i) => i.id), stageId);
    await this.finalizeHandoffStageSetup(projectId, stageId, newProjectId, activeItems);
    await this.changeLog.log(projectId, "handoffSnapshot", handoffDesc);
    await this.tryAutoLegacyStartAfterHandoff(projectId, stageId, handoffDesc);
    return this.getStatus(projectId);
  }

  /**
   * Crea etapa (o importa en existente) desde un change pack Ariadne.
   * MCP: `create_stage_from_ariadne_change_pack`.
   */
  async createStageFromAriadneChangePack(body: unknown): Promise<CreateStageFromAriadneChangePackOutput> {
    const { bodyForParse, handoffIdRemaps } = preprocessCreateStageFromAriadneChangePackBody(body);
    if (handoffIdRemaps.length > 0) {
      this.logger.log(
        `[Integration] Ariadne handoff id remap (${handoffIdRemaps.length}): ${handoffIdRemaps
          .map((r) => `${r.from}→${r.to}`)
          .join(", ")}`,
      );
    }
    const dto = createStageFromAriadneChangePackInputSchema.parse(bodyForParse);
    const project = await this.assertAccess(dto.forgeProjectId);
    if (project.projectType !== "LEGACY") {
      throw new BadRequestException("create_stage_from_ariadne_change_pack solo en proyectos LEGACY");
    }

    const pack = dto.pack;
    let stageRow = dto.stageId?.trim()
      ? project.stages.find((s) => s.id === dto.stageId!.trim())
      : undefined;
    let importMode: "created" | "existing" = "created";

    if (dto.stageId?.trim()) {
      if (!stageRow) throw new NotFoundException("Stage not found");
      if (stageRow.ordinal < 2) {
        throw new BadRequestException("Importa el pack en etapa 2 o superior (o omite stageId para crear una nueva)");
      }
      importMode = "existing";
    } else {
      const stageName = dto.stageName?.trim() || defaultStageNameFromAriadnePack(pack);
      const migrationTasks = isAriadneMigrationTasksPack(pack);
      const { stage } = await this.projectsService.createStage(project.id, {
        name: stageName,
        activate: dto.activate,
        seedExcludeDeliverableKeys: migrationTasks
          ? [...INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS]
          : undefined,
      });
      stageRow = {
        id: stage.id,
        ordinal: stage.ordinal,
        name: stage.name,
        workflowStatus: stage.workflowStatus,
        mddContent: stage.mddContent ?? null,
        handoffSnapshot: null,
        handoffImportedAt: null,
        linkedNewProjectId: null,
        legacyChangeState: null,
      };
      importMode = "created";
    }

    const stageId = stageRow.id;
    const legacyState = buildLegacyChangeStateFromAriadnePack(pack, project.theforgeProjectId);
    const existingState = stageRow.legacyChangeState as Record<string, unknown> | null;
    const nextLegacyState = {
      ...(existingState && typeof existingState === "object" ? existingState : {}),
      ...legacyState,
    };

    const handoffItems = pack.handoffItems ?? [];
    const linkedNewProjectId = pack.linkedNewProjectId?.trim() || project.linkedNewProjectId;
    let handoffDesc = pack.changeDescription.trim();
    const migrationTasksMode = isAriadneMigrationTasksPack(pack);

    if (handoffItems.length) {
      const snapshot = {
        items: handoffItems,
        importedAt: new Date().toISOString(),
        fromProjectId: linkedNewProjectId ?? "ariadne-change-pack",
        source: "ariadne_change_pack_v1",
      };
      if (linkedNewProjectId) {
        try {
          const newProject = await this.assertAccess(linkedNewProjectId);
          handoffDesc = buildHandoffImportDescription(handoffItems, newProject.name);
        } catch {
          handoffDesc = buildHandoffImportDescription(handoffItems, "Proyecto NEW");
        }
      } else {
        handoffDesc = buildHandoffImportDescription(handoffItems, "Ariadne");
      }
      await this.prisma.stage.update({
        where: { id: stageId },
        data: {
          handoffSnapshot: snapshot,
          handoffImportedAt: new Date(),
          linkedNewProjectId: linkedNewProjectId ?? null,
          legacyChangeState: {
            ...nextLegacyState,
            description: mergeHandoffIntoLegacyDescription(
              typeof nextLegacyState.description === "string" ? nextLegacyState.description : undefined,
              handoffDesc,
            ),
          },
        },
      });
      if (linkedNewProjectId) {
        await this.syncTracesFromHandoff(
          linkedNewProjectId,
          project.id,
          { items: handoffItems },
          stageId,
        );
        await this.persistHandoffItemsLegacyStage(
          linkedNewProjectId,
          handoffItems.map((i) => i.id),
          stageId,
        );
      }
      await this.finalizeHandoffStageSetup(project.id, stageId, linkedNewProjectId ?? project.id, handoffItems, {
        cursorTasksMarkdown: pack.cursorTasksMarkdown,
        migrationTasksMode,
      });
    } else {
      await this.prisma.stage.update({
        where: { id: stageId },
        data: { legacyChangeState: nextLegacyState as object },
      });
      if (migrationTasksMode && pack.cursorTasksMarkdown?.trim()) {
        await this.applyIntegrationHandoffTasks(project.id, stageId, {
          cursorTasksMarkdown: pack.cursorTasksMarkdown,
          handoffItems: [],
          stageName: stageRow.name ?? undefined,
        });
      }
    }

    await this.changeLog.log(
      project.id,
      "ariadneChangePack",
      `${importMode === "created" ? "Etapa creada" : "Pack importado"} (${pack.ariadneChangeId ?? "v1"}): ${pack.changeDescription.slice(0, 200)}`,
    );

    const ariadneWire = { scheduled: false as boolean, skippedReason: undefined as string | undefined };
    if (dto.wireAriadne !== false && project.theforgeProjectId?.trim()) {
      ariadneWire.scheduled = true;
      this.theforge.scheduleAriadneBrownfieldWire(
        {
          ariadneSourceId: pack.ariadneRepositoryId?.trim() || project.theforgeProjectId.trim(),
          workshopProjectId: project.id,
          workshopStageId: stageId,
        },
        "AriadneChangePack",
      );
    } else if (dto.wireAriadne !== false && !project.theforgeProjectId?.trim()) {
      ariadneWire.skippedReason = "project_without_theforgeProjectId";
    }

    const runLegacyStart = shouldRunLegacyStartForAriadnePack(
      pack,
      dto.runLegacyStart,
      isLegacyHandoffAutoLegacyStartEnabled(),
    );

    const legacyStart: CreateStageFromAriadneChangePackOutput["legacyStart"] = {
      attempted: false,
      ok: false,
      filesCount: (pack.filesToModify?.length ?? 0) as number,
      questionsCount: (pack.questionsToRefine?.length ?? 0) as number,
    };

    if (runLegacyStart) {
      legacyStart.attempted = true;
      try {
        const started = await this.legacyCoordinator.start(project.id, handoffDesc, stageId);
        legacyStart.ok = true;
        legacyStart.filesCount = started.filesToModify.length;
        legacyStart.questionsCount = started.questions.length;
      } catch (err) {
        legacyStart.error = err instanceof Error ? err.message : String(err);
      }
    } else if ((pack.filesToModify?.length ?? 0) > 0) {
      legacyStart.skippedReason = "pack_includes_modification_plan";
    } else {
      legacyStart.skippedReason = "runLegacyStart_disabled";
    }

    const updated = await this.prisma.stage.findUniqueOrThrow({ where: { id: stageId } });
    const questionsCount =
      legacyStart.questionsCount ||
      (Array.isArray(nextLegacyState.questions) ? nextLegacyState.questions.length : 0);

    return {
      forgeProjectId: project.id,
      stageId,
      stageOrdinal: updated.ordinal,
      stageName: updated.name ?? `Etapa ${updated.ordinal}`,
      workflowStatus: updated.workflowStatus,
      importMode,
      legacyStart,
      ariadneWire,
      recommendedNextTools: buildRecommendedNextToolsAfterAriadnePack({
        questionsCount,
        hasHandoffItems: handoffItems.length > 0,
        migrationTasksMode,
      }),
    };
  }

  /**
   * Retroactive Ariadne wire + legacy/start for stages promoted/imported before auto-handoff
   * or when wire/analyze failed silently.
   */
  async reconcileHandoffStage(
    projectId: string,
    stageId: string,
    body: unknown,
  ): Promise<ReconcileHandoffStageResponse> {
    const dto = reconcileHandoffStageBodySchema.parse(body ?? {});
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "LEGACY") {
      throw new BadRequestException("reconcile-handoff solo en proyectos LEGACY");
    }
    const stage = project.stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("Stage not found");
    if (stage.ordinal < 2) {
      throw new BadRequestException("Reconcilia handoff en etapa 2 o superior");
    }
    if (!stageHasHandoffPayload(stage)) {
      throw new BadRequestException(
        "La etapa no tiene handoff importado — usa import-handoff o promote-to-stage primero",
      );
    }

    const newProjectId = stage.linkedNewProjectId ?? project.linkedNewProjectId;
    if (!newProjectId) {
      throw new BadRequestException("Vincula un proyecto NEW antes de reconciliar handoff");
    }
    const newProject = await this.assertAccess(newProjectId);
    const description = resolveHandoffDescriptionForStage(stage, newProject.name);
    if (!description.trim()) {
      throw new BadRequestException("No hay descripción de cambio en la etapa para legacy/start");
    }

    const ariadneWire = {
      attempted: false,
      wired: false,
      repositoryIds: [] as string[],
      patched: [] as string[],
      skippedReason: undefined as string | undefined,
      errors: [] as string[],
    };
    const legacyStart = {
      attempted: false,
      ok: false,
      filesCount: 0,
      questionsCount: 0,
      error: undefined as string | undefined,
    };

    if (dto.wireAriadne && project.theforgeProjectId?.trim()) {
      ariadneWire.attempted = true;
      try {
        const wireResult = await this.theforge.wireAriadneBrownfieldConverge({
          ariadneSourceId: project.theforgeProjectId.trim(),
          workshopProjectId: projectId,
          workshopStageId: stageId,
        });
        ariadneWire.wired = wireResult.wired;
        ariadneWire.repositoryIds = wireResult.repositoryIds;
        ariadneWire.patched = wireResult.patched;
        ariadneWire.skippedReason = wireResult.skippedReason;
        ariadneWire.errors = wireResult.errors;
      } catch (err) {
        ariadneWire.errors.push(err instanceof Error ? err.message : String(err));
      }
    } else if (dto.wireAriadne && !project.theforgeProjectId?.trim()) {
      ariadneWire.attempted = true;
      ariadneWire.skippedReason = "no_theforge_project_id";
    }

    if (dto.legacyStart) {
      legacyStart.attempted = true;
      try {
        const result = await this.legacyCoordinator.start(projectId, description, stageId);
        legacyStart.ok = true;
        legacyStart.filesCount = result.filesToModify.length;
        legacyStart.questionsCount = result.questions.length;
      } catch (err) {
        legacyStart.error = err instanceof Error ? err.message : String(err);
      }
    }

    await this.changeLog.log(
      projectId,
      "integrationHandoff",
      `Reconcile handoff etapa ${stage.ordinal}: wire=${ariadneWire.wired} legacyStart=${legacyStart.ok}`,
    );

    return { stageId, description, ariadneWire, legacyStart };
  }

  /**
   * Abandon an integration handoff stage: ARCHIVED (visible + snapshot), release NEW-LEG items
   * for re-promotion, clear trace stage links. Does not delete the stage or etapa 1 baseline.
   */
  async abandonIntegrationHandoffStage(
    projectId: string,
    stageId: string,
    body: unknown,
  ): Promise<AbandonIntegrationHandoffResponse> {
    const dto = abandonIntegrationHandoffBodySchema.parse(body ?? {});
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "LEGACY") {
      throw new BadRequestException("abandon-handoff solo en proyectos LEGACY");
    }
    const stageRow = await this.prisma.stage.findFirst({
      where: { id: stageId, projectId },
    });
    if (!stageRow) throw new NotFoundException("Stage not found");
    if (stageRow.ordinal < 2) {
      throw new BadRequestException("Solo puedes abandonar handoff en etapa 2 o superior");
    }
    if (stageRow.workflowStatus === StageStatus.ARCHIVED) {
      throw new BadRequestException("Esta etapa ya está archivada");
    }
    if (!stageHasHandoffPayload(stageRow)) {
      throw new BadRequestException("La etapa no tiene handoff importado para abandonar");
    }

    const newProjectId = stageRow.linkedNewProjectId ?? project.linkedNewProjectId;
    if (!newProjectId) {
      throw new BadRequestException("Vincula un proyecto NEW antes de abandonar handoff");
    }

    const snapshotItemIds = handoffItemIdsFromStageSnapshot(stageRow.handoffSnapshot);
    const wasActive = stageRow.workflowStatus === StageStatus.ACTIVE;
    const abandonedAt = new Date().toISOString();
    const reason = dto.reason?.trim() || undefined;

    await ensureStageDeliverableSnapshotIfMissing(this.prisma, stageId, projectId, {
      source: "manual",
    }).catch(() => {});

    const prevLegacyState = stageRow.legacyChangeState as Record<string, unknown> | null;
    const prevSnapshot = stageRow.handoffSnapshot as Record<string, unknown> | null;
    const nextLegacyState = {
      ...(prevLegacyState && typeof prevLegacyState === "object" ? prevLegacyState : {}),
      abandonedAt,
      ...(reason ? { abandonReason: reason } : {}),
    };
    const nextHandoffSnapshot = {
      ...(prevSnapshot && typeof prevSnapshot === "object" ? prevSnapshot : {}),
      abandonedAt,
      ...(reason ? { abandonReason: reason } : {}),
    };

    await this.prisma.stage.update({
      where: { id: stageId },
      data: {
        workflowStatus: StageStatus.ARCHIVED,
        legacyChangeState: nextLegacyState,
        handoffSnapshot: nextHandoffSnapshot,
      },
    });

    const newProject = await this.assertAccess(newProjectId);
    const handoff = this.handoffFromProject(newProject);
    const { items: releasedHandoffItems, releasedIds } = releaseHandoffItemsForAbandonedStage(
      handoff.items,
      stageId,
      snapshotItemIds,
      dto.rejectReleasedItems,
    );
    if (releasedIds.length) {
      handoff.items = releasedHandoffItems;
      await this.persistHandoff(newProjectId, handoff);
    }

    const traceUpdate = await this.prisma.integrationTrace.updateMany({
      where: { legacyStageId: stageId },
      data: { legacyStageId: null },
    });

    let activatedStageId: string | null = null;
    if (wasActive) {
      const allStages = await this.prisma.stage.findMany({
        where: { projectId },
        select: { id: true, ordinal: true, workflowStatus: true },
        orderBy: { ordinal: "asc" },
      });
      const nextActiveId = pickActivateStageIdAfterAbandon(
        allStages,
        stageId,
        dto.activateStageId,
      );
      if (nextActiveId) {
        await this.projectsService.patchStage(projectId, nextActiveId, { activate: true });
        activatedStageId = nextActiveId;
      }
    }

    await this.changeLog.log(
      projectId,
      "integrationHandoff",
      `Handoff abandonado etapa ${stageRow.ordinal}: released=${releasedIds.join(",") || "none"} activated=${activatedStageId ?? "none"}`,
    );
    if (releasedIds.length) {
      await this.changeLog.log(newProjectId, "integrationHandoff", `Ítems liberados de etapa archivada: ${releasedIds.join(", ")}`);
    }

    const updated = await this.prisma.stage.findUniqueOrThrow({ where: { id: stageId } });
    return {
      stage: {
        id: updated.id,
        ordinal: updated.ordinal,
        name: updated.name,
        workflowStatus: updated.workflowStatus,
        handoffImportedAt: updated.handoffImportedAt?.toISOString() ?? null,
      },
      releasedItemIds: releasedIds,
      activatedStageId,
      tracesUpdated: traceUpdate.count,
    };
  }

  async promoteHandoffToStage(
    projectId: string,
    body: unknown,
  ): Promise<PromoteHandoffToStageResponse> {
    const dto = promoteHandoffToStageBodySchema.parse(body ?? {});
    const project = await this.assertAccess(projectId);
    if (project.projectType !== "LEGACY") {
      throw new BadRequestException("promote-to-stage solo en proyectos LEGACY");
    }
    const newProjectId = project.linkedNewProjectId;
    if (!newProjectId) {
      throw new BadRequestException("Vincula un proyecto NEW antes de promover handoff a etapa");
    }

    const newProject = await this.assertAccess(newProjectId);
    const handoff = this.handoffFromProject(newProject);
    const traces = await this.listTraceRows(projectId, handoff);
    const itemIds = selectPromotableHandoffItemIds(traces, dto.itemIds);
    if (!itemIds.length) {
      throw new BadRequestException("No hay ítems handoff SENT disponibles para promover");
    }

    const activeItems = pickHandoffItemsForPromotion(handoff.items, itemIds);
    if (!activeItems.length) {
      throw new BadRequestException("Los ítems seleccionados no están en estado sent/accepted en el NEW");
    }

    const stageName = dto.stageName?.trim() || `Integración — ${newProject.name}`;
    const snapshot = {
      items: activeItems,
      importedAt: new Date().toISOString(),
      fromProjectId: newProjectId,
      promotedFromSendAt: new Date().toISOString(),
    };
    const handoffDesc = buildHandoffImportDescription(activeItems, newProject.name);

    const { stage } = await this.projectsService.createStage(projectId, {
      name: stageName,
      activate: dto.activate,
      seedExcludeDeliverableKeys: [...INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS],
    });

    await this.applyHandoffPayloadToStage(stage.id, newProjectId, snapshot, handoffDesc);
    await this.syncTracesFromHandoff(newProjectId, projectId, { items: activeItems }, stage.id);
    await this.persistHandoffItemsLegacyStage(newProjectId, activeItems.map((i) => i.id), stage.id);
    await this.finalizeHandoffStageSetup(projectId, stage.id, newProjectId, activeItems);
    await this.changeLog.log(projectId, "handoffSnapshot", `Promovido a etapa ${stage.ordinal}: ${handoffDesc}`);

    if (project.theforgeProjectId?.trim()) {
      this.theforge.scheduleAriadneBrownfieldWire(
        {
          ariadneSourceId: project.theforgeProjectId.trim(),
          workshopProjectId: projectId,
          workshopStageId: stage.id,
        },
        "Integration",
      );
    }

    await this.tryAutoLegacyStartAfterHandoff(projectId, stage.id, handoffDesc);

    const updatedStage = await this.prisma.stage.findUniqueOrThrow({ where: { id: stage.id } });
    const updatedTraces = await this.listTraceRows(projectId, handoff);

    return {
      stage: {
        id: updatedStage.id,
        ordinal: updatedStage.ordinal,
        name: updatedStage.name,
        workflowStatus: updatedStage.workflowStatus,
        handoffImportedAt: updatedStage.handoffImportedAt?.toISOString() ?? null,
        linkedNewProjectId: updatedStage.linkedNewProjectId,
      },
      traces: updatedTraces,
      promotedItemIds: activeItems.map((i) => i.id),
    };
  }

  /** Snapshot deliverables and persist change spec after handoff import/promote. */
  private async finalizeHandoffStageSetup(
    legacyProjectId: string,
    stageId: string,
    _newProjectId: string,
    activeItems: IntegrationHandoffItem[],
    options?: {
      cursorTasksMarkdown?: string | null;
      migrationTasksMode?: boolean;
    },
  ): Promise<void> {
    const [stage, _projectRow] = await Promise.all([
      this.prisma.stage.findUnique({ where: { id: stageId } }),
      this.prisma.project.findUnique({ where: { id: legacyProjectId } }),
    ]);
    if (!stage) return;

    if (options?.migrationTasksMode !== false) {
      await this.clearIntegrationGhostDeliverables(legacyProjectId, stageId);
      await this.applyIntegrationHandoffTasks(legacyProjectId, stageId, {
        cursorTasksMarkdown: options?.cursorTasksMarkdown,
        handoffItems: activeItems,
        stageName: stage.name ?? undefined,
      });
    }

    const refreshedStage = await this.prisma.stage.findUnique({ where: { id: stageId } });
    const refreshedProject = await this.prisma.project.findUnique({ where: { id: legacyProjectId } });
    if (!refreshedStage || !refreshedProject) return;

    await persistStageDeliverableSnapshotFromProject(this.prisma, stageId, refreshedProject, {
      source: "manual",
    }).catch(() => {});

    let priorMdd: string | null = null;
    if (refreshedStage.ordinal > 1) {
      const prior = await this.prisma.stage.findFirst({
        where: { projectId: legacyProjectId, ordinal: refreshedStage.ordinal - 1 },
        select: { mddContent: true },
      });
      priorMdd = prior?.mddContent ?? null;
    }

    const legacyState = refreshedStage.legacyChangeState as { description?: string } | null;
    const changeSpec = buildStageChangeSpecContent({
      stageOrdinal: refreshedStage.ordinal,
      stageName: refreshedStage.name,
      priorMddExcerpt: priorMdd,
      legacyChangeDescription:
        legacyState?.description ??
        activeItems.map((i) => `${i.id}: ${i.title}`).join("; "),
      handoffItems: activeItems,
    });
    if (changeSpec) {
      await this.prisma.stage.update({
        where: { id: stageId },
        data: { changeSpecContent: prependDocumentTimestamps(changeSpec) },
      });
    }
  }

  /** Removes baseline tasks/US copied before handoff-aware seeding existed. */
  private async clearIntegrationGhostDeliverables(
    projectId: string,
    stageId: string,
  ): Promise<void> {
    await persistStageAndProjectDeliverables(this.prisma, stageId, projectId, {
      tasksContent: null,
      userStoriesContent: null,
    });
  }

  private async applyIntegrationHandoffTasks(
    projectId: string,
    stageId: string,
    input: {
      cursorTasksMarkdown?: string | null;
      handoffItems: IntegrationHandoffItem[];
      stageName?: string;
    },
  ): Promise<{ applied: boolean; source?: string }> {
    const resolved = resolveIntegrationHandoffTasksMarkdown({
      cursorTasksMarkdown: input.cursorTasksMarkdown,
      handoffItems: input.handoffItems,
      title: input.stageName,
    });
    if (!resolved) return { applied: false };

    await persistStageAndProjectDeliverables(this.prisma, stageId, projectId, {
      tasksContent: resolved.markdown,
    });

    const stageRow = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { legacyChangeState: true },
    });
    const existing =
      stageRow?.legacyChangeState != null && typeof stageRow.legacyChangeState === "object"
        ? (stageRow.legacyChangeState as Record<string, unknown>)
        : {};

    await this.prisma.stage.update({
      where: { id: stageId },
      data: {
        legacyChangeState: {
          ...existing,
          integrationHandoffTasks: {
            source: resolved.source,
            importedAt: new Date().toISOString(),
          },
        },
      },
    });

    this.logger.log(
      `[Integration] handoff tasks imported (stage=${stageId.slice(0, 8)} source=${resolved.source})`,
    );
    return { applied: true, source: resolved.source };
  }

  private async applyHandoffPayloadToStage(
    stageId: string,
    newProjectId: string,
    snapshot: {
      items: IntegrationHandoffItem[];
      importedAt: string;
      fromProjectId: string;
      promotedFromSendAt?: string;
    },
    handoffDesc: string,
  ) {
    const existingState =
      (await this.prisma.stage.findUnique({ where: { id: stageId }, select: { legacyChangeState: true } }))
        ?.legacyChangeState as { description?: string } | null;
    const mergedDescription = mergeHandoffIntoLegacyDescription(existingState?.description, handoffDesc);

    await this.prisma.stage.update({
      where: { id: stageId },
      data: {
        handoffSnapshot: snapshot,
        handoffImportedAt: new Date(),
        linkedNewProjectId: newProjectId,
        legacyChangeState: {
          ...(existingState && typeof existingState === "object" ? existingState : {}),
          description: mergedDescription,
        },
      },
    });
  }

  private async persistHandoffItemsLegacyStage(
    newProjectId: string,
    itemIds: string[],
    legacyStageId: string,
  ) {
    if (!itemIds.length) return;
    const project = await this.assertAccess(newProjectId);
    const handoff = this.handoffFromProject(project);
    const idSet = new Set(itemIds);
    handoff.items = handoff.items.map((item) =>
      idSet.has(item.id) ? { ...item, legacyStageId } : item,
    );
    await this.persistHandoff(newProjectId, handoff);
  }

  async updateTrace(projectId: string, traceId: string, body: unknown) {
    await this.assertAccess(projectId);
    const dto = updateIntegrationTraceBodySchema.parse(body);
    const trace = await this.prisma.integrationTrace.findFirst({
      where: {
        id: traceId,
        OR: [{ newProjectId: projectId }, { legacyProjectId: projectId }],
      },
    });
    if (!trace) throw new NotFoundException("Trace not found");
    await this.prisma.integrationTrace.update({
      where: { id: traceId },
      data: {
        legacyStoryId: dto.legacyStoryId === null ? null : dto.legacyStoryId ?? undefined,
        screenOrEndpoint: dto.screenOrEndpoint === null ? null : dto.screenOrEndpoint ?? undefined,
        status: dto.status ?? undefined,
        legacyStageId: dto.legacyStageId === null ? null : dto.legacyStageId ?? undefined,
      },
    });
    return this.getStatus(projectId);
  }

  /** Resuelve bloques de prompt para generación MDD/HU. */
  async resolvePromptContext(projectId: string, stageId?: string | null) {
    const project = await this.assertAccess(projectId);
    const externalLegacy =
      project.projectType === "NEW" && project.linkedLegacyProjectId
        ? await this.getLegacyContextForNew(projectId)
        : null;
    const externalBlock = externalLegacy
      ? buildExternalLegacyContextBlock({
          legacyProjectId: externalLegacy.legacyProjectId,
          legacyProjectName: externalLegacy.legacyProjectName,
          apiSectionMarkdown: externalLegacy.apiSectionMarkdown,
          contextSectionMarkdown: externalLegacy.contextSectionMarkdown,
        })
      : undefined;

    let handoffItems: IntegrationHandoffItem[] = [];
    let newProjectMeta: { id: string; name: string } | undefined;
    if (project.projectType === "LEGACY") {
      // Preferred (closed scope): the promoted stage's handoff snapshot (stage 2+).
      const stage = stageId ? project.stages.find((s) => s.id === stageId) : undefined;
      if (stage && stage.ordinal >= 2) {
        const snap = stage.handoffSnapshot as { items?: IntegrationHandoffItem[] } | null;
        if (snap?.items?.length) {
          handoffItems = snap.items;
          const npId = stage.linkedNewProjectId ?? project.linkedNewProjectId;
          if (npId) {
            const np = await this.prisma.project.findUnique({ where: { id: npId }, select: { id: true, name: true } });
            if (np) newProjectMeta = np;
          }
        }
      }
      // Fallback (pre-promotion): read SENT/ACCEPTED items from the linked NEW project so both
      // teams can produce the handoff-spec for mutual agreement before a stage is promoted.
      if (handoffItems.length === 0 && project.linkedNewProjectId) {
        const np = await this.assertAccess(project.linkedNewProjectId);
        handoffItems = this.handoffFromProject(np).items.filter(
          (i) => i.status === "sent" || i.status === "accepted",
        );
        newProjectMeta = { id: np.id, name: np.name };
      }
    }
    if (project.projectType === "NEW") {
      handoffItems = this.handoffFromProject(project).items;
    }

    return { externalBlock, handoffItems, newProjectMeta, handoffForNew: project.projectType === "NEW" ? handoffItems : [] };
  }

  assertHandoffGateForLegacyMdd(project: ProjectRow, stage: { ordinal: number; handoffImportedAt: Date | null }) {
    if (stage.ordinal < 2) return;
    if (process.env.LEGACY_INTEGRATION_HANDOFF_GATE !== "1") return;
    if (!project.linkedNewProjectId) return;
    if (stage.handoffImportedAt) return;
    throw new BadRequestException(
      "Importa el handoff del proyecto NEW en esta etapa antes de generate-mdd (LEGACY_INTEGRATION_HANDOFF_GATE=1).",
    );
  }

  async syncTracesFromUserStories(
    legacyProjectId: string,
    stageId: string,
    userStoriesMarkdown: string,
  ) {
    const project = await this.assertAccess(legacyProjectId);
    const newProjectId = project.linkedNewProjectId;
    if (!newProjectId) return;
    const links = parseSatisfiesLinksFromUserStories(userStoriesMarkdown);
    for (const [newLegId, legId] of links.entries()) {
      await this.prisma.integrationTrace.upsert({
        where: {
          newProjectId_legacyProjectId_newLegId: {
            newProjectId,
            legacyProjectId,
            newLegId,
          },
        },
        create: {
          newProjectId,
          legacyProjectId,
          newLegId,
          legacyStoryId: legId,
          legacyStageId: stageId,
          status: "ACCEPTED",
        },
        update: { legacyStoryId: legId, legacyStageId: stageId, status: "ACCEPTED" },
      });
    }
  }

  private async persistHandoff(projectId: string, handoff: IntegrationHandoff) {
    handoff.updatedAt = new Date().toISOString();
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        integrationHandoff: handoff as object,
        integrationHandoffUpdatedAt: new Date(),
      },
    });
    await this.changeLog.log(projectId, "integrationHandoff", JSON.stringify(handoff));
  }

  private async syncTracesFromHandoff(
    newProjectId: string,
    legacyProjectId: string,
    handoff: IntegrationHandoff,
    legacyStageId?: string,
  ) {
    for (const item of handoff.items) {
      await this.prisma.integrationTrace.upsert({
        where: {
          newProjectId_legacyProjectId_newLegId: { newProjectId, legacyProjectId, newLegId: item.id },
        },
        create: {
          newProjectId,
          legacyProjectId,
          newLegId: item.id,
          status: item.status === "sent" ? "SENT" : "DRAFT",
          legacyStageId: legacyStageId ?? undefined,
        },
        update: {
          status: item.status === "sent" ? "SENT" : undefined,
          ...(legacyStageId ? { legacyStageId } : {}),
        },
      });
    }
  }

  private async listTraceRows(projectId: string, handoff: IntegrationHandoff): Promise<IntegrationTraceRow[]> {
    const traces = await this.prisma.integrationTrace.findMany({
      where: { OR: [{ newProjectId: projectId }, { legacyProjectId: projectId }] },
      orderBy: { newLegId: "asc" },
    });
    const itemById = new Map(handoff.items.map((i) => [i.id, i]));
    return traces.map((t) => {
      const item = itemById.get(t.newLegId);
      return {
        id: t.id,
        newLegId: t.newLegId,
        legacyStoryId: t.legacyStoryId,
        legacyStageId: t.legacyStageId,
        screenOrEndpoint: t.screenOrEndpoint,
        status: t.status,
        title: item?.title ?? t.newLegId,
        description: item?.description ?? "",
        actor: item?.actor ?? null,
        acceptanceCriteria: item?.acceptanceCriteria ?? [],
      };
    });
  }

  /** Runs legacy/start (Ariadne get_modification_plan) after handoff lands on a stage. */
  private async tryAutoLegacyStartAfterHandoff(
    projectId: string,
    stageId: string,
    description: string,
  ): Promise<void> {
    if (!isLegacyHandoffAutoLegacyStartEnabled()) return;
    const desc = description.trim();
    if (!desc) return;
    try {
      await this.legacyCoordinator.start(projectId, desc, stageId);
      this.logger.log(
        `[Integration] legacy/start OK after handoff (project=${projectId}, stage=${stageId})`,
      );
    } catch (err) {
      this.logger.warn(
        `[Integration] legacy/start after handoff failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
