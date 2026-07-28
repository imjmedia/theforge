import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import { ComplexityLevel } from "@theforge/database";
import { Prisma } from "@theforge/database";
import {
  DELIVERABLE_WAVES_BY_COMPLEXITY,
  TASKS_PREFLIGHT_DOC_ACCURACY_BLOCK_THRESHOLD,
  flattenDeliverableWaves,
  type DeliverableKind,
  type DeliverableWaveStep,
} from "@theforge/shared-types";
import {
  buildInfraConformanceGapFeedback,
  checkApiVsMdd,
  checkInfraVsMdd,
  checkLogicFlowsVsMdd,
  checkBlueprintVsMdd,
} from "../engine/conformance.service.js";
import { buildApiRetryFeedback } from "../engine/api-conformance-repair.util.js";
import { buildDeterministicDeliverableConformancePatches } from "../engine/deliverable-conformance-enforce.util.js";
import { computeCascadeAccuracy } from "../engine/cascade-accuracy.util.js";
import {
  buildCrossArtifactTraceReport,
  formatCrossArtifactTraceGaps,
} from "../engine/cross-artifact-trace.util.js";
import {
  checkModelCardinalityAlignment,
  formatModelCardinalityGaps,
} from "../engine/model-cardinality.util.js";
import {
  collectDomainInventoryConformanceGaps,
  formatDomainInventoryConformanceGaps,
} from "../engine/domain-inventory-conformance.util.js";
import { buildEntityApiTraceReport, formatEntityApiTraceGaps } from "../engine/entity-api-trace.util.js";
import { collectExternalIntegrationContractGaps } from "../engine/sdd-external-contracts.util.js";
import { checkBrdDecisionLogClosure } from "../engine/brd-decision-log.util.js";
import {
  collectSddPrecisionGaps,
  formatPrecisionGapsFeedback,
  precisionGapsForPostPassRetry,
} from "../engine/sdd-precision-checks.util.js";
import {
  CASCADE_W4_PRECISION_MAX_ATTEMPTS,
  filterSchedulerResearchPrecisionGaps,
  shouldRunAnotherCascadeW4Pass,
} from "./cascade-w4-post-pass.util.js";
import { UiMcpClientService } from "../ui-mcp/ui-mcp-client.service.js";
import { UiScreensService } from "../ui-mcp/ui-screens.service.js";
import { ConformanceService } from "../engine/conformance.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import { buildConstitutionMarkdown } from "./constitution-markdown.util.js";
import { buildExistingConformanceGapsMap } from "./deliverables-cascade-gaps.util.js";
import {
  collectConformanceGaps,
} from "./conformance-gaps.util.js";
import { collectLowMediumReadinessGaps } from "../engine/low-medium-readiness.util.js";
import { applyDeterministicMddRepairs } from "./mdd-deterministic-repair.util.js";
import {
  buildConvergenceFeedbackForDeliverable,
  buildConvergenceRetryPlan,
  orderConvergenceDeliverables,
} from "@theforge/shared-types";
import { storeMddMarkdownForPersist } from "../ai-analysis/utils/mdd-sanitize.js";
import { syncDomainInventoryForStage } from "./sync-domain-inventory-stage.util.js";
import { persistStageDeliverableSnapshotFromProject } from "./stage-deliverable-snapshot.util.js";
import {
  persistDeliverableBundleAtomic,
  pickDeliverableBundleFields,
} from "./deliverable-bundle-persist.util.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import { ProjectsService } from "./projects.service.js";
import { resolveDomainInventory } from "../engine/domain-inventory-persist.util.js";
import type { DomainInventory } from "@theforge/shared-types";

export type DeliverablesCascadeProgress = {
  step: string;
  completedSteps: string[];
  index: number;
  total: number;
};

@Injectable()
export class DeliverablesCascadeService {
  private readonly logger = new Logger(DeliverablesCascadeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly uiMcpClient: UiMcpClientService,
    private readonly uiScreens: UiScreensService,
    private readonly conformance: ConformanceService,
  ) {}

  /** Sync pantallas tras W2; no falla la cascada si no hay MCP activo. */
  async syncUiScreens(projectId: string): Promise<void> {
    try {
      if (!(await this.uiMcpClient.isActive())) {
        this.logger.debug("[Cascade] ui_screens_sync omitido — MCP gráfico inactivo");
        return;
      }
      await this.uiScreens.syncUiScreens(projectId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[Cascade] ui_screens_sync saltado: ${message}`);
    }
  }

  /** Cascada parcial: solo entregables afectados por el último delta MDD (shortTermContext.pendingCascadeDelta). */
  async generateDeliverablesDelta(
    projectId: string,
    onProgress?: (p: DeliverablesCascadeProgress) => void,
    options?: { acknowledgeGaps?: boolean; signal?: AbortSignal },
  ) {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    const stage = pickPrimaryStage(project.stages ?? []);
    const ctx = stage?.shortTermContext;
    const rawDelta =
      ctx &&
      typeof ctx === "object" &&
      !Array.isArray(ctx) &&
      (ctx as { pendingCascadeDelta?: { affectedDeliverables?: DeliverableWaveStep[] } | null })
        .pendingCascadeDelta;
    const delta =
      rawDelta && typeof rawDelta === "object" ? rawDelta : null;

    const steps = delta?.affectedDeliverables?.length
      ? delta.affectedDeliverables
      : null;

    if (!steps || steps.length === 0) {
      throw new BadRequestException(
        "No hay delta de cascada pendiente. Edita el MDD o ejecuta cascada completa.",
      );
    }

    await this.projects.assertDeliverablesAllowed(projectId, options);
    const throwIfAbortedDelta = () => {
      if (options?.signal?.aborted) throw new Error("Cancelado por el usuario");
    };
    const mddContent = buildConstitutionMarkdown(project);
    const gapsMap = buildExistingConformanceGapsMap(
      project,
      mddContent,
      steps,
      project.complexity ?? ComplexityLevel.HIGH,
    );
    const completedSteps: string[] = [];
    let index = 0;
    const total = steps.length + 1;

    for (const step of steps) {
      if (options?.signal?.aborted) throw new Error("Cancelado por el usuario");
      const stepGaps = gapsMap.get(step);
      await this.runDeliverableWaveStep(
        step,
        projectId,
        stepGaps,
        options?.acknowledgeGaps === true,
      ).catch((e) =>
        this.logger.warn(`[CascadeDelta] ${step}: ${e instanceof Error ? e.message : e}`),
      );
      completedSteps.push(step);
      onProgress?.({ step, completedSteps: [...completedSteps], index, total });
      index++;
    }

    await this.runCascadePostPassRetry(projectId, options?.signal).catch((err) => {
      if (err instanceof Error && err.message.includes("Cancelado por el usuario")) throw err;
    });
    throwIfAbortedDelta();
    await this.runCascadeDeterministicConformancePass(projectId);
    await this.runCascadeConformanceRetry(projectId, options?.signal).catch((err) => {
      if (err instanceof Error && err.message.includes("Cancelado por el usuario")) throw err;
    });
    throwIfAbortedDelta();
    await this.runCascadeConvergenceLoop(projectId, options?.signal).catch((err) => {
      if (err instanceof Error && err.message.includes("Cancelado por el usuario")) throw err;
    });
    throwIfAbortedDelta();
    await this.runCascadeDeterministicConformancePass(projectId);
    await this.projects.refreshStageSemaphoreFromProject(projectId).catch(() => undefined);

    if (stage?.id) {
      const prev =
        stage.shortTermContext &&
        typeof stage.shortTermContext === "object" &&
        !Array.isArray(stage.shortTermContext)
          ? (stage.shortTermContext as Record<string, unknown>)
          : {};
      await this.prisma.stage.update({
        where: { id: stage.id },
        data: {
          shortTermContext: { ...prev, pendingCascadeDelta: null } as Prisma.InputJsonValue,
        },
      });
    }

    onProgress?.({ step: "done", completedSteps, index: total - 1, total });
    return this.projects.findOne(projectId);
  }

  /**
   * Enrutamiento dinámico: solo ejecuta generadores listados en `DELIVERABLES_BY_COMPLEXITY`.
   * @param onProgress — opcional (p. ej. BullMQ `job.updateProgress`).
   */
  async generateDeliverablesCascade(
    projectId: string,
    onProgress?: (p: DeliverablesCascadeProgress) => void,
    options?: { acknowledgeGaps?: boolean; signal?: AbortSignal },
  ) {
    await this.projects.assertDeliverablesAllowed(projectId, options);
    const throwIfAborted = () => {
      if (options?.signal?.aborted) throw new Error("Cancelado por el usuario");
    };
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    await syncDomainInventoryForStage(this.prisma, project).catch((err) =>
      this.logger.warn(
        `[Cascade] syncDomainInventory: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    if (project.projectType === "LEGACY") {
      throw new BadRequestException("Usa el flujo de entregables legacy del proyecto.");
    }
    if (project.complexityPending != null) {
      throw new BadRequestException(
        "Hay una propuesta de complejidad pendiente de confirmación. Confirma o rechaza en el chat del Workshop antes de generar entregables.",
      );
    }
    const c = project.complexity ?? ComplexityLevel.HIGH;
    const waves = DELIVERABLE_WAVES_BY_COMPLEXITY[c];
    const flatSteps = flattenDeliverableWaves(c);
    const total = flatSteps.length + 1;
    const errors: { step: string; error: string }[] = [];

    let completedCount = 0;
    const completedSteps: string[] = [];
    const reportProgress = (step: DeliverableWaveStep) => {
      const progressKey = step === "ui_screens_sync" ? "ui_screens_sync" : step;
      completedSteps.push(progressKey);
      onProgress?.({
        step: progressKey,
        completedSteps: [...completedSteps],
        index: completedCount,
        total,
      });
      completedCount++;
    };

    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      throwIfAborted();
      const wave = waves[waveIndex]!;
      const projectFresh = await this.projects.findOne(projectId);
      const mddContent = buildConstitutionMarkdown(projectFresh);
      const gapsMap = buildExistingConformanceGapsMap(
        projectFresh,
        mddContent,
        wave,
        projectFresh.complexity ?? ComplexityLevel.HIGH,
      );

      await Promise.allSettled(
        wave.map(async (step: DeliverableWaveStep) => {
          try {
            throwIfAborted();
            const stepGaps = step !== "ui_screens_sync" ? gapsMap.get(step) : undefined;
            await this.runDeliverableWaveStep(
              step,
              projectId,
              stepGaps ?? undefined,
              options?.acknowledgeGaps === true,
            );
          } catch (e) {
            if (e instanceof Error && e.message.includes("Cancelado por el usuario")) return;
            const message = e instanceof Error ? e.message : "Error desconocido";
            this.logger.warn(`[Cascade] Paso ${step} saltado: ${message}.`);
            errors.push({ step, error: message });
          }
          reportProgress(step);
        }),
      );
      throwIfAborted();
    }

    const projectAfterWaves = await this.projects.findOne(projectId);
    const stageAfterWaves = pickPrimaryStage(projectAfterWaves.stages ?? []);
    if (stageAfterWaves?.id) {
      await persistDeliverableBundleAtomic(
        this.prisma,
        stageAfterWaves.id,
        projectId,
        pickDeliverableBundleFields(projectAfterWaves),
      ).catch((err) =>
        this.logger.warn(
          `[Cascade] bundle atomic persist: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    onProgress?.({
      step: "post_pass_w4",
      completedSteps: [...completedSteps],
      index: completedCount,
      total,
    });

    throwIfAborted();
    await this.runCascadePostPassRetry(projectId, options?.signal).catch((err) => {
      if (err instanceof Error && err.message.includes("Cancelado por el usuario")) throw err;
      this.logger.warn(
        `[Cascade] post-pass W4: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    throwIfAborted();
    await this.runCascadeDeterministicConformancePass(projectId);
    await this.runCascadeConformanceRetry(projectId, options?.signal).catch((err) => {
      if (err instanceof Error && err.message.includes("Cancelado por el usuario")) throw err;
      this.logger.warn(
        `[Cascade] conformance retry: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    throwIfAborted();
    await this.runCascadeConvergenceLoop(projectId, options?.signal).catch((err) => {
      if (err instanceof Error && err.message.includes("Cancelado por el usuario")) throw err;
      this.logger.warn(
        `[Cascade] convergence loop: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    throwIfAborted();
    await this.runCascadeDeterministicConformancePass(projectId);

    throwIfAborted();
    await this.projects.refreshStageSemaphoreFromProject(projectId).catch((err) =>
      this.logger.warn(
        `[Cascade] refresh semaphore: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );

    onProgress?.({ step: "done", completedSteps: [...completedSteps], index: total - 1, total });
    if (errors.length > 0) {
      this.logger.warn(
        `[Cascade] Completada con ${errors.length}/${total} paso(s) saltado(s): ${errors.map((e) => `${e.step}: ${e.error}`).join("; ")}`,
      );
    }
    const result = await this.projects.findOne(projectId);
    const activeStage = pickPrimaryStage(result.stages ?? []);
    if (activeStage?.id) {
      await persistStageDeliverableSnapshotFromProject(this.prisma, activeStage.id, result, {
        source: "cascade",
      }).catch((err) =>
        this.logger.warn(
          `[Cascade] deliverableSnapshot: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      await this.projects.runPostRegenSddConflictSurfacing(result.id).catch((err) =>
        this.logger.warn(
          `[Cascade] sddConflictSurfacing: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    return result;
  }

  private async runDeliverableWaveStep(
    step: DeliverableWaveStep,
    projectId: string,
    gapsFeedback?: string | null,
    acknowledgeGaps?: boolean,
  ): Promise<void> {
    if (step === "ui_screens_sync") {
      await this.syncUiScreens(projectId);
      return;
    }
    await this.projects.generateDocument(step as DeliverableKind, projectId, {
      gapsFeedback: gapsFeedback ?? undefined,
      acknowledgeGaps,
    });
  }

  /** W4: reintenta artefactos con gaps de precisión SDD o TaskAccuracy < 90 (hasta 3 pases). */
  private async runCascadePostPassRetry(projectId: string, signal?: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < CASCADE_W4_PRECISION_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new Error("Cancelado por el usuario");
      const didRetry = await this.executeCascadePostPassRetryRound(projectId, signal);
      if (!didRetry) return;

      const project = await this.projects.findOne(projectId);
      const mdd = buildConstitutionMarkdown(project);
      const precisionGaps = collectSddPrecisionGaps({
        mdd,
        architecture: project.architectureContent,
        blueprint: project.blueprintContent,
        tasks: project.tasksContent,
        logicFlows: project.logicFlowsContent,
        userStories: project.userStoriesContent,
        useCases: project.useCasesContent,
        apiContracts: project.apiContractsContent,
        pantallas: project.uiScreensContent,
        phase0Summary: project.phase0SummaryContent,
      });
      const schedulerResearchRemaining = filterSchedulerResearchPrecisionGaps(precisionGaps);
      if (!shouldRunAnotherCascadeW4Pass(schedulerResearchRemaining, attempt)) {
        if (schedulerResearchRemaining.length > 0) {
          this.logger.warn(
            `[Cascade] W4: ${schedulerResearchRemaining.length} gap(s) scheduler/research persisten tras ${attempt + 1} pase(s)`,
          );
        }
        return;
      }
      this.logger.warn(
        `[Cascade] W4: pase ${attempt + 2}/${CASCADE_W4_PRECISION_MAX_ATTEMPTS} — ${schedulerResearchRemaining.length} gap(s) scheduler/research`,
      );
    }
  }

  private async executeCascadePostPassRetryRound(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) throw new Error("Cancelado por el usuario");
    const project = await this.projects.findOne(projectId);
    const mdd = buildConstitutionMarkdown(project);
    const stage = pickPrimaryStage(project.stages ?? []);
    const precisionGaps = collectSddPrecisionGaps({
      mdd,
      architecture: project.architectureContent,
      blueprint: project.blueprintContent,
      tasks: project.tasksContent,
      logicFlows: project.logicFlowsContent,
      userStories: project.userStoriesContent,
      useCases: project.useCasesContent,
      apiContracts: project.apiContractsContent,
      pantallas: project.uiScreensContent,
      phase0Summary: project.phase0SummaryContent,
    });

    const accuracy = computeCascadeAccuracy({
      brdMarkdown: stage?.brdContent,
      dbgaMarkdown: project.dbgaContent,
      mddMarkdown: mdd,
      tasksMarkdown: project.tasksContent,
      logicFlowsMarkdown: project.logicFlowsContent,
      apiContractsMarkdown: project.apiContractsContent,
      uiScreensMarkdown: project.uiScreensContent,
      userStoriesMarkdown: project.userStoriesContent,
      useCasesMarkdown: project.useCasesContent,
      specMarkdown: project.specContent,
    });

    const taskGaps: string[] = [];
    if (!accuracy.tasks.ok) {
      const detail = [
        ...accuracy.tasks.blockers,
        ...accuracy.tasks.components.flatMap((c) => c.gaps),
      ]
        .filter(Boolean)
        .slice(0, 12);
      taskGaps.push(
        `TaskAccuracy=${accuracy.tasks.score} < 90. ${detail.join("; ") || "mejorar cobertura dominio→task / CRUD / anti auth-skew"}`,
      );
    }

    const crossTrace = buildCrossArtifactTraceReport({
      userStoriesMarkdown: project.userStoriesContent,
      uiScreensMarkdown: project.uiScreensContent,
      apiContractsMarkdown: project.apiContractsContent,
      tasksMarkdown: project.tasksContent,
    });
    const crossGaps = formatCrossArtifactTraceGaps(crossTrace, 16);

    const inventory = resolveDomainInventory({
      persisted: stage?.domainInventory as DomainInventory | null | undefined,
      brdMarkdown: stage?.brdContent,
      dbgaMarkdown: project.dbgaContent,
      mddMarkdown: mdd,
    });

    const cardinality = checkModelCardinalityAlignment({
      mddMarkdown: mdd,
      inventory,
      tasksMarkdown: project.tasksContent,
    });
    const cardinalityGaps = formatModelCardinalityGaps(cardinality);

    const invConf = collectDomainInventoryConformanceGaps({
      brdMarkdown: stage?.brdContent,
      dbgaMarkdown: project.dbgaContent,
      mddMarkdown: mdd,
      inventory,
    });
    const invConfGaps = formatDomainInventoryConformanceGaps(invConf, 10);

    const entityTraceGaps = formatEntityApiTraceGaps(
      buildEntityApiTraceReport({
        mddMarkdown: mdd,
        inventory,
        apiContractsMarkdown: project.apiContractsContent,
      }),
      10,
    );

    const externalGaps = collectExternalIntegrationContractGaps({
      dbgaMarkdown: project.dbgaContent,
      brdMarkdown: stage?.brdContent,
      mddMarkdown: mdd,
      apiContractsMarkdown: project.apiContractsContent,
      architectureMarkdown: project.architectureContent,
      infraMarkdown: project.infraContent,
    });

    const brdLogGaps = stage?.brdContent?.trim()
      ? [
          ...checkBrdDecisionLogClosure(stage.brdContent).blockers,
          ...checkBrdDecisionLogClosure(stage.brdContent).warnings,
        ]
      : [];

    const allGaps = [
      ...precisionGaps,
      ...taskGaps,
      ...crossGaps,
      ...cardinalityGaps,
      ...invConfGaps,
      ...entityTraceGaps,
      ...externalGaps,
      ...brdLogGaps,
    ];
    if (allGaps.length === 0) return false;
    if (signal?.aborted) throw new Error("Cancelado por el usuario");

    const feedback = formatPrecisionGapsFeedback(allGaps);
    const flags = precisionGapsForPostPassRetry(precisionGaps);
    if (taskGaps.length > 0 || crossGaps.length > 0 || cardinalityGaps.length > 0) {
      flags.retryTasks = true;
    }
    if (invConfGaps.length > 0 || entityTraceGaps.length > 0 || externalGaps.length > 0) {
      flags.retryApiContracts = true;
      flags.retryArchitecture = true;
    }

    this.logger.warn(
      `[Cascade] Post-pase W4: ${allGaps.length} gap(s) (precision=${precisionGaps.length}, taskAccuracy=${accuracy.tasks.score}) — retry dirigido`,
    );

    if (flags.retryLogicFlows) {
      await this.projects
        .generateLogicFlows(projectId, feedback)
        .catch((e) =>
          this.logger.warn(`[Cascade] W4 logic-flows retry: ${e instanceof Error ? e.message : e}`),
        );
      if (signal?.aborted) throw new Error("Cancelado por el usuario");
    }

    const upstreamRetries: Array<Promise<unknown>> = [];
    if (flags.retryArchitecture) {
      upstreamRetries.push(
        this.projects.generateArchitecture(projectId, feedback).catch((e) =>
          this.logger.warn(`[Cascade] W4 architecture retry: ${e instanceof Error ? e.message : e}`),
        ),
      );
    }
    if (flags.retryApiContracts) {
      upstreamRetries.push(
        this.projects.generateApiContracts(projectId, feedback).catch((e) =>
          this.logger.warn(`[Cascade] W4 api-contracts retry: ${e instanceof Error ? e.message : e}`),
        ),
      );
    }

    if (upstreamRetries.length > 0) {
      await Promise.allSettled(upstreamRetries);
    }
    if (signal?.aborted) throw new Error("Cancelado por el usuario");

    if (flags.retryTasks) {
      const refreshed = await this.projects.findOne(projectId);
      const refreshedStage = pickPrimaryStage(refreshed.stages ?? []);
      const docAcc = computeCascadeAccuracy({
        brdMarkdown: refreshedStage?.brdContent,
        dbgaMarkdown: refreshed.dbgaContent,
        mddMarkdown: buildConstitutionMarkdown(refreshed),
        tasksMarkdown: refreshed.tasksContent,
        logicFlowsMarkdown: refreshed.logicFlowsContent,
        apiContractsMarkdown: refreshed.apiContractsContent,
        uiScreensMarkdown: refreshed.uiScreensContent,
        userStoriesMarkdown: refreshed.userStoriesContent,
        useCasesMarkdown: refreshed.useCasesContent,
        specMarkdown: refreshed.specContent,
      }).doc;
      const relaxPreflight =
        docAcc.score < TASKS_PREFLIGHT_DOC_ACCURACY_BLOCK_THRESHOLD;
      await this.projects
        .generateTasks(projectId, feedback, { acknowledgeGaps: relaxPreflight })
        .catch((e) =>
          this.logger.warn(`[Cascade] W4 tasks retry: ${e instanceof Error ? e.message : e}`),
        );
    }

    return true;
  }

  /** Alineación determinista API/Blueprint/Flujos al MDD (sin LLM). */
  private async runCascadeDeterministicConformancePass(projectId: string): Promise<void> {
    const project = await this.projects.findOne(projectId);
    const mdd = buildConstitutionMarkdown(project);
    if (!mdd.trim()) return;

    const patches = buildDeterministicDeliverableConformancePatches(mdd, project);
    if (Object.keys(patches).length === 0) return;

    this.logger.log(
      `[Cascade] Conformance determinista: ${Object.keys(patches).join(", ")}`,
    );
    await this.projects.update(projectId, patches);
  }

  /** Reintenta derivados cuando conformance heurístico falla tras la cascada (máx. 2 iteraciones). */
  private async runCascadeConformanceRetry(projectId: string, signal?: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error("Cancelado por el usuario");
      await this.runCascadeDeterministicConformancePass(projectId);

      const project = await this.projects.findOne(projectId);
      const mdd = buildConstitutionMarkdown(project);
      if (!mdd.trim()) return;

      const apiCheck = checkApiVsMdd(mdd, project.apiContractsContent ?? null);
      const infraCheck = checkInfraVsMdd(mdd, project.infraContent ?? null);
      const bpCheck = checkBlueprintVsMdd(mdd, project.blueprintContent ?? null);
      const lfCheck = checkLogicFlowsVsMdd(mdd, project.logicFlowsContent ?? null);
      if (apiCheck.ok && infraCheck.ok && bpCheck.ok && lfCheck.ok) return;

      this.logger.warn(
        `[Cascade] Conformance retry ${attempt + 1}/2 — API=${apiCheck.ok} BP=${bpCheck.ok} LF=${lfCheck.ok} Infra=${infraCheck.ok}`,
      );

      const retries: Promise<unknown>[] = [];
      if (!apiCheck.ok && (project.apiContractsContent ?? "").trim().length >= 80) {
        retries.push(
          this.projects.generateApiContracts(projectId, buildApiRetryFeedback(apiCheck)).catch((e) =>
            this.logger.warn(`[Cascade] API conformance retry: ${e instanceof Error ? e.message : e}`),
          ),
        );
      } else if (!apiCheck.ok) {
        retries.push(
          this.projects.generateApiContracts(projectId).catch((e) =>
            this.logger.warn(`[Cascade] API regen: ${e instanceof Error ? e.message : e}`),
          ),
        );
      }
      if (!bpCheck.ok && (project.blueprintContent ?? "").trim().length >= 80) {
        retries.push(
          this.projects.generateBlueprint(projectId, bpCheck.gaps.slice(0, 12).join("; ")).catch((e) =>
            this.logger.warn(`[Cascade] Blueprint conformance retry: ${e instanceof Error ? e.message : e}`),
          ),
        );
      }
      if (!lfCheck.ok && (project.logicFlowsContent ?? "").trim().length >= 80) {
        retries.push(
          this.projects.generateLogicFlows(projectId, lfCheck.gaps.slice(0, 12).join("; ")).catch((e) =>
            this.logger.warn(`[Cascade] Flujos conformance retry: ${e instanceof Error ? e.message : e}`),
          ),
        );
      }
      if (!infraCheck.ok && (project.infraContent ?? "").trim().length > 80) {
        const feedback = buildInfraConformanceGapFeedback(infraCheck.gaps);
        retries.push(
          this.projects.generateInfra(projectId, feedback).catch((e) =>
            this.logger.warn(`[Cascade] Infra conformance retry: ${e instanceof Error ? e.message : e}`),
          ),
        );
      }
      if (retries.length === 0) return;
      await Promise.allSettled(retries);
    }
  }

  /**
   * Ciclo verify → reparación/regen dirigida → verify (máx. 3 iteraciones).
   * Cierra gaps auto-fixables y dispara regeneración LLM por artefacto.
   */
  async repairReadinessGaps(projectId: string, options?: { signal?: AbortSignal }) {
    await this.runCascadeConvergenceLoop(projectId, options?.signal);
    if (options?.signal?.aborted) throw new Error("Cancelado por el usuario");
    await this.projects.refreshStageSemaphoreFromProject(projectId).catch(() => undefined);
    return this.projects.findOne(projectId);
  }

  private async runCascadeConvergenceLoop(projectId: string, signal?: AbortSignal): Promise<void> {
    const MAX_ITERATIONS = 3;
    const GAP_TOLERANCE = 5;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (signal?.aborted) throw new Error("Cancelado por el usuario");
      const project = await this.projects.findOne(projectId);
      const complexity = project.complexity ?? ComplexityLevel.HIGH;
      const stage = pickPrimaryStage(project.stages ?? []);
      const mdd = buildConstitutionMarkdown(project);
      const source = {
        ...project,
        brdContent: stage?.brdContent ?? null,
        dbgaContent: project.dbgaContent ?? null,
        domainInventory: stage?.domainInventory ?? null,
      };

      const useLowMedium =
        complexity === ComplexityLevel.LOW || complexity === ComplexityLevel.MEDIUM;

      let gaps: string[];
      if (useLowMedium) {
        gaps = collectLowMediumReadinessGaps(complexity, source);
      } else {
        if (!mdd.trim()) return;
        gaps = collectConformanceGaps(this.conformance, mdd, source);
      }

      if (gaps.length <= GAP_TOLERANCE) {
        this.logger.log(`[Cascade] Convergence OK en iteración ${iteration + 1}/${MAX_ITERATIONS} (${gaps.length} gap(s) ≤ tolerancia ${GAP_TOLERANCE})`);
        return;
      }

      const plan = buildConvergenceRetryPlan(gaps);
      if (!plan.autoRepairMdd && plan.deliverables.length === 0) {
        this.logger.debug(
          `[Cascade] Convergence detenida — ${gaps.length} gap(s) requieren HITL o sin plan`,
        );
        return;
      }

      this.logger.warn(
        `[Cascade] Convergence iter ${iteration + 1}/${MAX_ITERATIONS}: ${gaps.length} gap(s), plan=${plan.deliverables.join(",") || "mdd-repair"}`,
      );

      if (!useLowMedium && plan.autoRepairMdd && stage?.id) {
        const inventory = resolveDomainInventory({
          persisted: stage?.domainInventory as DomainInventory | null | undefined,
          brdMarkdown: stage?.brdContent,
          dbgaMarkdown: project.dbgaContent,
          mddMarkdown: mdd,
        });
        const repaired = applyDeterministicMddRepairs(mdd, {
          brdMarkdown: stage.brdContent,
          dbgaMarkdown: project.dbgaContent,
          inventory,
          specMarkdown: project.specContent,
        });
        if (repaired.changed) {
          await this.prisma.stage.update({
            where: { id: stage.id },
            data: { mddContent: storeMddMarkdownForPersist(repaired.markdown) },
          });
          await this.projects.refreshStageSemaphoreFromProject(projectId).catch(() => undefined);
        }
      }

      const regenSteps = orderConvergenceDeliverables(
        [...new Set(plan.deliverables)].filter(
          (s) => s !== "mdd_canonical" && s !== "ui_screens_sync",
        ),
      );

      for (const step of regenSteps) {
        if (signal?.aborted) throw new Error("Cancelado por el usuario");
        const feedback =
          buildConvergenceFeedbackForDeliverable(gaps, step) || plan.feedback || undefined;
        await this.projects
          .generateDocument(step as DeliverableKind, projectId, {
            gapsFeedback: feedback,
          })
          .catch((e) =>
            this.logger.warn(
              `[Cascade] Convergence regen ${step}: ${e instanceof Error ? e.message : e}`,
            ),
          );
        await this.runCascadeDeterministicConformancePass(projectId);
      }
      if (signal?.aborted) throw new Error("Cancelado por el usuario");
    }
  }
}
