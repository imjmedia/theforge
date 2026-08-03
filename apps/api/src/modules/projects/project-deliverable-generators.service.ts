import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { ComplexityLevel, Prisma, type Project, type Stage } from "@theforge/database";
import { enforceMddGovernancePatternsOnPersist } from "@theforge/shared-types/mdd-governance-patterns";
import {
  generateAemBodySchema,
  isBrownfieldCapable,
  isPhase0BorradorJson,
  mergeTasksQualityIntoShortTermContext,
  mergeTasksGenerationDraftFlag,
  parseAgentGovernanceScaffold,
  specKitFeatureDir,
  type DeliverableKind,
  type TasksPipelineProgress,
  type TasksPipelineQualitySnapshot,
  detectWebSurfaces,
} from "@theforge/shared-types";
import { loadProjectBorrador, hasBorradorContent } from "../ai-analysis/phase0/phase0-load-borrador.util.js";
import { phase0ToMarkdown } from "../ai-analysis/phase0/phase0-to-markdown.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import { enrichBlueprintWithUiDesignSystem } from "../engine/blueprint-enrich-ui-system.js";
import {
  buildBlueprintQualityRetryFeedback,
  collectBlueprintHardQualityGaps,
  repairBlueprintProgrammaticGaps,
  runBlueprintQualityChecks,
} from "../engine/blueprint-conformance-repair.util.js";
import {
  buildApiRetryFeedback,
  repairApiProgrammaticGaps,
  runApiConformanceCheck,
} from "../engine/api-conformance-repair.util.js";
import { repairLogicFlowsProgrammaticGaps } from "../engine/logic-flows-conformance-repair.util.js";
import {
  buildInfraConformanceGapFeedback,
  extractEntities,
  extractMddSection4Endpoints,
  extractSection,
} from "../engine/conformance.service.js";
import { computeDocAccuracy } from "../engine/cascade-accuracy.util.js";
import { resolveDomainInventory } from "../engine/domain-inventory-persist.util.js";
import { AiService, type LegacyGenerateOptions } from "../ai/ai.service.js";
import { buildLegacyGenerateOptions } from "../legacy-flow/legacy-generate-options.util.js";
import {
  extractSection5Services,
  readLogicFlowsBatchSize,
  scoreLogicFlowsSection5Coverage,
  toLogicFlowsSection5CoverageReport,
} from "../ai/utils/legacy-as-is-logic-flows.util.js";
import {
  parseAgentGovernanceResponse,
  serializeAgentGovernanceScaffold,
} from "../ai/utils/agent-governance.util.js";
import { suggestAgentGovernanceArtifacts } from "../ai/utils/suggest-agent-governance-artifacts.js";
import { ConformanceService } from "../engine/conformance.service.js";
import { TheForgeService } from "../theforge/theforge.service.js";
import { ChangeLogService } from "../change-log/change-log.service.js";
import { UiMcpClientService } from "../ui-mcp/ui-mcp-client.service.js";
import {
  McpUiComponentResolver,
  heuristicUiComponentResolver,
  type UiComponentResolver,
} from "../ui-mcp/ui-component-resolver.js";
import { PluginDocumentPipelineService } from "../../plugins/plugin-document-pipeline.service.js";
import { buildProjectHookContext } from "../../plugins/plugin-project-context.util.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ProjectEstimationRecalcService } from "./project-estimation-recalc.service.js";
import { ProjectIntegrationService } from "./integration/project-integration.service.js";
import { buildHandoffUserStoriesAppendix } from "./integration/integration-context.util.js";
import { patchLegacyDeliverablesDebugReport } from "../legacy-flow/legacy-flow-state-debug.util.js";
import { PlanValidationService } from "./plan-validation.service.js";
import { TasksGenerationPipelineService } from "./tasks-generation-pipeline.service.js";
import { ProjectMddPersistService } from "./project-mdd-persist.service.js";
import { ProjectUxGuideService } from "./project-ux-guide.service.js";
import { DeliverablesCascadeService } from "./deliverables-cascade.service.js";
import { ResolveChangeToFilesService } from "../legacy-flow/resolve-change-to-files.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import {
  buildConstitutionMarkdown,
  pickMddFromStages,
} from "./constitution-markdown.util.js";
import { mergeProjectFieldsForSemaphore } from "./project-mdd-persist.util.js";
import { reconcileExportScaffold, buildAgentGovernanceInput, synthesizeExportGovernanceScaffold } from "./handoff-export.util.js";
import { cleanSpecDocumentContent } from "./spec-content.util.js";
import { prepareSpecMarkdownForTasks, deriveTasksUpstreamActions } from "./tasks-upstream-prep.util.js";
import {
  buildTasksCoordinatesPromptBlock,
  extractMddCapabilityLines,
  parseChangeScopeFromLegacyState,
} from "./tasks-coordinates-context.util.js";
import { resolveLegacyBaselineStageFlag } from "../ai/utils/legacy-as-is-spec.util.js";
import { pickPrimaryStage, type StageWithEstimation } from "./stage-helpers.js";
import { ProjectsService } from "./projects.service.js";

type StageWithEst = StageWithEstimation;

@Injectable()
export class ProjectDeliverableGeneratorsService {
  private readonly logger = new Logger(ProjectDeliverableGeneratorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly conformance: ConformanceService,
    private readonly theforge: TheForgeService,
    private readonly estimationRecalc: ProjectEstimationRecalcService,
    private readonly changeLog: ChangeLogService,
    private readonly projectIntegration: ProjectIntegrationService,
    private readonly uiMcpClient: UiMcpClientService,
    private readonly tasksPipeline: TasksGenerationPipelineService,
    private readonly planValidation: PlanValidationService,
    private readonly mddPersist: ProjectMddPersistService,
    private readonly uxGuide: ProjectUxGuideService,
    private readonly deliverablesCascade: DeliverablesCascadeService,
    @Inject(forwardRef(() => ResolveChangeToFilesService))
    private readonly resolveChangeToFiles: ResolveChangeToFilesService,
    private readonly pluginPipeline: PluginDocumentPipelineService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
  ) {}

  private assertBlueprintCoversMddDataModel(project: Project & { stages: StageWithEst[] }): void {
  const mdd = buildConstitutionMarkdown(project);
  const dm = this.conformance.checkBlueprintDataModel(mdd, project.blueprintContent);
  if (!dm.ok) {
    throw new BadRequestException({
      message:
        "El Blueprint debe reflejar el modelo de datos del MDD (§3) antes de generar Contratos API. Corrija el Blueprint o regenérelo.",
      code: "BLUEPRINT_DATA_MODEL_GAPS",
      gaps: dm.gaps,
    });
  }
  }

  /** Opciones legacy (etapa 1 AS-IS + TheForge) para regeneración individual en Workshop. */
  private async resolveLegacyGenerateOptions(
  project: Project & { stages: StageWithEst[] },
  ): Promise<LegacyGenerateOptions | undefined> {
  const p = project as { projectType?: string; theforgeProjectId?: string | null };
  const stage = pickPrimaryStage(project.stages);
  const base = await buildLegacyGenerateOptions({
    projectType: p.projectType,
    theforgeProjectId: p.theforgeProjectId ?? null,
    mddMarkdown: buildConstitutionMarkdown(project),
    stages: project.stages,
    theforgeConfigured: this.theforge.isConfigured(),
    getContextForDeliverables: (id) => this.theforge.getContextForDeliverables(id),
    gatherContractSpecsForApi: (id) => this.theforge.gatherContractSpecsForApi(id),
  });
  const domainAware: LegacyGenerateOptions = {
    ...(base ?? {}),
    brdContent: stage?.brdContent ?? null,
    dbgaContent: project.dbgaContent ?? null,
    phase0SummaryContent: base?.phase0SummaryContent ?? project.phase0SummaryContent,
    phase0GapsJson: base?.phase0GapsJson ?? project.phase0Gaps,
    preferThinLiteraryDocs: true,
    omitLiteraryUcUs: (project.complexity ?? ComplexityLevel.HIGH) === ComplexityLevel.HIGH,
    domainInventory: this.resolveStageDomainInventory(project, stage),
  };
  return domainAware;
  }

  /** Opciones mínimas (BRD/DBGA + thin UC/US) cuando no hay legacy AS-IS. */
  private buildDomainCascadeGenerateOptions(
  project: Project & { stages: StageWithEst[] },
  ): LegacyGenerateOptions {
  const stage = pickPrimaryStage(project.stages);
  const inventory = this.resolveStageDomainInventory(project, stage);
  return {
    brdContent: stage?.brdContent ?? null,
    dbgaContent: project.dbgaContent ?? null,
    phase0SummaryContent: project.phase0SummaryContent,
    phase0GapsJson: project.phase0Gaps,
    preferThinLiteraryDocs: true,
    omitLiteraryUcUs: (project.complexity ?? ComplexityLevel.HIGH) === ComplexityLevel.HIGH,
    domainInventory: inventory,
  };
  }

  private resolveStageDomainInventory(
  project: Project & { stages?: StageWithEst[] },
  stage?: StageWithEst | null,
  ) {
  return resolveDomainInventory({
    persisted: (stage as { domainInventory?: unknown } | null | undefined)?.domainInventory,
    brdMarkdown: stage?.brdContent,
    dbgaMarkdown: project.dbgaContent,
    mddMarkdown: buildConstitutionMarkdown(project as Project & { stages: StageWithEst[] }),
  });
  }

  /** Tras regen individual de flujos legacy etapa 1: telemetría §5 en `legacyFlowState`. */
  private async persistLegacyLogicFlowsCoverageDebug(
  projectId: string,
  project: Project & { stages: StageWithEst[] },
  logicFlowsMarkdown: string,
  legacyOpts: LegacyGenerateOptions | undefined,
  ): Promise<void> {
  if (!legacyOpts?.legacyBaselineStage) return;
  const mdd = buildConstitutionMarkdown(project);
  const services = extractSection5Services(mdd);
  const batchSize = readLogicFlowsBatchSize();
  const batchCount =
    services.length > batchSize ? Math.ceil(services.length / batchSize) : undefined;
  const coverage = toLogicFlowsSection5CoverageReport(
    scoreLogicFlowsSection5Coverage(mdd, logicFlowsMarkdown),
    batchCount !== undefined ? { batchCount } : undefined,
  );
  await patchLegacyDeliverablesDebugReport(
    this.prisma,
    projectId,
    {
      legacyBaselineStage: true,
      logicFlowsSection5Coverage: coverage,
    },
    pickPrimaryStage(project.stages ?? [])?.id,
  );
  }
  async generateDocument(
  kind: DeliverableKind,
  projectId: string,
  options?: { gapsFeedback?: string | null; acknowledgeGaps?: boolean; signal?: AbortSignal },
  ): Promise<void> {
  await this.projects.assertDeliverablesAllowed(projectId, {
    acknowledgeGaps: options?.acknowledgeGaps === true,
  });
  const gaps = options?.gapsFeedback ?? undefined;
  const ack = options?.acknowledgeGaps === true;
  const signal = options?.signal;
  switch (kind) {
    case "mdd_canonical":
      return;
    case "spec":
      await this.generateSpec(projectId, signal);
      return;
    case "architecture":
      await this.generateArchitecture(projectId, gaps, signal);
      return;
    case "use_cases":
      await this.generateUseCases(projectId, signal);
      return;
    case "blueprint":
      await this.generateBlueprint(projectId, gaps, signal);
      return;
    case "api_contracts":
      await this.ensureBlueprintForApi(projectId);
      await this.generateApiContracts(projectId, gaps, signal);
      return;
    case "logic_flows":
      await this.generateLogicFlows(projectId, gaps, signal);
      return;
    case "ux_ui_guide":
      await this.uxGuide.generateUxUiGuide(projectId, signal);
      return;
    case "user_stories":
      await this.generateUserStories(projectId, signal);
      return;
    case "agent_governance":
      await this.generateAgentGovernance(projectId, undefined, undefined, signal);
      return;
    case "tasks":
      await this.generateTasks(projectId, gaps, { acknowledgeGaps: ack, signal });
      return;
    case "infra":
      await this.generateInfra(projectId, gaps, signal);
      return;
    default: {
      // Exhaustiveness check intentionally disabled after EVD extraction
      // (plugin framework handles extensible document types)
      return void 0;
    }
  }
  }

  private async ensureBlueprintForApi(projectId: string): Promise<void> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId).catch(() => null);
  if (!project) return;
  if ((project.blueprintContent ?? "").trim().length > 48) return;
  await this.generateBlueprint(projectId);
  }

  async generateAem(projectId: string, body: unknown) {
  const parsed = generateAemBodySchema.parse(body ?? {});
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);

  const dbga = (project.dbgaContent ?? "").trim();
  const summaryRaw = (project.phase0SummaryContent ?? "").trim();
  const benchmarkContent =
    summaryRaw && !isPhase0BorradorJson(summaryRaw) ? summaryRaw : "";

  let phase0Content = dbga;
  if (!phase0Content) {
    const borrador = loadProjectBorrador(project.dbgaContent, project.phase0SummaryContent);
    if (hasBorradorContent(borrador)) {
      phase0Content = phase0ToMarkdown(borrador);
    }
  }

  const stage = pickPrimaryStage(project.stages ?? []);
  const brdContent = (stage?.brdContent ?? "").trim();

  if (!benchmarkContent && !phase0Content && !brdContent) {
    throw new BadRequestException(
      "Se requiere al menos Benchmark (Deep Research), Fase 0 (DBGA) o BRD para generar el AEM.",
    );
  }

  let content: string;
  const hookOpts = this.buildHookGenerateOpts(project);
  try {
    const aemMarkdown = await this.ai.generateAem(
      {
        marketScope: parsed.marketScope,
        benchmarkContent,
        phase0Content,
        brdContent,
        projectName: project.name,
      },
      hookOpts,
    );
    const advisory = await this.ai.generateAemInvestmentAdvisory({
      aemContent: aemMarkdown,
      marketScope: parsed.marketScope,
      projectName: project.name,
      benchmarkContent,
      phase0Content,
      brdContent,
    });
    content = `${aemMarkdown.trim()}\n\n${advisory.trim()}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al generar AEM";
    throw new Error(`Falló la generación del AEM. ${message.slice(0, 200)}`);
  }

  const cleaned = cleanDocumentContent(content);
  const updated = await this.projects.update(projectId, { aemContent: cleaned });
  this.notifyPluginAfterDocumentPersist("aem", projectId, updated.aemContent ?? cleaned);
  return updated;
  }

  async generateSpec(projectId: string, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  if ((project as { projectType?: string }).projectType === "LEGACY") {
    throw new BadRequestException(
      "Generar Spec con este flujo es solo para proyectos nuevos. En legacy usa el flujo de entregables legacy.",
    );
  }
  const dbga = (project.dbgaContent ?? "").trim();
  const rawMdd = pickMddFromStages(project.stages).trim();
  const inputContent = dbga || rawMdd || buildConstitutionMarkdown(project).trim();
  const specContent = await this.ai.generateSpec(
    inputContent,
    project.phase0SummaryContent,
    dbga.length === 0 && rawMdd.length > 0 ? "mdd" : "dbga",
    this.withHookGenerateOpts(project, undefined, signal),
  );
  const cleaned = cleanSpecDocumentContent(specContent);
  const updated = await this.projects.update(projectId, { specContent: cleaned });
  this.notifyPluginAfterDocumentPersist("spec", projectId, updated.specContent ?? cleaned);
  return updated;
  }

  /** Limpia gobernanza persistida antes de regenerar (polling y UI). */
  async clearAgentGovernanceContent(projectId: string) {
    return this.projects.update(projectId, { agentGovernanceContent: null });
  }

  async generateAgentGovernance(
  projectId: string,
  target?: string,
  options?: { forceRegenerate?: boolean; skipSddAutoReconcile?: boolean },
  signal?: AbortSignal,
  ) {
  this.throwIfAborted(signal);
  const forceRegenerate = options?.forceRegenerate !== false;
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const beforeLen = (project.agentGovernanceContent ?? "").length;
  this.logger.debug(
    `[agent-gov] generateAgentGovernance start projectId=${projectId} force=${forceRegenerate} beforeLen=${beforeLen}`,
  );
  if (forceRegenerate) {
    this.logger.debug(`[agent-gov] generateAgentGovernance clearing agentGovernanceContent projectId=${projectId}`);
    await this.clearAgentGovernanceContent(projectId);
  }
  const complexity = project.complexity ?? ComplexityLevel.HIGH;
  const mdd = buildConstitutionMarkdown(project);
  const stage = pickPrimaryStage(project.stages);
  const governanceInput = buildAgentGovernanceInput(project, mdd, complexity, stage);
  const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);
  const suggestions = suggestAgentGovernanceArtifacts(governanceInput);
  this.logger.debug(
    `[agent-gov] generateAgentGovernance input keys=${Object.keys(governanceInput).join(",")} archetypes=${suggestions.archetypes.length} rules=${suggestions.suggestedRules.length} skills=${suggestions.suggestedSkills.length}`,
  );
  const raw = await this.ai.generateAgentGovernance(mdd, project.blueprintContent, complexity, {
    suggestions,
    tasksContent: project.tasksContent,
    architectureContent: project.architectureContent,
    specContent: project.specContent,
    apiContractsContent: project.apiContractsContent,
    logicFlowsContent: project.logicFlowsContent,
    uxUiGuideContent: project.uxUiGuideContent,
    uiScreensContent: project.uiScreensContent,
    infraContent: project.infraContent,
    userStoriesContent: project.userStoriesContent,
    useCasesContent: project.useCasesContent,
    ...this.withHookGenerateOpts(project, undefined, signal),
  });
  const forceFreshOverlay = forceRegenerate;
  const scaffold = parseAgentGovernanceResponse(raw, complexity, {
    suggestions,
    governanceInput,
    target,
    forceFreshOverlay,
    featureDir,
  });
  const serialized = serializeAgentGovernanceScaffold(scaffold);
  this.logger.debug(
    `[agent-gov] generateAgentGovernance done projectId=${projectId} beforeLen=${beforeLen} afterLen=${serialized.length} files=${scaffold.files.length}`,
  );
  const updated = await this.projects.update(projectId, {
    agentGovernanceContent: serialized,
  });
  this.notifyPluginAfterDocumentPersist(
    "agent-governance",
    projectId,
    updated.agentGovernanceContent ?? serialized,
  );
  if (options?.skipSddAutoReconcile !== true) {
    const activeStage = pickPrimaryStage(updated.stages ?? []);
    if (activeStage?.id) {
      await this.syncSddConflictGapsForProject(updated, activeStage.id).catch((err) =>
        this.logger.warn(
          `[agent-gov] sddConflictSurfacing: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }
  return updated;
  }

  async generateAgentGovernancePreview(
  projectId: string,
  target?: string,
  options?: { forceRegenerate?: boolean },
  ): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const complexity = project.complexity ?? ComplexityLevel.HIGH;
  const mdd = buildConstitutionMarkdown(project);
  const stage = pickPrimaryStage(project.stages);
  const governanceInput = buildAgentGovernanceInput(project, mdd, complexity, stage);
  const featureDir = specKitFeatureDir(stage?.ordinal ?? 1, project.name);
  const suggestions = suggestAgentGovernanceArtifacts(governanceInput);
  const raw = await this.ai.generateAgentGovernance(mdd, project.blueprintContent, complexity, {
    suggestions,
    tasksContent: project.tasksContent,
    architectureContent: project.architectureContent,
    specContent: project.specContent,
    apiContractsContent: project.apiContractsContent,
    logicFlowsContent: project.logicFlowsContent,
    uxUiGuideContent: project.uxUiGuideContent,
    uiScreensContent: project.uiScreensContent,
    infraContent: project.infraContent,
    userStoriesContent: project.userStoriesContent,
    useCasesContent: project.useCasesContent,
  });
  const forceFreshOverlay = options?.forceRegenerate !== false;
  const scaffold = parseAgentGovernanceResponse(raw, complexity, {
    suggestions,
    governanceInput,
    target,
    forceFreshOverlay,
    featureDir,
  });
  return { content: serializeAgentGovernanceScaffold(scaffold) };
  }

  /** Scaffold listo para ZIP: reconcilia sugerencias, rutas obligatorias y entregables SDD. */
  async getAgentGovernanceForExport(projectId: string) {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const raw = project.agentGovernanceContent;
  if (!raw?.trim()) {
    return synthesizeExportGovernanceScaffold(project);
  }

  const filesBefore = parseAgentGovernanceScaffold(raw)?.files.length ?? 0;
  this.logger.debug(
    `[agent-gov] getAgentGovernanceForExport start projectId=${projectId} rawLen=${raw.length} filesBefore=${filesBefore}`,
  );

  const exportScaffold = reconcileExportScaffold(project, { throwIfMissing: true });
  if (!exportScaffold) {
    throw new BadRequestException("El scaffold de gobernanza no contiene archivos válidos.");
  }

  this.logger.debug(
    `[agent-gov] getAgentGovernanceForExport done projectId=${projectId} filesAfter=${exportScaffold.files.length} readOnly=true`,
  );

  return exportScaffold;
  }

  async generateTasks(
  projectId: string,
  gapsFeedback?: string | null,
  options?: { acknowledgeGaps?: boolean; onProgress?: (progress: TasksPipelineProgress) => void; signal?: AbortSignal },
  ) {
  this.throwIfAborted(options?.signal);
  let project = await loadAccessibleProjectWithStages(this.prisma, projectId);

  project = await this.ensureTasksUpstreamArtifacts(project);

  let navigationMap: string | undefined;
  const theforgeId = (project as Project & { theforgeProjectId?: string | null }).theforgeProjectId;
  if (theforgeId) {
    navigationMap = await this.fetchNavigationMap(theforgeId).catch(() => undefined);
  }

  const mdd = buildConstitutionMarkdown(project);
  const stage = pickPrimaryStage(project.stages ?? []);
  const coordinates = await this.buildTasksCoordinatesContext(
    projectId,
    project,
    mdd,
    navigationMap,
  );

  const gfOpts = this.greenfieldGenerateOptions(project);
  const taskOpts = {
    navigationMap,
    specContent: project.specContent,
    useCasesContent: project.useCasesContent,
    userStoriesContent: project.userStoriesContent,
    apiContractsContent: project.apiContractsContent,
    logicFlowsContent: project.logicFlowsContent,
    infraContent: project.infraContent,
    architectureContent: project.architectureContent,
    uxUiGuideContent: project.uxUiGuideContent,
    uiScreensContent: project.uiScreensContent,
    gapsFeedback,
    fileCoordinatesContext: coordinates.block,
    coordinatesMode: coordinates.coordinatesMode,
    ...this.withHookGenerateOpts(project, gfOpts, options?.signal),
  };

  const inventory = resolveDomainInventory({
    persisted: stage?.domainInventory,
    brdMarkdown: stage?.brdContent,
    dbgaMarkdown: project.dbgaContent,
    mddMarkdown: mdd,
  });

  const legacyBaselineStage =
    project.projectType === "LEGACY"
      ? resolveLegacyBaselineStageFlag(stage, mdd)
      : false;

  let lastDraftPersistLen = 0;
  const onPipelineProgress = async (progress: TasksPipelineProgress): Promise<void> => {
    const { markdown: _markdown, ...publicProgress } = progress;
    options?.onProgress?.(publicProgress);
    const draft = progress.markdown?.trim();
    if (!draft || draft.length < 48) return;
    if (draft.length <= lastDraftPersistLen + 180) return;
    lastDraftPersistLen = draft.length;
    await this.persistTasksDraftContent(projectId, stage?.id, draft);
  };

  const pipelineResult = await this.tasksPipeline.run({
    mddMarkdown: mdd,
    blueprintMarkdown: project.blueprintContent,
    brdMarkdown: stage?.brdContent,
    dbgaMarkdown: project.dbgaContent,
    inventory,
    gapsFeedback,
    hasUxTeam: project.hasUxTeam === true,
    legacyBaselineStage,
    acknowledgeGaps: options?.acknowledgeGaps === true,
    taskOpts,
    onProgress: (progress) => {
      void onPipelineProgress(progress).catch((err) =>
        this.logger.warn(
          `[Tasks] draft persist failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    },
  });

  const { tasksMarkdown: tasksRaw, quality, snapshot } = pipelineResult;
  if (quality.ok) {
    this.logger.log(
      `[Tasks] Pipeline OK (det=${quality.score}, llm=${snapshot.llmAuditorScore}, n=${quality.taskCount})`,
    );
  }

  const tasksContent = cleanDocumentContent(tasksRaw);

  const updated = await this.projects.update(projectId, { tasksContent });
  this.notifyPluginAfterDocumentPersist("tasks", projectId, updated.tasksContent ?? tasksContent);
  await this.persistTasksQualitySnapshot(stage?.id, snapshot, { clearDraft: true });

  if (stage?.id) {
    const freshStage = pickPrimaryStage(updated.stages ?? []) ?? stage;
    await this.estimationRecalc.recalcAndUpsert(freshStage.id, {
      mddContent: freshStage.mddContent ?? mdd,
      infraContent: updated.infraContent ?? project.infraContent ?? null,
      status: freshStage.status,
      consolidatedTaskCount: quality.taskCount,
    }).catch((e) =>
      this.logger.warn(
        `[Tasks] post-consolidation recalc: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  if (isBrownfieldCapable(theforgeId)) {
    void this.planValidation.validateProjectChangePlan(projectId).catch((e) =>
      this.logger.warn(
        `[plan-validation] post-generateTasks failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  return updated;
  }

  /**
   * Reparaciones deterministas de insumos upstream antes de Tasks (Spec, pantallas MCP, API/flujos vacíos).
   */
  private async ensureTasksUpstreamArtifacts(
  project: Project & { stages: StageWithEst[] },
  ): Promise<Project & { stages: StageWithEst[] }> {
  const projectId = project.id;
  let spec = (project.specContent ?? "").trim();
  const specPrep = prepareSpecMarkdownForTasks(spec);
  if (specPrep.changed && specPrep.normalized.length >= 80) {
    this.logger.log("[Tasks upstream] normalizando Spec (headings vacíos)");
    await this.projects.update(projectId, { specContent: cleanSpecDocumentContent(specPrep.normalized) });
    project = await this.projects.findOne(projectId);
    spec = (project.specContent ?? "").trim();
  }

  const mdd = buildConstitutionMarkdown(project);
  const hasUxTeam = project.hasUxTeam === true;
  const hasWebSurfaces = detectWebSurfaces(mdd, project.blueprintContent);
  const stage = pickPrimaryStage(project.stages ?? []);
  const inventory = resolveDomainInventory({
    persisted: stage?.domainInventory,
    brdMarkdown: stage?.brdContent,
    dbgaMarkdown: project.dbgaContent,
    mddMarkdown: mdd,
  });

  const docAcc = computeDocAccuracy({
    brdMarkdown: stage?.brdContent,
    dbgaMarkdown: project.dbgaContent,
    mddMarkdown: mdd,
    specMarkdown: specPrep.normalized || spec,
    apiContractsMarkdown: project.apiContractsContent,
    logicFlowsMarkdown: project.logicFlowsContent,
    uiScreensMarkdown: project.uiScreensContent,
    inventory,
    uiScreensRequired: hasUxTeam || hasWebSurfaces,
  });

  const actions = deriveTasksUpstreamActions(docAcc, {
    hasUxTeam,
    mddMarkdown: mdd,
    blueprintMarkdown: project.blueprintContent,
    specMarkdown: spec,
    apiContractsMarkdown: project.apiContractsContent,
    logicFlowsMarkdown: project.logicFlowsContent,
    uiScreensMarkdown: project.uiScreensContent,
    mddHasApiSection: /##\s*4[\.\s]/i.test(mdd),
  }).filter((a) => a.autoRepairable);

  for (const action of actions) {
    try {
      if (action.artifact === "ui_screens" && (hasUxTeam || hasWebSurfaces)) {
        this.logger.log("[Tasks upstream] sync pantallas (MCP o heurístico)");
        await this.deliverablesCascade.syncUiScreens(projectId);
        project = await this.projects.findOne(projectId);
        continue;
      }
      if (
        action.artifact === "api_contracts" &&
        (project.apiContractsContent ?? "").trim().length < 80 &&
        /##\s*4[\.\s]/i.test(mdd)
      ) {
        this.logger.log("[Tasks upstream] generando api-contracts vacío");
        await this.generateApiContracts(projectId);
        project = await this.projects.findOne(projectId);
        continue;
      }
      if (
        action.artifact === "logic_flows" &&
        (project.logicFlowsContent ?? "").trim().length < 80
      ) {
        this.logger.log("[Tasks upstream] generando logic-flows vacío");
        await this.generateLogicFlows(projectId);
        project = await this.projects.findOne(projectId);
      }
    } catch (e) {
      this.logger.warn(
        `[Tasks upstream] skip ${action.artifact}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return project;
  }

  /**
   * Arma contexto determinista para tasks con coordenadas (ChangeScope, resolve-change, hints).
   */
  private async buildTasksCoordinatesContext(
  projectId: string,
  project: Project & { stages?: Stage[] },
  mddMarkdown: string,
  navigationMap?: string,
  ): Promise<{ block: string; coordinatesMode: boolean }> {
  const stage = pickPrimaryStage(project.stages ?? []);
  const changeScope = parseChangeScopeFromLegacyState(stage?.legacyChangeState);

  const descriptions: string[] = [];
  if (changeScope?.description?.trim()) {
    descriptions.push(changeScope.description.trim());
  } else {
    descriptions.push(...extractMddCapabilityLines(mddMarkdown, 4));
  }

  const resolveResults: Array<{ description: string; result: Awaited<ReturnType<ResolveChangeToFilesService["resolve"]>> }> = [];
  const theforgeId = (project as Project & { theforgeProjectId?: string | null }).theforgeProjectId;
  if (theforgeId && descriptions.length > 0) {
    await Promise.allSettled(
      descriptions.slice(0, 4).map(async (description) => {
        const result = await this.resolveChangeToFiles.resolve({
          projectId,
          description,
          stageId: stage?.id,
        });
        if (result.suggestedFiles.length || result.affectedRoutes.length) {
          resolveResults.push({ description, result });
        }
      }),
    );
  }

  return buildTasksCoordinatesPromptBlock({
    navigationMapMarkdown: navigationMap,
    changeScope: changeScope ?? undefined,
    resolveResults,
    architectureMarkdown: project.architectureContent,
    mddMarkdown,
  });
  }

  /**
   * Obtiene el navigation map desde Ariadne MCP para enriquecer Tasks.
   */
  private async fetchNavigationMap(theforgeId: string): Promise<string | undefined> {
  try {
    const content = await this.theforge.fetchNavigationMap(theforgeId);
    if (!content || content.length < 200) return undefined;
    return content.slice(0, 6000);
  } catch {
    return undefined;
  }
  }

  async generateArchitecturePreview(projectId: string): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const content = await this.ai.generateArchitecture(
    buildConstitutionMarkdown(project),
    project.blueprintContent,
  );
  return { content: cleanDocumentContent(content) };
  }

  async generateArchitecture(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const mdd = buildConstitutionMarkdown(project);
  const gfOpts = this.greenfieldGenerateOptions(project);
  const content = cleanDocumentContent(
    await this.ai.generateArchitecture(mdd, project.blueprintContent, {
      ...gfOpts,
      gapsFeedback,
      ...this.withHookGenerateOpts(project, undefined, signal),
    }),
  );

  const updated = await this.projects.update(projectId, { architectureContent: content });
  this.notifyPluginAfterDocumentPersist(
    "architecture",
    projectId,
    updated.architectureContent ?? content,
  );
  return updated;
  }

  async generateUseCasesPreview(projectId: string): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const opts =
    (await this.resolveLegacyGenerateOptions(project)) ??
    this.buildDomainCascadeGenerateOptions(project);
  const content = await this.ai.generateUseCases(
    buildConstitutionMarkdown(project),
    project.specContent,
    opts,
  );
  return { content: cleanDocumentContent(content) };
  }

  async generateUseCases(projectId: string, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const opts = this.withHookGenerateOpts(
    project,
    (await this.resolveLegacyGenerateOptions(project)) ??
      this.buildDomainCascadeGenerateOptions(project),
    signal,
  );
  const content = await this.ai.generateUseCases(
    buildConstitutionMarkdown(project),
    project.specContent,
    opts,
  );
  const cleaned = cleanDocumentContent(content);
  const updated = await this.projects.update(projectId, { useCasesContent: cleaned });
  this.notifyPluginAfterDocumentPersist("use-cases", projectId, updated.useCasesContent ?? cleaned);
  return updated;
  }

  async generateUserStoriesPreview(projectId: string): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const intOpts = await this.buildIntegrationGenerateOptions(projectId);
  const domainOpts = this.buildDomainCascadeGenerateOptions(project);
  const content = await this.ai.generateUserStories(
    buildConstitutionMarkdown(project),
    project.specContent,
    project.useCasesContent,
    { ...domainOpts, ...intOpts },
  );
  const appendix = buildHandoffUserStoriesAppendix(intOpts?.integrationHandoffItems ?? []);
  return { content: cleanDocumentContent(content + appendix) };
  }

  async generateUserStories(projectId: string, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const intOpts = await this.buildIntegrationGenerateOptions(projectId);
  const domainOpts = this.buildDomainCascadeGenerateOptions(project);
  const hookOpts = this.withHookGenerateOpts(project, { ...domainOpts, ...intOpts }, signal);
  const content = await this.ai.generateUserStories(
    buildConstitutionMarkdown(project),
    project.specContent,
    project.useCasesContent,
    hookOpts,
  );
  const appendix = buildHandoffUserStoriesAppendix(intOpts?.integrationHandoffItems ?? []);
  const cleaned = cleanDocumentContent(content + appendix);
  const updated = await this.projects.update(projectId, { userStoriesContent: cleaned });
  this.notifyPluginAfterDocumentPersist("user-stories", projectId, updated.userStoriesContent ?? cleaned);
  return updated;
  }

  private async buildIntegrationGenerateOptions(projectId: string): Promise<LegacyGenerateOptions | undefined> {
  const ctx = await this.projectIntegration.resolvePromptContext(projectId, null);
  if (!ctx.externalBlock && !ctx.handoffForNew.length) return undefined;
  return {
    ...(ctx.externalBlock ? { externalLegacyContextBlock: ctx.externalBlock } : {}),
    ...(ctx.handoffForNew.length ? { integrationHandoffItems: ctx.handoffForNew } : {}),
  };
  }

  /** Pre-extrae entidades del MDD §3 y las agrega como texto literal en el prompt para la IA. */
  private enrichMddWithEntities(mddContent: string): string {
  const section3 = extractSection(
    mddContent,
    /^#+\s*(?:3\.\s*)?(?:modelo\s+de\s+datos|datos\s*\/\s*entidades)/im,
  );
  const mddEntities = extractEntities(section3);
  const entityList = Array.from(mddEntities).sort().join(", ");
  if (!entityList) return mddContent;
  return mddContent +
  `
  **LISTA EXACTA DE ENTIDADES DEL MDD §3 (extraídas automáticamente del SQL):** ${entityList}

  CADA entidad DEBE aparecer en su PROPIA LÍNEA con cabecera ### o viñeta - en la sección "### 2. Persistencia y datos".
  Ejemplo CORRECTO:
  ### developers
  ### users
  ### properties

  Ejemplo INCORRECTO (NO detectado automáticamente):
  developers
  users
  properties

  PROHIBIDO escribir los nombres como texto plano suelto. DEBEN ser cabeceras ### o viñetas -. NO omitas ninguna.
  `;
  }

  /** Pre-extrae endpoints del MDD §4 para el prompt de Contratos API. */
  private enrichMddWithApiEndpoints(mddContent: string): string {
  const endpoints = extractMddSection4Endpoints(mddContent);
  if (endpoints.length === 0) return mddContent;
  const list = endpoints.map((ep) => `${ep.method} ${ep.path}`).join("\n- ");
  return (
    mddContent +
    `

  **LISTA EXACTA DE ENDPOINTS MDD §4 (extraídos automáticamente):**
  - ${list}

  CADA endpoint DEBE tener EXACTAMENTE UNA fila en la tabla markdown del documento (columnas Método | Ruta | …).
  Usa la misma ruta que el MDD (puedes usar \`:id\` o \`{id}\` en path params). NO omitas ninguno. NO inventes rutas que no estén en esta lista salvo /health si ya figura arriba.
  `
  );
  }

  async generateBlueprintPreview(projectId: string, gapsFeedback?: string | null): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const mddContent = buildConstitutionMarkdown(project);
  const enrichedMdd = this.enrichMddWithEntities(mddContent);
  const legacyOpts = await this.resolveLegacyGenerateOptions(project);
  const content = await this.ai.generateBlueprint(enrichedMdd, gapsFeedback, legacyOpts);
  return { content: cleanDocumentContent(content) };
  }

  async generateBlueprint(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const mddContent = buildConstitutionMarkdown(project);
  const enrichedMdd = this.enrichMddWithEntities(mddContent);
  const legacyOpts = this.withHookGenerateOpts(
    project,
    (await this.resolveLegacyGenerateOptions(project)) ?? {},
    signal,
  );
  let blueprintContent = await this.ai.generateBlueprint(enrichedMdd, gapsFeedback, legacyOpts);
  blueprintContent = cleanDocumentContent(blueprintContent);

  // GUARD: Si gapsFeedback provocó un resultado vacío/corto, reintentar SIN gaps
  if (gapsFeedback && blueprintContent.length < 80) {
    this.throwIfAborted(signal);
    this.logger.warn(`[Blueprint] Resultado vacío/corto (${blueprintContent.length} chars) con gapsFeedback — reintentando sin gaps`);
    blueprintContent = await this.ai.generateBlueprint(enrichedMdd, null, legacyOpts);
    blueprintContent = cleanDocumentContent(blueprintContent);
  }

  // GUARD: No persistir si sigue vacío — preservar el Blueprint anterior
  if (blueprintContent.length < 80) {
    this.logger.error(`[Blueprint] No se pudo generar contenido válido — preservando Blueprint anterior`);
    throw new BadRequestException("No se pudo generar el Blueprint. Intenta de nuevo.");
  }

  // Verificación multi-capa + un reintento LLM solo ante gaps "duros" (entidades, secciones, tablas…).
  // Autocontenido es soft: evita ~80s de retry cuando el blueprint ya es sustancial.
  let qualityRetried = false;
  let checks = runBlueprintQualityChecks(mddContent, blueprintContent);
  let hardGaps = collectBlueprintHardQualityGaps(checks);

  if (hardGaps.length > 0 && !qualityRetried) {
    this.throwIfAborted(signal);
    qualityRetried = true;
    const internalFeedback = buildBlueprintQualityRetryFeedback(checks);
    const combinedFeedback = [gapsFeedback?.trim(), internalFeedback].filter(Boolean).join("\n\n");
    this.logger.warn(
      `[Blueprint] Calidad insuficiente (${checks.entity.gaps.length} entidades, ${checks.section.gaps.length} secciones, ` +
        `${checks.generalTable.gaps.length} tablaGral, ${checks.spanish.gaps.length} español, ` +
        `${checks.selfContained.gaps.length} autocontenido) — reintentando: ${hardGaps[0]?.slice(0, 140)}`,
    );
    blueprintContent = await this.ai.generateBlueprint(enrichedMdd, combinedFeedback, legacyOpts);
    blueprintContent = cleanDocumentContent(blueprintContent);
    checks = runBlueprintQualityChecks(mddContent, blueprintContent);
    hardGaps = collectBlueprintHardQualityGaps(checks);
  } else if (checks.selfContained.gaps.length > 0) {
    this.logger.warn(
      `[Blueprint] Referencias al MDD (${checks.selfContained.gaps.length} autocontenido) — sin retry LLM: ` +
        `${checks.selfContained.gaps[0]?.slice(0, 140)}`,
    );
  }

  blueprintContent = repairBlueprintProgrammaticGaps(mddContent, blueprintContent);

  // Anexar §9 UI Design System (§8 queda libre para checklist del prompt).
  blueprintContent = await enrichBlueprintWithUiDesignSystem(
    mddContent,
    blueprintContent,
    await this.getUiResolver(),
    {
      pantallasContent: project.uiScreensContent,
      apiContractsContent: project.apiContractsContent,
    },
  );

  blueprintContent = repairBlueprintProgrammaticGaps(mddContent, blueprintContent);

  const postGenCheck = this.conformance.checkBlueprint(mddContent, blueprintContent);
  if (!postGenCheck.ok) {
    const gapSummary = postGenCheck.gaps.slice(0, 6).join("; ");
    this.logger.warn(`[Blueprint] Post-generation conformance gaps: ${gapSummary}`);
    await this.changeLog
      .log(projectId, "blueprintContent", `[conformance-recheck] ${gapSummary}`)
      .catch(() => {});
  }

  const updated = await this.projects.update(projectId, { blueprintContent });
  this.notifyPluginAfterDocumentPersist(
    "blueprint",
    projectId,
    updated.blueprintContent ?? blueprintContent,
  );
  return updated;
  }

  async generateApiContractsPreview(projectId: string, gapsFeedback?: string | null): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  this.assertBlueprintCoversMddDataModel(project);

  const mainStage = project.stages?.[0];
  const brdContent = mainStage?.brdContent ?? undefined;
  const legacyOpts = await this.resolveLegacyGenerateOptions(project);
  const content = await this.ai.generateApiContracts(
    this.enrichMddWithApiEndpoints(buildConstitutionMarkdown(project)),
    project.blueprintContent,
    gapsFeedback,
    brdContent,
    legacyOpts,
  );
  return { content: cleanDocumentContent(content) };
  }

  async generateInfraPreview(projectId: string, gapsFeedback?: string | null): Promise<{ content: string }> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const legacyOpts = await this.resolveLegacyGenerateOptions(project);
  const content = await this.ai.generateInfra(
    buildConstitutionMarkdown(project),
    project.blueprintContent,
    gapsFeedback,
    legacyOpts,
  );
  return { content: cleanDocumentContent(content) };
  }

  async generateApiContracts(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  this.assertBlueprintCoversMddDataModel(project);

  const mainStage = project.stages?.[0];
  const brdContent = mainStage?.brdContent ?? undefined;
  const mddContent = buildConstitutionMarkdown(project);
  const enrichedMdd = this.enrichMddWithApiEndpoints(mddContent);
  const legacyOpts = this.withHookGenerateOpts(
    project,
    {
      ...(await this.resolveLegacyGenerateOptions(project)),
      ...this.greenfieldGenerateOptions(project),
    },
    signal,
  );

  let apiContent = await this.ai.generateApiContracts(
    enrichedMdd,
    project.blueprintContent,
    gapsFeedback,
    brdContent,
    legacyOpts,
  );
  apiContent = cleanDocumentContent(apiContent);

  if (gapsFeedback && apiContent.length < 80) {
    this.throwIfAborted(signal);
    this.logger.warn(
      `[API] Resultado vacío/corto (${apiContent.length} chars) con gapsFeedback — reintentando sin gaps`,
    );
    apiContent = cleanDocumentContent(
      await this.ai.generateApiContracts(
        enrichedMdd,
        project.blueprintContent,
        null,
        brdContent,
        legacyOpts,
      ),
    );
  }

  if (apiContent.length < 80) {
    throw new BadRequestException("No se pudo generar Contratos API. Intenta de nuevo.");
  }

  let qualityRetried = false;
  let apiCheck = runApiConformanceCheck(mddContent, apiContent);
  if (!apiCheck.ok && !qualityRetried) {
    this.throwIfAborted(signal);
    qualityRetried = true;
    const internalFeedback = buildApiRetryFeedback(apiCheck);
    const combinedFeedback = [gapsFeedback?.trim(), internalFeedback].filter(Boolean).join("\n\n");
    this.logger.warn(
      `[API] Conformidad insuficiente (${apiCheck.missingInApi.length} faltantes, ${apiCheck.extraInApi.length} extra) — reintentando`,
    );
    apiContent = cleanDocumentContent(
      await this.ai.generateApiContracts(
        enrichedMdd,
        project.blueprintContent,
        combinedFeedback,
        brdContent,
        legacyOpts,
      ),
    );
    apiCheck = runApiConformanceCheck(mddContent, apiContent);
  }

  apiContent = repairApiProgrammaticGaps(mddContent, apiContent);
  let postCheck = this.conformance.checkApi(mddContent, apiContent);
  if (!postCheck.ok) {
    apiContent = repairApiProgrammaticGaps(mddContent, apiContent);
    postCheck = this.conformance.checkApi(mddContent, apiContent);
  }

  if (!postCheck.ok) {
    const gapSummary = [...postCheck.missingInApi, ...postCheck.extraInApi].slice(0, 6).join("; ");
    this.logger.warn(`[API] Post-generation conformance gaps: ${gapSummary}`);
    await this.changeLog
      .log(
        projectId,
        "apiContractsContent",
        JSON.stringify({
          type: "conformance-recheck",
          ok: false,
          missing: postCheck.missingInApi.slice(0, 20),
          extra: postCheck.extraInApi.slice(0, 12),
          at: new Date().toISOString(),
        }),
      )
      .catch(() => {});
  }

  const updated = await this.projects.update(projectId, { apiContractsContent: apiContent });
  this.notifyPluginAfterDocumentPersist(
    "api-contracts",
    projectId,
    updated.apiContractsContent ?? apiContent,
  );
  return updated;
  }

  async generateLogicFlows(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const legacyOpts = this.withHookGenerateOpts(
    project,
    (await this.resolveLegacyGenerateOptions(project)) ?? {},
    signal,
  );
  const mdd = buildConstitutionMarkdown(project);
  let content = await this.ai.generateLogicFlows(mdd, gapsFeedback, legacyOpts);
  let cleaned = cleanDocumentContent(content);

  let qualityRetried = false;
  let lfCheck = this.conformance.checkLogicFlows(mdd, cleaned);
  if (!lfCheck.ok && !qualityRetried) {
    this.throwIfAborted(signal);
    qualityRetried = true;
    const internalFeedback = lfCheck.gaps.join("; ");
    const combinedFeedback = [gapsFeedback?.trim(), internalFeedback].filter(Boolean).join("\n\n");
    this.logger.warn(`[Flujos] Conformidad insuficiente — reintentando: ${internalFeedback.slice(0, 200)}`);
    cleaned = cleanDocumentContent(await this.ai.generateLogicFlows(mdd, combinedFeedback, legacyOpts));
    lfCheck = this.conformance.checkLogicFlows(mdd, cleaned);
  }

  cleaned = repairLogicFlowsProgrammaticGaps(mdd, cleaned);

  if ((project as { projectType?: string }).projectType === "LEGACY") {
    await this.persistLegacyLogicFlowsCoverageDebug(projectId, project, cleaned, legacyOpts);
  }

  const postCheck = this.conformance.checkLogicFlows(mdd, cleaned);
  if (!postCheck.ok) {
    const gapSummary = postCheck.gaps.slice(0, 6).join("; ");
    this.logger.warn(`[Flujos] Post-generation conformance gaps: ${gapSummary}`);
    await this.changeLog
      .log(projectId, "logicFlowsContent", `[conformance-recheck] ${gapSummary}`)
      .catch(() => {});
  }

  const updated = await this.projects.update(projectId, { logicFlowsContent: cleaned });
  this.notifyPluginAfterDocumentPersist(
    "logic-flows",
    projectId,
    updated.logicFlowsContent ?? cleaned,
  );
  return updated;
  }

  /** Parchea el MDD de la etapa según feedback de un documentation gap (reconciliación parcial). */
  async patchMddFromGapFeedback(
  projectId: string,
  stageId: string,
  gapsFeedback: string,
  ): Promise<void> {
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const stage = project.stages.find((s) => s.id === stageId);
  if (!stage) throw new NotFoundException("Etapa no encontrada");

  const currentMdd = (stage.mddContent ?? "").trim();
  if (!currentMdd) {
    throw new BadRequestException("MDD vacío: no se puede aplicar parche desde gap");
  }

  const patched = await this.ai.patchMddFromGapFeedback(currentMdd, gapsFeedback);
  if (!patched?.trim()) {
    throw new BadRequestException("Parche MDD inválido o vacío");
  }

  const enforced = enforceMddGovernancePatternsOnPersist(patched, stage.mddContent);
  const pipelineResult = await this.mddPersist.persistMddFromPatch({
    projectId,
    stageId,
    mddMarkdown: enforced.markdown,
    mergedForSemaphore: mergeProjectFieldsForSemaphore(project, {}),
    stageBaseline: {
      status: stage.status,
      precisionScore: stage.precisionScore,
    },
    patchFlags: {},
  });
  await this.estimationRecalc.recalcAndUpsert(stageId, {
    mddContent: pipelineResult.sanitizedMdd,
    infraContent: project.infraContent ?? null,
    status: pipelineResult.status,
  });
  }

  async generateInfra(projectId: string, gapsFeedback?: string | null, signal?: AbortSignal) {
  this.throwIfAborted(signal);
  const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
  const legacyOpts = this.withHookGenerateOpts(
    project,
    (await this.resolveLegacyGenerateOptions(project)) ?? {},
    signal,
  );
  const mdd = buildConstitutionMarkdown(project);
  let content = await this.ai.generateInfra(
    mdd,
    project.blueprintContent,
    gapsFeedback,
    legacyOpts,
  );
  let cleaned = cleanDocumentContent(content);

  let qualityRetried = false;
  let infraCheck = this.conformance.checkInfra(mdd, cleaned);
  if (!infraCheck.ok && !qualityRetried) {
    this.throwIfAborted(signal);
    qualityRetried = true;
    const internalFeedback = buildInfraConformanceGapFeedback(infraCheck.gaps);
    const combinedFeedback = [gapsFeedback?.trim(), internalFeedback].filter(Boolean).join("\n\n");
    this.logger.warn(`[Infra] Conformidad insuficiente — reintentando: ${internalFeedback.slice(0, 200)}`);
    cleaned = cleanDocumentContent(
      await this.ai.generateInfra(mdd, project.blueprintContent, combinedFeedback, legacyOpts),
    );
    infraCheck = this.conformance.checkInfra(mdd, cleaned);
  }

  const postCheck = this.conformance.checkInfra(mdd, cleaned);
  if (!postCheck.ok) {
    const gapSummary = postCheck.gaps.slice(0, 6).join("; ");
    this.logger.warn(`[Infra] Post-generation conformance gaps: ${gapSummary}`);
    await this.changeLog
      .log(
        projectId,
        "infraContent",
        JSON.stringify({
          type: "conformance-recheck",
          ok: false,
          gaps: postCheck.gaps.slice(0, 16),
          at: new Date().toISOString(),
        }),
      )
      .catch(() => {});
  }

  const updated = await this.projects.update(projectId, { infraContent: cleaned });
  this.notifyPluginAfterDocumentPersist("infra", projectId, updated.infraContent ?? cleaned);
  return updated;
  }

  private greenfieldGenerateOptions(project: Project): LegacyGenerateOptions {
    return {
      phase0SummaryContent: project.phase0SummaryContent,
      phase0GapsJson: project.phase0Gaps,
      coverageBlueprintContent: project.blueprintContent,
    };
  }

  private buildHookGenerateOpts(project: Project & { stages: StageWithEst[] }) {
    const stage = pickPrimaryStage(project.stages);
    return {
      projectId: project.id,
      hookContext: buildProjectHookContext(project, {
        mddContent: pickMddFromStages(project.stages).trim() || null,
        brdContent: stage?.brdContent ?? null,
      }),
    };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Cancelado por el usuario");
  }

  private withHookGenerateOpts(
    project: Project & { stages: StageWithEst[] },
    opts?: LegacyGenerateOptions,
    signal?: AbortSignal,
  ): LegacyGenerateOptions {
    const merged = { ...(opts ?? {}), ...this.buildHookGenerateOpts(project) };
    return signal ? { ...merged, abortSignal: signal } : merged;
  }

  private notifyPluginAfterDocumentPersist(
    documentType: string,
    projectId: string,
    finalContent: string,
  ): void {
    void this.pluginPipeline.runAfterDocumentPersist({
      documentType,
      projectId,
      finalContent,
      metadata: { durationMs: 0, provider: "core", model: documentType },
    });
  }

  private async persistTasksDraftContent(
    projectId: string,
    stageId: string | undefined,
    markdown: string,
  ): Promise<void> {
    const cleaned = cleanDocumentContent(markdown);
    if (cleaned.trim().length < 48) return;

    const data = { tasksContent: cleaned };
    if (stageId?.trim()) {
      await this.prisma.$transaction([
        this.prisma.stage.update({ where: { id: stageId.trim() }, data }),
        this.prisma.project.update({ where: { id: projectId }, data }),
      ]);
      try {
        const stage = await this.prisma.stage.findUnique({
          where: { id: stageId.trim() },
          select: { shortTermContext: true },
        });
        const prev =
          stage?.shortTermContext &&
          typeof stage.shortTermContext === "object" &&
          !Array.isArray(stage.shortTermContext)
            ? (stage.shortTermContext as Record<string, unknown>)
            : {};
        await this.prisma.stage.update({
          where: { id: stageId.trim() },
          data: {
            shortTermContext: mergeTasksGenerationDraftFlag(prev, true) as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        this.logger.warn(
          `[Tasks] draft flag persist failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      await this.prisma.project.update({ where: { id: projectId }, data });
    }
  }

  private async persistTasksQualitySnapshot(
    stageId: string | undefined,
    snapshot: TasksPipelineQualitySnapshot,
    opts?: { clearDraft?: boolean },
  ): Promise<void> {
    if (!stageId?.trim()) return;
    try {
      const stage = await this.prisma.stage.findUnique({
        where: { id: stageId.trim() },
        select: { shortTermContext: true },
      });
      const prev =
        stage?.shortTermContext &&
        typeof stage.shortTermContext === "object" &&
        !Array.isArray(stage.shortTermContext)
          ? (stage.shortTermContext as Record<string, unknown>)
          : {};
      const withSnapshot = mergeTasksQualityIntoShortTermContext(prev, snapshot);
      const shortTermContext = opts?.clearDraft
        ? mergeTasksGenerationDraftFlag(withSnapshot, false)
        : withSnapshot;
      await this.prisma.stage.update({
        where: { id: stageId.trim() },
        data: {
          shortTermContext: shortTermContext as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[Tasks] quality snapshot persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async getUiResolver(): Promise<UiComponentResolver> {
    try {
      if (await this.uiMcpClient.isActive()) {
        return new McpUiComponentResolver(this.uiMcpClient);
      }
    } catch {
      /* fallback heurístico */
    }
    return heuristicUiComponentResolver;
  }

  private async syncSddConflictGapsForProject(
    project: Project & { stages: StageWithEst[] },
    _stageId: string,
  ): Promise<void> {
    await this.projects.runPostRegenSddConflictSurfacing(project.id);
  }

}
