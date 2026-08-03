import { createHmac } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ComplexityLevel, Prisma } from "@theforge/database";
import {
  buildHandoffMicroSpecFiles,
  buildNextTaskDocumentLayout,
  buildOpenSpecChangeExport,
  buildSpecKitBundleFiles,
  checkBrdObjectiveMentionHealth,
  countClarificationMarkers,
  extractClarificationItems,
  type ClarifyDocumentBody,
  type ClarifyableDocumentField,
  type ResolveClarificationsBody,
  extractTaskCheckpoints,
  filterOpenTasks,
  getNextOpenTask,
  parseIntegrationHandoff,
  parseTasksMarkdown,
  readStageDeliverableSnapshot,
  getLegacyChangeState,
  sectionToIssueLabel,
  specHasPendingClarificationSection,
  specKitFeatureDir,
  type IntegrationHandoffItem,
  type NextTaskDocumentLayout,
  type SddAnalyzeReport,
  type SddAnalyzeStatus,
  type SpecKitBundleFile,
  type TasksToIssuesBody,
} from "@theforge/shared-types";
import type { Project, Stage } from "@theforge/database";
import { AiService } from "../ai/ai.service.js";
import { ConformanceService } from "../engine/conformance.service.js";
import {
  checkDeliverablePresence,
  checkSpecVsMdd,
  checkTasksCoverage,
  checkUserStoriesVsUseCases,
} from "../engine/sdd-cross-artifact.util.js";
import { collectSddPrecisionGaps } from "../engine/sdd-precision-checks.util.js";
import {
  checkPhase0BrdSpecBridge,
  formatPhase0BridgeGaps,
} from "../engine/phase0-brd-spec-bridge.util.js";
import { computeCascadeAccuracy } from "../engine/cascade-accuracy.util.js";
import { TheForgeService } from "../theforge/theforge.service.js";
import { CONVERGE_PROMPT } from "../ai/prompts/converge-prompt.js";
import { loadConsumptionGuideMarkdown } from "./consumption-guide.util.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import { pickPrimaryStage } from "./stage-helpers.js";
import { resolveStageDeliverables } from "./stage-deliverables.util.js";
import { persistStageAndProjectDeliverables } from "./stage-deliverable-persist.util.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import { validateDocumentForPersist } from "../sessions/document-shrink.util.js";
import { stampMarkdownIfBodyChanged } from "../engine/document-date-header.util.js";
import type { ClarifySpecBody, ConvergeTriggerBody, ProjectDeliverableSource } from "@theforge/shared-types";
import {
  buildClarifyContextDocs,
  clarifyDocumentFieldLabel,
  persistClarifyDocumentContent,
  readClarifyDocumentContent,
} from "./document-clarify.util.js";
import {
  analyzeAgentGovernanceSlice,
  buildProjectDeliverableExportInput,
  buildUnifiedHandoff,
  enrichSpecKitFilesForHandoff,
  scaffoldToRepoHandoffGovernance,
  synthesizeExportGovernanceScaffold,
} from "./handoff-export.util.js";
import { parseTasksV2 } from "../engine/task-v2/tasks-parser-v2.js";
import { resolveProjectTasksSsot, type ProjectTasksSsot } from "./tasks-ssot-resolve.util.js";

type ProjectWithStages = Project & {
  stages: Array<Stage & { estimation?: unknown }>;
};

export interface ConvergeResult {
  featureDir: string;
  openTaskCount: number;
  conformanceGaps: string[];
  codebaseEvidence: string | null;
  convergeSection: string;
  suggestedTasksMarkdown: string;
  persisted: boolean;
}

export interface TasksToIssuesResult {
  dryRun: boolean;
  planned: Array<{ title: string; labels: string[]; body: string }>;
  created: Array<{ number: number; html_url: string; title: string }>;
  errors: string[];
}

export interface ClarifySpecResult {
  clarifiedSpec: string;
  clarificationMarkerCount: number;
  persisted: boolean;
  mddSyncQueued?: boolean;
}

export interface ClarifyDocumentResult {
  field: ClarifyableDocumentField;
  clarifiedContent: string;
  clarificationMarkerCount: number;
  pendingItems: ReturnType<typeof extractClarificationItems>;
  persisted: boolean;
  mddSyncQueued?: boolean;
}

export interface ResolveClarificationsResult {
  field: ClarifyableDocumentField;
  resolvedContent: string;
  clarificationMarkerCount: number;
  persisted: boolean;
}

export interface RepoHandoffExport {
  featureDir: string;
  projectName: string;
  specKitFiles: SpecKitBundleFile[];
  agentGovernance: {
    present: boolean;
    files: Array<{ path: string; content: string }>;
    manifest?: Record<string, unknown>;
  };
}

@Injectable()
export class SddIntegrationService {
  private readonly logger = new Logger(SddIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conformance: ConformanceService,
    private readonly ai: AiService,
    private readonly theforge: TheForgeService,
  ) {}

  /** Cuando REQUIRE_DOC_ACCURACY_90=true, bloquea export SpecKit / handoff si scores &lt; 90. */
  private async assertCascadeAccuracyHardGate(
    project: ProjectWithStages,
    stage: Stage | null | undefined,
  ): Promise<void> {
    if (process.env.REQUIRE_DOC_ACCURACY_90 !== "true") return;
    const deliverables = stage
      ? resolveStageDeliverables(project, stage, "analyze").deliverables
      : project;
    const report = computeCascadeAccuracy({
      brdMarkdown: stage?.brdContent,
      dbgaMarkdown: project.dbgaContent,
      mddMarkdown: stage?.mddContent ?? "",
      specMarkdown: deliverables.specContent ?? project.specContent,
      apiContractsMarkdown: deliverables.apiContractsContent ?? project.apiContractsContent,
      logicFlowsMarkdown: deliverables.logicFlowsContent ?? project.logicFlowsContent,
      uiScreensMarkdown: deliverables.uiScreensContent ?? project.uiScreensContent,
      tasksMarkdown: deliverables.tasksContent ?? project.tasksContent,
    });
    if (!report.hardGateBlocked) return;
    throw new ConflictException({
      code: "ERR_DOC_ACCURACY_HARD_GATE",
      message: `Exactitud insuficiente para export (docs ${report.doc.score}%, tasks ${report.tasks.score}%; umbral 90).`,
      accuracy: {
        docScore: report.doc.score,
        taskScore: report.tasks.score,
        topGaps: [
          ...report.doc.components.flatMap((c) => c.gaps),
          ...report.tasks.components.flatMap((c) => c.gaps),
        ].slice(0, 12),
      },
    });
  }

  buildBundleForProject(project: ProjectWithStages, stageOverride?: Stage | null): SpecKitBundleFile[] {
    const stage = stageOverride ?? pickPrimaryStage(project.stages);
    const mdd = stage?.mddContent ?? "";
    const deliverables = stage
      ? resolveStageDeliverables(project, stage, "analyze").deliverables
      : project;
    const tasksSsot = resolveProjectTasksSsot({
      tasksContent: deliverables.tasksContent ?? project.tasksContent,
      tasksJson: project.tasksJson,
      stageTasksJson: stage?.tasksJson,
    });
    const spec = deliverables.specContent ?? project.specContent;
    const acceptanceLines = (spec ?? "")
      .split("\n")
      .filter((l) => /aceptación|acceptance|criterio/i.test(l))
      .slice(0, 12);
    return buildSpecKitBundleFiles({
      projectName: project.name,
      featureOrdinal: stage?.ordinal ?? 1,
      mddContent: mdd,
      specContent: spec,
      blueprintContent: deliverables.blueprintContent ?? project.blueprintContent,
      tasksContent: tasksSsot.markdown ?? deliverables.tasksContent ?? project.tasksContent,
      tasksJson: stage?.tasksJson ?? project.tasksJson,
      apiContractsContent: deliverables.apiContractsContent ?? project.apiContractsContent,
      logicFlowsContent: deliverables.logicFlowsContent ?? project.logicFlowsContent,
      infraContent: deliverables.infraContent ?? project.infraContent,
      phase0SummaryContent: project.phase0SummaryContent,
      dbgaContent: project.dbgaContent,
      uxUiGuideContent: deliverables.uxUiGuideContent ?? project.uxUiGuideContent,
      uiScreensContent: deliverables.uiScreensContent ?? project.uiScreensContent,
      architectureContent: deliverables.architectureContent ?? project.architectureContent,
      useCasesContent: deliverables.useCasesContent ?? project.useCasesContent,
      userStoriesContent: deliverables.userStoriesContent ?? project.userStoriesContent,
      consumptionGuideContent: loadConsumptionGuideMarkdown(
        specKitFeatureDir(stage?.ordinal ?? 1, project.name),
      ),
      changeSpecContent: stage?.changeSpecContent ?? null,
      acceptanceCriteriaLines: acceptanceLines.length ? acceptanceLines : null,
    });
  }

  async getExportBundle(projectId: string): Promise<{
    featureDir: string;
    projectName: string;
    files: SpecKitBundleFile[];
  }> {
    const project = await this.loadProject(projectId);
    const stage = pickPrimaryStage(project.stages);
    await this.assertCascadeAccuracyHardGate(project, stage);
    return {
      featureDir: specKitFeatureDir(stage?.ordinal ?? 1, project.name),
      projectName: project.name,
      files: this.buildBundleForProject(project, stage),
    };
  }

  /**
   * Bundle completo para "Llevar al repo": spec-kit + agent governance + IMPLEMENT.md + consumption guide.
   */
  async getRepoHandoffExport(projectId: string): Promise<RepoHandoffExport> {
    const project = await this.loadProject(projectId);
    const stage = pickPrimaryStage(project.stages);
    await this.assertCascadeAccuracyHardGate(project, stage);
    const unified = buildUnifiedHandoff(
      project,
      loadConsumptionGuideMarkdown(specKitFeatureDir(stage?.ordinal ?? 1, project.name)),
    );

    if (unified.governancePersisted && unified.serializedGovernance) {
      await this.prisma.project.update({
        where: { id: project.id },
        data: { agentGovernanceContent: unified.serializedGovernance },
      });
    }

    const handoffItems = this.readHandoffItemsForStage(project, stage);
    const legacyState = (stage?.legacyChangeState ?? null) as { description?: string } | null;
    const openSpecFiles =
      (stage?.ordinal ?? 1) >= 2
        ? buildOpenSpecChangeExport({
            stageOrdinal: stage?.ordinal ?? 1,
            projectName: project.name,
            changeSpecContent: stage?.changeSpecContent,
            legacyChangeDescription: legacyState?.description ?? null,
            handoffItems,
          })
        : [];
    const microSpecs = handoffItems.length ? buildHandoffMicroSpecFiles(handoffItems) : [];

    const deliverables = buildProjectDeliverableExportInput(project, stage);
    let agentGovernance = unified.agentGovernance;
    if (!agentGovernance) {
      agentGovernance = synthesizeExportGovernanceScaffold(project);
    }

    const specKitFiles = enrichSpecKitFilesForHandoff(unified.specKitFiles, deliverables, [
      ...openSpecFiles,
      ...microSpecs,
    ]);

    return {
      featureDir: unified.featureDir,
      projectName: unified.projectName,
      specKitFiles,
      agentGovernance: scaffoldToRepoHandoffGovernance(agentGovernance),
    };
  }

  private readHandoffItemsForStage(
    project: ProjectWithStages,
    stage: Stage | null | undefined,
  ): IntegrationHandoffItem[] {
    if (!stage || stage.ordinal < 2) return [];
    const snap = stage.handoffSnapshot as { items?: IntegrationHandoffItem[] } | null;
    if (snap?.items?.length) return snap.items;
    if (project.projectType === "NEW") {
      return parseIntegrationHandoff(project.integrationHandoff).items;
    }
    return [];
  }

  /**
   * Clarify Spec pre-MDD (`/speckit.clarify` equivalent). Works on specContent without full MDD pipeline.
   */
  async clarifySpec(projectId: string, body: ClarifySpecBody): Promise<ClarifySpecResult> {
    const project = await this.loadProject(projectId);
    const stage = pickPrimaryStage(project.stages);
    const deliverables = stage
      ? resolveStageDeliverables(project, stage, "analyze").deliverables
      : {};
    const spec = (deliverables.specContent ?? project.specContent ?? "").trim();
    const dbga = (project.dbgaContent ?? project.phase0SummaryContent ?? "").trim();
    const brd = (stage?.brdContent ?? "").trim();

    if (!spec && !dbga && !brd) {
      throw new BadRequestException(
        "Genera Spec, DBGA o BRD antes de ejecutar clarify-spec",
      );
    }

    const clarified = cleanDocumentContent(
      await this.ai.clarifySpec(spec, {
        dbgaContent: dbga || null,
        brdContent: brd || null,
        notes: body.notes ?? null,
      }),
    );
    const markerCount = countClarificationMarkers(clarified);
    let persisted = false;
    let mddSyncQueued = false;
    if (body.persist) {
      const validation = validateDocumentForPersist(spec, clarified, {
        fieldLabel: "Spec",
        minBodyChars: spec.length > 0 ? 80 : 120,
      });
      if (!validation.ok) {
        throw new BadRequestException(validation.message);
      }
      if (stage?.id) {
        await persistStageAndProjectDeliverables(this.prisma, stage.id, project.id, {
          specContent: clarified,
        });
      } else {
        await this.prisma.project.update({
          where: { id: project.id },
          data: { specContent: clarified },
        });
      }
      persisted = true;
    }

    if (body.syncMdd && persisted && markerCount === 0) {
      const stage = pickPrimaryStage(project.stages);
      if (stage?.mddContent?.trim()) {
        const syncNote =
          `\n\n<!-- clarify-spec-sync ${new Date().toISOString()} -->\n` +
          `> Spec aclarado sincronizado desde clarify-spec. Revisar ambigüedades resueltas.\n`;
        await this.prisma.stage.update({
          where: { id: stage.id },
          data: {
            mddContent: `${(stage.mddContent ?? "").trim()}${syncNote}`,
          },
        });
        mddSyncQueued = true;
      }
    }

    return {
      clarifiedSpec: clarified,
      clarificationMarkerCount: markerCount,
      persisted,
      mddSyncQueued,
    };
  }

  /**
   * Clarify any Workshop document — marks ambiguities with [NEEDS CLARIFICATION].
   */
  async clarifyDocument(projectId: string, body: ClarifyDocumentBody): Promise<ClarifyDocumentResult> {
    const project = await this.loadProject(projectId);
    const stage = this.resolveOptionalStage(project, body.stageId);
    const deliverables = stage
      ? resolveStageDeliverables(project, stage, "analyze").deliverables
      : {};
    const field = body.field;
    const fieldLabel = clarifyDocumentFieldLabel(field);
    const current = readClarifyDocumentContent(project, stage, deliverables, field);

    if (!current && field === "specContent") {
      const dbga = (project.dbgaContent ?? project.phase0SummaryContent ?? "").trim();
      const brd = (stage?.brdContent ?? "").trim();
      if (!dbga && !brd) {
        throw new BadRequestException(
          "Genera Spec, DBGA o BRD antes de ejecutar clarificación",
        );
      }
    } else if (!current && field !== "specContent") {
      throw new BadRequestException(
        `Genera ${fieldLabel} antes de ejecutar clarificación`,
      );
    }

    const relatedDocs = buildClarifyContextDocs(project, stage, deliverables, field);
    const clarified = cleanDocumentContent(
      await this.ai.clarifyDocument(current, fieldLabel, {
        notes: body.notes ?? null,
        relatedDocs,
      }),
    );
    const markerCount = countClarificationMarkers(clarified);
    const pendingItems = extractClarificationItems(clarified);
    let persisted = false;
    let mddSyncQueued = false;

    if (body.persist) {
      const validation = validateDocumentForPersist(current, clarified, {
        fieldLabel,
        minBodyChars: current.length > 0 ? 80 : 120,
      });
      if (!validation.ok) {
        throw new BadRequestException(validation.message);
      }
      await this.persistClarifiedField(project, stage, field, current, clarified);
      persisted = true;
    }

    if (body.syncMdd && persisted && markerCount === 0 && field === "specContent" && stage?.mddContent?.trim()) {
      const syncNote =
        `\n\n<!-- clarify-spec-sync ${new Date().toISOString()} -->\n` +
        `> Spec aclarado sincronizado desde clarify-spec. Revisar ambigüedades resueltas.\n`;
      await this.prisma.stage.update({
        where: { id: stage.id },
        data: {
          mddContent: `${(stage.mddContent ?? "").trim()}${syncNote}`,
        },
      });
      mddSyncQueued = true;
    }

    return {
      field,
      clarifiedContent: clarified,
      clarificationMarkerCount: markerCount,
      pendingItems,
      persisted,
      mddSyncQueued,
    };
  }

  /**
   * Applies user answers to pending clarifications and regenerates the document.
   */
  async resolveClarifications(
    projectId: string,
    body: ResolveClarificationsBody,
  ): Promise<ResolveClarificationsResult> {
    const project = await this.loadProject(projectId);
    const stage = this.resolveOptionalStage(project, body.stageId);
    const deliverables = stage
      ? resolveStageDeliverables(project, stage, "analyze").deliverables
      : {};
    const field = body.field;
    const fieldLabel = clarifyDocumentFieldLabel(field);
    const current = readClarifyDocumentContent(project, stage, deliverables, field);

    if (!current) {
      throw new BadRequestException(`No hay contenido en ${fieldLabel} para resolver clarificaciones`);
    }

    const pendingItems = extractClarificationItems(current);
    if (pendingItems.length === 0) {
      throw new BadRequestException(`No hay marcadores [NEEDS CLARIFICATION] en ${fieldLabel}`);
    }

    for (const item of pendingItems) {
      const answer = body.answers[item.id]?.trim();
      if (!answer) {
        throw new BadRequestException(
          `Falta respuesta para la clarificación ${item.id}: ${item.question.slice(0, 80)}…`,
        );
      }
    }

    const resolved = cleanDocumentContent(
      await this.ai.resolveClarifications(
        current,
        fieldLabel,
        pendingItems.map((item) => ({
          question: item.question,
          answer: body.answers[item.id]!.trim(),
        })),
      ),
    );
    const markerCount = countClarificationMarkers(resolved);
    let persisted = false;

    if (body.persist) {
      const validation = validateDocumentForPersist(current, resolved, {
        fieldLabel,
        minBodyChars: 80,
      });
      if (!validation.ok) {
        throw new BadRequestException(validation.message);
      }
      await this.persistClarifiedField(project, stage, field, current, resolved);
      persisted = true;
    }

    return {
      field,
      resolvedContent: resolved,
      clarificationMarkerCount: markerCount,
      persisted,
    };
  }

  private async persistClarifiedField(
    project: ProjectWithStages,
    stage: Stage | undefined,
    field: ClarifyableDocumentField,
    previous: string,
    next: string,
  ): Promise<void> {
    if (field === "dbgaContent") {
      await persistClarifyDocumentContent(this.prisma, project.id, null, field, previous, next);
      return;
    }
    if (stage?.id) {
      await persistClarifyDocumentContent(this.prisma, project.id, stage.id, field, previous, next);
      return;
    }
    if (field === "specContent") {
      await this.prisma.project.update({
        where: { id: project.id },
        data: {
          specContent: stampMarkdownIfBodyChanged(previous, next),
        },
      });
      return;
    }
    throw new BadRequestException("Se requiere una etapa activa para persistir este entregable");
  }

  private resolveOptionalStage(project: ProjectWithStages, stageId?: string): Stage | undefined {
    if (stageId) {
      const found = project.stages.find((s) => s.id === stageId);
      if (!found) throw new NotFoundException("Etapa no encontrada");
      return found;
    }
    return pickPrimaryStage(project.stages);
  }

  /**
   * Unified cross-artifact analyze report (`/speckit.analyze` + ConformanceService).
   */
  async analyzeArtifacts(projectId: string, stageId?: string): Promise<SddAnalyzeReport> {
    const project = await this.loadProject(projectId);
    const stage = this.resolveAnalysisStage(project, stageId);
    const deliverables = resolveStageDeliverables(project, stage, "analyze").deliverables;
    const mdd = (stage?.mddContent ?? "").trim();
    const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);

    const conformance = {
      blueprint: this.conformance.checkBlueprint(mdd, deliverables.blueprintContent ?? null),
      blueprintDataModel: this.conformance.checkBlueprintDataModel(mdd, deliverables.blueprintContent ?? null),
      api: this.conformance.checkApi(mdd, deliverables.apiContractsContent ?? null),
      logicFlows: this.conformance.checkLogicFlows(mdd, deliverables.logicFlowsContent ?? null),
      infra: this.conformance.checkInfra(mdd, deliverables.infraContent ?? null),
    };

    const tasksMd = deliverables.tasksContent ?? "";
    const parsed = parseTasksMarkdown(tasksMd);
    const open = filterOpenTasks(parsed);
    const spec = deliverables.specContent ?? "";

    const wordCount = (s: string | null | undefined) =>
      (s ?? "").trim() ? (s ?? "").trim().split(/\s+/).length : 0;

    const crossArtifactGaps: string[] = [];
    if (!spec.trim()) crossArtifactGaps.push("Spec ausente — generar antes del plan");
    if (!deliverables.blueprintContent?.trim()) crossArtifactGaps.push("Blueprint/plan ausente");
    if (!tasksMd.trim()) crossArtifactGaps.push("Tasks ausente — requerido para implementación");
    if (countClarificationMarkers(spec) > 0) {
      crossArtifactGaps.push(
        `${countClarificationMarkers(spec)} marcador(es) [NEEDS CLARIFICATION] en Spec`,
      );
    }
    if (!conformance.blueprint.ok) {
      crossArtifactGaps.push(...conformance.blueprint.gaps.map((g) => `[Blueprint] ${g}`));
    }
    if (!conformance.blueprintDataModel.ok) {
      crossArtifactGaps.push(
        ...conformance.blueprintDataModel.gaps.map((g) => `[Blueprint §3] ${g}`),
      );
    }
    if (!conformance.api.ok) {
      crossArtifactGaps.push(...conformance.api.missingInApi.map((g) => `[API falta] ${g}`));
    }
    if (!conformance.logicFlows.ok) {
      crossArtifactGaps.push(...conformance.logicFlows.gaps.map((g) => `[Flujos] ${g}`));
    }
    if (!conformance.infra.ok) {
      crossArtifactGaps.push(...conformance.infra.gaps.map((g) => `[Infra] ${g}`));
    }

    const complexity = project.complexity ?? ComplexityLevel.HIGH;
    const useCasesMd = deliverables.useCasesContent ?? project.useCasesContent ?? "";
    const userStoriesMd = deliverables.userStoriesContent ?? project.userStoriesContent ?? "";
    const uxUiMd = deliverables.uxUiGuideContent ?? project.uxUiGuideContent ?? "";

    const specVsMdd = checkSpecVsMdd(spec, mdd);
    if (!specVsMdd.ok) {
      crossArtifactGaps.push(...specVsMdd.gaps.map((g) => `[Spec↔MDD] ${g}`));
    }

    const huVsUc = checkUserStoriesVsUseCases(userStoriesMd, useCasesMd, spec);
    if (!huVsUc.ok) {
      crossArtifactGaps.push(...huVsUc.gaps.map((g) => `[HU↔UC] ${g}`));
    }

    const tasksCoverage = checkTasksCoverage(
      tasksMd,
      deliverables.blueprintContent ?? null,
      deliverables.apiContractsContent ?? null,
    );
    if (!tasksCoverage.ok) {
      crossArtifactGaps.push(...tasksCoverage.gaps.map((g) => `[Tasks] ${g}`));
    }

    const precisionGaps = collectSddPrecisionGaps({
      mdd,
      architecture: deliverables.architectureContent ?? project.architectureContent,
      blueprint: deliverables.blueprintContent ?? null,
      tasks: tasksMd,
      logicFlows: deliverables.logicFlowsContent ?? null,
      userStories: userStoriesMd,
      useCases: useCasesMd,
      apiContracts: deliverables.apiContractsContent ?? null,
      pantallas: deliverables.uiScreensContent ?? project.uiScreensContent,
      phase0Summary: project.phase0SummaryContent,
    });
    if (precisionGaps.length > 0) {
      crossArtifactGaps.push(...precisionGaps);
    }

    const phase0Bridge = checkPhase0BrdSpecBridge({
      dbgaContent: project.dbgaContent,
      phase0SummaryContent: project.phase0SummaryContent,
      brdContent: stage?.brdContent,
      specContent: spec,
    });
    if (!phase0Bridge.ok) {
      crossArtifactGaps.push(...formatPhase0BridgeGaps(phase0Bridge.gaps));
    }

    const requireMediumArtifacts = complexity === ComplexityLevel.MEDIUM || complexity === ComplexityLevel.HIGH;
    const ucGap = checkDeliverablePresence("Casos de uso", useCasesMd, requireMediumArtifacts && !spec.trim());
    if (ucGap) crossArtifactGaps.push(ucGap);
    const huGap = checkDeliverablePresence(
      "Historias de usuario",
      userStoriesMd,
      complexity === ComplexityLevel.LOW || requireMediumArtifacts,
    );
    if (huGap) crossArtifactGaps.push(huGap);
    const uxGap = checkDeliverablePresence(
      "Guía UX/UI",
      uxUiMd,
      requireMediumArtifacts && !(deliverables.logicFlowsContent ?? "").trim(),
    );
    if (uxGap) crossArtifactGaps.push(uxGap);

    const agentGov = analyzeAgentGovernanceSlice(project);
    if (!agentGov.present) {
      crossArtifactGaps.push("Gobernanza IA no generada — obligatoria para handoff HIGH");
    } else {
      if (agentGov.missingRequiredPaths.length > 0) {
        crossArtifactGaps.push(
          ...agentGov.missingRequiredPaths.map((p) => `[Gobernanza] Falta ruta obligatoria: ${p}`),
        );
      }
      if (!agentGov.pathAlignmentOk) {
        crossArtifactGaps.push(
          "Gobernanza IA: espejos docs/sdd incompletos — faltan: " +
            (agentGov.missingMirrorPaths ?? []).join(", "),
        );
      }
      if (agentGov.mddConformanceOk === false && agentGov.mddConformanceGaps?.length) {
        crossArtifactGaps.push(
          ...agentGov.mddConformanceGaps.map((g) => `[Gobernanza↔MDD] ${g}`),
        );
      }
    }

    const brdHealth = checkBrdObjectiveMentionHealth(stage?.brdContent, mdd);
    if (!brdHealth.ok && brdHealth.warnings.length) {
      crossArtifactGaps.push(...brdHealth.warnings.map((w) => `[BRD health] ${w}`));
    }

    const accuracyReport = computeCascadeAccuracy({
      brdMarkdown: stage?.brdContent,
      dbgaMarkdown: project.dbgaContent,
      mddMarkdown: mdd,
      specMarkdown: spec,
      apiContractsMarkdown: deliverables.apiContractsContent,
      logicFlowsMarkdown: deliverables.logicFlowsContent,
      uiScreensMarkdown: deliverables.uiScreensContent ?? project.uiScreensContent,
      tasksMarkdown: tasksMd,
      useCasesMarkdown: useCasesMd,
      userStoriesMarkdown: userStoriesMd,
    });
    const accuracyTopGaps = [
      ...accuracyReport.doc.components.flatMap((c) => c.gaps),
      ...accuracyReport.tasks.components.flatMap((c) => c.gaps),
    ].slice(0, 16);
    if (!accuracyReport.doc.ok) {
      crossArtifactGaps.push(
        `[Exactitud docs ${accuracyReport.doc.score}%] por debajo de 90 — ${accuracyTopGaps[0] ?? "revisar BRD↔MDD"}`,
      );
    }
    if (!accuracyReport.tasks.ok) {
      crossArtifactGaps.push(
        `[Exactitud tasks ${accuracyReport.tasks.score}%] por debajo de 90 — cobertura de dominio incompleta`,
      );
    }
    if (accuracyReport.hardGateBlocked) {
      crossArtifactGaps.push(
        "[Hard gate] REQUIRE_DOC_ACCURACY_90: docs y tasks deben ≥90 antes de codegen/export",
      );
    }

    const gapCount = crossArtifactGaps.length;
    let status: SddAnalyzeStatus = "ok";
    const govBlockHigh =
      complexity === ComplexityLevel.HIGH &&
      (!agentGov.present ||
        agentGov.missingRequiredPaths.length > 0 ||
        !agentGov.pathAlignmentOk ||
        agentGov.mddConformanceOk === false);

    if (accuracyReport.hardGateBlocked || !mdd || gapCount > 8 || govBlockHigh) {
      status = "blocked";
    } else if (gapCount > 0 || !accuracyReport.doc.ok || !accuracyReport.tasks.ok) {
      status = "warnings";
    }

    const score = Math.max(0, Math.min(100, 100 - gapCount * 8));

    return {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      projectName: project.name,
      featureDir,
      semaphore: (stage?.status as SddAnalyzeReport["semaphore"]) ?? null,
      accuracy: {
        docScore: accuracyReport.doc.score,
        taskScore: accuracyReport.tasks.score,
        docOk: accuracyReport.doc.ok,
        taskOk: accuracyReport.tasks.ok,
        codegenReady: accuracyReport.codegenReady,
        hardGateEnabled: accuracyReport.hardGateEnabled,
        hardGateBlocked: accuracyReport.hardGateBlocked,
        topGaps: accuracyTopGaps,
      },
      artifacts: {
        mdd: { present: mdd.length > 0, wordCount: wordCount(mdd) },
        spec: {
          present: spec.trim().length > 0,
          wordCount: wordCount(spec),
          clarificationMarkerCount: countClarificationMarkers(spec),
          hasPendingClarificationSection: specHasPendingClarificationSection(spec),
        },
        blueprint: {
          present: !!(deliverables.blueprintContent ?? "").trim(),
          wordCount: wordCount(deliverables.blueprintContent),
        },
        tasks: {
          present: tasksMd.trim().length > 0,
          totalTasks: parsed.length,
          openTasks: open.length,
          doneTasks: parsed.length - open.length,
          parallelizableOpen: open.filter((t) => t.parallel).length,
          checkpoints: extractTaskCheckpoints(tasksMd),
        },
        apiContracts: {
          present: !!(deliverables.apiContractsContent ?? "").trim(),
          wordCount: wordCount(deliverables.apiContractsContent),
        },
        logicFlows: {
          present: !!(deliverables.logicFlowsContent ?? "").trim(),
          wordCount: wordCount(deliverables.logicFlowsContent),
        },
        infra: {
          present: !!(deliverables.infraContent ?? "").trim(),
          wordCount: wordCount(deliverables.infraContent),
        },
        useCases: {
          present: !!useCasesMd.trim(),
          wordCount: wordCount(useCasesMd),
        },
        userStories: {
          present: !!userStoriesMd.trim(),
          wordCount: wordCount(userStoriesMd),
        },
        uxUiGuide: {
          present: !!uxUiMd.trim(),
          wordCount: wordCount(uxUiMd),
        },
        agentGovernance: agentGov,
      },
      conformance,
      crossArtifactGaps,
      brdHealth,
      phase0Bridge: {
        ok: phase0Bridge.ok,
        phase0Present: phase0Bridge.phase0Present,
        gapCount: phase0Bridge.gaps.length,
      },
      summary: {
        status,
        score,
        headline:
          status === "ok"
            ? "Artefactos alineados — listo para implementación"
            : status === "warnings"
              ? `${gapCount} hallazgo(s) de consistencia`
              : "Bloqueos críticos — resolver antes de implementar",
      },
    };
  }

  /** Next open task for MCP implement (lightweight `/speckit.implement` hint). */
  getNextImplementationTask(
    tasksMarkdown: string,
    tasksJson?: unknown,
  ): {
    task: ReturnType<typeof getNextOpenTask>;
    openCount: number;
  } {
    if (tasksJson != null && typeof tasksJson === "object") {
      const root = tasksJson as { tasks?: unknown[] };
      const rows = Array.isArray(root.tasks) ? root.tasks : [];
      const openRows = rows.filter((raw) => {
        if (!raw || typeof raw !== "object") return false;
        return String((raw as { status?: string }).status ?? "").toLowerCase() !== "done";
      });
      const first = openRows[0] as { id?: string; title?: string; targetFiles?: string[]; files?: string[] } | undefined;
      if (first?.id && first?.title) {
        const files = Array.isArray(first.targetFiles)
          ? first.targetFiles
          : Array.isArray(first.files)
            ? first.files
            : [];
        return {
          task: {
            line: 0,
            title: `${first.id}: ${first.title}`,
            cleanTitle: first.title,
            section: "Integration",
            done: false,
            parallel: false,
            filePaths: files.map(String),
            checkpoint: null,
          },
          openCount: openRows.length,
        };
      }
    }
    const items = parseTasksMarkdown(tasksMarkdown);
    const open = filterOpenTasks(items);
    return { task: getNextOpenTask(items), openCount: open.length };
  }

  /** Next open task for a project (MCP / GET next-task). */
  async loadProjectForNextTask(projectId: string): Promise<{
    projectId: string;
    projectName: string;
    featureDir: string;
    openCount: number;
    task: ReturnType<typeof getNextOpenTask>;
    tasksSource: ProjectTasksSsot["source"];
    hasTasksJson: boolean;
    taskCount: number;
    deliverableBundleVersion: string | null;
    ariadneTasksSource?: string | null;
  } & NextTaskDocumentLayout> {
    const project = await this.loadProject(projectId);
    const stage = pickPrimaryStage(project.stages);
    const deliverables = stage
      ? resolveStageDeliverables(project, stage, "analyze").deliverables
      : project;
    const tasksSsot = resolveProjectTasksSsot({
      tasksContent: deliverables.tasksContent ?? project.tasksContent,
      tasksJson: project.tasksJson,
      stageTasksJson: stage?.tasksJson,
    });
    const tasksMd = tasksSsot.markdown ?? "";
    const { task, openCount } = this.getNextImplementationTask(tasksMd, tasksSsot.tasksJson ?? undefined);
    const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);
    const governancePresent = !!(project.agentGovernanceContent?.trim());
    const snapshot = readStageDeliverableSnapshot(stage?.deliverableSnapshot);
    const legacyState = getLegacyChangeState(stage);
    const ariadneTasksSource =
      (legacyState as { tasksSource?: string }).tasksSource ??
      legacyState.integrationHandoffTasks?.source ??
      null;
    return {
      projectId: project.id,
      projectName: project.name,
      openCount,
      task,
      tasksSource: tasksSsot.source,
      hasTasksJson: tasksSsot.hasTasksJson,
      taskCount: tasksSsot.taskCount,
      deliverableBundleVersion: snapshot?.bundleVersion ?? null,
      ariadneTasksSource,
      ...buildNextTaskDocumentLayout(featureDir, governancePresent),
      implementHint:
        "Lee IMPLEMENT.md → .specify/memory/constitution.md → tasks en specs/NNN-slug/tasks.md",
    };
  }

  async converge(projectId: string, persist = false, stageId?: string): Promise<ConvergeResult> {
    const project = await this.loadProject(projectId);
    const stage = this.resolveAnalysisStage(project, stageId);
    const deliverables = resolveStageDeliverables(project, stage, "analyze").deliverables;
    const tasksMd = (deliverables.tasksContent ?? "").trim();
    if (!tasksMd) {
      throw new BadRequestException("Genera tasks.md antes de ejecutar converge");
    }

    const mdd = (stage?.mddContent ?? "").trim();
    const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);

    const openTasks = filterOpenTasks(parseTasksMarkdown(tasksMd));
    const conformanceGaps = this.collectConformanceGaps(mdd, deliverables);

    let codebaseEvidence: string | null = null;
    const tfId = stage?.theforgeProjectId ?? project.theforgeProjectId;
    if (tfId && this.theforge.isConfigured() && openTasks.length > 0) {
      const sample = openTasks
        .slice(0, 15)
        .map((t, i) => `${i + 1}. [${t.section}] ${t.title}`)
        .join("\n");
      const question =
        `Para el proyecto legacy, indica qué tareas del plan parecen YA implementadas en el codebase ` +
        `y cuáles faltan. Responde en markdown con secciones "Implementado" y "Pendiente".\n\nTareas:\n${sample}`;
      try {
        const raw = await this.theforge.askCodebase(question, tfId, {
          responseMode: "raw_evidence",
          deterministicRetriever: true,
        });
        codebaseEvidence = raw.trim().slice(0, 16_000) || null;
      } catch (err) {
        this.logger.warn(
          `converge askCodebase failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const userPrompt = [
      "## Tareas abiertas del plan",
      openTasks.length > 0
        ? openTasks.map((t) => `- [ ] [${t.section}] ${t.title}`).join("\n")
        : "(ninguna — revisa gaps de conformidad)",
      "",
      "## Gaps de conformidad (MDD vs entregables)",
      conformanceGaps.length > 0 ? conformanceGaps.map((g) => `- ${g}`).join("\n") : "(sin gaps detectados)",
      "",
      "## Evidencia codebase (Ariadne)",
      codebaseEvidence ?? "(no disponible — THEFORGE_MCP_URL o theforgeProjectId ausente)",
    ].join("\n");

    const convergeSection = (
      await this.ai.generateResponse(userPrompt, [], { systemPrompt: CONVERGE_PROMPT })
    ).trim();

    const normalizedSection = convergeSection.startsWith("##")
      ? convergeSection
      : `## Tareas pendientes (converge)\n\n${convergeSection}`;

    let suggestedTasksMarkdown = tasksMd;
    if (!tasksMd.includes("## Tareas pendientes (converge)")) {
      suggestedTasksMarkdown = `${tasksMd.trim()}\n\n---\n\n${normalizedSection}\n`;
    } else {
      suggestedTasksMarkdown = tasksMd.replace(
        /## Tareas pendientes \(converge\)[\s\S]*$/m,
        normalizedSection,
      );
    }

    let persisted = false;
      if (persist) {
        if (stage?.id) {
          await persistStageAndProjectDeliverables(this.prisma, stage.id, project.id, {
            tasksContent: suggestedTasksMarkdown,
          });
        } else {
          // Auto-parse tasks v2 into structured JSON even when no stage exists
          let tasksJson: Prisma.InputJsonValue | undefined;
          try {
            const parsed = parseTasksV2(suggestedTasksMarkdown);
            if (parsed.tasks.length > 0) {
              tasksJson = parsed as unknown as Prisma.InputJsonValue;
            }
          } catch {
            // ignore parse errors
          }
          await this.prisma.project.update({
            where: { id: project.id },
            data: { tasksContent: suggestedTasksMarkdown, tasksJson },
          });
        }
        persisted = true;
      }

    return {
      featureDir,
      openTaskCount: openTasks.length,
      conformanceGaps,
      codebaseEvidence,
      convergeSection: normalizedSection,
      suggestedTasksMarkdown,
      persisted,
    };
  }

  /**
   * Minimal CI hook: converge + optional webhook POST (env CONVERGE_WEBHOOK_URL or body override).
   */
  async triggerConverge(
    projectId: string,
    body: ConvergeTriggerBody,
    stageId?: string,
  ): Promise<ConvergeResult & { webhookSent: boolean; webhookUrl: string | null }> {
    const project = await this.loadProject(projectId);
    const result = await this.converge(projectId, body.persist, stageId);
    const webhookUrl =
      (body.webhookUrl ?? project.convergeWebhookUrl ?? process.env.CONVERGE_WEBHOOK_URL ?? "").trim() ||
      null;
    const webhookSecret = (project.convergeWebhookSecret ?? "").trim() || null;
    let webhookSent = false;
    if (webhookUrl) {
      try {
        const payload = JSON.stringify({
          event: "theforge.converge",
          projectId,
          stageId: stageId ?? null,
          ...result,
        });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (webhookSecret) {
          const signature = createHmac("sha256", webhookSecret).update(payload).digest("hex");
          headers["X-TheForge-Signature"] = `sha256=${signature}`;
        }
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers,
          body: payload,
        });
        webhookSent = res.ok;
        if (!res.ok) {
          this.logger.warn(`converge webhook ${webhookUrl} responded ${res.status}`);
        }
      } catch (err) {
        this.logger.warn(
          `converge webhook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { ...result, webhookSent, webhookUrl };
  }

  async tasksToIssues(projectId: string, body: TasksToIssuesBody): Promise<TasksToIssuesResult> {
    const project = await this.loadProject(projectId);
    const tasksMd = (project.tasksContent ?? "").trim();
    if (!tasksMd) {
      throw new BadRequestException("Genera tasks.md antes de exportar a GitHub Issues");
    }

    const token = process.env.GITHUB_TOKEN?.trim();
    if (!body.dryRun && !token) {
      throw new BadRequestException(
        "GITHUB_TOKEN no está configurado en el servidor para crear issues",
      );
    }

    const openTasks = filterOpenTasks(parseTasksMarkdown(tasksMd));
    if (openTasks.length === 0) {
      throw new BadRequestException("No hay tareas abiertas (- [ ]) en tasks.md");
    }

    const baseLabels = body.labels ?? ["theforge", "sdd"];
    const planned = openTasks.map((t) => {
      const labels = [...new Set([...baseLabels, sectionToIssueLabel(t.section)])];
      const pathsNote =
        t.filePaths.length > 0 ? `\n**Archivos:** ${t.filePaths.map((p) => `\`${p}\``).join(", ")}` : "";
      const parallelNote = t.parallel ? "\n**Paralelizable:** sí (`[P]`)" : "";
      const issueBody = [
        `**Sección:** ${t.section}`,
        t.checkpoint ? `**Checkpoint:** ${t.checkpoint}` : "",
        `**Proyecto The Forge:** ${project.name} (\`${project.id}\`)`,
        pathsNote,
        parallelNote,
        "",
        "Generado desde `tasks.md` vía The Forge.",
      ]
        .filter((line) => line !== "")
        .join("\n");
      return { title: (t.cleanTitle || t.title).slice(0, 240), labels, body: issueBody };
    });

    const created: TasksToIssuesResult["created"] = [];
    const errors: string[] = [];

    if (body.dryRun) {
      return { dryRun: true, planned, created, errors };
    }

    for (const item of planned) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(body.owner)}/${encodeURIComponent(body.repo)}/issues`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
              title: item.title,
              body: item.body,
              labels: item.labels,
              ...(body.milestone ? { milestone: body.milestone } : {}),
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          errors.push(`${item.title}: HTTP ${res.status} ${text.slice(0, 200)}`);
          continue;
        }
        const json = (await res.json()) as { number: number; html_url: string; title: string };
        created.push({
          number: json.number,
          html_url: json.html_url,
          title: json.title,
        });
      } catch (err) {
        errors.push(`${item.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { dryRun: false, planned, created, errors };
  }

  private collectConformanceGaps(mdd: string, project: ProjectDeliverableSource): string[] {
    if (!mdd) return ["MDD vacío: no se puede verificar conformidad"];
    const gaps: string[] = [];
    const bp = this.conformance.checkBlueprint(mdd, project.blueprintContent ?? null);
    if (!bp.ok) gaps.push(...bp.gaps.map((g) => `[Blueprint] ${g}`));
    const api = this.conformance.checkApi(mdd, project.apiContractsContent ?? null);
    if (!api.ok) {
      gaps.push(...api.missingInApi.map((g) => `[API falta] ${g}`));
      gaps.push(...api.extraInApi.map((g) => `[API extra] ${g}`));
    }
    const lf = this.conformance.checkLogicFlows(mdd, project.logicFlowsContent ?? null);
    if (!lf.ok) gaps.push(...lf.gaps.map((g) => `[Flujos] ${g}`));
    const inf = this.conformance.checkInfra(mdd, project.infraContent ?? null);
    if (!inf.ok) gaps.push(...inf.gaps.map((g) => `[Infra] ${g}`));
    return gaps;
  }

  private resolveAnalysisStage(project: ProjectWithStages, stageId?: string) {
    if (stageId) {
      const found = project.stages.find((s) => s.id === stageId);
      if (!found) throw new NotFoundException("Etapa no encontrada");
      return found;
    }
    const primary = pickPrimaryStage(project.stages);
    if (!primary) throw new BadRequestException("El proyecto no tiene etapas");
    return primary;
  }

  private async loadProject(projectId: string): Promise<ProjectWithStages> {
    const userId = getRequestUserId();
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!project) throw new NotFoundException("Proyecto no encontrado");
    const isOwner = project.userId === userId;
    const isShared = project.visibility === "SHARED";
    if (!isOwner && !isShared) throw new NotFoundException("Proyecto no encontrado");
    return project as ProjectWithStages;
  }
}
