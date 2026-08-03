import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ComplexityLevel } from "@theforge/database";
import {
  DELIVERABLES_BY_COMPLEXITY,
  DELIVERABLE_STEP_LABELS,
  planLegacyDeliverablesToGenerate,
  shouldSkipLegacyTasksGeneration,
  type DeliverableKind,
} from "@theforge/shared-types";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { ProjectIntegrationService } from "../projects/integration/project-integration.service.js";
import { TheForgeService } from "../theforge/theforge.service.js";
import { AiService } from "../ai/ai.service.js";
import {
  extractSection5Services,
  readLogicFlowsBatchSize,
  scoreLogicFlowsSection5Coverage,
  toLogicFlowsSection5CoverageReport,
} from "../ai/utils/legacy-as-is-logic-flows.util.js";
import { parseAgentGovernanceResponse, serializeAgentGovernanceScaffold } from "../ai/utils/agent-governance.util.js";
import { suggestAgentGovernanceArtifacts } from "../ai/utils/suggest-agent-governance-artifacts.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import { cleanSpecDocumentContent } from "../projects/spec-content.util.js";
import { appendLegacyBaselineDetailPrompt } from "../ai/utils/legacy-baseline-detail.util.js";
import { resolveLegacyBaselineStageFlag } from "../ai/utils/legacy-as-is-spec.util.js";
import { UX_UI_GUIDE_PROMPT } from "../ai/prompts/ux-ui-guide-prompt.js";
import { persistStageDeliverableSnapshotFromProject } from "../projects/stage-deliverable-snapshot.util.js";
import { persistStageAndProjectDeliverables } from "../projects/stage-deliverable-persist.util.js";
import { assertLegacyChangeGate } from "./legacy-change-gate.util.js";
import { trySectionMergeDeliverable } from "./legacy-section-merge-deliverables.runner.js";
import type { LegacySectionMergeTrace } from "./legacy-section-merge.types.js";
import { LegacyDeliverablesStrategyService } from "./legacy-deliverables-strategy/legacy-deliverables-strategy.service.js";
import type {
  LegacyDeliverablesStrategyContext,
  LegacyDeliverablesStrategyResolution,
} from "./legacy-deliverables-strategy/legacy-deliverables-strategy.types.js";
import {
  buildReverseEngineeringMddForLegacySteps,
  clipDebug,
  deliverableFieldCharCount,
  DELIVERABLE_KIND_TO_CODEBASE_DOC_TYPE,
  isLegacy429Like,
  isLegacyDeliverablesDebugVerbose,
  legacyDeliverablesLargeMddCooldownMs,
  mddTheforgeContextBlock,
  readRetryAfterSecondsFromErrorHeaders,
  runWithLegacy429Retries,
  sleepMs,
  upstreamLlmRateLimitHttpException,
} from "./legacy-coordinator.util.js";
import type {
  LegacyDeliverablesDebugReport,
  LegacyDeliverablesDebugStep,
  LegacyFlowState,
} from "./legacy-coordinator.types.js";
import { LegacyStageContextService } from "./legacy-stage-context.service.js";
import { LegacyCoordinatorService } from "./legacy-coordinator.service.js";

@Injectable()
export class LegacyDeliverablesOrchestratorService {
  private readonly logger = new Logger(LegacyDeliverablesOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly theforge: TheForgeService,
    private readonly ai: AiService,
    private readonly legacyDeliverablesStrategy: LegacyDeliverablesStrategyService,
    @Inject(forwardRef(() => ProjectIntegrationService))
    private readonly projectIntegration: ProjectIntegrationService,
    private readonly stageContext: LegacyStageContextService,
    @Inject(forwardRef(() => LegacyCoordinatorService))
    private readonly coordinator: LegacyCoordinatorService,
  ) {}

  /** Persists `lastDeliverablesDebug` on stage legacyChangeState (fallback: project without stages). */
  private async persistDeliverablesDebugReport(
    projectId: string,
    report: LegacyDeliverablesDebugReport,
    stageId?: string | null,
  ): Promise<void> {
    try {
      if (stageId?.trim()) {
        const stage = await this.prisma.stage.findUnique({
          where: { id: stageId.trim() },
          select: { legacyChangeState: true },
        });
        const state = (stage?.legacyChangeState as LegacyFlowState | null | undefined) ?? {};
        const next = { ...state, lastDeliverablesDebug: report } as LegacyFlowState;
        await this.prisma.stage.update({
          where: { id: stageId.trim() },
          data: { legacyChangeState: next as object },
        });
        return;
      }
      const firstStage = await this.prisma.stage.findFirst({
        where: { projectId },
        orderBy: { ordinal: "asc" },
        select: { id: true, legacyChangeState: true },
      });
      if (!firstStage?.id) return;
      const state = (firstStage.legacyChangeState as LegacyFlowState | null | undefined) ?? {};
      const next = { ...state, lastDeliverablesDebug: report } as LegacyFlowState;
      await this.prisma.stage.update({
        where: { id: firstStage.id },
        data: { legacyChangeState: next as object },
      });
    } catch (err) {
      this.logger.warn(
        `[LegacyDeliverables] persistDeliverablesDebugReport: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async generateDeliverables(
    projectId: string,
    stageId?: string,
    options?: {
      onProgress?: (p: {
        step: string;
        completedSteps: string[];
        index: number;
        total: number;
      }) => void;
    },
  ): Promise<{ ok: boolean; lastDeliverablesDebug: LegacyDeliverablesDebugReport }> {
    const report: LegacyDeliverablesDebugReport = {
      startedAt: new Date().toISOString(),
      mddSource: "none",
      mddChars: 0,
      codebaseDocChars: 0,
      mddContentChars: 0,
      theforgeContextChars: 0,
      theforgeConfigured: this.theforge.isConfigured(),
      complexityEffective: ComplexityLevel.HIGH,
      deliverablesOrder: [],
      steps: [],
    };

    const pushStep = (step: Omit<LegacyDeliverablesDebugStep, "at"> & { at?: string }) => {
      const full: LegacyDeliverablesDebugStep = {
        ...step,
        at: step.at ?? new Date().toISOString(),
      };
      report.steps.push(full);
      if (isLegacyDeliverablesDebugVerbose()) {
        this.logger.log(
          `[LegacyDeliverables] step=${full.kind} ok=${full.ok} ms=${full.durationMs} outChars=${full.outChars ?? "-"} ${full.detail ?? ""} ${full.error ?? ""}`.trim(),
        );
      }
    };

    const markFatal = (err: unknown) => {
      report.finishedAt = new Date().toISOString();
      report.ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      report.fatalError = {
        message: clipDebug(msg, 2000),
        stack: err instanceof Error ? clipDebug(err.stack ?? "", 4000) : undefined,
      };
    };

    const { project, theforgeId } = await this.stageContext.getLegacyProject(projectId);
    const row = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!row) throw new NotFoundException("Project not found");
    if (row.complexityPending != null) {
      throw new BadRequestException(
        "Hay una propuesta de complejidad pendiente de confirmación. Confirma o rechaza en el Workshop antes de generar entregables.",
      );
    }

    const gateStage = stageId?.trim()
      ? await this.prisma.stage.findUnique({ where: { id: stageId.trim() } })
      : await this.stageContext.resolveLegacyGateStage(projectId);

    assertLegacyChangeGate(gateStage);

    // enforceLegacyBrdTobeGate eliminado — To-Be y As-Is removidos
    const gateState = this.stageContext.readLegacyChangeState(gateStage);
    const skipTasksFromHandoff = shouldSkipLegacyTasksGeneration({
      legacyChangeState: gateStage?.legacyChangeState,
    });
    const codebaseDoc = String(gateState.codebaseDoc ?? "").trim();
    const mddContent = String(project.mddContent ?? "").trim();
    const legacyBaselineStage = resolveLegacyBaselineStageFlag(gateStage, mddContent);
    report.legacyBaselineStage = legacyBaselineStage;
    report.codebaseDocChars = codebaseDoc.length;
    report.mddContentChars = mddContent.length;
    report.mddSource = mddContent ? "mddContent" : codebaseDoc ? "codebaseDoc_fallback" : "none";
    const mdd =
      mddContent || (codebaseDoc ? `[Ingeniería inversa: documento del codebase existente. Genera entregables que describan el sistema AS-IS.]\n\n${codebaseDoc}` : "");
    report.mddChars = mdd.length;

    const isReverseEngineering = !mddContent && !!codebaseDoc;
    report.pipelineMode = isReverseEngineering ? "generate_from_codebase" : "projects_generate_document";
    if (!isReverseEngineering) {
      report.mddLlmStrategy = "full";
      report.mddCharsSentToLlm = mddContent.length;
      report.mddClippedForLlm = false;
      report.mddRollupWindows = 0;
    }

    pushStep({
      kind: "preflight",
      durationMs: 0,
      ok: !!mdd,
      detail:
        `legacyBaselineStage=${legacyBaselineStage} reverseEngineering=${isReverseEngineering} pipelineMode=${report.pipelineMode} mddSource=${report.mddSource} mddLlmStrategy=${report.mddLlmStrategy ?? "?"} rollupWindows=${report.mddRollupWindows ?? 0} clipped=${report.mddClippedForLlm ?? false} rollupFailed=${report.mddRollupFailed ?? false}`,
    });

    if (!mdd) {
      markFatal(new Error("missing_mdd_and_codebaseDoc"));
      await this.persistDeliverablesDebugReport(projectId, report, gateStage?.id);
      throw new BadRequestException("Genera la documentación de partida (MDD Inicial) o el MDD de cambio antes de generar entregables.");
    }

    const legacyState = gateState;

    const tGate = Date.now();
    try {
      await this.stageContext.assertLegacyIndexSddGate(projectId, theforgeId, legacyState);
      pushStep({ kind: "index_sdd_gate", durationMs: Date.now() - tGate, ok: true });
    } catch (err) {
      pushStep({
        kind: "index_sdd_gate",
        durationMs: Date.now() - tGate,
        ok: false,
        error: clipDebug(err instanceof Error ? err.message : String(err), 800),
      });
      markFatal(err);
      await this.persistDeliverablesDebugReport(projectId, report, gateStage?.id);
      if (isLegacyDeliverablesDebugVerbose()) this.logger.error(err);
      throw err;
    }

    const tTf = Date.now();
    const [theforgeContext, contractSpecs] = await Promise.all([
      this.theforge.getContextForDeliverables(theforgeId),
      this.theforge.gatherContractSpecsForApi(theforgeId),
    ]);
    report.theforgeContextChars = theforgeContext.length;
    pushStep({
      kind: "theforge_context",
      durationMs: Date.now() - tTf,
      ok: true,
      outChars: theforgeContext.length,
      detail: theforgeContext.trim() ? "non_empty" : "empty_string",
    });
    const legacyOpts: { theforgeContext?: string; contractSpecs?: string; legacyBaselineStage?: boolean; codebaseDoc?: string } | undefined =
      theforgeContext.trim() || contractSpecs.trim() || legacyBaselineStage
        ? {
            ...(theforgeContext.trim() ? { theforgeContext } : {}),
            ...(contractSpecs.trim() ? { contractSpecs } : {}),
            ...(legacyBaselineStage ? { legacyBaselineStage: true } : {}),
            ...(codebaseDoc ? { codebaseDoc } : {}),
          }
        : undefined;

    const run429 = <T>(fn: () => Promise<T>, step: string) =>
      runWithLegacy429Retries(fn, { logger: this.logger, step });

    const pushSectionMergeTrace = (t: LegacySectionMergeTrace) => {
      report.sectionMergeTraces = [...(report.sectionMergeTraces ?? []), t];
    };

    const pushStrategyDecision = (d: LegacyDeliverablesStrategyResolution) => {
      report.strategyDecisions = [...(report.strategyDecisions ?? []), d];
    };

    const resolveSectionMergeAttempt = async (
      kind: DeliverableKind,
      mddText: string,
      fields: Partial<Pick<LegacyDeliverablesStrategyContext, "blueprintText" | "specText" | "useCasesText">>,
    ): Promise<boolean> => {
      const d = await this.legacyDeliverablesStrategy.resolveSectionMergeAttempt(kind, {
        mddText,
        theforgeContextText: theforgeContext,
        legacyBaselineStage,
        ...fields,
      });
      pushStrategyDecision(d);
      return d.attemptSectionMerge;
    };

    const update = async (data: Record<string, unknown>) => {
      if (!gateStage?.id) {
        throw new BadRequestException("No hay etapa activa para persistir entregables.");
      }
      await persistStageAndProjectDeliverables(
        this.prisma,
        gateStage.id,
        projectId,
        data as import("@theforge/shared-types").ProjectDeliverableSource,
      );
    };

    const load = async () => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!p) throw new NotFoundException("Project not found");
      return p;
    };

    let p = await load();
    const complexity = isReverseEngineering ? ComplexityLevel.HIGH : (row.complexity ?? ComplexityLevel.HIGH);
    const deliverablesToRun = DELIVERABLES_BY_COMPLEXITY[complexity];
    report.complexityEffective = complexity;

    const ensureBlueprint = async (mddForLlm: string): Promise<string> => {
      let bp = String(p.blueprintContent ?? "").trim();
      if (bp.length > 48) return bp;
      bp = await this.ai.generateBlueprint(mddForLlm, undefined, legacyOpts);
      await update({ blueprintContent: cleanDocumentContent(bp) });
      p = await load();
      return String(p.blueprintContent ?? "").trim();
    };

    const runStepWithMdd = async (kind: DeliverableKind, mddForLlm: string): Promise<void> => {
      switch (kind) {
        case "mdd_canonical":
          return;
        case "spec": {
          if (!legacyBaselineStage) {
            const sm = await trySectionMergeDeliverable(
              this.ai,
              "spec",
              mddForLlm,
              legacyOpts,
              {},
              run429,
              this.logger,
              {
                attemptSectionMerge: await resolveSectionMergeAttempt("spec", mddForLlm, {}),
              },
            );
            if (sm) {
              pushSectionMergeTrace(sm.trace);
              await update({ specContent: cleanSpecDocumentContent(sm.content) });
              p = await load();
              return;
            }
          }
          const specContent = await this.ai.generateSpec(mddForLlm, null, "mdd", legacyOpts);
          await update({ specContent: cleanSpecDocumentContent(specContent) });
          p = await load();
          return;
        }
        case "architecture": {
          const smArch = await trySectionMergeDeliverable(
            this.ai,
            "architecture",
            mddForLlm,
            legacyOpts,
            { blueprint: p.blueprintContent ?? undefined },
            run429,
            this.logger,
            {
              attemptSectionMerge: await resolveSectionMergeAttempt("architecture", mddForLlm, {
                blueprintText: p.blueprintContent ?? undefined,
              }),
            },
          );
          if (smArch) {
            pushSectionMergeTrace(smArch.trace);
            await update({ architectureContent: cleanDocumentContent(smArch.content) });
            p = await load();
            return;
          }
          const architectureContent = await this.ai.generateArchitecture(
            mddForLlm,
            p.blueprintContent ?? undefined,
            legacyOpts,
          );
          await update({ architectureContent: cleanDocumentContent(architectureContent) });
          p = await load();
          return;
        }
        case "use_cases": {
          if (!legacyBaselineStage) {
            const smUc = await trySectionMergeDeliverable(
              this.ai,
              "use_cases",
              mddForLlm,
              legacyOpts,
              { spec: p.specContent ?? undefined },
              run429,
              this.logger,
              {
                attemptSectionMerge: await resolveSectionMergeAttempt("use_cases", mddForLlm, {
                  specText: p.specContent ?? undefined,
                }),
              },
            );
            if (smUc) {
              pushSectionMergeTrace(smUc.trace);
              await update({ useCasesContent: cleanDocumentContent(smUc.content) });
              p = await load();
              return;
            }
          }
          const useCasesContent = await this.ai.generateUseCases(mddForLlm, p.specContent, legacyOpts);
          await update({ useCasesContent: cleanDocumentContent(useCasesContent) });
          p = await load();
          return;
        }
        case "blueprint": {
          if (!legacyBaselineStage) {
            const smBp = await trySectionMergeDeliverable(
              this.ai,
              "blueprint",
              mddForLlm,
              legacyOpts,
              {},
              run429,
              this.logger,
              {
                attemptSectionMerge: await resolveSectionMergeAttempt("blueprint", mddForLlm, {}),
              },
            );
            if (smBp) {
              pushSectionMergeTrace(smBp.trace);
              await update({ blueprintContent: cleanDocumentContent(smBp.content) });
              p = await load();
              return;
            }
          }
          const blueprintContent = await this.ai.generateBlueprint(mddForLlm, undefined, legacyOpts);
          await update({ blueprintContent: cleanDocumentContent(blueprintContent) });
          p = await load();
          return;
        }
        case "api_contracts": {
          const bp = await ensureBlueprint(mddForLlm);
          const smApi = await trySectionMergeDeliverable(
            this.ai,
            "api_contracts",
            mddForLlm,
            legacyOpts,
            { blueprint: bp },
            run429,
            this.logger,
            {
              attemptSectionMerge: await resolveSectionMergeAttempt("api_contracts", mddForLlm, {
                blueprintText: bp,
              }),
            },
          );
          if (smApi) {
            pushSectionMergeTrace(smApi.trace);
            await update({ apiContractsContent: cleanDocumentContent(smApi.content) });
            p = await load();
            return;
          }
          const apiContractsContent = await this.ai.generateApiContracts(mddForLlm, bp, undefined, undefined, legacyOpts);
          await update({ apiContractsContent: cleanDocumentContent(apiContractsContent) });
          p = await load();
          return;
        }
        case "logic_flows": {
          if (!legacyBaselineStage) {
            const smLf = await trySectionMergeDeliverable(
              this.ai,
              "logic_flows",
              mddForLlm,
              legacyOpts,
              {},
              run429,
              this.logger,
              { attemptSectionMerge: await resolveSectionMergeAttempt("logic_flows", mddForLlm, {}) },
            );
            if (smLf) {
              pushSectionMergeTrace(smLf.trace);
              await update({ logicFlowsContent: cleanDocumentContent(smLf.content) });
              p = await load();
              return;
            }
          }
          const logicFlowsContent = await this.ai.generateLogicFlows(mddForLlm, undefined, legacyOpts);
          const cleaned = cleanDocumentContent(
            this.ai.resolveLogicFlowsLlmFallback(mddForLlm, logicFlowsContent, legacyOpts),
          );
          if (legacyBaselineStage) {
            const services = extractSection5Services(mddForLlm);
            const batchSize = readLogicFlowsBatchSize();
            const batchCount =
              services.length > batchSize ? Math.ceil(services.length / batchSize) : undefined;
            report.logicFlowsSection5Coverage = toLogicFlowsSection5CoverageReport(
              scoreLogicFlowsSection5Coverage(mddForLlm, cleaned),
              batchCount !== undefined ? { batchCount } : undefined,
            );
          }
          await update({ logicFlowsContent: cleaned });
          p = await load();
          return;
        }
        case "ux_ui_guide": {
          const bpUx = String(p.blueprintContent ?? "").trim() || (await ensureBlueprint(mddForLlm));
          const smUx = await trySectionMergeDeliverable(
            this.ai,
            "ux_ui_guide",
            mddForLlm,
            legacyOpts,
            { blueprint: bpUx },
            run429,
            this.logger,
            {
              attemptSectionMerge: await resolveSectionMergeAttempt("ux_ui_guide", mddForLlm, {
                blueprintText: bpUx,
              }),
            },
          );
          if (smUx) {
            pushSectionMergeTrace(smUx.trace);
            const uxClean = smUx.content.replace(/\n---FIN_UX_UI---.*/s, "").trim();
            await update({ uxUiGuideContent: cleanDocumentContent(uxClean) });
            p = await load();
            return;
          }
          let uxPrompt =
            "Genera la Guía UX/UI en markdown según el system prompt. MDD:\n---\n" +
            mddForLlm +
            "\n---\n\nBlueprint:\n---\n" +
            bpUx +
            "\n---";
          if (theforgeContext) {
            uxPrompt =
              "**Contexto del codebase (TheForge) — priorizar y usar antes de elaborar:**\n---\n" +
              mddTheforgeContextBlock(theforgeContext) +
              "\n---\n\n**Regla obligatoria (legacy):** No inventes nada. Apégate al MDD y únicamente al conocimiento del codebase (TheForge) proporcionado arriba.\n\n**Instrucción:** Usa TODO el conocimiento anterior para alinear la guía con lo que ya existe. A continuación, MDD y Blueprint.\n\n" +
              uxPrompt;
          }
          // Extraer tokens de diseño reales del codebase (herramienta MCP extract_design_tokens)
          try {
            const raw = await this.theforge.extractDesignTokens(theforgeId);
            if (raw.trim()) {
              const parsed = JSON.parse(raw) as {
                foundTailwind?: boolean;
                foundCssCustomProps?: boolean;
                foundThemeFile?: boolean;
                tailwindTokens?: Record<string, string>;
                cssTokens?: Record<string, string>;
                summary?: string;
              } | null;
              if (parsed?.summary?.trim()) {
                const hasTokens = parsed.foundTailwind || parsed.foundCssCustomProps || parsed.foundThemeFile;
                if (hasTokens) {
                  uxPrompt =
                    "**Tokens de diseño extraídos del codebase — usar como valores reales:**\\n---\\n" +
                    (parsed.summary ?? "") +
                    "\\n---\\n\\n" +
                    uxPrompt;
                }
              }
            }
          } catch {
            // Si falla la extracción, continuar sin tokens — no bloquear la generación
            this.logger.warn("[Legacy UX/UI] Design token extraction via MCP tool skipped (error, continuing without tokens)");
          }
          const uxUiGuideContent = await this.ai.generateResponse(
            appendLegacyBaselineDetailPrompt(uxPrompt, legacyBaselineStage),
            [],
            {
              systemPrompt: UX_UI_GUIDE_PROMPT,
              activeTab: "ux-ui-guide",
              projectTypeForUxGuide: "LEGACY",
            },
          );
          const uxClean = (uxUiGuideContent ?? "").replace(/\n---FIN_UX_UI---.*/s, "").trim();
          await update({ uxUiGuideContent: cleanDocumentContent(uxClean) });
          p = await load();
          return;
        }
        case "user_stories": {
          const integrationPromptCtx = await this.projectIntegration.resolvePromptContext(
            projectId,
            gateStage?.id ?? undefined,
          );
          if (!legacyBaselineStage) {
            const smUs = await trySectionMergeDeliverable(
              this.ai,
              "user_stories",
              mddForLlm,
              legacyOpts,
              { spec: p.specContent ?? undefined, useCases: p.useCasesContent ?? undefined },
              run429,
              this.logger,
              {
                attemptSectionMerge: await resolveSectionMergeAttempt("user_stories", mddForLlm, {
                  specText: p.specContent ?? undefined,
                  useCasesText: p.useCasesContent ?? undefined,
                }),
              },
            );
            if (smUs) {
              pushSectionMergeTrace(smUs.trace);
              await update({ userStoriesContent: cleanDocumentContent(smUs.content) });
              p = await load();
              return;
            }
          }
          const userStoriesContent = await this.ai.generateUserStories(
            mddForLlm,
            p.specContent,
            p.useCasesContent,
            {
              ...legacyOpts,
              integrationHandoffItems: integrationPromptCtx.handoffItems,
              integrationNewProject: integrationPromptCtx.newProjectMeta,
            },
          );
          const cleanedUs = cleanDocumentContent(userStoriesContent);
          if (gateStage?.id) {
            await this.projectIntegration
              .syncTracesFromUserStories(projectId, gateStage.id, cleanedUs)
              .catch(() => {});
          }
          await update({ userStoriesContent: cleanedUs });
          p = await load();
          return;
        }
        case "agent_governance": {
          const bpGov = p.blueprintContent?.trim() || undefined;
          const governanceInput = {
            mddMarkdown: mddForLlm,
            blueprintMarkdown: bpGov,
            tasksMarkdown: p.tasksContent?.trim() || undefined,
            architectureMarkdown: p.architectureContent?.trim() || undefined,
            specMarkdown: p.specContent?.trim() || undefined,
            projectType: "LEGACY" as const,
            complexity,
          };
          const govSuggestions = suggestAgentGovernanceArtifacts(governanceInput);
          const raw = await this.ai.generateAgentGovernance(mddForLlm, bpGov, complexity, {
            ...legacyOpts,
            suggestions: govSuggestions,
            tasksContent: p.tasksContent,
            architectureContent: p.architectureContent,
            specContent: p.specContent,
          });
          const scaffold = parseAgentGovernanceResponse(raw, complexity, {
            suggestions: govSuggestions,
            governanceInput,
            forceFreshOverlay: true,
          });
          await update({ agentGovernanceContent: serializeAgentGovernanceScaffold(scaffold) });
          p = await load();
          return;
        }
        case "tasks": {
          if (skipTasksFromHandoff) {
            pushStep({
              kind: "tasks",
              durationMs: 0,
              ok: true,
              detail: "skipped_handoff_ssot",
            });
            return;
          }
          const bpTasks = p.blueprintContent?.trim();
          const smTk = await trySectionMergeDeliverable(
            this.ai,
            "tasks",
            mddForLlm,
            legacyOpts,
            { blueprint: bpTasks || undefined },
            run429,
            this.logger,
            {
              attemptSectionMerge: await resolveSectionMergeAttempt("tasks", mddForLlm, {
                blueprintText: bpTasks || undefined,
              }),
            },
          );
          if (smTk) {
            pushSectionMergeTrace(smTk.trace);
            await update({ tasksContent: cleanDocumentContent(smTk.content) });
            p = await load();
            return;
          }
          await this.projects.generateTasks(projectId);
          p = await load();
          return;
        }
        case "infra": {
          const bpInf = await ensureBlueprint(mddForLlm);
          const smIf = await trySectionMergeDeliverable(
            this.ai,
            "infra",
            mddForLlm,
            legacyOpts,
            { blueprint: bpInf },
            run429,
            this.logger,
            {
              attemptSectionMerge: await resolveSectionMergeAttempt("infra", mddForLlm, {
                blueprintText: bpInf,
              }),
            },
          );
          if (smIf) {
            pushSectionMergeTrace(smIf.trace);
            await update({ infraContent: cleanDocumentContent(smIf.content) });
            p = await load();
            return;
          }
          const infraContent = await this.ai.generateInfra(mddForLlm, bpInf, undefined, legacyOpts);
          await update({ infraContent: cleanDocumentContent(infraContent) });
          p = await load();
          return;
        }
        default: {
          const _exhaustive: never = kind;
          return _exhaustive;
        }
      }
    };

    let reverseEngineeringMddForLegacySteps: string | null = null;
    const getReverseEngineeringMddForLegacySteps = (): string => {
      if (reverseEngineeringMddForLegacySteps === null) {
        reverseEngineeringMddForLegacySteps = buildReverseEngineeringMddForLegacySteps(
          codebaseDoc,
          report,
        );
        if (isLegacyDeliverablesDebugVerbose()) {
          this.logger.log(
            `[LegacyDeliverables] reverse_engineering_fallback strategy=${report.mddLlmStrategy ?? "?"} sentChars=${report.mddCharsSentToLlm ?? reverseEngineeringMddForLegacySteps.length}`,
          );
        }
      }
      return reverseEngineeringMddForLegacySteps;
    };

    /** Bulk legacy: `runStepWithMdd` (ProjectsService bloquea LEGACY en spec) o generate-from-codebase. */
    const mddForLlmSteps = (): string => mddContent || getReverseEngineeringMddForLegacySteps();

    const runDeliverableStep = async (kind: DeliverableKind): Promise<void> => {
      if (kind === "mdd_canonical") return;
      if (isReverseEngineering) {
        const docType = DELIVERABLE_KIND_TO_CODEBASE_DOC_TYPE[kind];
        if (docType) {
          await this.coordinator.generateFromCodebase(projectId, docType, stageId);
          return;
        }
        report.pipelineMode = "legacy_run_step_fallback";
        await runStepWithMdd(kind, mddForLlmSteps());
        return;
      }
      await runStepWithMdd(kind, mddForLlmSteps());
    };

    const deliverablesPlanned = planLegacyDeliverablesToGenerate({
      complexity,
      hasMddContent: !!mddContent,
      skipKinds: skipTasksFromHandoff ? (["tasks"] as const) : undefined,
    });
    report.deliverablesOrder = [...deliverablesPlanned];

    if (deliverablesPlanned.length === 0) {
      pushStep({
        kind: "preflight_plan",
        durationMs: 0,
        ok: true,
        detail: "all_deliverables_already_present",
      });
      report.finishedAt = new Date().toISOString();
      report.ok = true;
      await this.persistDeliverablesDebugReport(projectId, report, gateStage?.id);
      if (gateStage?.id) {
        const snapProject = await this.prisma.project.findUnique({ where: { id: projectId } });
        if (snapProject) {
          await persistStageDeliverableSnapshotFromProject(
            this.prisma,
            gateStage.id,
            snapProject,
            { source: "cascade" },
          ).catch((err) =>
            this.logger.warn(
              `[LegacyDeliverables] deliverableSnapshot: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
      }
      options?.onProgress?.({ step: "done", completedSteps: [], index: 0, total: 0 });
      return { ok: true, lastDeliverablesDebug: report };
    }

    pushStep({
      kind: "preflight_plan",
      durationMs: 0,
      ok: true,
      detail: `planned=${deliverablesPlanned.length} skipped=${deliverablesToRun.length - deliverablesPlanned.length} parallel=true`,
    });

    const largeMddCooldown = legacyDeliverablesLargeMddCooldownMs(report.mddChars);
    if (largeMddCooldown > 0) {
      if (isLegacyDeliverablesDebugVerbose()) {
        this.logger.log(
          `[LegacyDeliverables] throttle large_mdd_cooldown_ms=${largeMddCooldown} mddChars=${report.mddChars}`,
        );
      }
      await sleepMs(largeMddCooldown);
    }

    const stepErrors: Array<{ step: string; error: string }> = [];
    let completedCount = 0;
    const totalPlanned = deliverablesPlanned.length;
    const completedStepsReport: string[] = [];

    await Promise.allSettled(
      deliverablesPlanned.map(async (kind) => {
        const t0 = Date.now();
        try {
          await runWithLegacy429Retries(() => runDeliverableStep(kind), { logger: this.logger, step: kind });
          const fresh = await load();
          const outChars = deliverableFieldCharCount(fresh as Record<string, unknown>, kind);
          const short = outChars < 48;
          let detail: string | undefined = short ? "output_under_48_chars" : undefined;
          if (kind === "logic_flows" && report.logicFlowsSection5Coverage) {
            const c = report.logicFlowsSection5Coverage;
            detail = `s5_coverage=${c.coveragePercent}% target=${c.targetPercent}% met=${c.metTarget}${
              c.batchCount ? ` batches=${c.batchCount}` : ""
            }`;
          }
          pushStep({
            kind,
            durationMs: Date.now() - t0,
            ok: true,
            outChars,
            detail,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          pushStep({
            kind,
            durationMs: Date.now() - t0,
            ok: false,
            error: clipDebug(msg, 800),
          });
          stepErrors.push({ step: kind, error: msg });
          if (isLegacy429Like(err)) {
            report.upstreamRateLimited = true;
            report.retryAfterSeconds = readRetryAfterSecondsFromErrorHeaders(err) ?? 60;
          }
        }
        completedCount++;
        const label = DELIVERABLE_STEP_LABELS[kind] ?? kind;
        completedStepsReport.push(label);
        options?.onProgress?.({
          step: label,
          completedSteps: [...completedStepsReport],
          index: completedCount - 1,
          total: totalPlanned,
        });
      }),
    );

    options?.onProgress?.({
      step: "done",
      completedSteps: [...completedStepsReport],
      index: totalPlanned,
      total: totalPlanned,
    });

    p = await load();

    if (stepErrors.length > 0) {
      this.logger.warn(
        `[LegacyDeliverables] Completada con ${stepErrors.length}/${totalPlanned} paso(s) fallido(s): ${stepErrors.map((e) => `${e.step}: ${e.error}`).join("; ")}`,
      );
    }

    if (report.upstreamRateLimited) {
      markFatal(new Error("UPSTREAM_LLM_RATE_LIMIT"));
      await this.persistDeliverablesDebugReport(projectId, report, gateStage?.id);
      const rateLimited = upstreamLlmRateLimitHttpException(new Error("UPSTREAM_LLM_RATE_LIMIT"), report);
      if (rateLimited) throw rateLimited;
    }

    report.finishedAt = new Date().toISOString();
    report.ok = stepErrors.length === 0;
    report.deliverablesWithBody = report.steps.filter(
      (s) =>
        typeof s.outChars === "number" &&
        s.outChars > 48 &&
        s.kind !== "preflight" &&
        s.kind !== "index_sdd_gate" &&
        s.kind !== "theforge_context" &&
        s.kind !== "mdd_canonical",
    ).length;

    await this.persistDeliverablesDebugReport(projectId, report, gateStage?.id);
    if (gateStage?.id) {
      await persistStageDeliverableSnapshotFromProject(this.prisma, gateStage.id, p, {
        source: "cascade",
      }).catch((err) =>
        this.logger.warn(
          `[LegacyDeliverables] deliverableSnapshot: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    const elapsed = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    this.logger.log(
      `[LegacyDeliverables] cascade_ok project=${projectId.slice(0, 8)}… steps=${report.steps.length} withBody=${report.deliverablesWithBody} tfCtxChars=${report.theforgeContextChars} elapsedMs=${elapsed}`,
    );

    return { ok: true, lastDeliverablesDebug: report };
  }
}
