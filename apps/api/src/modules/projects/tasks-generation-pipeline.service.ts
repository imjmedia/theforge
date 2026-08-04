import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  tasksGenerationPlanSchema,
  tasksLlmAuditorOutputSchema,
  TASKS_LLM_AUDITOR_PASS_THRESHOLD,
  type TasksGenerationLayer,
  type TasksGenerationPlan,
  type TasksContractManifest,
  type TasksLlmAuditorOutput,
  type TasksPipelineProgress,
  type TasksPipelineQualitySnapshot,
} from "@theforge/shared-types";
import type { DomainInventory } from "@theforge/shared-types";
import type { z } from "zod";
import { resolveLlmMaxTokensForPurpose } from "../ai/config/llm-config.js";
import { AiService, type LegacyGenerateOptions } from "../ai/ai.service.js";
import {
  TASKS_AUDITOR_LLM_PROMPT,
  TASKS_PLANNER_PROMPT,
  TASKS_REPAIR_PROMPT,
} from "../ai/prompts/tasks-pipeline-prompts.js";
import { extractFirstJsonObject, parseJsonOrThrow } from "../ai-analysis/utils/parse-json.js";
import {
  evaluateTasksGenerationQuality,
  type TasksQualityReport,
} from "./tasks-generation-quality.util.js";
import { runTasksPreflightStrict } from "./tasks-preflight.util.js";
import { buildHeuristicTasksPlan, type HeuristicTasksPlanInput } from "./tasks-heuristic-plan.util.js";
import { buildSlimTasksPlannerContext } from "./tasks-planner-context.util.js";
import { mergeTasksPlanWithCoverageFloor } from "./tasks-plan-merge.util.js";
import { partitionTasksPlanByJourney } from "./tasks-journey-partition.util.js";
import { extractHttpEndpointsFromMarkdown } from "../ui-mcp/api-contract-endpoints.util.js";
import { extractPantallaRoutes } from "./tasks-generation-structure.util.js";
import {
  buildTasksCoverageChecklist,
  serializeTasksCoverageChecklist,
} from "./tasks-coverage-checklist.util.js";
import { isTasksDocumentTruncated } from "./tasks-generation-structure.util.js";
import {
  composeTasksRedactorRetryFeedback,
  composeTasksRepairFeedbackLines,
  summarizeTasksRepairAttempt,
  type TasksRedactorRetryFeedback,
} from "./tasks-generation-repair-feedback.util.js";
import {
  mapWithConcurrency,
  resolveTasksPipelineMaxRepairs,
  resolveTasksRedactorBatchSize,
  resolveTasksRedactorConcurrency,
  resolveTasksRepairStagnantDelta,
} from "./tasks-pipeline-tuning.util.js";
import {
  extractTasksContractManifest,
  type TasksContractExtractionInput,
} from "./tasks-contract-layers.util.js";
import {
  buildTasksContextAnchors,
  partitionPlanItemsByGenerationLayer,
  selectContextAnchorsForPlanItems,
  TASKS_GENERATION_LAYER_ORDER,
} from "./tasks-context-anchor.util.js";
import {
  buildTasksLayerPromptContext,
  buildTasksPlannerContractContext,
} from "./tasks-layer-context.util.js";

export type TasksPipelineInput = {
  mddMarkdown: string;
  blueprintMarkdown?: string | null;
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  inventory?: DomainInventory | null;
  gapsFeedback?: string | null;
  hasUxTeam?: boolean;
  legacyBaselineStage?: boolean;
  acknowledgeGaps?: boolean;
  taskOpts: LegacyGenerateOptions & {
    navigationMap?: string;
    specContent?: string | null;
    useCasesContent?: string | null;
    userStoriesContent?: string | null;
    apiContractsContent?: string | null;
    logicFlowsContent?: string | null;
    infraContent?: string | null;
    architectureContent?: string | null;
    uxUiGuideContent?: string | null;
    uiScreensContent?: string | null;
    fileCoordinatesContext?: string | null;
    coordinatesMode?: boolean;
  };
  onProgress?: (progress: TasksPipelineProgress) => void;
};

export type TasksPipelineResult = {
  tasksMarkdown: string;
  quality: TasksQualityReport;
  llmAuditor: TasksLlmAuditorOutput | null;
  plan: TasksGenerationPlan | null;
  snapshot: TasksPipelineQualitySnapshot;
};

@Injectable()
export class TasksGenerationPipelineService {
  private readonly logger = new Logger(TasksGenerationPipelineService.name);

  constructor(private readonly ai: AiService) {}

  private reportProgress(input: TasksPipelineInput, progress: TasksPipelineProgress): void {
    input.onProgress?.(progress);
  }

  async run(input: TasksPipelineInput): Promise<TasksPipelineResult> {
    const preflight = await runTasksPreflightStrict({
      mddMarkdown: input.mddMarkdown,
      brdMarkdown: input.brdMarkdown,
      dbgaMarkdown: input.dbgaMarkdown,
      blueprintMarkdown: input.blueprintMarkdown,
      specMarkdown: input.taskOpts.specContent,
      apiContractsMarkdown: input.taskOpts.apiContractsContent,
      hasUxTeam: input.hasUxTeam,
      uiScreensMarkdown: input.taskOpts.uiScreensContent,
      logicFlowsMarkdown: input.taskOpts.logicFlowsContent,
      inventory: input.inventory,
      legacyBaselineStage: input.legacyBaselineStage,
      acknowledgeGaps: input.acknowledgeGaps,
    });
    if (!preflight.ok) {
      throw new BadRequestException({
        code: "TASKS_PREFLIGHT_BLOCKED",
        message: preflight.blockers.join(" "),
        blockers: preflight.blockers,
        upstreamHints: preflight.upstreamHints,
        docAccuracyScore: preflight.docAccuracyScore,
      });
    }
    for (const w of preflight.warnings) {
      this.logger.warn(`[Tasks pipeline] preflight warning: ${w}`);
    }
    if (preflight.upstreamHints?.length) {
      this.logger.warn(
        `[Tasks pipeline] upstream hints: ${preflight.upstreamHints.slice(0, 4).join(" | ")}`,
      );
    }

    const contractManifest = this.extractContractManifest(input);
    const contextAnchors = buildTasksContextAnchors(contractManifest);
    this.logger.log(
      `[Tasks pipeline] contratos: ${contractManifest.layers.length} capas, ${contextAnchors.length} context anchors`,
    );

    const plannerContext = this.buildPlannerContext(input, contractManifest);
    this.reportProgress(input, {
      phase: "planner",
      message: "Planificando cobertura Tasks (JSON)…",
    });
    const plan = await this.runPlanner(plannerContext, input);
    this.reportProgress(input, {
      phase: "planner",
      plannerItemCount: plan.items.length,
      message: `Plan listo: ${plan.items.length} ítems`,
    });
    const redactorMaxTokens = resolveLlmMaxTokensForPurpose("tasksDoc");
    this.logger.log(
      `[Tasks pipeline] plan ${plan.items.length} items → redactor max_tokens=${redactorMaxTokens} (global ceiling llm_max_tokens)`,
    );

    let tasksMarkdown = await this.runRedactor(plan, input, input.gapsFeedback, contractManifest, contextAnchors);

    this.reportProgress(input, {
      phase: "auditor",
      tasksLength: tasksMarkdown.length,
      message: "Auditando calidad estructural…",
    });
    let llmAuditor = await this.runLlmAuditor(tasksMarkdown, input);
    let quality = this.evaluateQuality(tasksMarkdown, input);
    let repairAttempts = 0;
    const isTruncated = isTasksDocumentTruncated(tasksMarkdown);
    const taskDeficitRatio = plan.items.length > 0 && quality.taskCount > 0
      ? quality.taskCount / plan.items.length
      : 1;
    let maxRepairs = resolveTasksPipelineMaxRepairs({
      truncated: isTruncated,
      taskDeficitRatio,
    });
    if (taskDeficitRatio < 0.5 && quality.taskCount > 0) {
      this.logger.warn(
        `[Tasks pipeline] task deficit: ${quality.taskCount}/${plan.items.length} (${Math.round(taskDeficitRatio * 100)}%) — allowing ${maxRepairs} repair attempts`,
      );
    }

    const repairHistory: string[] = [];
    let lastLlmScore = llmAuditor.score;
    const stagnantDelta = resolveTasksRepairStagnantDelta();

    while (
      repairAttempts < maxRepairs &&
      (!quality.ok || !llmAuditor.passed || llmAuditor.score < TASKS_LLM_AUDITOR_PASS_THRESHOLD)
    ) {
      repairAttempts += 1;
      const documentTruncated = isTasksDocumentTruncated(tasksMarkdown);
      this.logger.warn(
        `[Tasks pipeline] repair ${repairAttempts}/${maxRepairs} ` +
          `(det=${quality.score}, llm=${llmAuditor.score}, truncated=${documentTruncated})`,
      );
      const repairFeedbackLines = composeTasksRepairFeedbackLines(
        quality,
        llmAuditor,
        input.gapsFeedback,
      );
      const retryFeedback = composeTasksRedactorRetryFeedback({
        repairAttempt: repairAttempts,
        maxRepairs,
        repairFeedbackLines,
        llmAuditor,
        priorAttemptSummaries: repairHistory,
        documentTruncated,
      });
      repairHistory.push(summarizeTasksRepairAttempt(quality, llmAuditor));
      this.reportProgress(input, {
        phase: "repair",
        repairAttempt: repairAttempts,
        maxRepairs,
        message: `Regenerando Tasks (intento ${repairAttempts}/${maxRepairs})…`,
      });
      tasksMarkdown = await this.runRepair(tasksMarkdown, plan, retryFeedback, input, {
        documentTruncated,
        patchFeedbackLines: repairFeedbackLines,
        deterministicOk: quality.ok,
        llmOnlyFailure:
          quality.ok &&
          (!llmAuditor.passed || llmAuditor.score < TASKS_LLM_AUDITOR_PASS_THRESHOLD),
      }, contractManifest, contextAnchors);
      llmAuditor = await this.runLlmAuditor(tasksMarkdown, input);
      quality = this.evaluateQuality(tasksMarkdown, input);
      if (
        repairAttempts >= 2 &&
        llmAuditor.score <= lastLlmScore + stagnantDelta
      ) {
        this.logger.warn(
          `[Tasks pipeline] LLM auditor stagnant (${lastLlmScore} → ${llmAuditor.score}) — stopping repairs early`,
        );
        break;
      }
      lastLlmScore = llmAuditor.score;
      this.reportProgress(input, {
        phase: "auditor",
        repairAttempt: repairAttempts,
        tasksLength: tasksMarkdown.length,
        taskCount: quality.taskCount,
        message: `Auditoría tras reparación ${repairAttempts} (score det=${quality.score}, llm=${llmAuditor.score})`,
      });
    }

    const snapshot: TasksPipelineQualitySnapshot = {
      deterministicScore: quality.score,
      taskAccuracyScore: quality.accuracyScore,
      auditScore: quality.auditScore,
      llmAuditorScore: llmAuditor.score,
      taskCount: quality.taskCount,
      plannerItemCount: plan.items.length,
      repairAttempts,
      passed:
        quality.ok &&
        llmAuditor.passed &&
        llmAuditor.score >= TASKS_LLM_AUDITOR_PASS_THRESHOLD,
      capturedAt: new Date().toISOString(),
    };

    if (!snapshot.passed) {
      const blockers = [
        quality.feedback,
        !quality.ok ? `deterministic score ${quality.score}` : null,
        llmAuditor.score < TASKS_LLM_AUDITOR_PASS_THRESHOLD
          ? `LLM auditor ${llmAuditor.score} < ${TASKS_LLM_AUDITOR_PASS_THRESHOLD}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      this.logger.warn(`[Tasks pipeline] blocked persist (${blockers})`);
      throw new BadRequestException({
        code: "TASKS_QUALITY_BLOCKED",
        message:
          "Tasks no cumple umbral de calidad estructural/determinístico/auditor. Regenera tras corregir upstream (pantallas, API, MDD).",
        snapshot,
        feedback: quality.feedback,
        llmAuditor,
      });
    }

    return {
      tasksMarkdown,
      quality,
      llmAuditor,
      plan,
      snapshot,
    };
  }

  private extractContractManifest(input: TasksPipelineInput): TasksContractManifest {
    const extraction: TasksContractExtractionInput = {
      mddMarkdown: input.mddMarkdown,
      brdMarkdown: input.brdMarkdown,
      dbgaMarkdown: input.dbgaMarkdown,
      specMarkdown: input.taskOpts.specContent,
      blueprintMarkdown: input.blueprintMarkdown,
      architectureMarkdown: input.taskOpts.architectureContent,
      infraMarkdown: input.taskOpts.infraContent,
      userStoriesMarkdown: input.taskOpts.userStoriesContent,
      useCasesMarkdown: input.taskOpts.useCasesContent,
      apiContractsMarkdown: input.taskOpts.apiContractsContent,
      logicFlowsMarkdown: input.taskOpts.logicFlowsContent,
      uxUiGuideMarkdown: input.taskOpts.uxUiGuideContent,
      uiScreensMarkdown: input.taskOpts.uiScreensContent,
    };
    return extractTasksContractManifest(extraction);
  }

  private buildPlannerContext(input: TasksPipelineInput, manifest: TasksContractManifest): string {
    return buildTasksPlannerContractContext({
      manifest,
      mddMarkdown: input.mddMarkdown,
      blueprintMarkdown: input.blueprintMarkdown,
    });
  }

  /** @deprecated Reservado como fallback legacy si el planner por contratos falla. */
  private buildPlannerContextLegacyDump(input: TasksPipelineInput): string {
    const parts: string[] = [
      "Genera el plan JSON de Tasks según el system prompt. " +
      "Cada fase/roadmap del blueprint debe generar al menos una sección de tasks con ítems por hito.",
      "\n\nMDD:\n---\n" + input.mddMarkdown.trim().slice(0, 40_000) + "\n---",
    ];
    const append = (label: string, content?: string | null, cap = 10_000) => {
      const t = (content ?? "").trim();
      if (t.length > 0) parts.push(`\n\n${label}:\n---\n` + t.slice(0, cap) + "\n---");
    };
    // Blueprint gets 40K chars — ForgeOps and similar projects have 8 phases across 17 sections
    append("Blueprint", input.blueprintMarkdown, 40_000);
    append("Spec", input.taskOpts.specContent, 15_000);
    append("Use Cases", input.taskOpts.useCasesContent, 10_000);
    append("User Stories", input.taskOpts.userStoriesContent, 10_000);
    append("API Contracts", input.taskOpts.apiContractsContent, 20_000);
    append("Logic Flows", input.taskOpts.logicFlowsContent, 12_000);
    append("Infra", input.taskOpts.infraContent, 10_000);
    append("Architecture", input.taskOpts.architectureContent, 12_000);
    if (input.taskOpts.uxUiGuideContent?.trim()) {
      append("UX Guide", input.taskOpts.uxUiGuideContent, 8_000);
    }
    append("Pantallas", input.taskOpts.uiScreensContent, 20_000);
    if (input.taskOpts.navigationMap?.trim()) {
      append("Navigation map", input.taskOpts.navigationMap, 8_000);
    }
    if (input.taskOpts.fileCoordinatesContext?.trim()) {
      parts.push("\n\n" + input.taskOpts.fileCoordinatesContext.trim().slice(0, 6_000));
    }
    return parts.join("");
  }

  /** Redacta tasks.md desde el plan; map-reduce por capa + lotes por journey/tamaño. */
  private async runRedactor(
    plan: TasksGenerationPlan,
    input: TasksPipelineInput,
    gapsFeedback?: string | null,
    manifest?: TasksContractManifest,
    contextAnchors?: ReturnType<typeof buildTasksContextAnchors>,
    tasksAuditorFeedback?: string | null,
  ): Promise<string> {
    const batchSize = resolveTasksRedactorBatchSize();
    const totalBatches = Math.max(1, Math.ceil(plan.items.length / batchSize));
    const journeyPartitions =
      (input.inventory?.processes?.length ?? 0) > 0
        ? partitionTasksPlanByJourney(plan, input.inventory)
        : null;

    if (journeyPartitions && journeyPartitions.length > 1) {
      this.logger.log(
        `[Tasks pipeline] redactor por journey: ${journeyPartitions.length} fases`,
      );
      const parts: string[] = [];
      for (let ji = 0; ji < journeyPartitions.length; ji++) {
        const partition = journeyPartitions[ji]!;
        const slicePlan: TasksGenerationPlan = {
          sections: plan.sections,
          items: partition.items,
        };
        const batchFeedback =
          ji === 0
            ? gapsFeedback
            : [
                gapsFeedback?.trim(),
                `Fase journey ${ji + 1}/${journeyPartitions.length}: «${partition.label}». ` +
                  `Cubre US: ${partition.storyRefs.join(", ") || "núcleo"}.`,
              ]
                .filter(Boolean)
                .join("\n\n");
        const chunk = await this.redactorSlice(
          slicePlan,
          input,
          batchFeedback,
          ji === 0,
          tasksAuditorFeedback,
          { batch: ji + 1, totalBatches: journeyPartitions.length },
          manifest,
          contextAnchors,
        );
        parts.push(chunk);
        const accumulated = parts.filter(Boolean).join("\n\n");
        this.reportProgress(input, {
          phase: "redactor",
          batch: ji + 1,
          totalBatches: journeyPartitions.length,
          tasksLength: accumulated.length,
          markdown: accumulated,
          message: `Redactando journey ${ji + 1}/${journeyPartitions.length}…`,
        });
      }
      return parts.filter(Boolean).join("\n\n");
    }

    return this.redactorSlice(plan, input, gapsFeedback, true, tasksAuditorFeedback, {
      batch: 1,
      totalBatches,
    }, manifest, contextAnchors);
  }

  private buildLayerContractContext(
    layer: TasksGenerationLayer,
    input: TasksPipelineInput,
    manifest: TasksContractManifest,
    anchors: ReturnType<typeof buildTasksContextAnchors>,
    planItems: TasksGenerationPlan["items"],
  ): string {
    return buildTasksLayerPromptContext({
      manifest,
      layer,
      anchors: selectContextAnchorsForPlanItems(anchors, planItems),
      mddMarkdown: input.mddMarkdown,
      specMarkdown: input.taskOpts.specContent,
      apiContractsMarkdown: input.taskOpts.apiContractsContent,
      blueprintMarkdown: input.blueprintMarkdown,
      infraMarkdown: input.taskOpts.infraContent,
      uxUiGuideMarkdown: input.taskOpts.uxUiGuideContent,
      uiScreensMarkdown: input.taskOpts.uiScreensContent,
      logicFlowsMarkdown: input.taskOpts.logicFlowsContent,
      useCasesMarkdown: input.taskOpts.useCasesContent,
      userStoriesMarkdown: input.taskOpts.userStoriesContent,
      architectureMarkdown: input.taskOpts.architectureContent,
    });
  }

  /** Map-reduce: un prompt por capa (Backend / Frontend / Infra / QA / Integración). */
  private async redactorMapReduceByLayer(
    plan: TasksGenerationPlan,
    input: TasksPipelineInput,
    gapsFeedback: string | null | undefined,
    isFirstChunk: boolean,
    tasksAuditorFeedback: string | null | undefined,
    manifest: TasksContractManifest,
    contextAnchors: ReturnType<typeof buildTasksContextAnchors>,
  ): Promise<string> {
    const byLayer = partitionPlanItemsByGenerationLayer(plan.items);
    const parts: string[] = [];
    let layerIndex = 0;

    for (const layer of TASKS_GENERATION_LAYER_ORDER) {
      const layerItems = byLayer.get(layer);
      if (!layerItems?.length) continue;
      layerIndex += 1;
      const slicePlan: TasksGenerationPlan = { sections: plan.sections, items: layerItems };
      const contractContext = this.buildLayerContractContext(
        layer,
        input,
        manifest,
        contextAnchors,
        layerItems,
      );

      this.reportProgress(input, {
        phase: "redactor",
        batch: layerIndex,
        totalBatches: byLayer.size,
        message: `Redactando capa ${layer} (${layerItems.length} ítems)…`,
      });

      const chunk = await this.ai.generateTasks(input.mddMarkdown, input.blueprintMarkdown ?? null, {
        ...input.taskOpts,
        tasksPlanJson: JSON.stringify(slicePlan, null, 2),
        tasksContractContext: contractContext,
        tasksGenerationLayer: layer,
        gapsFeedback:
          layerIndex === 1
            ? gapsFeedback
            : [
                gapsFeedback?.trim(),
                `Continúa documento Tasks — sección ## ${layer} tasks. No repitas título # Tasks ni secciones ya generadas.`,
              ]
                .filter(Boolean)
                .join("\n\n"),
        tasksAuditorFeedback: layerIndex === 1 ? tasksAuditorFeedback : undefined,
      });

      const trimmed = chunk.trim();
      const normalized =
        layerIndex === 1 && isFirstChunk
          ? trimmed
          : trimmed.replace(/^#\s*Tasks\s*\n+/im, "").trim();
      if (normalized) parts.push(normalized);
    }

    return parts.join("\n\n");
  }

  private buildRedactorGenerateOptions(
    input: TasksPipelineInput,
    plan: TasksGenerationPlan,
    opts: {
      gapsFeedback?: string | null;
      tasksAuditorFeedback?: string | null;
      manifest?: TasksContractManifest;
      contextAnchors?: ReturnType<typeof buildTasksContextAnchors>;
      layer?: TasksGenerationLayer;
    },
  ): Parameters<AiService["generateTasks"]>[2] {
    const base = {
      ...input.taskOpts,
      tasksPlanJson: JSON.stringify(plan, null, 2),
      gapsFeedback: opts.gapsFeedback,
      tasksAuditorFeedback: opts.tasksAuditorFeedback,
    };
    if (opts.manifest && opts.layer) {
      return {
        ...base,
        tasksContractContext: this.buildLayerContractContext(
          opts.layer,
          input,
          opts.manifest,
          opts.contextAnchors ?? [],
          plan.items,
        ),
        tasksGenerationLayer: opts.layer,
      };
    }
    if (opts.manifest && opts.contextAnchors) {
      const layerItems = plan.items;
      const layer = normalizeSingleLayer(layerItems);
      if (layer) {
        return {
          ...base,
          tasksContractContext: this.buildLayerContractContext(
            layer,
            input,
            opts.manifest,
            opts.contextAnchors,
            layerItems,
          ),
          tasksGenerationLayer: layer,
        };
      }
    }
    return base;
  }

  private async redactorSlice(
    plan: TasksGenerationPlan,
    input: TasksPipelineInput,
    gapsFeedback?: string | null,
    isFirstChunk = true,
    tasksAuditorFeedback?: string | null,
    batchInfo?: { batch: number; totalBatches: number },
    manifest?: TasksContractManifest,
    contextAnchors?: ReturnType<typeof buildTasksContextAnchors>,
  ): Promise<string> {
    if (manifest && contextAnchors && plan.items.length > 0) {
      const byLayer = partitionPlanItemsByGenerationLayer(plan.items);
      if (byLayer.size > 1) {
        return this.redactorMapReduceByLayer(
          plan,
          input,
          gapsFeedback,
          isFirstChunk,
          tasksAuditorFeedback,
          manifest,
          contextAnchors,
        );
      }
    }
    const batchSize = resolveTasksRedactorBatchSize();
    const totalBatches =
      batchInfo?.totalBatches ??
      Math.max(1, Math.ceil(plan.items.length / batchSize));
    if (plan.items.length <= batchSize) {
      this.reportProgress(input, {
        phase: "redactor",
        batch: batchInfo?.batch ?? 1,
        totalBatches,
        message: `Redactando lote ${batchInfo?.batch ?? 1}/${totalBatches}…`,
      });
      const chunk = await this.ai.generateTasks(
        input.mddMarkdown,
        input.blueprintMarkdown ?? null,
        this.buildRedactorGenerateOptions(input, plan, {
          gapsFeedback,
          tasksAuditorFeedback,
          manifest,
          contextAnchors,
        }),
      );
      const trimmed = isFirstChunk ? chunk.trim() : chunk.trim().replace(/^#\s*Tasks\s*\n+/im, "").trim();
      this.reportProgress(input, {
        phase: "redactor",
        batch: batchInfo?.batch ?? 1,
        totalBatches,
        tasksLength: trimmed.length,
        markdown: trimmed,
        message: `Lote ${batchInfo?.batch ?? 1}/${totalBatches} redactado`,
      });
      return trimmed;
    }

    this.logger.log(
      `[Tasks pipeline] redactor en lotes: ${plan.items.length} ítems, batch=${batchSize}, concurrency=${resolveTasksRedactorConcurrency()}`,
    );

    const batchTotal = Math.ceil(plan.items.length / batchSize);
    const batchOffsets = Array.from(
      { length: batchTotal },
      (_, i) => i * batchSize,
    );
    const concurrency = resolveTasksRedactorConcurrency();

    const parts = await mapWithConcurrency(batchOffsets, concurrency, async (offset, batchIndex) => {
      const sliceItems = plan.items.slice(offset, offset + batchSize);
      const slicePlan: TasksGenerationPlan = { sections: plan.sections, items: sliceItems };
      const batchNumber = batchIndex + 1;
      this.reportProgress(input, {
        phase: "redactor",
        batch: batchNumber,
        totalBatches: batchTotal,
        message: `Redactando lote ${batchNumber}/${batchTotal} (${sliceItems[0]!.id}…)…`,
      });
      const batchFeedback =
        offset === 0
          ? gapsFeedback
          : [
              gapsFeedback?.trim(),
              `Lote ${batchNumber}/${batchTotal} del plan Tasks. Continúa desde ${sliceItems[0]!.id}. ` +
                "No repitas el título # Tasks ni secciones H2 ya generadas en lotes anteriores.",
            ]
              .filter(Boolean)
              .join("\n\n");

      const chunk = await this.ai.generateTasks(
        input.mddMarkdown,
        input.blueprintMarkdown ?? null,
        this.buildRedactorGenerateOptions(input, slicePlan, {
          gapsFeedback: batchFeedback,
          tasksAuditorFeedback: offset === 0 ? tasksAuditorFeedback : undefined,
          manifest,
          contextAnchors,
        }),
      );
      const trimmed = chunk.trim();
      const normalized =
        offset === 0 && isFirstChunk
          ? trimmed
          : trimmed.replace(/^#\s*Tasks\s*\n+/im, "").trim();
      return normalized;
    });

    let accumulated = "";
    for (let i = 0; i < parts.length; i += 1) {
      accumulated = [...parts.slice(0, i + 1)].filter(Boolean).join("\n\n");
      this.reportProgress(input, {
        phase: "redactor",
        batch: i + 1,
        totalBatches: batchTotal,
        tasksLength: accumulated.length,
        markdown: accumulated,
        message: `Lote ${i + 1}/${batchTotal} redactado`,
      });
    }
    return parts.filter(Boolean).join("\n\n");
  }

  private heuristicPlanInput(input: TasksPipelineInput): HeuristicTasksPlanInput {
    return {
      mddMarkdown: input.mddMarkdown,
      apiContractsMarkdown: input.taskOpts.apiContractsContent,
      uiScreensMarkdown: input.taskOpts.uiScreensContent,
      inventory: input.inventory,
      hasUxTeam: input.hasUxTeam,
      blueprintMarkdown: input.blueprintMarkdown,
    };
  }

  /** Expande plan LLM con piso heurístico (API, pantallas, entidades, infra, QA). */
  private expandPlanWithCoverageFloor(
    plan: TasksGenerationPlan,
    input: TasksPipelineInput,
  ): TasksGenerationPlan {
    const floor = buildHeuristicTasksPlan(this.heuristicPlanInput(input));
    const merged = mergeTasksPlanWithCoverageFloor(plan, floor);
    if (merged.items.length > plan.items.length) {
      this.logger.warn(
        `[Tasks pipeline] plan LLM ${plan.items.length} → ${merged.items.length} ítems tras piso heurístico`,
      );
    }
    return merged;
  }

  private async runPlanner(context: string, input: TasksPipelineInput): Promise<TasksGenerationPlan> {
    const heuristicFallback = () =>
      buildHeuristicTasksPlan(this.heuristicPlanInput(input));

    const contexts: Array<{ label: string; prompt: string }> = [
      { label: "contracts", prompt: context },
      {
        label: "slim",
        prompt: buildSlimTasksPlannerContext(
          {
            mddMarkdown: input.mddMarkdown,
            blueprintMarkdown: input.blueprintMarkdown,
            taskOpts: input.taskOpts,
          },
          input.inventory,
        ),
      },
      { label: "legacy-dump", prompt: this.buildPlannerContextLegacyDump(input) },
    ];

    for (const { label, prompt } of contexts) {
      const parsed = await this.tryCallAuditorJson({
        step: "planner",
        prompt,
        systemPrompt: TASKS_PLANNER_PROMPT,
        schema: tasksGenerationPlanSchema,
        maxTokensPurpose: "tasksPlanner",
        abortSignal: input.taskOpts.abortSignal,
      });
      if (parsed) {
        let plan: TasksGenerationPlan = {
          sections: parsed.sections ?? [],
          items: parsed.items.map((item) => ({
            ...item,
            mddRefs: item.mddRefs ?? [],
            storyRefs: item.storyRefs ?? [],
            upstreamRefs: item.upstreamRefs ?? [],
            dependsOn: item.dependsOn ?? [],
            targetFilesHint: item.targetFilesHint ?? [],
          })),
        };
        plan = this.expandPlanWithCoverageFloor(plan, input);
        try {
          this.validatePlanCompleteness(plan, input);
          this.logger.log(`[Tasks pipeline] planner OK (${label}, ${plan.items.length} items)`);
          return plan;
        } catch (validationErr) {
          this.logger.warn(`[Tasks pipeline] planner plan rechazado (${label}): ${(validationErr as Error).message}`);
        }
      }
      this.logger.warn(`[Tasks pipeline] planner JSON failed (${label})`);
    }

    const heuristic = heuristicFallback();
    this.logger.warn(
      `[Tasks pipeline] planner heuristic fallback (${heuristic.items.length} items) — revisa auditorChatModel o upstream`,
    );
    return heuristic;
  }

  /**
   * Valida que el plan cubra todas las fases/roadmap del blueprint.
   * Si el blueprint tiene 8 fases pero el plan solo cubre 3, rechaza el plan
   * para forzar reintentos con el planner o el fallback heurístico.
   */
  private validatePlanCompleteness(plan: TasksGenerationPlan, input: TasksPipelineInput): void {
    const endpoints = extractHttpEndpointsFromMarkdown(input.taskOpts.apiContractsContent ?? "");
    if (endpoints.length >= 2) {
      const covered = endpoints.filter((ep) =>
        plan.items.some((item) =>
          item.upstreamRefs.some(
            (ref) =>
              ref === `api-contracts:${ep.method} ${ep.path}` ||
              ref.toLowerCase().includes(ep.path.toLowerCase()),
          ),
        ),
      );
      if (covered.length < endpoints.length) {
        throw new BadRequestException({
          code: "TASKS_PLAN_MISSING_ENDPOINTS",
          message: `Plan incompleto: ${covered.length}/${endpoints.length} endpoints de api-contracts.`,
          endpointCount: endpoints.length,
          coveredEndpoints: covered.length,
          planItemCount: plan.items.length,
        });
      }
    }

    const routes = extractPantallaRoutes(input.taskOpts.uiScreensContent ?? "").filter(
      (r) => !/\/admin\/proc-cap/i.test(r),
    );
    if (routes.length >= 1) {
      const coveredRoutes = routes.filter((route) =>
        plan.items.some(
          (item) =>
            item.layer === "Frontend" &&
            (item.upstreamRefs.some((ref) => ref === `pantallas:${route}`) ||
              item.title.includes(route)),
        ),
      );
      if (coveredRoutes.length < routes.length) {
        throw new BadRequestException({
          code: "TASKS_PLAN_MISSING_ROUTES",
          message: `Plan incompleto: ${coveredRoutes.length}/${routes.length} rutas de pantallas.md.`,
          routeCount: routes.length,
          coveredRoutes: coveredRoutes.length,
          planItemCount: plan.items.length,
        });
      }
    }

    const blueprint = (input.blueprintMarkdown ?? "").trim();
    if (blueprint.length < 200) return; // No hay blueprint significativo

    // Extract phase/roadmap headings from blueprint
    const phaseRegex = /^##\s+(?:(?:Fase|Phase|Roadmap|Milestone|Sprint|Hitos|Etapa)\s+\d+[^#\n]*)/gim;
    const phaseMatches = [...blueprint.matchAll(phaseRegex)];

    if (phaseMatches.length <= 1) return; // No hay múltiples fases detectables

    const phaseCount = phaseMatches.length;
    const planItemCount = plan.items.length;

    // Heuristic: each phase should generate at least 5 tasks (backend + frontend + test + infra + doc)
    const minExpectedTasks = phaseCount * 5;
    if (planItemCount < minExpectedTasks) {
      this.logger.warn(
        `[Tasks pipeline] plan incompleto: blueprint tiene ${phaseCount} fases (~${phaseMatches.map((m) => m[0]?.trim()).join(", ")}) ` +
        `pero plan solo tiene ${planItemCount} items (mínimo esperado: ${minExpectedTasks}). ` +
        `Falling back to heuristic plan.`,
      );
      throw new BadRequestException({
        code: "TASKS_PLAN_TOO_SMALL",
        message: `Plan demasiado pequeño: ${planItemCount} items vs ${minExpectedTasks} esperados para ${phaseCount} fases del blueprint.`,
        phaseCount,
        coveredPhases: 0,
        planItemCount,
      });
    }

    // Check if plan covers at least 50% of blueprint phases
    // Extract phase keywords from blueprint headings
    const blueprintPhaseKeywords = phaseMatches.map((m) => {
      const heading = m[0]?.trim() ?? "";
      // Extract meaningful words from heading (e.g., "Fase 1" → ["fase", "1"], "Hitos de seguridad" → ["seguridad"])
      return heading.toLowerCase().replace(/^##\s+/, "").split(/\s+/);
    });

    // Check how many blueprint phases are referenced in plan items
    let coveredPhases = 0;
    for (const keywords of blueprintPhaseKeywords) {
      const isCovered = plan.items.some((item) => {
        const itemText = `${item.title} ${item.upstreamRefs.join(" ")}`.toLowerCase();
        return keywords.some((kw) => kw.length > 2 && itemText.includes(kw));
      });
      if (isCovered) coveredPhases += 1;
    }

    const coverageRatio = blueprintPhaseKeywords.length > 0
      ? coveredPhases / blueprintPhaseKeywords.length
      : 1;

    if (coverageRatio < 0.5) {
      throw new BadRequestException({
        code: "TASKS_PLAN_INCOMPLETE",
        message: `El plan solo cubre ${Math.round(coverageRatio * 100)}% de las fases del blueprint (${coveredPhases}/${blueprintPhaseKeywords.length}). Regenerar con cobertura completa.`,
        phaseCount,
        coveredPhases,
        planItemCount,
      });
    }

    // Log phase headings for traceability
    this.logger.log(
      `[Tasks pipeline] blueprint phases detectadas: ${phaseMatches.map((m) => m[0]?.trim()).join(" | ")}`,
    );
  }

  private buildAuditorUpstreamContext(input: TasksPipelineInput, tasksMarkdown: string): string {
    const append = (label: string, content?: string | null, cap = 8_000) => {
      const t = (content ?? "").trim();
      if (!t) return "";
      return `\n\n${label}:\n---\n${t.slice(0, cap)}\n---`;
    };
    const checklist = buildTasksCoverageChecklist({
      tasksMarkdown,
      apiContractsMarkdown: input.taskOpts.apiContractsContent,
      uiScreensMarkdown: input.taskOpts.uiScreensContent,
      mddMarkdown: input.mddMarkdown,
      infraMarkdown: input.taskOpts.infraContent,
    });
    return (
      append("API Contracts", input.taskOpts.apiContractsContent, 12_000) +
      append("Pantallas", input.taskOpts.uiScreensContent, 12_000) +
      append("User Stories", input.taskOpts.userStoriesContent, 6_000) +
      append("Use Cases", input.taskOpts.useCasesContent, 6_000) +
      `\n\nChecklist determinista (gaps conocidos):\n---\n${serializeTasksCoverageChecklist(checklist)}\n---`
    );
  }

  private async runLlmAuditor(
    tasksMarkdown: string,
    input: TasksPipelineInput,
  ): Promise<TasksLlmAuditorOutput> {
    const upstream = this.buildAuditorUpstreamContext(input, tasksMarkdown);
    const prompt =
      "Audita el siguiente tasks.md contra el MDD y upstream del contexto.\n\n" +
      "MDD (extracto):\n---\n" +
      input.mddMarkdown.trim().slice(0, 16_000) +
      "\n---\n\n" +
      upstream +
      "\n\ntasks.md:\n---\n" +
      tasksMarkdown.trim().slice(0, 24_000) +
      "\n---";
    const parsed = await this.callAuditorJson({
      step: "auditor",
      prompt,
      systemPrompt: TASKS_AUDITOR_LLM_PROMPT,
      schema: tasksLlmAuditorOutputSchema,
      maxTokensPurpose: "auditor",
      abortSignal: input.taskOpts.abortSignal,
    });
    const normalized: TasksLlmAuditorOutput = {
      score: parsed.score,
      passed: parsed.passed,
      missing_coverage: parsed.missing_coverage ?? [],
      conflicts: parsed.conflicts ?? [],
      traceability_gaps: parsed.traceability_gaps ?? [],
      dependency_issues: parsed.dependency_issues ?? [],
      executable_gaps: parsed.executable_gaps ?? [],
      feedback: parsed.feedback,
    };
    const passed =
      normalized.passed &&
      normalized.score >= TASKS_LLM_AUDITOR_PASS_THRESHOLD &&
      normalized.conflicts.length === 0 &&
      normalized.dependency_issues.length === 0;
    return { ...normalized, passed };
  }

  /**
   * LLM auditor/planner con reintento si el modelo no devuelve JSON parseable.
   * Devuelve null si agota reintentos (planner usa fallback heurístico).
   */
  private async tryCallAuditorJson<T>(params: {
    step: "planner" | "auditor";
    prompt: string;
    systemPrompt: string;
    schema: z.ZodType<T>;
    maxTokensPurpose: "tasksPlanner" | "auditor";
    abortSignal?: AbortSignal;
  }): Promise<T | null> {
    const maxTokens = resolveLlmMaxTokensForPurpose(params.maxTokensPurpose);
    const retrySuffix =
      "\n\nIMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido (JSON.parse). " +
      "Sin markdown, sin fences ```, sin texto antes ni después.";
    const prompts = [params.prompt, params.prompt + retrySuffix];

    for (let attempt = 0; attempt < prompts.length; attempt++) {
      if (params.abortSignal?.aborted) throw new Error("Cancelado por el usuario");
      const raw = await this.ai.generateAuditorResponse(prompts[attempt]!, [], {
        systemPrompt: params.systemPrompt,
        maxTokensOverride: maxTokens,
        jsonObjectMode: true,
        abortSignal: params.abortSignal,
      });
      if (!raw.trim()) {
        this.logger.warn(
          `[Tasks pipeline] ${params.step} empty response (attempt ${attempt + 1})`,
        );
        continue;
      }
      try {
        const jsonText = extractFirstJsonObject(raw) ?? raw.trim();
        return parseJsonOrThrow(jsonText, params.schema);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[Tasks pipeline] ${params.step} JSON parse failed (attempt ${attempt + 1}): ${detail}; preview=${raw.trim().slice(0, 120)}`,
        );
      }
    }
    return null;
  }

  /** Auditor LLM — fallo duro (no hay fallback determinista). */
  private async callAuditorJson<T>(params: {
    step: "planner" | "auditor";
    prompt: string;
    systemPrompt: string;
    schema: z.ZodType<T>;
    maxTokensPurpose: "tasksPlanner" | "auditor";
    abortSignal?: AbortSignal;
  }): Promise<T> {
    const parsed = await this.tryCallAuditorJson(params);
    if (parsed) return parsed;

    throw new BadRequestException({
      code:
        params.step === "planner"
          ? "TASKS_PLANNER_JSON_FAILED"
          : "TASKS_AUDITOR_JSON_FAILED",
      message:
        `Tasks ${params.step === "planner" ? "Planner" : "Auditor LLM"}: ` +
        "el modelo no devolvió JSON válido tras reintentos. Reintenta o cambia auditorChatModel.",
    });
  }

  /**
   * Reparación: regenera con el redactor principal (aprende del auditor).
   * Parche LLM solo como fallback si el redactor no devuelve markdown usable y el doc no está truncado.
   */
  private async runRepair(
    previousMarkdown: string,
    plan: TasksGenerationPlan,
    retryFeedback: TasksRedactorRetryFeedback,
    input: TasksPipelineInput,
    options: {
      documentTruncated: boolean;
      patchFeedbackLines: string;
      deterministicOk: boolean;
      llmOnlyFailure: boolean;
    },
    manifest?: TasksContractManifest,
    contextAnchors?: ReturnType<typeof buildTasksContextAnchors>,
  ): Promise<string> {
    const usePatchFirst =
      !options.documentTruncated &&
      options.deterministicOk &&
      options.llmOnlyFailure;

    if (usePatchFirst) {
      this.logger.log(
        "[Tasks pipeline] repair → patch agent (deterministic OK, solo fallo auditor LLM)",
      );
      const patched = await this.runPatchRepair(
        previousMarkdown,
        plan,
        options.patchFeedbackLines,
        input,
      );
      const looksLikeTasksDoc =
        patched.trim().startsWith("#") || patched.includes("## Backend");
      if (looksLikeTasksDoc) {
        return patched;
      }
      this.logger.warn(
        "[Tasks pipeline] patch repair unusable — falling back to redactor regenerate",
      );
    }

    this.logger.log(
      `[Tasks pipeline] repair → redactor regenerate (truncated=${options.documentTruncated})`,
    );

    const regenerated = await this.runRedactor(
      plan,
      input,
      retryFeedback.gapsFeedback,
      manifest,
      contextAnchors,
      retryFeedback.tasksAuditorFeedback,
    );

    const looksLikeTasksDoc =
      regenerated.trim().startsWith("#") || regenerated.includes("## Backend");

    if (looksLikeTasksDoc || options.documentTruncated) {
      return regenerated;
    }

    this.logger.warn(
      "[Tasks pipeline] redactor repair returned unusable output — falling back to patch agent",
    );
    return this.runPatchRepair(
      previousMarkdown,
      plan,
      options.patchFeedbackLines,
      input,
    );
  }

  /** Fallback: parche dirigido sobre el borrador anterior (solo si el redactor no produjo markdown válido). */
  private async runPatchRepair(
    tasksMarkdown: string,
    plan: TasksGenerationPlan,
    feedback: string,
    input: TasksPipelineInput,
  ): Promise<string> {
    const planJson = JSON.stringify(plan, null, 2);
    const upstream = this.buildAuditorUpstreamContext(input, tasksMarkdown);
    const prompt =
      "Repara el documento Tasks según gaps.\n\n" +
      "Plan JSON:\n---\n" +
      planJson +
      "\n---\n\n" +
      "Gaps:\n---\n" +
      feedback +
      "\n---\n\n" +
      upstream +
      "\n\ntasks.md actual:\n---\n" +
      tasksMarkdown.trim().slice(0, 22_000) +
      "\n---\n\n" +
      "MDD (referencia):\n---\n" +
      input.mddMarkdown.trim().slice(0, 10_000) +
      "\n---";
    const repaired = await this.ai.generateAuditorResponse(prompt, [], {
      systemPrompt: TASKS_REPAIR_PROMPT,
      maxTokensOverride: resolveLlmMaxTokensForPurpose("tasksDoc"),
      abortSignal: input.taskOpts.abortSignal,
    });
    const trimmed = repaired.trim();
    if (trimmed.startsWith("#") || trimmed.includes("## Backend")) {
      return trimmed;
    }
    return await this.runRedactor(plan, input, feedback, undefined);
  }

  private evaluateQuality(tasksMarkdown: string, input: TasksPipelineInput): TasksQualityReport {
    return evaluateTasksGenerationQuality({
      tasksMarkdown,
      mddMarkdown: input.mddMarkdown,
      brdMarkdown: input.brdMarkdown,
      dbgaMarkdown: input.dbgaMarkdown,
      inventory: input.inventory,
      uiScreensMarkdown: input.taskOpts.uiScreensContent,
      apiContractsMarkdown: input.taskOpts.apiContractsContent,
      infraMarkdown: input.taskOpts.infraContent,
      userStoriesMarkdown: input.taskOpts.userStoriesContent,
      blueprintMarkdown: input.blueprintMarkdown,
    });
  }
}

function normalizeSingleLayer(items: TasksGenerationPlan["items"]): TasksGenerationLayer | null {
  if (items.length === 0) return null;
  const layers = new Set(items.map((i) => i.layer));
  if (layers.size !== 1) return null;
  const only = [...layers][0] ?? "";
  if (/^frontend$/i.test(only)) return "Frontend";
  if (/^infra/i.test(only)) return "Infra";
  if (/^qa$/i.test(only)) return "QA";
  if (/integraci/i.test(only)) return "Integración";
  return "Backend";
}
