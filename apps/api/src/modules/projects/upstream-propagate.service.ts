import {
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
  Inject,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  UPSTREAM_IMPACT_MAP,
  WORKSHOP_UPSTREAM_LEVEL_LABELS,
  buildUpstreamChangeSummaryForPipeline,
  buildUpstreamPropagatePatchPlan,
  type WorkshopUpstreamLevelTab,
} from "@theforge/shared-types";
import { MddUpstreamSyncService } from "../ai-analysis/mdd/mdd-upstream-sync.service.js";
import { MddQueueService } from "../ai-analysis/mdd/mdd-queue.service.js";
import { ProjectGenerationGuardService } from "./project-generation-guard.service.js";
import { ProjectsService } from "./projects.service.js";
import { pickPrimaryStage } from "./stage-helpers.js";

/**
 * Propagación en background tras edición en un nivel upstream (Paso 0/DBGA, BRD, Benchmark).
 * MVP: análisis determinista + job upstream-sync MDD; parches LLM entre hermanos upstream: TODO en runJob.
 */
@Injectable()
export class UpstreamPropagateService {
  private readonly logger = new Logger(UpstreamPropagateService.name);

  constructor(
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly mddUpstreamSync: MddUpstreamSyncService,
    @Inject(forwardRef(() => MddQueueService))
    private readonly mddQueue: MddQueueService,
    @Inject(forwardRef(() => ProjectGenerationGuardService))
    private readonly generationGuard: ProjectGenerationGuardService,
  ) {}

  async enqueue(
    projectId: string,
    originTab: WorkshopUpstreamLevelTab,
    stageId?: string | null,
  ): Promise<{ queued: true; jobId: string; plan: ReturnType<typeof buildUpstreamPropagatePatchPlan> }> {
    const jobId = randomUUID();
    const plan = buildUpstreamPropagatePatchPlan(originTab);
    this.generationGuard.registerBackgroundJob(jobId, projectId, "upstream-propagate");

    void this.runJob(projectId, originTab, stageId, jobId).catch((err) => {
      this.logger.error(
        `upstream-propagate failed projectId=${projectId} jobId=${jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.generationGuard.finishBackgroundJob(jobId);
    });

    return { queued: true, jobId, plan };
  }

  private async runJob(
    projectId: string,
    originTab: WorkshopUpstreamLevelTab,
    stageId: string | null | undefined,
    jobId: string,
  ): Promise<void> {
    this.generationGuard.markBackgroundJobActive(jobId);
    const plan = buildUpstreamPropagatePatchPlan(originTab);
    this.logger.log(
      `[upstream-propagate] start projectId=${projectId} origin=${originTab} siblings=${plan.siblingTabs.join(",")}`,
    );

    const project = await this.projects.findOne(projectId);
    const stages = (project as { stages?: Array<{ id?: string; mddContent?: string | null }> }).stages ?? [];
    const stageRaw =
      (stageId?.trim() && stages.find((s) => String(s.id ?? "") === stageId.trim())) ||
      pickPrimaryStage(stages as Parameters<typeof pickPrimaryStage>[0]);
    const stage = stageRaw as { id?: string; mddContent?: string | null } | null | undefined;
    const resolvedStageId = String(stage?.id ?? "");
    if (!resolvedStageId) throw new NotFoundException("Etapa no encontrada");

    const docs = await this.mddUpstreamSync.loadUpstreamDocuments(projectId, resolvedStageId);
    const analysis = await this.mddUpstreamSync.analyze(projectId, resolvedStageId);

    // TODO: parches selectivos LLM en hermanos upstream según diff del origen.
    for (const sibling of UPSTREAM_IMPACT_MAP[originTab]) {
      this.logger.log(
        `[upstream-propagate] patch-plan sibling=${sibling} label=${WORKSHOP_UPSTREAM_LEVEL_LABELS[sibling]} (scaffold)`,
      );
    }

    const mddContent = String(stage?.mddContent ?? "").trim();
    if (mddContent.length >= 80 && analysis.canSync && !analysis.needsFullRegen) {
      const sections = this.mddUpstreamSync.normalizeSections(undefined, analysis);
      const changeSummary = buildUpstreamChangeSummaryForPipeline(analysis);
      await this.mddQueue.enqueue({
        mode: "upstream-sync",
        projectId,
        stageId: resolvedStageId,
        dbgaContent: docs.dbgaContent,
        mddContent,
        upstreamSections: sections,
        upstreamChangeSummary: changeSummary,
      });
    } else {
      this.logger.warn(
        `[upstream-propagate] skip MDD sync: hasMdd=${mddContent.length >= 80} canSync=${analysis.canSync} needsFullRegen=${analysis.needsFullRegen}`,
      );
    }

    this.logger.log(`[upstream-propagate] done jobId=${jobId}`);
    this.generationGuard.finishBackgroundJob(jobId);
  }
}
