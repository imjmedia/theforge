import { forwardRef, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service.js";
import { PreferencesService } from "../ai/preferences.service.js";
import { AiService } from "../ai/ai.service.js";
import { DiscoveryService } from "../ai/discovery.service.js";
import { Command, isGraphInterrupt } from "@langchain/langgraph";
import { createDbgaGraph } from "./graph/dbga-graph.js";
import { createMddGraph, createMddGraphWithManager } from "./graph/mdd-graph.js";
import { defaultDBGAState, type DBGAState } from "./state/index.js";
import { defaultMDDState, type MDDState, type MDDStateType } from "./state/index.js";
import {
  composeBrdPreamble,
} from "./utils/brd-tobe-gate.util.js";
import { CheckpointerService } from "./checkpoint/checkpointer.service.js";
import { NodeCacheService } from "./checkpoint/node-cache.service.js";
import { EstimationService } from "./estimation/estimation.service.js";
import type { AuditorGaps, MddAgentEditLogEntry } from "./estimation/estimation.types.js";
import { MddStreamEditLogTracker } from "./utils/mdd-agent-edit-log.util.js";
import { stateToMarkdown, getAgentLabel } from "./state/state-to-markdown.js";
import { getMddNodeProgressMessage } from "./utils/mdd-progress-messages.js";
import {
  buildMddStreamProgressEvent,
  createMddNodeStartTracker,
} from "./utils/mdd-stream-progress.util.js";
import {
  extractContextSectionBody,
  extractSection5Body,
  logSection3Debug,
  mergeSingleArchitectSectionIntoDraft,
  replaceSection1BodyFromAnyHeading,
  restoreContextSectionFromBaselineIfMissing,
  restoreMddSectionsFromBaselineStrict,
} from "./utils/mdd-sanitize.js";
import { guardTailSectionsForPersist } from "./utils/mdd-section-preserve.util.js";
import { ProjectsService } from "../projects/projects.service.js";
import { pickPrimaryStage } from "../projects/stage-helpers.js";
import { TheForgeService } from "../theforge/theforge.service.js";
import { AgentSupervisorService } from "../agent-supervisor/agent-supervisor.service.js";
import { EpisodicMemoryKind, type ComplexityLevel } from "@theforge/database";
import { contentIncludesVisionBlock, peelDocumentBodyForPersist, type ChatImagePart, type MddDeliveryGateResult, expandMddSectionsForSync, MDD_SECTION_TITLES } from "@theforge/shared-types";
import { formatVisionContextBlock, mergeUserTextWithVisionBlock } from "../ai/utils/vision-context.util.js";
import { markdownToMddStructured } from "./utils/mdd-markdown-to-structured.js";
import { HumanMessage } from "@langchain/core/messages";
import { createDbgaLLM } from "./llm/create-dbga-llm.js";
import { resolveMddRuntimeWithPreflight } from "./llm/mdd-llm-preflight.util.js";
import { AIFactory } from "../ai/ai.factory.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import { CONTEXT_SYNTHESIZER_PROMPT } from "./prompts/load-prompts.js";
import { createMddIntegrationNode } from "./nodes/mdd-integration.node.js";
import { createMddSecurityNode } from "./nodes/mdd-security.node.js";
import { createMddSection5Node } from "./nodes/mdd-section5.node.js";
import { createMddSoftwareArchitectNode } from "./nodes/mdd-software-architect.node.js";
import {
  agentsForArchitectSection,
  resolveLiveDraftForScopedArchitectStream,
  type MddSoftwareArchitectScope,
} from "./utils/mdd-architect-pipeline.util.js";
import { createMddClarifierNode } from "./nodes/mdd-clarifier.node.js";
import { getMddArchitectTools } from "./tools/tool-registry.js";
import { contextSynthesizerComplexityAppendix } from "./utils/mdd-complexity-rigor.js";
import { formatDbgaStreamError } from "./utils/dbga-stream-error.util.js";
import { awaitWithNdjsonHeartbeat } from "./utils/ndjson-heartbeat.util.js";
import { MddRegenTracer } from "./utils/mdd-regen-tracer.js";
import {
  demoteCanonicalSectionHeadingsInSection1Body,
  isContextSynthesizerBodySubstantial,
  MIN_SECTION1_REGEN_BODY_LENGTH,
  normalizeContextSynthesizerBody,
  resolveUpstreamSyncSection1Body,
} from "./utils/mdd-section1-regen.util.js";
import {
  INSUFFICIENT_DBGA_IDEA_MESSAGE,
  isInsufficientDbgaIdea,
} from "./utils/dbga-idea-validation.util.js";
import { resolveLangGraphRecursionLimit } from "./utils/langgraph-recursion.util.js";
import {
  prepareMddForOutput as prepareMddForOutputCore,
  draftHasSection6Heading,
  type PrepareMddForOutputOptions,
} from "./utils/mdd-prepare-output.js";
import { UiMcpClientService } from "../ui-mcp/ui-mcp-client.service.js";
import { UiMcpService } from "../ui-mcp/ui-mcp.service.js";
import { formatUiMcpLibraryLabel } from "./utils/mdd-inject-ui-mcp-frontend.util.js";
import {
  McpUiComponentResolver,
  heuristicUiComponentResolver,
  type UiComponentResolver,
} from "../ui-mcp/ui-component-resolver.js";
import {
  buildMddWithGovernanceSkeleton,
  ensureMddGovernanceSection,
  extractGovernanceSection,
  mddHasSubstantialBody,
  resolveMddGovernancePreservation,
  updateMddGovernancePatterns,
} from "@theforge/shared-types/mdd-governance-patterns";
import {
  formatGovernancePatternCorrectionsNotice,
  resolveGovernancePatternIncompatibilities,
} from "@theforge/shared-types/mdd-governance-pattern-compat";
import { mddStreamDeliveryGateFields } from "./utils/mdd-delivery-gate.util.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import type { MddJobData, MddJobProgress, MddJobResult } from "./mdd/mdd-queue.service.js";
import { MddUpstreamSyncService } from "./mdd/mdd-upstream-sync.service.js";
import {
  listProjectAdrsFromGovernance,
  persistProjectAdrsToGovernance,
} from "../engine/mdd-coherence/project-adrs-from-governance.util.js";

import type { EstimationComplexity, PrecisionBreakdown } from "./estimation/estimation.types.js";

const LANGGRAPH_RECURSION_LIMIT = resolveLangGraphRecursionLimit();

async function* runRegenWithHeartbeat<T>(
  work: Promise<T>,
  agent: string,
  label: string,
  tracer?: MddRegenTracer,
): AsyncGenerator<StreamProgressEvent, T, undefined> {
  const stepName = `llm:${agent}`;
  const t0 = Date.now();
  tracer?.event(stepName, { label, status: "start" });
  yield { type: "progress", agent, message: label };
  const heartbeat = awaitWithNdjsonHeartbeat(work, () => {
    const elapsed = Date.now() - t0;
    tracer?.heartbeat(stepName, elapsed);
    return {
      type: "progress" as const,
      agent,
      message: `${label} (LLM en curso, ${Math.round(elapsed / 1000)}s)`,
    };
  });
  while (true) {
    const step = await heartbeat.next();
    if (step.done) {
      const dur = Date.now() - t0;
      tracer?.event(stepName, { label, status: "done", duration: `${dur}ms` });
      return step.value;
    }
    yield step.value;
  }
}

export type StreamProgressEvent =
  | { type: "progress"; agent: string; message: string; phase?: "active" | "done" }
  | { type: "draft"; markdown: string; deliveryGate?: MddDeliveryGateResult }
  | { type: "blocked"; code: string; message: string }
  | {
    type: "done";
    markdown: string;
    /** Tras DBGA stream con projectId: propuesta HITL (persistida en `complexityPending`, no aplica `complexity` hasta confirmación en chat). */
    complexityProposal?: { level: ComplexityLevel; planSummary: string; reason?: string };
    precision?: number;
    status?: "red" | "yellow" | "green";
    deliveryGate?: MddDeliveryGateResult;
    auditorFeedback?: string;
    precisionBreakdown?: PrecisionBreakdown;
    auditTrail?: string[];
    mddAgentEditLog?: MddAgentEditLogEntry[];
  }
  | { type: "error"; message: string; code?: string; replanning?: boolean };

/** Eventos del flujo MDD con Manager; interrupt puede ser reply (conversación) o questions (entrevista). */
export type StreamMddManagerEvent =
  | StreamProgressEvent
  | { type: "draft"; markdown: string; deliveryGate?: MddDeliveryGateResult }
  | { type: "blocked"; code: string; message: string }
  | {
    type: "interrupt";
    threadId: string;
    reply?: string;
    questions?: string[];
    /** Plan para aprobación (HITL 4.4): pasos con step_id, task_description, node. */
    plan?: Array<{ step_id: string; task_description: string; node: string }>;
    /** Mensaje que acompaña al plan (ej. "¿Ejecutar este plan?") */
    planMessage?: string;
    markdown?: string;
    precision?: number;
    status?: "red" | "yellow" | "green";
    deliveryGate?: MddDeliveryGateResult;
    precisionBreakdown?: PrecisionBreakdown;
    auditorFeedback?: string;
    auditTrail?: string[];
    mddAgentEditLog?: MddAgentEditLogEntry[];
  };

/**
 * Service for the AI Agentic DBGA (Domain Benchmark & Gap Analysis) pipeline.
 * Orchestrates LangGraph agents; long-running work should return JobId or stream (Step 4).
 * Con checkpointer y projectId, el estado se persiste por thread_id y se puede retomar Fase 0.
 * Inyecta preferencias arquitectónicas (memoria semántica) cuando hay projectId.
 */
/** Guarda lastStepFailed por thread_id cuando un nodo falla; se inyecta al reanudar para que el Manager re-planifique. */
const lastStepFailedByThread = new Map<string, { node: string; error: string }>();

/** Clave de borrador en EstimationService: vacío → solo `projectId` (legacy). */
function stageIdForEstimation(mddStageId: string): string | undefined {
  const s = (mddStageId ?? "").trim();
  return s.length > 0 ? s : undefined;
}

function estimationOpts(
  projectId: string | undefined,
  stageId: string | null | undefined,
  state: Pick<MDDState, "mddComplexity" | "projectId" | "activeStageId"> | null | undefined,
): { projectId?: string; stageId?: string | null; complexity?: EstimationComplexity } {
  const pid = (state?.projectId ?? projectId)?.trim();
  if (!pid) return {};
  const sid = (stageId ?? state?.activeStageId) ?? null;
  return {
    projectId: pid,
    stageId: sid,
    complexity: state?.mddComplexity,
  };
}

function createPrepareOptsWithGate(base: PrepareMddForOutputOptions = {}): {
  opts: PrepareMddForOutputOptions;
  gateRef: { current?: MddDeliveryGateResult };
} {
  const gateRef: { current?: MddDeliveryGateResult } = {};
  return { opts: { ...base, deliveryGateRef: gateRef }, gateRef };
}

function snapshotDeliveryGate(gate: MddDeliveryGateResult | undefined): MddDeliveryGateResult | undefined {
  if (!gate) return undefined;
  return { ok: gate.ok, score: gate.score, blockers: gate.blockers, warnings: gate.warnings };
}

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private readonly createDbgaGraphFn: typeof createDbgaGraph;

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkpointerService: CheckpointerService,
    private readonly preferences: PreferencesService,
    private readonly estimationService: EstimationService,
    private readonly nodeCacheService: NodeCacheService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly theforge: TheForgeService,
    private readonly agentSupervisor: AgentSupervisorService,
    private readonly ai: AiService,
    private readonly discovery: DiscoveryService,
    private readonly aiFactory: AIFactory,
    private readonly uiMcpClient: UiMcpClientService,
    private readonly uiMcp: UiMcpService,
    @Inject(forwardRef(() => MddUpstreamSyncService))
    private readonly mddUpstreamSync: MddUpstreamSyncService,
    @Optional() createDbgaGraphFn?: typeof createDbgaGraph,
  ) {
    this.createDbgaGraphFn = createDbgaGraphFn ?? createDbgaGraph;
  }

  /** Resolver de componentes UI memoizado (TTL corto): MCP compatible activo o heurístico. */
  private uiResolverCache?: { at: number; resolver: UiComponentResolver };

  private async getUiResolver(): Promise<UiComponentResolver> {
    const now = Date.now();
    if (this.uiResolverCache && now - this.uiResolverCache.at < 30_000) {
      return this.uiResolverCache.resolver;
    }
    let resolver: UiComponentResolver = heuristicUiComponentResolver;
    try {
      if (await this.uiMcpClient.isActive()) {
        resolver = new McpUiComponentResolver(this.uiMcpClient);
      }
    } catch {
      resolver = heuristicUiComponentResolver;
    }
    this.uiResolverCache = { at: now, resolver };
    return resolver;
  }

  private async getUiMcpLibraryLabel(): Promise<string | null> {
    try {
      if (!(await this.uiMcpClient.isActive())) return null;
      const meta = await this.uiMcp.getActiveCompatibleMeta();
      return formatUiMcpLibraryLabel(meta);
    } catch {
      return null;
    }
  }

  /**
   * Wrapper async de `prepareMddForOutput` que inyecta el resolver de componentes UI
   * (MCP compatible activo con fallback por-entidad al heurístico). Reemplaza las llamadas directas.
   */
  private async runPrepareMddForOutput(
    input: Parameters<typeof prepareMddForOutputCore>[0],
    options?: PrepareMddForOutputOptions,
  ): Promise<string> {
    const resolver = options?.resolver ?? (await this.getUiResolver());
    const uiMcpLibraryLabel =
      options?.uiMcpLibraryLabel !== undefined
        ? options.uiMcpLibraryLabel
        : await this.getUiMcpLibraryLabel();
    return prepareMddForOutputCore(input, { ...options, resolver, uiMcpLibraryLabel });
  }

  /** Evita persistir MDD con §2–§7 borradas por prepare/dedupe tras borrador sustancial. */
  private guardMarkdownTailForPersist(
    prePrepareDraft: string,
    markdown: string,
  ): { markdown: string; errorMessage?: string } {
    const guard = guardTailSectionsForPersist(prePrepareDraft, markdown, "PersistCheck");
    if (guard.restored) {
      this.logger.warn(
        `[MDD:PersistCheck] §2–§7 restaurada(s) tras prepare (draftLen=${prePrepareDraft.length})`,
      );
    }
    if (guard.failedSections.length > 0) {
      const preS5Len = extractSection5Body(prePrepareDraft)?.length ?? 0;
      const postS5Len = extractSection5Body(guard.markdown)?.length ?? 0;
      this.logger.error(
        `[MDD:PersistCheck] §${guard.failedSections.join("/§")} wipe post-prepare (§5 pre=${preS5Len} post=${postS5Len})`,
      );
      return {
        markdown: guard.markdown,
        errorMessage:
          `El borrador final perdió contenido sustancial en §${guard.failedSections.join(", §")} tras prepare-output. ` +
          "No se persistió la versión dañada; reintenta la generación del MDD.",
      };
    }
    return { markdown: guard.markdown };
  }

  private async resolveUserId(projectId?: string): Promise<string> {
    const pid = projectId?.trim();
    if (pid) {
      const row = await this.prisma.project.findUnique({
        where: { id: pid },
        select: { userId: true },
      });
      if (row?.userId) return row.userId;
    }
    return getRequestUserId();
  }

  /** Contexto agéntico (legacy, Relic, memoria episódica) para el estado MDD. */
  private async buildMddAgentContext(
    projectId: string,
    preferredStageId?: string | null,
  ): Promise<{
    activeStageId?: string;
    isLegacyProject?: boolean;
    theforgeProjectId?: string;
    episodicMemoryContext?: string;
    mddComplexity?: EstimationComplexity;
  }> {
    const pid = projectId?.trim();
    if (!pid) return {};
    const project = await this.prisma.project.findUnique({
      where: { id: pid },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!project) return {};
    const route = await this.agentSupervisor.resolveRouteFromProject(project, preferredStageId);
    const memories = await this.agentSupervisor.getRecentEpisodicMemory(route.stageId, 18);
    const relevant = memories.filter(
      (m) =>
        m.kind === EpisodicMemoryKind.EVALUATOR_REJECTION ||
        m.kind === EpisodicMemoryKind.REFLEXION_FEEDBACK,
    );
    const episodicMemoryContext =
      relevant.length > 0
        ? relevant
            .map((m) => `[${m.kind}] ${m.content.slice(0, 2000)}`)
            .join("\n---\n")
            .slice(0, 12000)
        : undefined;
    return {
      activeStageId: route.stageId,
      isLegacyProject: route.flow === "LEGACY",
      theforgeProjectId: route.theforgeProjectId ?? undefined,
      episodicMemoryContext,
      mddComplexity: project.complexity as EstimationComplexity,
    };
  }

  /** Devuelve el threadId del flujo MDD para el proyecto (y etapa opcional), si existe. */
  async getMddThreadId(projectId: string, stageId?: string | null): Promise<string | null> {
    if (!projectId?.trim()) return null;
    const mddStageId = stageId?.trim() ?? "";
    const row = await this.prisma.agentStateCheckpoint.findUnique({
      where: {
        projectId_mddStageId: { projectId: projectId.trim(), mddStageId },
      },
      select: { threadId: true },
    });
    return row?.threadId ?? null;
  }

  /** Borra checkpoint para ese par proyecto / etapa (`mddStageId` vacío = hilo DBGA). */
  async clearMddCheckpoint(projectId: string, mddStageId = ""): Promise<void> {
    if (!projectId?.trim()) return;
    await this.prisma.agentStateCheckpoint.deleteMany({
      where: { projectId: projectId.trim(), mddStageId: mddStageId.trim() },
    });
    this.nodeCacheService.invalidateAll();
  }

  /**
   * Revisión de consistencia del MDD: re-deriva diagramas desde el contenido (ER desde SQL, etc.)
   * y devuelve el documento actualizado. No llama a LLMs; solo reglas determinísticas.
   */
  async reviewMddConsistency(projectId: string, mddContentOverride?: string): Promise<string> {
    const content =
      mddContentOverride != null && mddContentOverride.length > 0
        ? mddContentOverride
        : (await this.estimationService.getMddContentForProject(projectId)) ?? "";
    const draft = (content || "").trim();
    if (draft.length < 200) return draft;
    return await this.runPrepareMddForOutput(draft);
  }

  /**
   * Starts the DBGA analysis for a raw user idea.
   * Si se pasa projectId, se usa o crea un thread_id por proyecto para persistir estado (retomar después).
   */
  async startAnalysis(idea: string, projectId?: string): Promise<DBGAState> {
    const checkpointer = await this.checkpointerService.getCheckpointer();
    const userId = await this.resolveUserId(projectId);
    const graph = await this.createDbgaGraphFn(this.aiFactory, userId, checkpointer ?? undefined);

    let threadId: string;
    if (projectId?.trim()) {
      const row = await this.prisma.agentStateCheckpoint.upsert({
        where: {
          projectId_mddStageId: { projectId: projectId.trim(), mddStageId: "" },
        },
        create: {
          threadId: randomUUID(),
          projectId: projectId.trim(),
          mddStageId: "",
        },
        update: {},
      });
      threadId = row.threadId;
    } else {
      threadId = randomUUID();
    }

    const userPreferences = await this.preferences.getPreferencesForContext(
      projectId?.trim() ?? undefined,
      5,
    );

    const initialState: DBGAState = {
      ...defaultDBGAState,
      rawIdea: idea.trim(),
      status: "idle",
      userPreferences: userPreferences || undefined,
    };
    const config = checkpointer
      ? { configurable: { thread_id: threadId } as Record<string, string> }
      : undefined;
    const finalState = await graph.invoke(initialState, {
      ...config,
      recursionLimit: LANGGRAPH_RECURSION_LIMIT,
    });
    return finalState as DBGAState;
  }

  /**
   * Streams the DBGA analysis: emite eventos de progreso (qué agente trabaja) y al final el markdown.
   * Usa graph.stream con streamMode "values" para obtener estado completo tras cada paso.
   */
  async *streamAnalysis(
    idea: string,
    projectId?: string,
  ): AsyncGenerator<StreamProgressEvent> {
    if (isInsufficientDbgaIdea(idea)) {
      yield {
        type: "error",
        message: INSUFFICIENT_DBGA_IDEA_MESSAGE,
        code: "INSUFFICIENT_IDEA",
      };
      return;
    }

    let checkpointer: Awaited<ReturnType<CheckpointerService["getCheckpointer"]>>;
    let graph: Awaited<ReturnType<typeof createDbgaGraph>>;
    try {
      checkpointer = await this.checkpointerService.getCheckpointer();
      const userId = await this.resolveUserId(projectId);
      graph = await this.createDbgaGraphFn(this.aiFactory, userId, checkpointer ?? undefined);
    } catch (err) {
      yield { type: "error", ...formatDbgaStreamError(err) };
      return;
    }

    let threadId: string;
    if (projectId?.trim()) {
      await this.clearMddCheckpoint(projectId.trim(), "");
      const row = await this.prisma.agentStateCheckpoint.upsert({
        where: {
          projectId_mddStageId: { projectId: projectId.trim(), mddStageId: "" },
        },
        create: {
          threadId: randomUUID(),
          projectId: projectId.trim(),
          mddStageId: "",
        },
        update: {},
      });
      threadId = row.threadId;
    } else {
      threadId = randomUUID();
    }

    const userPreferences = await this.preferences.getPreferencesForContext(
      projectId?.trim() ?? undefined,
      5,
    );

    const initialState: DBGAState = {
      ...defaultDBGAState,
      rawIdea: idea.trim(),
      status: "idle",
      userPreferences: userPreferences || undefined,
    };
    const config = checkpointer
      ? { configurable: { thread_id: threadId } as Record<string, string> }
      : undefined;

    const order: Array<{ node: string; message: string }> = [
      { node: "scout", message: "Competidores y referencias de mercado recopilados" },
      { node: "auditor", message: "Tech stack de competidores analizado" },
      { node: "critic", message: "Calidad de la investigación validada" },
      { node: "synthesis", message: "Documento de Gap Analysis generado" },
    ];

    let lastState: Record<string, unknown> = {};
    let stepIndex = 0;

    try {
      const stream = await graph.stream(initialState, {
        ...config,
        recursionLimit: LANGGRAPH_RECURSION_LIMIT,
        streamMode: "values",
      });

      for await (const chunk of stream) {
        // LangGraph streamMode "values" yields [namespace, "values", state] or plain state
        const raw = chunk as unknown;
        const state: Record<string, unknown> =
          Array.isArray(raw) && raw[1] === "values" && raw[2] != null
            ? (raw[2] as Record<string, unknown>)
            : (raw as Record<string, unknown>) ?? {};
        const prev = lastState;
        lastState = state;

        const hadCompetitors = Array.isArray(prev.competitors) && (prev.competitors as unknown[]).length > 0;
        const hasCompetitors = Array.isArray(state.competitors) && (state.competitors as unknown[]).length > 0;
        const hadTech = Array.isArray(prev.techStackInsights) && (prev.techStackInsights as unknown[]).length > 0;
        const hasTech = Array.isArray(state.techStackInsights) && (state.techStackInsights as unknown[]).length > 0;
        const hasDecision = state.criticDecision != null;
        const hadDecision = prev.criticDecision != null;
        const hasGap = typeof state.gapAnalysis === "string" && (state.gapAnalysis as string).trim().length > 0;
        const hadGap = typeof prev.gapAnalysis === "string" && (prev.gapAnalysis as string).trim().length > 0;

        if (!hadCompetitors && hasCompetitors) {
          yield { type: "progress", agent: getAgentLabel("scout"), message: order[0].message };
        }
        if (!hadTech && hasTech) {
          yield { type: "progress", agent: getAgentLabel("auditor"), message: order[1].message };
        }
        if (!hadDecision && hasDecision) {
          yield { type: "progress", agent: getAgentLabel("critic"), message: order[2].message };
        }
        if (!hadGap && hasGap) {
          yield { type: "progress", agent: getAgentLabel("synthesis"), message: order[3].message };
        }

        stepIndex += 1;
      }

      const finalState = lastState as DBGAState;
      const markdown = stateToMarkdown(finalState);

      let complexityProposal: { level: ComplexityLevel; planSummary: string; reason?: string } | undefined;
      const pid = projectId?.trim();
      if (pid) {
        try {
          const proposal = await this.discovery.inferComplexityProposal(idea.trim(), markdown);
          complexityProposal = proposal;
          await this.projects.update(pid, { complexityPending: proposal });
        } catch (err) {
          this.logger.warn(
            `inferComplexityProposal/update project failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      yield {
        type: "done",
        markdown,
        ...(complexityProposal != null ? { complexityProposal } : {}),
      };
    } catch (err) {
      yield { type: "error", ...formatDbgaStreamError(err) };
    }
  }

  /**
   * Streams the MDD (Master Design Document) pipeline: Clarificador → Security → Integration → Auditor.
   * Si el Auditor da score < 85%, el Manager asigna gaps a los agentes; >= 85% cede al usuario (máx. iteraciones según config).
   * Emite eventos progress por nodo y al final done con el markdown del MDD.
   */
  async *streamMddAnalysis(
    dbgaContent: string,
    projectId?: string,
    stageId?: string | null,
    clientMddContent?: string,
  ): AsyncGenerator<StreamProgressEvent> {
    let estimationStage: string | undefined;
    let brdContent: string | null = null;
    let preservedGovernance: string | null = null;
    let existingStageMdd = "";
    if (projectId?.trim()) {
      const p = await this.prisma.project.findUnique({
        where: { id: projectId.trim() },
        include: { stages: { orderBy: { ordinal: "asc" } } },
    });
      if (p) {
        const route = await this.agentSupervisor.resolveRouteFromProject(p, stageId);
        estimationStage = route.stageId;
        this.estimationService.cacheProjectComplexity(
          projectId.trim(),
          estimationStage ?? null,
          p.complexity as EstimationComplexity,
        );
        if (estimationStage?.trim()) {
          const stage = await this.prisma.stage.findUnique({
            where: { id: estimationStage.trim() },
            select: { brdContent: true, mddContent: true },
          });
          brdContent = stage?.brdContent ?? null;
          existingStageMdd = peelDocumentBodyForPersist(stage?.mddContent ?? "").trim();
          ({ preservedGovernance } = resolveMddGovernancePreservation(
            clientMddContent,
            existingStageMdd,
          ));
        }
      }
    }
    const { opts: prepareOpts, gateRef: prepareGateRef } = createPrepareOptsWithGate({ preservedGovernance });
    const uiMcpFrontendLibraryLabel = await this.getUiMcpLibraryLabel();
    const nodeStart = createMddNodeStartTracker();
    let graph: Awaited<ReturnType<typeof createMddGraph>>;
    try {
      const userId = await this.resolveUserId(projectId);
      const preflightRuntime = await resolveMddRuntimeWithPreflight(this.aiFactory, userId);
      graph = await createMddGraph(this.aiFactory, userId, {
        theforge: this.theforge,
        nodeCache: this.nodeCacheService,
        uiMcpFrontendLibraryLabel,
        onNodeStart: nodeStart.onNodeStart,
        preflightRuntime,
        prisma: this.prisma,
      });
    } catch (err) {
      const formatted = formatDbgaStreamError(err);
      yield { type: "error", message: formatted.message, code: formatted.code };
      return;
    }
    const agentCtx = projectId?.trim() ? await this.buildMddAgentContext(projectId.trim(), stageId) : {};
    let dbgaEffective =
      dbgaContent.trim() ||
      "(Sin Benchmark. El usuario no tiene un documento de Benchmark; genera un MDD base con contexto, alcance y requisitos que el usuario podrá refinar.)";
    const brdPreamble = composeBrdPreamble(brdContent);
    if (brdPreamble) dbgaEffective = brdPreamble + dbgaEffective;
    const initialState: MDDState = {
      ...defaultMDDState,
      dbgaContent: dbgaEffective,
      brdContent: (brdContent ?? "").trim() || undefined,
      projectId: projectId?.trim(),
      ...agentCtx,
      ...(preservedGovernance
        ? {
            mddDraft: mddHasSubstantialBody(existingStageMdd)
              ? ensureMddGovernanceSection(existingStageMdd, preservedGovernance)
              : buildMddWithGovernanceSkeleton("Master Design Document", preservedGovernance),
          }
        : {}),
    };

    let lastState: MDDState = initialState;
    const auditTrail: string[] = [];
    const editLogTracker = new MddStreamEditLogTracker(
      initialState.mddDraft ?? "",
      initialState.internalDirectives,
    );

    try {
      const stream = await graph.stream(initialState, {
        recursionLimit: LANGGRAPH_RECURSION_LIMIT,
        streamMode: ["updates", "values"] as const,
      });

      for await (const raw of stream) {
        const pendingNode = nodeStart.takePendingNodeStart();
        if (pendingNode) {
          yield buildMddStreamProgressEvent(pendingNode, "active");
        }
        const [mode, data] = Array.isArray(raw) ? (raw as [string, unknown]) : ["values", raw];
        if (mode === "updates" && data && typeof data === "object" && !Array.isArray(data)) {
          const dataRecord = data as Record<string, unknown>;
          const nodeName = Object.keys(dataRecord)[0];
          if (nodeName) {
            editLogTracker.noteNodeUpdate(nodeName);
            const nodeData = dataRecord[nodeName] as Partial<MDDState> | undefined;
            const draftLen = nodeData?.mddDraft?.length;
            const scopeLen = nodeData?.clarifiedScope?.length;
            const extra: string[] = [];
            if (draftLen) extra.push(`draft=${draftLen}`);
            if (scopeLen) extra.push(`scope=${scopeLen}`);
            auditTrail.push(`${nodeName}(${extra.join(" ")})`);
            yield buildMddStreamProgressEvent(nodeName, "done");
          }
        }
        if (mode === "values" && data && typeof data === "object") {
          const stableDraft = editLogTracker.getLastDraft();
          const pendingNode = editLogTracker.peekPendingNode();
          lastState = data as MDDState;
          editLogTracker.noteValuesState(lastState);
          const draft = resolveLiveDraftForScopedArchitectStream(
            pendingNode ?? undefined,
            (lastState.mddDraft ?? "").trim(),
            stableDraft,
          );
          if (projectId?.trim() && draft) {
            this.estimationService.setLiveDraft(projectId.trim(), draft, estimationStage);
            if (lastState.auditorGaps) {
              this.estimationService.setAuditorGaps(projectId.trim(), lastState.auditorGaps, estimationStage);
            }
            const prepared = await this.runPrepareMddForOutput(
              { mddStructured: lastState.mddStructured, mddDraft: draft },
              prepareOpts,
            );
            if (prepared.length > 80) {
              yield {
                type: "draft",
                markdown: prepared,
                deliveryGate: snapshotDeliveryGate(prepareGateRef.current),
              };
            }
          }
        }
      }

      const mddDraftRaw = (lastState.mddDraft ?? "").trim();
      const raw = mddDraftRaw || "# Master Design Document\n\n(Sin contenido generado.)";
      let markdown = await this.runPrepareMddForOutput(
        {
          mddStructured: lastState.mddStructured,
          mddDraft: raw || lastState.mddDraft,
        },
        { ...prepareOpts, baselineDraft: mddDraftRaw || undefined },
      );
      const tailPersistGuard = this.guardMarkdownTailForPersist(mddDraftRaw, markdown);
      markdown = tailPersistGuard.markdown;
      if (tailPersistGuard.errorMessage) {
        yield { type: "error", message: tailPersistGuard.errorMessage };
        return;
      }
      this.logger.log(`[MDD:PersistCheck] mddDraft len=${mddDraftRaw.length} first200=${JSON.stringify(mddDraftRaw.slice(0, 200))}`);
      this.logger.log(`[MDD:PersistCheck] markdown post-prepare len=${markdown.length} first200=${JSON.stringify(markdown.slice(0, 200))}`);
      logSection3Debug("final (stream done)", markdown);
      if (projectId?.trim()) this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
      const estOptsDone = estimationOpts(projectId, estimationStage, lastState);
      const metrics = this.estimationService.calculateLiveMetrics(markdown, estOptsDone);
      const precisionBreakdown = this.estimationService.getPrecisionBreakdown(markdown, estOptsDone);
      this.persistMddAuditSnapshot(projectId, estimationStage, {
        auditTrail,
        mddAgentEditLog: editLogTracker.log,
        precisionBreakdown,
        auditorGaps: lastState.auditorGaps ?? undefined,
      });
      const gateFields = mddStreamDeliveryGateFields(prepareGateRef.current, metrics.status);
      yield {
        type: "done",
        markdown,
        precision: metrics.precision,
        status: gateFields.status,
        deliveryGate: gateFields.deliveryGate,
        auditorFeedback: lastState.auditorFeedback?.trim() || undefined,
        precisionBreakdown,
        auditTrail,
        mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
      };
    } catch (err) {
      if (projectId?.trim()) this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
      const formatted = formatDbgaStreamError(err);
      yield { type: "error", message: formatted.message, code: formatted.code };
    }
  }

  /**
   * Flujo MDD con Manager (Supervisor): entrevista al usuario (máx. 2 preguntas por ronda),
   * envía contexto a especialistas; termina cuando el Auditor da >= 85% (cede intervención al usuario) o usuario pide parar.
   * Emite "interrupt" con questions y threadId cuando el Manager pide respuestas; luego usar streamMddResume.
   */
  async *streamMddAnalysisWithManager(
    dbgaContent: string,
    projectId: string,
    initialMessage?: string,
    initialMddDraft?: string,
    stageIdFromClient?: string | null,
    imageAttachments?: ChatImagePart[],
  ): AsyncGenerator<StreamMddManagerEvent> {
    this.logger.log(`[MDD stream/manager] start projectId=${projectId} initialMessage=${initialMessage ? "(presente)" : "(vacío)"} mddDraftLen=${(initialMddDraft ?? "").length}`);

    const checkpointer = await this.checkpointerService.getCheckpointer();
    if (!checkpointer) {
      this.logger.warn("[MDD stream/manager] Checkpointer no disponible");
      yield { type: "error", message: "Checkpointer no disponible; el flujo con Manager requiere persistencia." };
      return;
    }

    const projRow = await this.prisma.project.findUnique({
      where: { id: projectId.trim() },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!projRow) {
      yield { type: "error", message: "Proyecto no encontrado." };
      return;
    }
    const route = await this.agentSupervisor.resolveRouteFromProject(projRow, stageIdFromClient);
    const mddStageKey = route.stageId;
    const estimationStageId = mddStageKey;
    this.estimationService.cacheProjectComplexity(
      projectId.trim(),
      estimationStageId ?? null,
      projRow.complexity as EstimationComplexity,
    );

    const brdContent = mddStageKey?.trim()
      ? (await this.prisma.stage.findUnique({ where: { id: mddStageKey.trim() }, select: { brdContent: true } }))?.brdContent ?? null
      : null;

    const row = await this.prisma.agentStateCheckpoint.upsert({
      where: {
        projectId_mddStageId: { projectId: projectId.trim(), mddStageId: mddStageKey },
      },
      create: {
        threadId: randomUUID(),
        projectId: projectId.trim(),
        mddStageId: mddStageKey,
      },
      update: { threadId: randomUUID() },
    });
    const threadId = row.threadId;

    let graph: Awaited<ReturnType<typeof createMddGraphWithManager>>;
    try {
      const mddUserId = await this.resolveUserId(projectId);
      const preflightRuntime = await resolveMddRuntimeWithPreflight(this.aiFactory, mddUserId);
      const uiMcpFrontendLibraryLabel = await this.getUiMcpLibraryLabel();
      graph = await createMddGraphWithManager(
        this.aiFactory,
        mddUserId,
        checkpointer,
        this.estimationService,
        {
          projects: this.projects,
          theforge: this.theforge,
          ai: this.ai,
        },
        {
          theforge: this.theforge,
          nodeCache: this.nodeCacheService,
          uiMcpFrontendLibraryLabel,
          preflightRuntime,
          prisma: this.prisma,
        },
      );
    } catch (err) {
      const formatted = formatDbgaStreamError(err);
      this.logger.error(`[MDD stream/manager] setup error: ${formatted.message}`, err instanceof Error ? err.stack : String(err));
      yield { type: "error", message: formatted.message, code: formatted.code };
      return;
    }
    const agentCtx = await this.buildMddAgentContext(projectId, stageIdFromClient);
    const existingMdd = (initialMddDraft ?? "").trim();
    const { opts: managerPrepareOpts, gateRef: managerGateRef } = createPrepareOptsWithGate({
      preservedGovernance: extractGovernanceSection(existingMdd),
    });
    const rawInitial = (initialMessage ?? "").trim();
    const looksLikeMddDocument =
      rawInitial.length > 500 &&
      /^#\s*Master\s+Design\s+Document/i.test(rawInitial) &&
      /\n##\s*1\.\s*Contexto/i.test(rawInitial);
    let lastUserMessage = looksLikeMddDocument
      ? undefined
      : (rawInitial || undefined);
    if (looksLikeMddDocument) {
      this.logger.warn("[MDD stream/manager] initialMessage parece el documento MDD (no la petición del usuario); se ignora como lastUserMessage");
    }
    if (imageAttachments?.length && !contentIncludesVisionBlock(rawInitial)) {
      try {
        const summary = await this.ai.describeImagesForMddPipeline(rawInitial, imageAttachments);
        const block = formatVisionContextBlock(summary);
        if (block) {
          lastUserMessage = lastUserMessage?.trim()
            ? mergeUserTextWithVisionBlock(lastUserMessage, block)
            : block;
        }
      } catch (e) {
        this.logger.warn(`[MDD stream/manager] describeImages failed: ${String(e)}`);
      }
    }
    let dbgaEffective = (dbgaContent || projRow?.dbgaContent || projRow?.phase0SummaryContent || "").trim()
      || "(Sin Benchmark. El usuario no tiene un documento de Benchmark; genera un MDD base.)";
    const brdPreamble = composeBrdPreamble(brdContent);
    if (brdPreamble) dbgaEffective = brdPreamble + dbgaEffective;
    const initialState: MDDState = {
      ...defaultMDDState,
      dbgaContent: dbgaEffective,
      brdContent: (brdContent ?? "").trim() || undefined,
      lastUserMessage,
      mddDraft: existingMdd || defaultMDDState.mddDraft,
      projectId: projectId?.trim(),
      ...agentCtx,
    };
    const config = {
      configurable: { thread_id: threadId } as Record<string, string>,
      recursionLimit: LANGGRAPH_RECURSION_LIMIT,
    };

    let lastState: MDDState = initialState;
    let lastNonEmptyDraft = (initialState.mddDraft ?? "").trim() || "";
    const auditTrail: string[] = [];
    const editLogTracker = new MddStreamEditLogTracker(
      initialState.mddDraft ?? "",
      initialState.internalDirectives,
    );

    try {
      const stream = await graph.stream(initialState, {
        ...config,
        streamMode: ["updates", "values"] as const,
      });

      for await (const raw of stream) {
        const [mode, data] = Array.isArray(raw) ? (raw as [string, unknown]) : ["values", raw];
        if (mode === "updates" && data && typeof data === "object" && !Array.isArray(data)) {
          const dataRecord = data as Record<string, unknown>;
          const nodeName = Object.keys(dataRecord)[0];
          if (nodeName && nodeName !== "__interrupt__") {
            editLogTracker.noteNodeUpdate(nodeName);
            const nodeData = dataRecord[nodeName] as Partial<MDDState> | undefined;
            const draftLen = nodeData?.mddDraft?.length;
            const scopeLen = nodeData?.clarifiedScope?.length;
            const extra = [];
            if (draftLen) extra.push(`draft=${draftLen}`);
            if (scopeLen) extra.push(`scope=${scopeLen}`);
            auditTrail.push(`${nodeName}(${extra.join(" ")})`);
          }
          if (nodeName === "__interrupt__") {
            const interrupts = dataRecord.__interrupt__ as Array<{
              value?: { type?: string; reply?: string; questions?: string[]; plan?: Array<{ step_id: string; task_description: string; node: string }>; message?: string };
            }> | undefined;
            const first = Array.isArray(interrupts) ? interrupts[0] : undefined;
            const value = first?.value;
            let reply = typeof value?.reply === "string" ? value.reply : undefined;
            let questions = Array.isArray(value?.questions) ? value.questions : typeof value?.questions === "string" ? [value.questions] : [];
            if (value?.type === "questions" && questions.length === 0) {
              questions = [
                "¿Cuáles son los objetivos principales del sistema o producto?",
                "¿Qué aplicaciones o sistemas deben integrarse (ej. SSO, APIs)?",
              ];
            }
            const plan = value?.type === "plan_approval" && Array.isArray(value?.plan) ? value.plan : undefined;
            const planMessage = value?.type === "plan_approval" && typeof value?.message === "string" ? value.message : undefined;
            let draftOnInterrupt = await this.runPrepareMddForOutput(
              {
                mddStructured: lastState?.mddStructured,
                mddDraft: (lastState?.mddDraft ?? "").trim(),
              },
              managerPrepareOpts,
            );
            if (draftOnInterrupt.length < 200 && existingMdd.length >= 200) {
              draftOnInterrupt = await this.runPrepareMddForOutput(existingMdd, managerPrepareOpts);
            }
            const estOpts = estimationOpts(projectId, estimationStageId, lastState);
            const metrics = this.estimationService.calculateLiveMetrics(draftOnInterrupt, estOpts);
            const precisionBreakdown = this.estimationService.getPrecisionBreakdown(draftOnInterrupt, estOpts);
            if (reply && /Estamos al \d+%/.test(reply)) {
              reply = reply.replace(/\bEstamos al \d+%/, `Estamos al ${metrics.precision}%`);
            }
            this.persistMddAuditSnapshot(projectId, estimationStageId, {
              auditTrail,
              mddAgentEditLog: editLogTracker.log,
              precisionBreakdown,
              auditorGaps: lastState?.auditorGaps ?? undefined,
            });
            const gateFields = mddStreamDeliveryGateFields(managerGateRef.current, metrics.status);
            this.logger.log(`[MDD stream/manager] interrupt (from stream) reply=${reply ? "(presente)" : "(no)"} questions=${questions?.length ?? 0} plan=${plan?.length ?? 0} markdownLen=${draftOnInterrupt.length}`);
            yield {
              type: "interrupt",
              threadId,
              reply,
              questions: questions.length > 0 ? questions.slice(0, 2) : undefined,
              plan,
              planMessage,
              markdown: draftOnInterrupt || undefined,
              precision: metrics.precision,
              status: gateFields.status,
              deliveryGate: gateFields.deliveryGate,
              precisionBreakdown,
              auditorFeedback: lastState?.auditorFeedback?.trim() || undefined,
              auditTrail,
              mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
            };
            return;
          }
          if (nodeName) {
            const label = nodeName === "auditor" ? getAgentLabel("auditor", "mdd") : nodeName === "manager" ? "Manager (entrevista)" : getAgentLabel(nodeName);
            this.logger.log(`[MDD stream/manager] progress node=${nodeName} label=${label}`);
            yield { type: "progress", agent: label, message: getMddNodeProgressMessage(nodeName) };
          }
        }
        if (mode === "values" && data && typeof data === "object") {
          const stableDraft = editLogTracker.getLastDraft();
          const pendingNode = editLogTracker.peekPendingNode();
          lastState = data as MDDState;
          editLogTracker.noteValuesState(lastState);
          const draft = resolveLiveDraftForScopedArchitectStream(
            pendingNode ?? undefined,
            (lastState.mddDraft ?? "").trim(),
            stableDraft,
          );
          if (draft) {
            lastNonEmptyDraft = draft;
            this.estimationService.setLiveDraft(projectId.trim(), draft, estimationStageId);
            if (lastState.auditorGaps) {
              this.estimationService.setAuditorGaps(projectId.trim(), lastState.auditorGaps, estimationStageId);
            }
            const prepared = await this.runPrepareMddForOutput(
              {
                mddStructured: lastState?.mddStructured,
                mddDraft: draft,
              },
              managerPrepareOpts,
            );
            if (prepared.length > 80) {
              yield {
                type: "draft",
                markdown: prepared,
                deliveryGate: snapshotDeliveryGate(managerGateRef.current),
              };
            }
          }
        }
      }

      const finalDraft = (lastState?.mddDraft ?? "").trim();
      let rawMarkdown =
        finalDraft ||
        (lastNonEmptyDraft && lastNonEmptyDraft.length > 80 ? lastNonEmptyDraft : "") ||
        "# Master Design Document\n\n(Sin contenido generado.)";
      if (rawMarkdown.length < 200 && existingMdd.length >= 200) {
        rawMarkdown = existingMdd;
      }
      let markdown = await this.runPrepareMddForOutput(
        {
          mddStructured: lastState?.mddStructured,
          mddDraft: rawMarkdown,
        },
        { ...managerPrepareOpts, baselineDraft: finalDraft || undefined },
      );
      const managerTailGuard = this.guardMarkdownTailForPersist(finalDraft, markdown);
      markdown = managerTailGuard.markdown;
      if (managerTailGuard.errorMessage) {
        yield { type: "error", message: managerTailGuard.errorMessage };
        return;
      }
      logSection3Debug("final (stream/manager done)", markdown);
      
      if (projectId?.trim()) {
        this.estimationService.clearLiveDraft(projectId.trim(), estimationStageId);
        this.clearMddCheckpoint(projectId.trim(), mddStageKey).catch(() => { });
      }
      const estOptsDone = estimationOpts(projectId, estimationStageId, lastState);
      const metrics = this.estimationService.calculateLiveMetrics(markdown, estOptsDone);
      const precisionBreakdown = this.estimationService.getPrecisionBreakdown(markdown, estOptsDone);
      this.logger.log(`[MDD stream/manager] done markdownLen=${markdown.length} finalDraftLen=${finalDraft.length} lastNonEmptyLen=${lastNonEmptyDraft.length} auditTrail=${auditTrail.length}`);
      this.persistMddAuditSnapshot(projectId, estimationStageId, {
        auditTrail,
        mddAgentEditLog: editLogTracker.log,
        precisionBreakdown,
        auditorGaps: lastState?.auditorGaps ?? undefined,
      });
      const managerDoneGate = mddStreamDeliveryGateFields(managerGateRef.current, metrics.status);
      yield {
        type: "done",
        markdown,
        precision: metrics.precision,
        status: managerDoneGate.status,
        deliveryGate: managerDoneGate.deliveryGate,
        auditorFeedback: lastState?.auditorFeedback?.trim() || undefined,
        precisionBreakdown,
        auditTrail,
        mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
      };
    } catch (err) {
      if (isGraphInterrupt(err) && err.interrupts?.length > 0) {
        const value = err.interrupts[0]?.value as {
          type?: string;
          reply?: string;
          questions?: string[];
          plan?: Array<{ step_id: string; task_description: string; node: string }>;
          message?: string;
        } | undefined;
        let reply = typeof value?.reply === "string" ? value.reply : undefined;
        let questions = Array.isArray(value?.questions) ? value.questions : typeof value?.questions === "string" ? [value.questions] : [];
        if (value?.type === "questions" && questions.length === 0) {
          questions = [
            "¿Cuáles son los objetivos principales del sistema o producto?",
            "¿Qué aplicaciones o sistemas deben integrarse (ej. SSO, APIs)?",
          ];
        }
        const plan = value?.type === "plan_approval" && Array.isArray(value?.plan) ? value.plan : undefined;
        const planMessage = value?.type === "plan_approval" && typeof value?.message === "string" ? value.message : undefined;
        let draftOnInterrupt = await this.runPrepareMddForOutput(
          {
            mddStructured: lastState?.mddStructured,
            mddDraft: (lastState?.mddDraft ?? "").trim(),
          },
          managerPrepareOpts,
        );
        if (draftOnInterrupt.length < 200 && existingMdd.length >= 200) {
          draftOnInterrupt = await this.runPrepareMddForOutput(existingMdd, managerPrepareOpts);
        }
        const estOptsCatch = estimationOpts(projectId, estimationStageId, lastState);
        const metrics = this.estimationService.calculateLiveMetrics(draftOnInterrupt, estOptsCatch);
        const precision = metrics.precision;
        const catchGateFields = mddStreamDeliveryGateFields(managerGateRef.current, metrics.status);
        const precisionBreakdown = this.estimationService.getPrecisionBreakdown(draftOnInterrupt, estOptsCatch);
        const auditorFeedback = lastState?.auditorFeedback?.trim() || undefined;
        if (reply && /Estamos al \d+%/.test(reply)) {
          reply = reply.replace(/\bEstamos al \d+%/, `Estamos al ${metrics.precision}%`);
        }
        this.logger.log(`[MDD stream/manager] interrupt reply=${reply ? "(presente)" : "(no)"} questions=${questions?.length ?? 0} plan=${plan?.length ?? 0} markdownLen=${draftOnInterrupt.length}`);
        yield {
          type: "interrupt",
          threadId,
          reply,
          questions: questions.length > 0 ? questions.slice(0, 2) : undefined,
          plan,
          planMessage,
          markdown: draftOnInterrupt || undefined,
          precision,
          status: catchGateFields.status,
          deliveryGate: catchGateFields.deliveryGate,
          precisionBreakdown,
          auditorFeedback,
          auditTrail: [],
          mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
        };
        return;
      }
      this.estimationService.clearLiveDraft(projectId.trim(), estimationStageId);
      const formatted = formatDbgaStreamError(err);
      const message = formatted.message;
      this.logger.error(`[MDD stream/manager] error: ${message}`, err instanceof Error ? err.stack : String(err));
      lastStepFailedByThread.set(threadId, { node: "unknown", error: message });
      if (formatted.code === "MODELS_UNAVAILABLE") {
        yield { type: "error", message: formatted.message, code: formatted.code };
        return;
      }
      yield {
        type: "error",
        message: `${message} Reanuda con un mensaje (ej. "reintentar" o "omitir") y el Manager re-planificará.`,
        replanning: true,
      };
    }
  }

  /**
   * Reanuda el flujo MDD con Manager tras la respuesta del usuario (preguntas o conversación).
   */
  async *streamMddResume(
    projectId: string,
    threadId: string,
    userMessage: string,
    mddContentFromClient?: string,
    imageAttachments?: ChatImagePart[],
  ): AsyncGenerator<StreamMddManagerEvent> {
    let resumeText = (userMessage ?? "").trim();
    if (imageAttachments?.length && !contentIncludesVisionBlock(resumeText)) {
      try {
        const summary = await this.ai.describeImagesForMddPipeline(resumeText, imageAttachments);
        const block = formatVisionContextBlock(summary);
        if (block) {
          resumeText = resumeText
            ? mergeUserTextWithVisionBlock(resumeText, block)
            : block;
        }
      } catch (e) {
        this.logger.warn(`[MDD stream/resume] describeImages failed: ${String(e)}`);
      }
    }
    this.logger.log(`[MDD stream/resume] start projectId=${projectId} threadId=${threadId} userMessageLen=${resumeText.length} mddContentLen=${(mddContentFromClient ?? "").length}`);

    const checkpointer = await this.checkpointerService.getCheckpointer();
    if (!checkpointer) {
      this.logger.warn("[MDD stream/resume] Checkpointer no disponible");
      yield { type: "error", message: "Checkpointer no disponible." };
      return;
    }

    const cp = await this.prisma.agentStateCheckpoint.findFirst({
      where: { projectId: projectId.trim(), threadId: threadId.trim() },
    });
    if (!cp) {
      yield { type: "error", message: "No hay checkpoint para este hilo. Inicia el flujo MDD con Manager." };
      return;
    }
    const estimationStage = stageIdForEstimation(cp.mddStageId);
    const preferredStageForCtx = cp.mddStageId.trim() ? cp.mddStageId : undefined;

    // requireBrdTobeGate eliminado — To-Be/As-Is removidos

    let graph: Awaited<ReturnType<typeof createMddGraphWithManager>>;
    try {
      const resumeUserId = await this.resolveUserId(projectId);
      const preflightRuntime = await resolveMddRuntimeWithPreflight(this.aiFactory, resumeUserId);
      const uiMcpFrontendLibraryLabel = await this.getUiMcpLibraryLabel();
      graph = await createMddGraphWithManager(
        this.aiFactory,
        resumeUserId,
        checkpointer,
        this.estimationService,
        {
          projects: this.projects,
          theforge: this.theforge,
          ai: this.ai,
        },
        {
          theforge: this.theforge,
          nodeCache: this.nodeCacheService,
          uiMcpFrontendLibraryLabel,
          preflightRuntime,
          prisma: this.prisma,
        },
      );
    } catch (err) {
      const formatted = formatDbgaStreamError(err);
      this.logger.error(`[MDD stream/resume] setup error: ${formatted.message}`, err instanceof Error ? err.stack : String(err));
      yield { type: "error", message: formatted.message, code: formatted.code };
      return;
    }
    const agentCtx = await this.buildMddAgentContext(projectId, preferredStageForCtx);
    if (agentCtx.mddComplexity != null) {
      this.estimationService.cacheProjectComplexity(projectId.trim(), estimationStage ?? null, agentCtx.mddComplexity);
    }
    const config = {
      configurable: { thread_id: threadId } as Record<string, string>,
      recursionLimit: LANGGRAPH_RECURSION_LIMIT,
    };
    const auditTrail: string[] = [];
    let lastState: MDDState | null = null;
    let lastNonEmptyDraft = "";

    const pendingStepFailed = lastStepFailedByThread.get(threadId);
    if (pendingStepFailed) lastStepFailedByThread.delete(threadId);

    const clientDraft =
      mddContentFromClient?.trim() && mddContentFromClient.trim().length > 80
        ? mddContentFromClient.trim()
        : undefined;
    const { opts: resumePrepareOpts, gateRef: resumeGateRef } = createPrepareOptsWithGate({
      preservedGovernance: extractGovernanceSection(clientDraft ?? ""),
    });

    let resumeInitialDraft = clientDraft ?? "";
    let resumeInitialDirectives: MDDState["internalDirectives"];
    try {
      const cpSnapshot = await graph.getState(config);
      const cpValues = cpSnapshot?.values as MDDState | undefined;
      if (cpValues?.mddDraft?.trim()) resumeInitialDraft = cpValues.mddDraft.trim();
      resumeInitialDirectives = cpValues?.internalDirectives;
    } catch {
      /* usar clientDraft o vacío */
    }
    const editLogTracker = new MddStreamEditLogTracker(resumeInitialDraft, resumeInitialDirectives);

    try {
      // `resume` entrega el texto a interrupt(); el nodo reanudado aplica su propio update (p. ej. lastUserMessage).
      // No inyectar lastUserMessage, projectId ni agentCtx en Command.update: duplican canales en el mismo paso.
      // mddDraft sí puede ir en Command.update: el canal usa reduceMddDraft y fusiona escrituras concurrentes.
      let skipClientDraft = false;
      if (clientDraft) {
        try {
          const snapshot = await graph.getState(config);
          const cpValues = snapshot?.values as MDDState | undefined;
          const checkpointDraft = (cpValues?.mddDraft ?? "").trim();
          skipClientDraft =
            checkpointDraft.length > 0 &&
            (checkpointDraft === clientDraft ||
              !!(cpValues?.mddPlan?.length) ||
              !!(cpValues?.pendingPlanApproval?.mddPlan?.length));
        } catch {
          /* usar clientDraft */
        }
      }
      // agentCtx fields are reducePreferDefined — already set in the original stream checkpoint.
      // Do NOT call updateState before the resume stream: in LangGraph 0.2.x it creates a new
      // checkpoint snapshot that does not preserve the pending interrupt tasks, causing the
      // resume Command to find no active interrupt and silently end with an empty audit trail.
      // Instead, merge agentCtx into Command.update so LangGraph applies it atomically with the resume.
      const stream = await graph.stream(
        new Command({
          resume: resumeText,
          update: {
            ...agentCtx,
            ...(pendingStepFailed ? { lastStepFailed: pendingStepFailed } : {}),
            ...(clientDraft && !skipClientDraft ? { mddDraft: clientDraft } : {}),
          },
        }),
        {
          ...config,
          streamMode: ["updates", "values"] as const,
        },
      );

      for await (const raw of stream) {
        const [mode, data] = Array.isArray(raw) ? (raw as [string, unknown]) : ["values", raw];
        if (mode === "updates" && data && typeof data === "object" && !Array.isArray(data)) {
          const dataRecord = data as Record<string, unknown>;
          const nodeName = Object.keys(dataRecord)[0];
          if (nodeName === "__interrupt__") {
            const interrupts = dataRecord.__interrupt__ as Array<{
              value?: { type?: string; reply?: string; questions?: string[]; plan?: Array<{ step_id: string; task_description: string; node: string }>; message?: string };
            }> | undefined;
            const first = Array.isArray(interrupts) ? interrupts[0] : undefined;
            const value = first?.value;
            let reply = typeof value?.reply === "string" ? value.reply : undefined;
            let questions = Array.isArray(value?.questions) ? value.questions : typeof value?.questions === "string" ? [value.questions] : [];
            if (value?.type === "questions" && questions.length === 0) {
              questions = [
                "¿Cuáles son los objetivos principales del sistema o producto?",
                "¿Qué aplicaciones o sistemas deben integrarse (ej. SSO, APIs)?",
              ];
            }
            const plan = value?.type === "plan_approval" && Array.isArray(value?.plan) ? value.plan : undefined;
            const planMessage = value?.type === "plan_approval" && typeof value?.message === "string" ? value.message : undefined;
            // Usar estado actual del checkpointer para el markdown (evita enviar draft antiguo si el stream emitió updates antes que values)
            let stateForMarkdown = lastState;
            try {
              const snapshot = await graph.getState(config);
              const values = snapshot?.values as MDDState | undefined;
              if (values?.mddDraft?.trim()) stateForMarkdown = values;
            } catch {
              // mantener lastState
            }
            let draftOnInterrupt = await this.runPrepareMddForOutput(
              {
                mddStructured: stateForMarkdown?.mddStructured,
                mddDraft: (stateForMarkdown?.mddDraft ?? "").trim(),
              },
              resumePrepareOpts,
            );
            const isBroken = draftOnInterrupt.startsWith("## useMermaidForDiagrams") || draftOnInterrupt.startsWith("## leaveUncovered") || (draftOnInterrupt.includes("## document") && !draftOnInterrupt.includes("## 1. Contexto"));
            if (isBroken && lastNonEmptyDraft && lastNonEmptyDraft.length > 80) {
              draftOnInterrupt = await this.runPrepareMddForOutput(lastNonEmptyDraft.trim(), resumePrepareOpts);
            }
            const estOptsResume = estimationOpts(projectId, estimationStage, stateForMarkdown ?? lastState);
            const metrics = this.estimationService.calculateLiveMetrics(draftOnInterrupt, estOptsResume);
            const precisionBreakdown = this.estimationService.getPrecisionBreakdown(draftOnInterrupt, estOptsResume);
            const resumeInterruptGate = mddStreamDeliveryGateFields(resumeGateRef.current, metrics.status);
            if (reply && /Estamos al \d+%/.test(reply)) {
              reply = reply.replace(/\bEstamos al \d+%/, `Estamos al ${metrics.precision}%`);
            }
            this.logger.log(`[MDD stream/resume] interrupt (from stream) reply=${reply ? "(presente)" : "(no)"} questions=${questions?.length ?? 0} plan=${plan?.length ?? 0} markdownLen=${draftOnInterrupt.length}`);
            yield {
              type: "interrupt",
              threadId,
              reply,
              questions: questions.length > 0 ? questions.slice(0, 2) : undefined,
              plan,
              planMessage,
              markdown: draftOnInterrupt || undefined,
              precision: metrics.precision,
              status: resumeInterruptGate.status,
              deliveryGate: resumeInterruptGate.deliveryGate,
              precisionBreakdown,
              auditorFeedback: stateForMarkdown?.auditorFeedback?.trim() || undefined,
              auditTrail,
              mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
            };
            return;
          }
          if (nodeName) {
            const label = nodeName === "auditor" ? getAgentLabel("auditor", "mdd") : nodeName === "manager" ? "Manager (entrevista)" : getAgentLabel(nodeName);

            editLogTracker.noteNodeUpdate(nodeName);
            const nodeData = dataRecord[nodeName] as Partial<MDDState> | undefined;
            const draftLen = nodeData?.mddDraft?.length;
            const scopeLen = nodeData?.clarifiedScope?.length;
            const extra = [];
            if (draftLen) extra.push(`draft=${draftLen}`);
            if (scopeLen) extra.push(`scope=${scopeLen}`);
            auditTrail.push(`${nodeName}(${extra.join(" ")})`);

            this.logger.log(`[MDD stream/resume] progress node=${nodeName} label=${label}`);
            yield { type: "progress", agent: label, message: getMddNodeProgressMessage(nodeName) };
          }
        }
        if (mode === "values" && data && typeof data === "object") {
          const stableDraft = editLogTracker.getLastDraft();
          const pendingNode = editLogTracker.peekPendingNode();
          lastState = data as MDDState;
          editLogTracker.noteValuesState(lastState);
          const draft = resolveLiveDraftForScopedArchitectStream(
            pendingNode ?? undefined,
            (lastState.mddDraft ?? "").trim(),
            stableDraft,
          );
          if (draft) {
            lastNonEmptyDraft = draft;
            if (projectId?.trim()) {
              this.estimationService.setLiveDraft(projectId.trim(), draft, estimationStage);
              if (lastState.auditorGaps) {
                this.estimationService.setAuditorGaps(projectId.trim(), lastState.auditorGaps, estimationStage);
              }
            }
            const prepared = await this.runPrepareMddForOutput(
              {
                mddStructured: lastState?.mddStructured,
                mddDraft: draft,
              },
              resumePrepareOpts,
            );
            if (prepared.length > 80) {
              yield {
                type: "draft",
                markdown: prepared,
                deliveryGate: snapshotDeliveryGate(resumeGateRef.current),
              };
            }
          }
        }
      }

      if (lastState) {
        const finalDraft = (lastState.mddDraft || "").trim();
        let raw =
          finalDraft ||
          (lastNonEmptyDraft && lastNonEmptyDraft.length > 80 ? lastNonEmptyDraft : "") ||
          "# Master Design Document\n\n(Sin contenido generado.)";
        if (raw.length < 80 && projectId?.trim()) {
          const project = await this.prisma.project.findUnique({
            where: { id: projectId.trim() },
            include: { stages: { orderBy: { ordinal: "asc" } } },
          });
          let storedMdd = "";
          if (cp.mddStageId.trim()) {
            storedMdd = project?.stages?.find((s) => s.id === cp.mddStageId)?.mddContent?.trim() ?? "";
          }
          if (storedMdd.length < 80) {
            storedMdd = pickPrimaryStage(project?.stages ?? [])?.mddContent?.trim() ?? "";
          }
          if (storedMdd.length > 80) {
            raw = storedMdd;
            this.logger.log("[MDD stream/resume] done: draft vacío/corto, usando mddContent del proyecto");
          }
        }
        const isBrokenMetadataDocument =
          raw.startsWith("## useMermaidForDiagrams") ||
          raw.startsWith("## leaveUncovered") ||
          (raw.includes("## document") && !raw.includes("## 1. Contexto"));
        if (isBrokenMetadataDocument && lastNonEmptyDraft && lastNonEmptyDraft.length > 80) {
          raw = lastNonEmptyDraft;
        }
        let markdown = await this.runPrepareMddForOutput(
          {
            mddStructured: lastState?.mddStructured,
            mddDraft: raw,
          },
          { ...resumePrepareOpts, baselineDraft: finalDraft || undefined },
        );
        const resumeTailGuard = this.guardMarkdownTailForPersist(finalDraft, markdown);
        markdown = resumeTailGuard.markdown;
        if (resumeTailGuard.errorMessage) {
          yield { type: "error", message: resumeTailGuard.errorMessage };
          return;
        }
        logSection3Debug("final (stream/resume done)", markdown);
        
        if (projectId?.trim()) {
          this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
          this.clearMddCheckpoint(projectId.trim(), cp.mddStageId).catch(() => { });
        }
        const estOptsResumeDone = estimationOpts(projectId, estimationStage, lastState);
        const metrics = this.estimationService.calculateLiveMetrics(markdown, estOptsResumeDone);
        const precisionBreakdown = this.estimationService.getPrecisionBreakdown(markdown, estOptsResumeDone);
        this.logger.log(`[MDD stream/resume] done markdownLen=${markdown.length} finalDraftLen=${finalDraft.length}`);
        this.logger.log(`[MDD stream/resume] Audit Trail: ${auditTrail.join(" -> ")}`);
        this.persistMddAuditSnapshot(projectId, estimationStage, {
          auditTrail,
          mddAgentEditLog: editLogTracker.log,
          precisionBreakdown,
          auditorGaps: lastState?.auditorGaps ?? undefined,
        });
        const resumeDoneGate = mddStreamDeliveryGateFields(resumeGateRef.current, metrics.status);
        yield {
          type: "done",
          markdown,
          precision: metrics.precision,
          status: resumeDoneGate.status,
          deliveryGate: resumeDoneGate.deliveryGate,
          auditorFeedback: lastState?.auditorFeedback?.trim() || undefined,
          precisionBreakdown,
          auditTrail,
          mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
        };
      }
    } catch (err) {
      if (projectId?.trim()) this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
      if (isGraphInterrupt(err) && err.interrupts?.length > 0) {
        const value = err.interrupts[0]?.value as {
          type?: string;
          reply?: string;
          questions?: string[];
          plan?: Array<{ step_id: string; task_description: string; node: string }>;
          message?: string;
        } | undefined;
        let reply = typeof value?.reply === "string" ? value.reply : undefined;
        let questions = Array.isArray(value?.questions) ? value.questions : typeof value?.questions === "string" ? [value.questions] : [];
        if (value?.type === "questions" && questions.length === 0) {
          questions = [
            "¿Cuáles son los objetivos principales del sistema o producto?",
            "¿Qué aplicaciones o sistemas deben integrarse (ej. SSO, APIs)?",
          ];
        }
        const plan = value?.type === "plan_approval" && Array.isArray(value?.plan) ? value.plan : undefined;
        const planMessage = value?.type === "plan_approval" && typeof value?.message === "string" ? value.message : undefined;
        let stateForMarkdown = lastState;
        try {
          const snapshot = await graph.getState(config);
          const values = snapshot?.values as MDDState | undefined;
          if (values?.mddDraft?.trim()) stateForMarkdown = values;
        } catch {
          // mantener lastState
        }
        const draftOnInterrupt = await this.runPrepareMddForOutput(
          {
            mddStructured: stateForMarkdown?.mddStructured,
            mddDraft: (stateForMarkdown?.mddDraft ?? "").trim(),
          },
          resumePrepareOpts,
        );
        const estOptsResumeCatch = estimationOpts(projectId, estimationStage, stateForMarkdown ?? lastState);
        const metrics = this.estimationService.calculateLiveMetrics(draftOnInterrupt, estOptsResumeCatch);
        const precision = metrics.precision;
        const resumeCatchGate = mddStreamDeliveryGateFields(resumeGateRef.current, metrics.status);
        const precisionBreakdown = this.estimationService.getPrecisionBreakdown(draftOnInterrupt, estOptsResumeCatch);
        const auditorFeedback = stateForMarkdown?.auditorFeedback?.trim() || undefined;
        if (reply && /Estamos al \d+%/.test(reply)) {
          reply = reply.replace(/\bEstamos al \d+%/, `Estamos al ${metrics.precision}%`);
        }
        this.logger.log(`[MDD stream/resume] interrupt reply=${reply ? "(presente)" : "(no)"} questions=${questions?.length ?? 0} plan=${plan?.length ?? 0} markdownLen=${draftOnInterrupt.length}`);
        yield {
          type: "interrupt",
          threadId,
          reply,
          questions: questions.length > 0 ? questions.slice(0, 2) : undefined,
          plan,
          planMessage,
          markdown: draftOnInterrupt || undefined,
          precision,
          status: resumeCatchGate.status,
          deliveryGate: resumeCatchGate.deliveryGate,
          precisionBreakdown,
          auditorFeedback,
          auditTrail,
          mddAgentEditLog: editLogTracker.log.length > 0 ? editLogTracker.log : undefined,
        };
        return;
      }
      const formatted = formatDbgaStreamError(err);
      this.logger.error(
        `[MDD stream/resume] error: ${formatted.message}`,
        err instanceof Error ? err.stack : String(err),
      );
      yield { type: "error", ...formatted };
    }
  }

  /**
   * Regenera solo una sección del MDD (1–7) usando el resto del documento como contexto.
   * Entrada alternativa: comandos / en el chat (ej. /infraestructura, /contexto). No reemplaza el flujo
   * con Manager (streamMddAnalysisWithManager / streamMddResume): si el usuario escribe texto
   * normal, el frontend sigue usando manager/resume; este método solo se invoca cuando el
   * cliente envía explícitamente section 1–7 (regenerate-section). NDJSON: progress | done | error.
   * §1: sintetizador de contexto; aborta con error si el cuerpo queda < 200 chars (no hace done falso).
   */
  async *streamMddRegenerateSection(
    projectId: string,
    section: number,
    mddContentFromClient?: string,
    stageId?: string | null,
    gapReasons?: string[],
    upstreamContext?: { dbgaContent?: string; changeSummary?: string },
  ): AsyncGenerator<StreamMddManagerEvent> {
    const pid = projectId?.trim();
    if (!pid) {
      yield { type: "error", message: "projectId es requerido" };
      return;
    }
    if (section < 1 || section > 7) {
      yield { type: "error", message: "section debe ser 1–7" };
      return;
    }
    const tracer = new MddRegenTracer({
      mode: "section",
      projectId: pid,
      section,
      stageId: stageId?.trim() || undefined,
    });
    let mddContent = "";
    try {
      mddContent = await tracer.step("fetch-mdd", async () => {
        let content = typeof mddContentFromClient === "string" ? mddContentFromClient.trim() : "";
        if (content.length < 100) {
          const project = await this.prisma.project.findUnique({
            where: { id: pid },
            include: { stages: { orderBy: { ordinal: "asc" } } },
          });
          const sid = stageId?.trim();
          if (sid) {
            content = project?.stages?.find((s) => s.id === sid)?.mddContent?.trim() ?? "";
          }
          if (content.length < 100) {
            content = (pickPrimaryStage(project?.stages ?? [])?.mddContent ?? "").trim();
          }
        }
        return content;
      }, { source: mddContentFromClient && mddContentFromClient.trim().length >= 100 ? "client" : "db" });
    } catch {
      yield { type: "error", message: "No hay MDD suficiente para regenerar una sección. Genera o edita el MDD antes." };
      tracer.summary(false);
      return;
    }
    if (mddContent.length < 100) {
      yield { type: "error", message: "No hay MDD suficiente para regenerar una sección. Genera o edita el MDD antes." };
      tracer.summary(false, { reason: "mdd-too-short" });
      return;
    }

    // Qitar stamp (cabecera Creado/Última modificación) antes de procesar.
    // Si el MDD viene de BD trae el stamp; si no se peela, llega al LLM como contexto
    // y las funciones de reemplazo de sección pueden insertar contenido dentro del bloque de fechas.
    mddContent = await tracer.step("peel-stamp", async () => peelDocumentBodyForPersist(mddContent), { inputLen: mddContent.length });
    const regenBaselineMdd = mddContent;

    const preservedGov = extractGovernanceSection(mddContent);
    const { opts: regenPrepareOpts, gateRef: regenGateRef } = createPrepareOptsWithGate({
      preservedGovernance: preservedGov,
      baselineDraft: regenBaselineMdd,
    });

    // regenEstimationStage desde pid + stageId (To-Be/As-Is eliminados)
    const regenCx = "HIGH" as EstimationComplexity;
    const regenEstimationStage = stageId?.trim() || undefined;
    const regenBrdContent = regenEstimationStage
      ? await tracer.step("fetch-brd", async () => {
        const r = await this.prisma.stage.findUnique({ where: { id: regenEstimationStage }, select: { brdContent: true } });
        return r?.brdContent ?? null;
      })
      : null;

    this.estimationService.cacheProjectComplexity(pid, regenEstimationStage ?? null, regenCx);
    const regenEstOpts = { projectId: pid, stageId: regenEstimationStage ?? null, complexity: regenCx };

    let llm: Awaited<ReturnType<typeof createDbgaLLM>>;
    try {
      const regenUserId = await tracer.step("resolve-user", async () => this.resolveUserId(pid));
      llm = await tracer.step("create-llm", async () => createDbgaLLM(this.aiFactory, regenUserId));
    } catch (err) {
      const formatted = formatDbgaStreamError(err);
      tracer.summary(false, { error: formatted.message });
      yield { type: "error", message: formatted.message, code: formatted.code };
      return;
    }
    try {
      if (section === 1) {
        const prompt = `${CONTEXT_SYNTHESIZER_PROMPT}${contextSynthesizerComplexityAppendix(regenCx)}\n\n---\n\n**Documento MDD (usa las secciones 2–7 para sintetizar la sección 1):**\n\n${mddContent}`;
        const response = yield* runRegenWithHeartbeat(
          llm.invoke([new HumanMessage(prompt)]),
          "Contexto",
          "Regenerando §1…",
          tracer,
        );
        const text = (typeof response.content === "string" ? response.content : "").trim();
        const synthesized = normalizeContextSynthesizerBody(text);
        this.logger.log(
          `[MDD regenerate-section] §1 llm rawLen=${synthesized.rawLen} bodyLen=${synthesized.cleanedLen} ` +
            `fullDump=${synthesized.fromFullMddDump} truncatedH2=${synthesized.truncatedAtOtherSection} projectId=${pid}`,
        );
        if (!isContextSynthesizerBodySubstantial(synthesized.body)) {
          this.logger.warn(
            `[MDD regenerate-section] §1 sin sustancia (bodyLen=${synthesized.cleanedLen}; mín ${MIN_SECTION1_REGEN_BODY_LENGTH}) projectId=${pid}`,
          );
          tracer.summary(false, {
            reason: "section1-insubstantial",
            rawLen: synthesized.rawLen,
            bodyLen: synthesized.cleanedLen,
          });
          yield {
            type: "error",
            message:
              "La regeneración de §1 no produjo contenido suficiente (respuesta vacía, solo separador, " +
              "placeholder, o truncada al volcar §2–§7). Reintenta o usa un modelo más capaz; " +
              "si persiste, regenera el MDD completo.",
          };
          return;
        }
        const newBody = demoteCanonicalSectionHeadingsInSection1Body(synthesized.body);
        const finalDraft = extractContextSectionBody(mddContent)
          ? replaceSection1BodyFromAnyHeading(mddContent, newBody)
          : restoreContextSectionFromBaselineIfMissing(
              `## 1. Contexto\n\n${newBody}`,
              mddContent,
            );
        const mergedBody = extractContextSectionBody(finalDraft) ?? "";
        if (!isContextSynthesizerBodySubstantial(mergedBody)) {
          this.logger.warn(
            `[MDD regenerate-section] §1 merge no aplicó sustancia (mergedLen=${mergedBody.length}) projectId=${pid}`,
          );
          tracer.summary(false, { reason: "section1-merge-failed", bodyLen: mergedBody.length });
          yield {
            type: "error",
            message:
              "La regeneración de §1 produjo texto pero no se pudo fusionar en el MDD (heading §1 ausente o merge fallido). " +
              "Revisa que exista `## 1. Contexto` y reintenta.",
          };
          return;
        }
        let markdown = await tracer.step(
          "prepare-output",
          async () => this.runPrepareMddForOutput(finalDraft, regenPrepareOpts),
          { draftLen: finalDraft.length, section1Len: mergedBody.length },
        );
        // prepare (repairGlued/dedupe) a veces promueve `2. Arquitectura…` → ## 2 y parte §1.
        let afterPrepBody = extractContextSectionBody(markdown) ?? "";
        if (!isContextSynthesizerBodySubstantial(afterPrepBody)) {
          this.logger.warn(
            `[MDD regenerate-section] §1 wipe post-prepare (pre=${mergedBody.length} post=${afterPrepBody.length}); reinyectando projectId=${pid}`,
          );
          markdown = replaceSection1BodyFromAnyHeading(markdown, newBody);
          afterPrepBody = extractContextSectionBody(markdown) ?? "";
          if (!isContextSynthesizerBodySubstantial(afterPrepBody)) {
            tracer.summary(false, {
              reason: "section1-wiped-by-prepare",
              preLen: mergedBody.length,
              postLen: afterPrepBody.length,
            });
            yield {
              type: "error",
              message:
                "La regeneración de §1 produjo contenido pero prepare/dedupe lo vació. " +
                "No se persistió el borrador dañado; reintenta o regenera el MDD completo.",
            };
            return;
          }
        }
        const metrics = await tracer.step("metrics", async () => this.estimationService.calculateLiveMetrics(markdown, regenEstOpts));
        const regenGate1 = mddStreamDeliveryGateFields(regenGateRef.current, metrics.status);
        tracer.summary(true, {
          mddLen: markdown.length,
          precision: metrics.precision,
          section1Len: afterPrepBody.length,
        });
        yield {
          type: "done",
          markdown,
          precision: metrics.precision,
          status: regenGate1.status,
          deliveryGate: regenGate1.deliveryGate,
          precisionBreakdown: this.estimationService.getPrecisionBreakdown(markdown, regenEstOpts),
        };
        return;
      }

      const structured = await tracer.step("parse-structured", async () => markdownToMddStructured(mddContent));
      const agentCtxRegen = await tracer.step("agent-context", async () => this.buildMddAgentContext(pid, regenEstimationStage ?? null));
      let dbgaRegen = upstreamContext?.dbgaContent?.trim() || "(Regenerando sección desde documento actual.)";
      const pre = composeBrdPreamble(regenBrdContent);
      if (pre) dbgaRegen = pre + dbgaRegen;
      const mergedGaps = [
        ...(gapReasons ?? []),
        ...(upstreamContext?.changeSummary?.trim() ? [upstreamContext.changeSummary.trim()] : []),
      ];
      const state: MDDState = {
        ...defaultMDDState,
        dbgaContent: dbgaRegen,
        brdContent: (regenBrdContent ?? "").trim() || undefined,
        clarifiedScope: structured?.contextoAlcance ?? "",
        mddStructured: structured ?? undefined,
        mddDraft: mddContent,
        projectId: pid,
        ...(mergedGaps.length
          ? {
              auditorFeedback: `Gaps del auditor a corregir en esta regeneración:\n${mergedGaps.map((g) => `- ${g}`).join("\n")}`,
            }
          : {}),
        ...agentCtxRegen,
      };

      if (section === 7) {
        const integrationNode = createMddIntegrationNode(llm);
        const result = yield* runRegenWithHeartbeat(
          integrationNode(state as MDDStateType),
          getAgentLabel("integration"),
          "Regenerando §7 Infraestructura…",
          tracer,
        );
        const finalDraft = (result.mddDraft ?? mddContent).trim();
        const markdown = await tracer.step("prepare-output", async () => this.runPrepareMddForOutput(
          { mddStructured: result.mddStructured, mddDraft: finalDraft },
          regenPrepareOpts,
        ), { draftLen: finalDraft.length });
        const metrics = await tracer.step("metrics", async () => this.estimationService.calculateLiveMetrics(markdown, regenEstOpts));
        const regenGate7 = mddStreamDeliveryGateFields(regenGateRef.current, metrics.status);
        tracer.summary(true, { mddLen: markdown.length, precision: metrics.precision });
        yield {
          type: "done",
          markdown,
          precision: metrics.precision,
          status: regenGate7.status,
          deliveryGate: regenGate7.deliveryGate,
          precisionBreakdown: this.estimationService.getPrecisionBreakdown(markdown, regenEstOpts),
        };
        return;
      }
      if (section === 6) {
        const securityNode = createMddSecurityNode(llm);
        const result = yield* runRegenWithHeartbeat(
          securityNode(state as MDDStateType),
          getAgentLabel("security"),
          "Regenerando §6 Seguridad…",
          tracer,
        );
        const finalDraft = (result.mddDraft ?? mddContent).trim();
        const markdown = await tracer.step("prepare-output", async () => this.runPrepareMddForOutput(
          { mddStructured: result.mddStructured, mddDraft: finalDraft },
          regenPrepareOpts,
        ), { draftLen: finalDraft.length });
        if (!draftHasSection6Heading(markdown)) {
          tracer.summary(false, { reason: "no-§6-heading" });
          yield {
            type: "error",
            message:
              "La regeneración de §6 no produjo el heading ## 6. Seguridad en el documento. Reintenta con /seguridad o revisa el borrador.",
          };
          return;
        }
        const metrics = await tracer.step("metrics", async () => this.estimationService.calculateLiveMetrics(markdown, regenEstOpts));
        const regenGate6 = mddStreamDeliveryGateFields(regenGateRef.current, metrics.status);
        tracer.summary(true, { mddLen: markdown.length, precision: metrics.precision });
        yield {
          type: "done",
          markdown,
          precision: metrics.precision,
          status: regenGate6.status,
          deliveryGate: regenGate6.deliveryGate,
          precisionBreakdown: this.estimationService.getPrecisionBreakdown(markdown, regenEstOpts),
        };
        return;
      }
      if (section === 5) {
        // Nodo quirúrgico: SOLO reescribe ## 5. No usar Software Architect aquí —
        // ese agente regenera §2–§5 como bloque y puede borrar contenido bueno en §2–§4.
        const section5Node = createMddSection5Node(llm);
        const result = yield* runRegenWithHeartbeat(
          section5Node(state as MDDStateType),
          getAgentLabel("section5"),
          "Regenerando §5 Lógica y Edge Cases…",
          tracer,
        );
        const finalDraft = (result.mddDraft ?? mddContent).trim();
        if (finalDraft === mddContent.trim()) {
          this.logger.warn(
            `[MDD regenerate-section] §5 sin cambios (LLM vacío/placeholder o merge no aplicado) projectId=${pid}`,
          );
          tracer.summary(false, { reason: "section5-unchanged" });
          yield {
            type: "error",
            message:
              "La regeneración de §5 no produjo contenido (respuesta vacía, placeholder o demasiado corta). " +
              "Verifica que el MDD tenga §1 y §4 con contenido; reintenta o usa «Regenerar MDD» completo.",
          };
          return;
        }
        const markdown = await tracer.step("prepare-output", async () => this.runPrepareMddForOutput(
          { mddStructured: result.mddStructured ?? state.mddStructured, mddDraft: finalDraft },
          regenPrepareOpts,
        ), { draftLen: finalDraft.length });
        const metrics = await tracer.step("metrics", async () => this.estimationService.calculateLiveMetrics(markdown, regenEstOpts));
        const regenGate5 = mddStreamDeliveryGateFields(regenGateRef.current, metrics.status);
        tracer.summary(true, { mddLen: markdown.length, precision: metrics.precision });
        yield {
          type: "done",
          markdown,
          precision: metrics.precision,
          status: regenGate5.status,
          deliveryGate: regenGate5.deliveryGate,
          precisionBreakdown: this.estimationService.getPrecisionBreakdown(markdown, regenEstOpts),
        };
        return;
      }
      if (section >= 2 && section <= 4) {
        const agentNames = agentsForArchitectSection(section as 2 | 3 | 4, state.mddComplexity);
        const agentKey = agentNames[0] ?? "software_architect";
        const scope: MddSoftwareArchitectScope =
          agentKey === "stack_architect"
            ? "stack"
            : agentKey === "data_model"
              ? "data_model"
              : agentKey === "api_contracts"
                ? "api_contracts"
                : "full";
        const architectNode = createMddSoftwareArchitectNode(llm, getMddArchitectTools(), {
          theforge: this.theforge,
          scope,
        });
        const result = yield* runRegenWithHeartbeat(
          architectNode(state as MDDStateType),
          getAgentLabel(agentKey),
          `Regenerando §${section}…`,
          tracer,
        );
        const architectDraft = (result.mddDraft ?? "").trim();
        const finalDraft = mergeSingleArchitectSectionIntoDraft(
          mddContent,
          architectDraft || mddContent,
          section as 2 | 3 | 4,
        );
        if (finalDraft === mddContent.trim()) {
          this.logger.warn(
            `[MDD regenerate-section] §${section} sin cambios quirúrgicos (cuerpo ausente/corto/placeholder) projectId=${pid}`,
          );
          tracer.summary(false, { reason: `section${section}-unchanged` });
          yield {
            type: "error",
            message:
              `La regeneración de §${section} no produjo contenido (respuesta vacía, placeholder o demasiado corta). ` +
              "Verifica que el MDD tenga contexto suficiente en §1 y secciones relacionadas; reintenta o usa «Regenerar MDD» completo.",
          };
          return;
        }
        const markdown = await tracer.step("prepare-output", async () => this.runPrepareMddForOutput(
          { mddStructured: result.mddStructured, mddDraft: finalDraft },
          regenPrepareOpts,
        ), { draftLen: finalDraft.length });
        const metrics = await tracer.step("metrics", async () => this.estimationService.calculateLiveMetrics(markdown, regenEstOpts));
        const regenGate25 = mddStreamDeliveryGateFields(regenGateRef.current, metrics.status);
        tracer.summary(true, { mddLen: markdown.length, precision: metrics.precision });
        yield {
          type: "done",
          markdown,
          precision: metrics.precision,
          status: regenGate25.status,
          deliveryGate: regenGate25.deliveryGate,
          precisionBreakdown: this.estimationService.getPrecisionBreakdown(markdown, regenEstOpts),
        };
        return;
      }
      tracer.summary(false, { reason: "section-not-supported" });
      yield { type: "error", message: "Sección no soportada para regeneración." };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[MDD regenerate-section] error: ${message}`, err instanceof Error ? err.stack : undefined);
      tracer.summary(false, { error: message });
      yield { type: "error", message: `Error al regenerar §${section}: ${message}` };
    }
  }

  /**
   * Sincroniza el MDD existente con cambios en DBGA/BRD/Benchmark regenerando solo las secciones indicadas.
   */
  async *streamMddUpstreamSync(
    projectId: string,
    sections: number[],
    changeSummary: string,
    dbgaContent: string,
    stageId?: string | null,
  ): AsyncGenerator<StreamMddManagerEvent> {
    const pid = projectId?.trim();
    if (!pid) {
      yield { type: "error", message: "projectId es requerido" };
      return;
    }
    const ordered = expandMddSectionsForSync(sections);
    if (!ordered.length) {
      yield { type: "error", message: "No hay secciones MDD para sincronizar." };
      return;
    }

    let mddContent = "";
    const project = await this.prisma.project.findUnique({
      where: { id: pid },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    const sid = stageId?.trim();
    if (sid) {
      mddContent = project?.stages?.find((s) => s.id === sid)?.mddContent?.trim() ?? "";
    }
    if (mddContent.length < 100) {
      mddContent = (pickPrimaryStage(project?.stages ?? [])?.mddContent ?? "").trim();
    }
    if (mddContent.length < 100) {
      yield { type: "error", message: "No hay MDD suficiente para sincronizar. Genera el MDD completo primero." };
      return;
    }

    // Quitar stamp antes de procesar (mismo motivo que streamMddRegenerateSection).
    mddContent = peelDocumentBodyForPersist(mddContent);
    const baselineMddBeforeSync = mddContent;
    const sectionsToPreserve = [1, 2, 3, 4, 5, 6, 7].filter((n) => !ordered.includes(n));

    const brdContent = sid
      ? (await this.prisma.stage.findUnique({ where: { id: sid }, select: { brdContent: true } }))?.brdContent ?? null
      : null;
    const upstreamCtx = { dbgaContent, changeSummary };
    const gapLines = changeSummary.trim() ? [changeSummary.trim()] : [];

    for (const section of ordered) {
      const title = MDD_SECTION_TITLES[section] ?? `§${section}`;
      yield {
        type: "progress",
        agent: getAgentLabel(section === 1 ? "clarifier" : section === 6 ? "security" : section === 7 ? "integration" : "software_architect"),
        message: `Sincronizando ${title}…`,
        phase: "active",
      };

      if (section === 1) {
        try {
          const regenUserId = await this.resolveUserId(pid);
          const llm = await createDbgaLLM(this.aiFactory, regenUserId);
          let dbgaEffective = dbgaContent.trim() || mddContent.slice(0, 4000);
          const pre = composeBrdPreamble(brdContent);
          if (pre) dbgaEffective = pre + dbgaEffective;
          const clarifierNode = createMddClarifierNode(llm);
          const agentCtx = await this.buildMddAgentContext(pid, sid ?? null);
          const prevSection1 = extractContextSectionBody(mddContent) ?? "";
          const result = await clarifierNode({
            ...defaultMDDState,
            dbgaContent: dbgaEffective,
            brdContent: (brdContent ?? "").trim() || undefined,
            mddDraft: mddContent,
            projectId: pid,
            auditorFeedback: changeSummary.trim() || undefined,
            ...agentCtx,
          } as MDDStateType);
          const body = resolveUpstreamSyncSection1Body({
            clarifierMddDraft: result.mddDraft,
            clarifiedScope: result.clarifiedScope,
          });
          if (!body) {
            this.logger.warn(
              `[MDD upstream-sync] §1 sin sustancia tras Clarifier (prevLen=${prevSection1.length}); se preserva §1 previa projectId=${pid}`,
            );
            yield {
              type: "error",
              message:
                "La sincronización de §1 no produjo contenido suficiente (Clarifier JSON inválido, " +
                "dump DBGA como scope, o cuerpo < 200 chars). Se preservó la sección anterior; " +
                "reintenta con un modelo más capaz o regenera el MDD completo.",
            };
            return;
          }
          // Clarifier en fallback (JSON inválido) reusa mddDraft previo + scope dump `#…`.
          // No marcar sync OK ni capturar baseline si §1 no cambió y no hay scope usable.
          const scopeRaw = (result.clarifiedScope ?? "").trim();
          let scopeUsable = false;
          if (scopeRaw && !scopeRaw.startsWith("#") && !/\n##\s+/m.test(scopeRaw)) {
            scopeUsable = isContextSynthesizerBodySubstantial(
              normalizeContextSynthesizerBody(scopeRaw).body,
            );
          } else if (scopeRaw) {
            const ex = extractContextSectionBody(scopeRaw);
            scopeUsable = Boolean(ex && isContextSynthesizerBodySubstantial(ex));
          }
          if (
            isContextSynthesizerBodySubstantial(prevSection1) &&
            body.trim() === prevSection1.trim() &&
            !scopeUsable
          ) {
            this.logger.warn(
              `[MDD upstream-sync] Clarifier no actualizó §1 (fallback/sin scope usable) projectId=${pid}`,
            );
            yield {
              type: "error",
              message:
                "El Clarificador no generó un §1 nuevo usable (respuesta JSON inválida o scope = dump DBGA). " +
                "Se preservó el MDD anterior; reintenta con un modelo más capaz o regenera el documento completo.",
            };
            return;
          }
          // No degradar §1 sustancial previa con un cuerpo mucho más corto (ratio < 40%).
          if (
            isContextSynthesizerBodySubstantial(prevSection1) &&
            body.length < Math.max(MIN_SECTION1_REGEN_BODY_LENGTH, Math.floor(prevSection1.length * 0.4))
          ) {
            this.logger.warn(
              `[MDD upstream-sync] §1 candidato demasiado corto vs previa (prev=${prevSection1.length} new=${body.length}); abort projectId=${pid}`,
            );
            yield {
              type: "error",
              message:
                "La sincronización de §1 habría acortado demasiado el contexto existente. " +
                "Se preservó la sección anterior; reintenta o regenera el MDD completo.",
            };
            return;
          }
          mddContent = replaceSection1BodyFromAnyHeading(mddContent, body);
          const afterBody = extractContextSectionBody(mddContent) ?? "";
          if (!isContextSynthesizerBodySubstantial(afterBody)) {
            mddContent = baselineMddBeforeSync;
            yield {
              type: "error",
              message:
                "La sincronización de §1 dejó el contexto insuficiente tras el merge. " +
                "Se restauró el MDD previo; reintenta o regenera el documento completo.",
            };
            return;
          }
        } catch (err) {
          yield {
            type: "error",
            message: `Error al sincronizar §1: ${err instanceof Error ? err.message : String(err)}`,
          };
          return;
        }
      } else {
        let sectionMarkdown = "";
        for await (const event of this.streamMddRegenerateSection(
          pid,
          section,
          mddContent,
          stageId,
          gapLines,
          upstreamCtx,
        )) {
          if (event.type === "progress") yield event;
          if (event.type === "error") {
            yield event;
            return;
          }
          if (event.type === "done" && event.markdown?.trim()) {
            sectionMarkdown = event.markdown;
          }
        }
        if (!sectionMarkdown.trim()) {
          yield { type: "error", message: `La sincronización de §${section} no devolvió contenido.` };
          return;
        }
        mddContent = sectionMarkdown;
      }

      yield {
        type: "progress",
        agent: getAgentLabel("prepare_output"),
        message: `${title} sincronizado`,
        phase: "done",
      };
    }

    if (sectionsToPreserve.length > 0) {
      mddContent = restoreMddSectionsFromBaselineStrict(
        mddContent,
        baselineMddBeforeSync,
        sectionsToPreserve,
      );
    }

    const { opts: prepareOpts } = createPrepareOptsWithGate({
      preservedGovernance: extractGovernanceSection(mddContent),
      baselineDraft: baselineMddBeforeSync,
    });
    let markdown = await this.runPrepareMddForOutput(mddContent, prepareOpts);
    markdown = await this.reviewMddConsistency(pid, markdown);
    const estStage = sid || undefined;
    const estOpts = { projectId: pid, stageId: estStage ?? null, complexity: "HIGH" as const };
    const metrics = this.estimationService.calculateLiveMetrics(markdown, estOpts);
    yield {
      type: "done",
      markdown,
      precision: metrics.precision,
      status: metrics.status,
      precisionBreakdown: this.estimationService.getPrecisionBreakdown(markdown, estOpts),
    };
  }

  /**
   * Obtiene las decisiones arquitectónicas (ADRs) del proyecto desde agentGovernanceContent.
   */
  async getProjectDecisions(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { agentGovernanceContent: true },
    });
    return listProjectAdrsFromGovernance(project?.agentGovernanceContent);
  }

  /** Preselección de patrones SSOT a partir de DBGA (Fase 0), resumen benchmark y BRD. */
  async suggestGovernancePatterns(projectId: string, stageId?: string) {
    const project = await this.projects.findOne(projectId);
    const stages = project.stages ?? [];
    const stage =
      (stageId?.trim() && stages.find((s) => s.id === stageId.trim())) ||
      pickPrimaryStage(stages);
    const { suggestGovernancePatternIds, suggestGovernancePatternIdsWithoutDocs } = await import(
      "./utils/suggest-mdd-governance-patterns.util.js"
    );
    const input = {
      dbgaContent: (project.dbgaContent ?? "").trim(),
      phase0SummaryContent: (project.phase0SummaryContent ?? "").trim(),
      brdContent: (stage?.brdContent ?? "").trim(),
    };
    const empty = suggestGovernancePatternIdsWithoutDocs(input);
    if (empty) return empty;

    const userId = await this.resolveUserId(projectId);
    const llm = await createDbgaLLM(this.aiFactory, userId, {
      temperature: 0,
      outputTokenPurpose: "governancePatterns",
    });
    return suggestGovernancePatternIds(llm, input);
  }

  /** Registra cada patrón [X] del wizard como ADR en agentGovernanceContent. */
  async recordGovernancePatternAdrs(
    projectId: string,
    patterns: Array<{ label: string; group: string; affects: string; description: string }>,
  ) {
    await persistProjectAdrsToGovernance(
      this.prisma,
      projectId,
      patterns.map((p) => ({
        title: `Patrón SSOT: ${p.label}`,
        context: `Selección en el wizard del MDD (grupo: ${p.group}). Derivada del análisis de Fase 0 / Benchmark / BRD.`,
        consequence: [p.description, p.affects ? `Afecta a: ${p.affects}` : ""]
          .filter(Boolean)
          .join(" ")
          .slice(0, 2000),
        status: "Accepted",
      })),
    );
    return this.getProjectDecisions(projectId);
  }

  /**
   * Ejecuta generación/regeneración MDD desacoplada del SSE (cola background).
   * Persiste borradores y resultado final en BD desde el servidor.
   */
  private async resolveLockedPatternIdsForMddJob(data: MddJobData): Promise<{
    lockedPatternIds: Set<string>;
    stageMddContent: string;
    stageId: string | undefined;
  }> {
    const { projectId, stageId, mddContent } = data;
    if (!projectId?.trim()) {
      return { lockedPatternIds: new Set(), stageMddContent: "", stageId: undefined };
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId.trim() },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    const sid = stageId?.trim();
    const byId = sid ? project?.stages?.find((s) => s.id === sid) : undefined;
    const stage = byId ?? pickPrimaryStage(project?.stages ?? []);
    const { lockedPatternIds } = resolveMddGovernancePreservation(
      mddContent,
      stage?.mddContent ?? "",
    );
    return {
      lockedPatternIds,
      stageMddContent: stage?.mddContent ?? "",
      stageId: stage?.id,
    };
  }

  async runMddGenerationJob(
    data: MddJobData,
    onProgress: (p: MddJobProgress) => void,
    options?: { signal?: AbortSignal },
  ): Promise<MddJobResult> {
    const { mode, projectId, stageId } = data;
    let lastPersistedLen = 0;
    const resolvedPatterns = await this.resolveLockedPatternIdsForMddJob(data);
    const { correctedIds: lockedPatternIds, corrections } = resolveGovernancePatternIncompatibilities(
      resolvedPatterns.lockedPatternIds,
    );

    if (corrections.length > 0) {
      this.logger.warn(
        `MDD job ${mode} (${projectId}): ${corrections.length} patrón(es) incompatible(s) corregido(s) automáticamente`,
      );
      onProgress({
        phase: "pattern-compat",
        message: formatGovernancePatternCorrectionsNotice(corrections),
      });
      const stageBody = peelDocumentBodyForPersist(resolvedPatterns.stageMddContent);
      if (stageBody.trim().length >= 48) {
        const correctedMd = updateMddGovernancePatterns(stageBody, lockedPatternIds);
        await this.projects.persistMddFromBackgroundJob(projectId, correctedMd, {
          stageId: resolvedPatterns.stageId ?? (stageId?.trim() || undefined),
          finalize: false,
          lockedPatternIds: [...lockedPatternIds],
        });
      }
    }

    const persistMarkdown = async (markdown: string, finalize: boolean): Promise<void> => {
      const cleaned = cleanDocumentContent(markdown);
      if (cleaned.trim().length < 48) return;
      if (cleaned.length === lastPersistedLen && !finalize) return;
      lastPersistedLen = cleaned.length;
      await this.projects.persistMddFromBackgroundJob(projectId, markdown, {
        stageId: stageId?.trim() || undefined,
        finalize,
        lockedPatternIds: [...lockedPatternIds],
      });
      onProgress({ phase: finalize ? "persisted" : "draft", mddLength: cleaned.length });
    };

    type MddJobEvent = StreamMddManagerEvent | StreamProgressEvent;

    const consume = async (events: AsyncGenerator<MddJobEvent>): Promise<MddJobResult> => {
      let finalMarkdown = "";
      let result: MddJobResult | null = null;
      for await (const event of events) {
        if (options?.signal?.aborted) {
          throw new Error("Cancelado por el usuario");
        }
        if (event.type === "progress") {
          onProgress({
            agent: event.agent,
            message: event.message,
            phase: event.phase,
          });
        } else if (event.type === "draft" && event.markdown?.trim()) {
          await persistMarkdown(event.markdown, false);
          onProgress({ phase: "draft", mddLength: event.markdown.length });
        } else if (event.type === "interrupt") {
          if (event.markdown?.trim()) await persistMarkdown(event.markdown, false);
          return {
            ok: true,
            mode,
            projectId,
            stageId: stageId?.trim() || undefined,
            mddLength: event.markdown?.length ?? lastPersistedLen,
            outcome: "interrupt",
            threadId: event.threadId,
            interrupt: {
              reply: event.reply,
              questions: event.questions,
              planMessage: event.planMessage,
            },
          };
        } else if (event.type === "done" && event.markdown) {
          finalMarkdown = event.markdown;
          // Section regen: persist without hard delivery gate. The gate is designed for
          // full pipeline runs; a single-section regen shouldn't be blocked because other
          // sections are missing/corrupt (that's exactly what the user is trying to fix
          // by regenerating individual sections).
          const isSectionRegen = mode === "section" || mode === "upstream-sync";
          await persistMarkdown(event.markdown, !isSectionRegen);
          if (projectId?.trim()) {
            this.estimationService.clearLiveDraft(projectId.trim(), stageId ?? undefined);
          }
          result = {
            ok: true,
            mode,
            projectId,
            stageId: stageId?.trim() || undefined,
            mddLength: finalMarkdown.length,
            outcome: "done",
          };
          return result;
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else if (event.type === "blocked") {
          throw new Error(event.message);
        }
      }
      if (finalMarkdown.trim().length >= 48) {
        return {
          ok: true,
          mode,
          projectId,
          stageId: stageId?.trim() || undefined,
          mddLength: finalMarkdown.length,
          outcome: "done",
        };
      }
      throw new Error("La generación del MDD no devolvió contenido suficiente.");
    };

    switch (mode) {
      case "pipeline": {
        // PR #505: el cache upstream se eliminó del flujo de regeneración.
        // El cache asumía "upstream sin cambios = MDD OK" pero la realidad
        // es que un MDD de baja calidad (placeholder con excepciones, modelo
        // débil) puede pasar el gate y quedar cacheado para siempre. La
        // regeneración ahora siempre ejecuta el pipeline LLM completo.
        return await consume(
          this.streamMddAnalysis(
            data.dbgaContent ?? "",
            projectId,
            stageId,
            data.mddContent,
          ) as AsyncGenerator<MddJobEvent>,
        );
      }
      case "manager": {
        // PR #505: el cache se eliminó del flujo de regeneración.
        // El manager mode también siempre corre el pipeline LLM completo
        // sin reusar contenido cacheado.
        return await consume(
          this.streamMddAnalysisWithManager(
            data.dbgaContent ?? "",
            projectId,
            data.initialMessage,
            data.mddContent,
            stageId,
          ),
        );
      }
      case "section": {
        const rawSection = data.section;
        if (rawSection == null || !Number.isInteger(rawSection) || rawSection < 1 || rawSection > 7) {
          throw new Error("section must be 1–7");
        }
        const section = rawSection;
        onProgress({ phase: "section", section, message: `Regenerando §${section}…` });
        const jobResult = await consume(
          this.streamMddRegenerateSection(
            projectId,
            section,
            data.mddContent,
            stageId,
            data.gapReasons,
          ),
        );
        if (jobResult.ok && jobResult.outcome === "done") {
          return this.finalizeMddJobUpstreamBaseline(projectId, stageId, jobResult);
        }
        return jobResult;
      }
      case "upstream-sync": {
        const analysis = await this.mddUpstreamSync.analyze(projectId, stageId);
        const sections = this.mddUpstreamSync.normalizeSections(data.upstreamSections, analysis);
        if (!sections.length) {
          throw new Error("No hay secciones MDD para sincronizar desde upstream.");
        }
        const summary =
          data.upstreamChangeSummary?.trim() || this.mddUpstreamSync.buildSyncSummary(analysis);
        const docs = await this.mddUpstreamSync.loadUpstreamDocuments(projectId, stageId);
        onProgress({ phase: "upstream-sync", message: `Sincronizando ${sections.length} sección(es)…` });
        const jobResult = await consume(
          this.streamMddUpstreamSync(
            projectId,
            sections,
            summary,
            data.dbgaContent ?? docs.dbgaContent,
            stageId,
          ),
        );
        if (jobResult.ok && jobResult.outcome === "done") {
          const targetStage = stageId?.trim() || docs.stageId;
          await this.mddUpstreamSync.captureBaseline(projectId, targetStage).catch((err) => {
            this.logger.warn(
              `[MDD upstream-sync] capture baseline failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
        return jobResult;
      }
      default:
        throw new Error(`Modo MDD no soportado en job: ${mode}`);
    }
  }

  /** Captura baseline upstream y adjunta estado de sync al resultado del job para el Workshop. */
  private async finalizeMddJobUpstreamBaseline(
    projectId: string,
    stageId: string | null | undefined,
    jobResult: MddJobResult,
  ): Promise<MddJobResult> {
    const sid =
      stageId?.trim() ||
      jobResult.stageId?.trim() ||
      (await this.mddUpstreamSync.loadUpstreamDocuments(projectId, stageId).catch(() => null))?.stageId;
    if (!sid) return jobResult;
    try {
      const { syncStatus } = await this.mddUpstreamSync.captureBaselineAndAnalyze(projectId, sid);
      if (syncStatus.pendingSync) {
        this.logger.warn(
          `[MDD ${jobResult.mode}] baseline capturado pero pendingSync=true projectId=${projectId} stageId=${sid} sources=${syncStatus.changedSources.join(",")}`,
        );
      }
      return { ...jobResult, mddUpstreamSync: syncStatus };
    } catch (err) {
      this.logger.warn(
        `[MDD ${jobResult.mode}] capture baseline failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return jobResult;
    }
  }

  /** Persiste trail/breakdown/gaps del pipeline MDD para rehidratar el modal tras recargar. */
  private persistMddAuditSnapshot(
    projectId: string | undefined,
    stageId: string | null | undefined,
    payload: {
      auditTrail?: string[];
      mddAgentEditLog?: MddAgentEditLogEntry[];
      precisionBreakdown?: PrecisionBreakdown;
      auditorGaps?: AuditorGaps;
    },
  ): void {
    const pid = projectId?.trim();
    if (!pid) return;
    void this.estimationService.saveMddAuditSnapshot(pid, stageId, payload).catch((err) => {
      this.logger.warn(
        `[MDD audit] persist snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
