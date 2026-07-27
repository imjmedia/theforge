import { BadRequestException, Inject, Injectable, Logger, forwardRef } from "@nestjs/common";
import { Prisma, type Status } from "@theforge/database";
import type { MddDeliveryGateResult } from "@theforge/shared-types";
import { computeMddCascadeDelta } from "@theforge/shared-types";
import {
  enforceMddGovernancePatternsOnPersist,
  selectedPatternIdsFromMdd,
  updateMddGovernancePatterns,
} from "@theforge/shared-types/mdd-governance-patterns";
import { peelDocumentBodyForPersist } from "@theforge/shared-types";
import { ChangeLogService } from "../change-log/change-log.service.js";
import { MddUpdatePipelineService } from "../engine/mdd-update-pipeline.service.js";
import { prepareMddForOutput } from "../ai-analysis/utils/mdd-prepare-output.js";
import { storeMddMarkdownForPersist } from "../ai-analysis/utils/mdd-sanitize.js";
import {
  buildMddDeliveryGateConflictBody,
  buildMddPatchPipelineErrorBody,
  evaluateMddDeliveryGatePrepared,
  MDD_DELIVERY_GATE_ERR,
} from "../ai-analysis/utils/mdd-delivery-gate-guard.util.js";
import { mergeDeliveryGateIntoShortTermContext } from "../ai-analysis/utils/mdd-delivery-gate.util.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import {
  buildSemaphoreBaseFromProject,
  mergeProjectFieldsForSemaphore,
  resolveMddPersistMode,
  type MddPatchPersistFlags,
  type SemaphoreProjectFields,
} from "./project-mdd-persist.util.js";
import { ProjectEstimationRecalcService } from "./project-estimation-recalc.service.js";
import { ProjectDeliverableGateService } from "./project-deliverable-gate.service.js";
import { applyDeterministicMddRepairs } from "./mdd-deterministic-repair.util.js";
import { resolveDomainInventory } from "../engine/domain-inventory-persist.util.js";
import type { DomainInventory } from "@theforge/shared-types";
import { pickPrimaryStage, type StageWithEstimation } from "./stage-helpers.js";
import {
  mergeSddGraphIntoShortTermContext,
} from "../engine/mdd-coherence/sdd-graph-context.util.js";

export type PersistMddFromPatchInput = {
  projectId: string;
  stageId: string;
  mddMarkdown: string;
  mergedForSemaphore: SemaphoreProjectFields;
  stageBaseline: { status: Status; precisionScore: number };
  documentMeta?: {
    documentAst: unknown | null;
    documentVersion?: number | null;
  };
  patchFlags: MddPatchPersistFlags;
};

export type PersistMddFromPatchResult = {
  sanitizedMdd: string;
  status: Status;
  precisionScore: number;
};

@Injectable()
export class ProjectMddPersistService {
  private readonly logger = new Logger(ProjectMddPersistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLog: ChangeLogService,
    private readonly mddUpdatePipeline: MddUpdatePipelineService,
    private readonly estimationRecalc: ProjectEstimationRecalcService,
    @Inject(forwardRef(() => ProjectDeliverableGateService))
    private readonly deliverableGate: ProjectDeliverableGateService,
  ) {}

  async persistMddDeliveryGateSnapshot(
    stageId: string,
    gate: MddDeliveryGateResult,
  ): Promise<void> {
    try {
      const stage = await this.prisma.stage.findUnique({
        where: { id: stageId },
        select: { shortTermContext: true },
      });
      const prev =
        stage?.shortTermContext &&
        typeof stage.shortTermContext === "object" &&
        !Array.isArray(stage.shortTermContext)
          ? (stage.shortTermContext as Record<string, unknown>)
          : {};
      await this.prisma.stage.update({
        where: { id: stageId },
        data: {
          shortTermContext: mergeDeliveryGateIntoShortTermContext(prev, gate) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[DeliveryGate] snapshot persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** BadRequest 400 con cuerpo estructurado para fallos del pipeline MDD en PATCH. */
  async throwMddPipelineBadRequest(
    result: { code: string; message: string },
    stageId: string,
    mddRaw: string,
  ): Promise<never> {
    if (result.code === MDD_DELIVERY_GATE_ERR) {
      const gate = await evaluateMddDeliveryGatePrepared(mddRaw);
      void this.persistMddDeliveryGateSnapshot(stageId, gate);
      throw new BadRequestException(
        buildMddPatchPipelineErrorBody(
          MDD_DELIVERY_GATE_ERR,
          buildMddDeliveryGateConflictBody(gate).message,
          stageId,
          gate,
        ),
      );
    }
    throw new BadRequestException(
      buildMddPatchPipelineErrorBody(result.code, result.message, stageId),
    );
  }

  /**
   * Persistencia MDD desde job en background (cola theforge-mdd).
   * - Borradores (`finalize: false`): sin delivery gate — el MDD puede estar incompleto.
   * - Final (`finalize: true`): pipeline completo (gate + semáforo + estimación).
   */
  async persistMddFromBackgroundJob(
    projectId: string,
    rawMarkdown: string,
    options?: { stageId?: string; finalize?: boolean; lockedPatternIds?: readonly string[] },
  ): Promise<void> {
    const existing = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const targetStage: StageWithEstimation | undefined =
      (options?.stageId?.trim() && existing.stages.find((s) => s.id === options.stageId!.trim())) ||
      pickPrimaryStage(existing.stages);
    if (!targetStage) throw new BadRequestException("El proyecto no tiene etapas");

    const lockedIds =
      options?.lockedPatternIds?.length
        ? new Set(options.lockedPatternIds)
        : selectedPatternIdsFromMdd(peelDocumentBodyForPersist(targetStage.mddContent ?? ""));
    const applyLockedPatterns = (md: string): string =>
      lockedIds.size > 0 ? updateMddGovernancePatterns(md, lockedIds) : md;

    const cleaned = cleanDocumentContent(peelDocumentBodyForPersist(rawMarkdown));
    if (cleaned.trim().length < 48) return;

    const enforced = enforceMddGovernancePatternsOnPersist(cleaned, targetStage.mddContent, {});
    const mddForPipeline = applyLockedPatterns(enforced.markdown);

    if (!options?.finalize) {
      const prepared = await prepareMddForOutput(mddForPipeline, { formatForPersist: false });
      const stored = applyLockedPatterns(prepared);
      await this.prisma.stage.update({
        where: { id: targetStage.id },
        data: { mddContent: stored },
      });
      await this.changeLog.log(projectId, "mddContent", prepared);
      return;
    }

    const mergedForSemaphore = mergeProjectFieldsForSemaphore(existing, {});
    const previousMdd = targetStage.mddContent ?? "";
    const inventory = resolveDomainInventory({
      persisted: targetStage.domainInventory as DomainInventory | null | undefined,
      brdMarkdown: targetStage.brdContent,
      dbgaMarkdown: existing.dbgaContent,
      mddMarkdown: mddForPipeline,
    });
    const repaired = applyDeterministicMddRepairs(mddForPipeline, {
      brdMarkdown: targetStage.brdContent,
      dbgaMarkdown: existing.dbgaContent,
      inventory,
      specMarkdown: existing.specContent,
    });
    const pipelineInput = repaired.changed ? repaired.markdown : mddForPipeline;

    const result = await this.mddUpdatePipeline.process(
      pipelineInput,
      buildSemaphoreBaseFromProject(mergedForSemaphore),
      { projectId, stageId: targetStage.id },
    );
    if (!result.ok) {
      if (result.code === MDD_DELIVERY_GATE_ERR) {
        const gate = await evaluateMddDeliveryGatePrepared(mddForPipeline);
        void this.persistMddDeliveryGateSnapshot(targetStage.id, gate);
      }
      throw new BadRequestException({
        code: result.code,
        message: result.message,
      });
    }

    const finalMdd = applyLockedPatterns(result.sanitizedMdd);
    const cascadeDelta = computeMddCascadeDelta(previousMdd, finalMdd);
    const prevCtx =
      targetStage.shortTermContext &&
      typeof targetStage.shortTermContext === "object" &&
      !Array.isArray(targetStage.shortTermContext)
        ? (targetStage.shortTermContext as Record<string, unknown>)
        : {};

    const nextCtx = mergeSddGraphIntoShortTermContext(
      {
        ...prevCtx,
        pendingCascadeDelta:
          cascadeDelta.affectedDeliverables.length > 0 ? cascadeDelta : null,
      },
      result.sddGraph ?? {
        state: "unavailable",
        entityCount: 0,
        endpointCount: 0,
        expectedEntities: 0,
        expectedEndpoints: 0,
        isCoherent: false,
        orphanEntityCount: 0,
        orphanEndpointCount: 0,
        lastSyncedAt: null,
        message: "Sin evaluación de grafo SDD en esta persistencia.",
      },
      finalMdd,
    );

    await this.prisma.stage.update({
      where: { id: targetStage.id },
      data: {
        mddContent: storeMddMarkdownForPersist(finalMdd),
        shortTermContext: nextCtx as Prisma.InputJsonValue,
      },
    });
    await this.changeLog.log(projectId, "mddContent", finalMdd);
    void this.persistMddDeliveryGateSnapshot(
      targetStage.id,
      await evaluateMddDeliveryGatePrepared(finalMdd),
    );
    await this.deliverableGate.refreshStageSemaphoreFromProject(projectId);
    const refreshed = await this.prisma.stage.findUnique({
      where: { id: targetStage.id },
      select: { status: true, precisionScore: true },
    });
    await this.estimationRecalc.recalcAndUpsert(targetStage.id, {
      mddContent: finalMdd,
      infraContent: existing.infraContent ?? null,
      status: refreshed?.status ?? result.status,
    });
  }

  /** Persistencia MDD desde `PATCH /projects/:id` (format-only, seed/wizard o pipeline completo). */
  async persistMddFromPatch(input: PersistMddFromPatchInput): Promise<PersistMddFromPatchResult> {
    const {
      projectId,
      stageId,
      mddMarkdown,
      mergedForSemaphore,
      stageBaseline,
      documentMeta,
      patchFlags,
    } = input;
    const mode = resolveMddPersistMode(mddMarkdown, patchFlags);
    const documentData = this.buildStageDocumentUpdate(documentMeta);

    if (mode === "format" || mode === "store") {
      const formatted = storeMddMarkdownForPersist(mddMarkdown);
      await this.prisma.stage.update({
        where: { id: stageId },
        data: { mddContent: formatted, ...documentData },
      });
      await this.changeLog.log(projectId, "mddContent", formatted);
      return {
        sanitizedMdd: formatted,
        status: stageBaseline.status,
        precisionScore: stageBaseline.precisionScore,
      };
    }

    const stageRow = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: {
        mddContent: true,
        brdContent: true,
        domainInventory: true,
        shortTermContext: true,
      },
    });
    const projectRow = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { dbgaContent: true, specContent: true },
    });
    const inventory = resolveDomainInventory({
      persisted: stageRow?.domainInventory as DomainInventory | null | undefined,
      brdMarkdown: stageRow?.brdContent,
      dbgaMarkdown: projectRow?.dbgaContent,
      mddMarkdown,
    });
    const repaired = applyDeterministicMddRepairs(mddMarkdown, {
      brdMarkdown: stageRow?.brdContent,
      dbgaMarkdown: projectRow?.dbgaContent,
      inventory,
      specMarkdown: projectRow?.specContent,
    });
    const pipelineInput = repaired.changed ? repaired.markdown : mddMarkdown;
    const previousMdd = stageRow?.mddContent ?? "";

    const result = await this.mddUpdatePipeline.process(
      pipelineInput,
      buildSemaphoreBaseFromProject(mergedForSemaphore),
      { projectId, stageId },
    );
    if (!result.ok) {
      return await this.throwMddPipelineBadRequest(result, stageId, mddMarkdown);
    }

    const ok = result;
    const cascadeDelta = computeMddCascadeDelta(previousMdd, ok.sanitizedMdd);
    const prevCtx =
      stageRow?.shortTermContext &&
      typeof stageRow.shortTermContext === "object" &&
      !Array.isArray(stageRow.shortTermContext)
        ? (stageRow.shortTermContext as Record<string, unknown>)
        : {};

    const nextCtx = mergeSddGraphIntoShortTermContext(
      {
        ...prevCtx,
        pendingCascadeDelta:
          cascadeDelta.affectedDeliverables.length > 0 ? cascadeDelta : null,
      },
      ok.sddGraph ?? {
        state: "unavailable",
        entityCount: 0,
        endpointCount: 0,
        expectedEntities: 0,
        expectedEndpoints: 0,
        isCoherent: false,
        orphanEntityCount: 0,
        orphanEndpointCount: 0,
        lastSyncedAt: null,
        message: "Sin evaluación de grafo SDD en esta persistencia.",
      },
      ok.sanitizedMdd,
    );

    await this.prisma.stage.update({
      where: { id: stageId },
      data: {
        mddContent: storeMddMarkdownForPersist(ok.sanitizedMdd),
        ...documentData,
        shortTermContext: nextCtx as Prisma.InputJsonValue,
      },
    });
    await this.changeLog.log(projectId, "mddContent", ok.sanitizedMdd);
    void this.persistMddDeliveryGateSnapshot(
      stageId,
      await evaluateMddDeliveryGatePrepared(ok.sanitizedMdd),
    );
    await this.deliverableGate.refreshStageSemaphoreFromProject(projectId);
    const refreshed = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { status: true, precisionScore: true },
    });
    return {
      sanitizedMdd: ok.sanitizedMdd,
      status: refreshed?.status ?? ok.status,
      precisionScore: refreshed?.precisionScore ?? ok.precisionScore,
    };
  }

  private buildStageDocumentUpdate(
    documentMeta?: PersistMddFromPatchInput["documentMeta"],
  ): Pick<Prisma.StageUpdateInput, "documentAst" | "documentVersion"> {
    if (documentMeta === undefined) return {};
    return {
      documentAst:
        documentMeta.documentAst === null
          ? Prisma.JsonNull
          : (documentMeta.documentAst as Prisma.InputJsonValue),
      documentVersion: documentMeta.documentVersion ?? undefined,
    };
  }
}
