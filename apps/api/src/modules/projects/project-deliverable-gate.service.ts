import { ConflictException, Inject, Injectable, Logger, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ComplexityLevel, type Project, type Stage } from "@theforge/database";
import type { Estimation } from "@theforge/database";
import type { MddDeliveryGateResult, MddSemaphoreVerdict, SemaphoreStatus } from "@theforge/shared-types";
import {
  buildMddDeliveryGateConflictBody,
  DELIVERABLES_GATE_ERR,
  evaluateMddDeliveryGatePrepared,
  type DeliverablesGateConflictDetail,
} from "../ai-analysis/utils/mdd-delivery-gate-guard.util.js";
import { buildSemaphoreInputs } from "../ai-analysis/estimation/semaphore-inputs.factory.js";
import { ConformanceService } from "../engine/conformance.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import { pickMddFromStages } from "./constitution-markdown.util.js";
import { StageSemaphoreSyncService } from "./stage-semaphore-sync.service.js";
import { ProjectMddPersistService } from "./project-mdd-persist.service.js";
import { syncDomainInventoryForStage as persistDomainInventoryForStage } from "./sync-domain-inventory-stage.util.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import {
  assertDesignFirstDeliverableGate,
  loadDesignFirstStageContext,
} from "../design-first/design-first-gate.util.js";

type StageWithEst = Stage & { estimation: Estimation | null };

@Injectable()
export class ProjectDeliverableGateService {
  private readonly logger = new Logger(ProjectDeliverableGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conformance: ConformanceService,
    private readonly config: ConfigService,
    private readonly stageSemaphoreSync: StageSemaphoreSyncService,
    @Inject(forwardRef(() => ProjectMddPersistService))
    private readonly mddPersist: ProjectMddPersistService,
  ) {}

  /**
   * @deprecated Usar `StageSemaphoreSyncService.syncFromPersisted` con la etapa editada.
   */
  async refreshStageSemaphoreFromProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!project) return;
    const targetStage = pickPrimaryStage(project.stages);
    if (!targetStage) return;
    await this.stageSemaphoreSync.syncFromPersisted(projectId, targetStage.id, {
      reason: "refreshStageSemaphoreFromProject",
    });
  }

  /** Bloquea generación de entregables si el MDD no aprueba el gate (409 + ERR_MDD_DELIVERY_GATE). */
  async assertDeliverablesAllowed(
    projectId: string,
    options?: { acknowledgeGaps?: boolean },
  ): Promise<void> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    if (project.projectType === "DESIGN_FIRST") {
      const ctx = await loadDesignFirstStageContext(this.prisma, projectId);
      if (ctx) assertDesignFirstDeliverableGate(ctx);
      return;
    }
    if (project.projectType === "LEGACY") return;
    await this.assertDeliverablesMddGate(project, options?.acknowledgeGaps === true);
  }

  /** Gate MDD de entrega para cualquier tipo de proyecto (incl. LEGACY). */
  async assertMddDeliveryGateForDeliverables(projectId: string): Promise<void> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    await this.assertDeliverablesMddGate(project);
  }

  private deliverablesGateDetail(
    verdict: MddSemaphoreVerdict,
    hasSpec: boolean,
  ): DeliverablesGateConflictDetail {
    const dg = verdict.deliverablesGate;
    return {
      allowed: dg.allowed,
      rule: dg.rule,
      reasons: dg.reasons,
      semaphoreStatus: verdict.status as SemaphoreStatus,
      hasSpec,
    };
  }

  private async assertDeliverablesMddGate(
    project: Project & { stages: StageWithEst[] },
    acknowledgeGaps = false,
  ): Promise<void> {
    const stage = pickPrimaryStage(project.stages);
    const mdd = pickMddFromStages(project.stages).trim();
    const cx = project.complexity ?? ComplexityLevel.HIGH;
    const requireGreen = this.config.get<boolean>("DELIVERABLES_GATE_REQUIRE_GREEN", false);

    if (!mdd) {
      if (cx !== ComplexityLevel.HIGH) return;
      const gate: MddDeliveryGateResult = {
        ok: false,
        score: 0,
        blockers: [
          "No hay MDD en la etapa activa; completa la Constitución antes de generar entregables.",
        ],
        warnings: [],
      };
      if (stage?.id) void this.mddPersist.persistMddDeliveryGateSnapshot(stage.id, gate);
      if (!acknowledgeGaps) {
        throw new ConflictException(
          buildMddDeliveryGateConflictBody(gate, gate.blockers[0]!),
        );
      }
      return;
    }

    const legacyGate = await evaluateMddDeliveryGatePrepared(mdd, {
      brdMarkdown: stage?.brdContent,
      dbgaMarkdown: project.dbgaContent,
      mddComplexity: cx,
    });

    let verdict: MddSemaphoreVerdict | null = null;
    let hasSpec = (project.specContent ?? "").trim().length >= 80;
    if (stage?.id) {
      const built = await buildSemaphoreInputs(this.prisma, this.conformance, {
        projectId: project.id,
        stageId: stage.id,
        content: mdd,
        source: "persisted",
      });
      verdict = built.verdict;
      hasSpec = (built.deliverableSource.specContent ?? project.specContent ?? "").trim().length >= 80;
      void this.mddPersist.persistMddDeliveryGateSnapshot(stage.id, legacyGate);
      void persistDomainInventoryForStage(this.prisma, project, stage.id);
    }

    const dg = verdict?.deliverablesGate;
    const gateDetail = verdict ? this.deliverablesGateDetail(verdict, hasSpec) : undefined;
    const mddBlocked = !legacyGate.ok;
    const skipMissingSpecWithAck =
      dg?.reasons.some((r) => /falta Spec/i.test(r)) === true;

    const canAcknowledgeMdd = acknowledgeGaps && mddBlocked;
    const canAcknowledgeDeliverables =
      acknowledgeGaps &&
      requireGreen &&
      dg != null &&
      !dg.allowed &&
      !skipMissingSpecWithAck &&
      dg.reasons.every((r) => !/falta Spec/i.test(r));

    if (canAcknowledgeMdd || canAcknowledgeDeliverables) {
      this.logger.log(
        `[Semaphore] gate-skip projectId=${project.id} acknowledgeGaps mddBlockers=${mddBlocked} rule=${dg?.rule ?? "mdd"}`,
      );
      return;
    }

    if (mddBlocked) {
      this.logger.warn(
        `[Semaphore] gate-block rule=mdd_delivery projectId=${project.id} reasons=${legacyGate.blockers.length}`,
      );
      throw new ConflictException(buildMddDeliveryGateConflictBody(legacyGate));
    }

    if (requireGreen && dg != null && !dg.allowed) {
      this.logger.warn(
        `[Semaphore] gate-block rule=${dg.rule} projectId=${project.id} reasons=${dg.reasons.join("|")}`,
      );
      throw new ConflictException(
        buildMddDeliveryGateConflictBody(legacyGate, dg.reasons.join("; "), {
          deliverablesGate: gateDetail,
          code: DELIVERABLES_GATE_ERR,
        }),
      );
    }
  }
}
