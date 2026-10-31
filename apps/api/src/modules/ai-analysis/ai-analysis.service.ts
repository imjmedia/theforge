import { forwardRef, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { fallbackClarifierQuestions } from "./utils/mdd-clarifier-questions.util.js";
import { hashMddDraft } from "./estimation/mdd-draft-hash.util.js";
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
import {
  mddThreadLockKey,
  ThreadRunLockService,
  THREAD_BUSY_CODE,
  THREAD_BUSY_MESSAGE,
  type ThreadRunLease,
} from "./checkpoint/thread-run-lock.service.js";
import { runWithLlmAbortSignal } from "./utils/mdd-llm-stream-invoke.util.js";
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
  logSection3Debug,
  mergeSingleArchitectSectionIntoDraft,
  replaceSection1BodyFromAnyHeading,
  restoreContextSectionFromBaselineIfMissing,
  restoreMddSectionsFromBaselineStrict,
  mddHasDuplicateSectionHeadings,
  deduplicateMddDraftSections,
} from "./utils/mdd-sanitize.js";
import { evaluateMddPersistTailGuard } from "./utils/mdd-persist-tail-guard.util.js";
import { evaluateMddDraftPersistFloor } from "./utils/mdd-draft-persist-floor.util.js";
import { logMddPersistFenceDiag } from "./utils/mdd-persist-fence-diag.util.js";
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
import { createMddFormatterNode } from "./nodes/mdd-formatter.node.js";
import { preflightSanitizeDraftForSection5 } from "./utils/mdd-tail-parallel.util.js";
import { createMddSoftwareArchitectNode } from "./nodes/mdd-software-architect.node.js";
import {
  agentsForArchitectSection,
  resolveLiveDraftForScopedArchitectStream,
  type MddSoftwareArchitectScope,
} from "./utils/mdd-architect-pipeline.util.js";
import { getMddArchitectTools } from "./tools/tool-registry.js";
import { contextSynthesizerComplexityAppendix } from "./utils/mdd-complexity-rigor.js";
import { formatDbgaStreamError } from "./utils/dbga-stream-error.util.js";
import { awaitWithNdjsonHeartbeat } from "./utils/ndjson-heartbeat.util.js";
import { extractLlmText, invokeLlmWithRetry } from "./utils/mdd-llm-retry.util.js";
import { MddRegenTracer } from "./utils/mdd-regen-tracer.js";
import {
  demoteCanonicalSectionHeadingsInSection1Body,
  isContextSynthesizerBodySubstantial,
  MIN_SECTION1_REGEN_BODY_LENGTH,
  normalizeContextSynthesizerBody,
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
import { isMddUserCancellationError } from "./mdd/mdd-job-error.util.js";
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
    /** Último nodo escritor que falló (borrador conservado / placeholder); el Auditor se omitió en ese caso. */
    failedStep?: { node: string; error: string };
    /** true cuando el servidor ya persistió este markdown en `done` (el cliente no debe repetir el PATCH). */
    persistedOnServer?: boolean;
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
/** Opciones comunes de los streams MDD (HTTP y job). */
export type MddStreamRunOptions = {
  /**
   * Cancelación: cierre del cliente HTTP o abort del job. Se pasa a `graph.stream({ signal })` y, vía
   * AsyncLocalStorage, a cada invocación LLM del pipeline (`invokeLlmWithRetry`), de modo que el nodo
   * en vuelo se corta en lugar de seguir consumiendo tokens.
   */
  signal?: AbortSignal;
  /**
   * Persistir el markdown final en servidor antes de emitir `done` (manager/resume). Default `true`.
   * El job BullMQ lo desactiva porque persiste él mismo (`runMddGenerationJob`).
   */
  persistOnDone?: boolean;
};

/** Evento que el turno de chat en cola entrega al relay (mismos tipos que el NDJSON del stream). */
export type MddChatJobEvent = StreamMddManagerEvent;

/** Ganchos del turno de chat ejecutado en el worker (`runMddChatTurn`). */
export type MddChatTurnHooks = {
  /** Abort del job (cancelación del usuario / apagado del worker). */
  signal?: AbortSignal;
  /** Progreso para `job.updateProgress` (banner de generación). */
  onProgress?: (p: MddJobProgress) => void | Promise<void>;
  /** Se invoca por cada evento del generador (incluidos terminales), en orden. */
  onEvent?: (event: MddChatJobEvent) => void | Promise<void>;
};

/**
 * Avanza el generador interno ejecutando cada `next()` dentro del contexto de aborto LLM: así las
 * llamadas LLM de los nodos (que no reciben `config.signal`) ven la señal del turno.
 */
async function* withLlmAbortContext<T, R>(
  signal: AbortSignal | undefined,
  gen: AsyncGenerator<T, R, undefined>,
): AsyncGenerator<T, R, undefined> {
  if (!signal) return yield* gen;
  try {
    for (;;) {
      const step = await runWithLlmAbortSignal(signal, () => gen.next());
      if (step.done) return step.value;
      yield step.value;
    }
  } finally {
    // Si el consumidor cortó antes de tiempo, ejecuta los `finally` del generador interno.
    await gen.return(undefined as R).catch(() => undefined);
  }
}

/** Guarda lastStepFailed por thread_id cuando un nodo falla; se inyecta al reanudar para que el Manager re-planifique. */
const lastStepFailedByThread = new Map<string, { node: string; error: string }>();

/** Clave de borrador en EstimationService: vacío → solo `projectId` (legacy). */
function stageIdForEstimation(mddStageId: string): string | undefined {
  const s = (mddStageId ?? "").trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Opciones para calculateLiveMetrics / getPrecisionBreakdown. Incluye `auditorGaps` del último estado
 * para que el % mostrado al usuario (interrupt y done) sea el del Auditor LLM (juez único) y no el
 * semáforo regex, que solo aplica cuando aún no hay auditoría.
 */
function estimationOpts(
  projectId: string | undefined,
  stageId: string | null | undefined,
  state: Pick<MDDState, "mddComplexity" | "projectId" | "activeStageId" | "auditorGaps"> | null | undefined,
): { projectId?: string; stageId?: string | null; complexity?: EstimationComplexity; auditorGaps?: AuditorGaps } {
  const pid = (state?.projectId ?? projectId)?.trim();
  if (!pid) return {};
  const sid = (stageId ?? state?.activeStageId) ?? null;
  return {
    projectId: pid,
    stageId: sid,
    complexity: state?.mddComplexity,
    ...(state?.auditorGaps ? { auditorGaps: state.auditorGaps } : {}),
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
    private readonly threadLock: ThreadRunLockService,
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

  private streamDraftCacheKey(draft: string): string {
    const trimmed = (draft ?? "").trim();
    if (trimmed.length < 80) return "";
    let hash = 5381;
    for (let i = 0; i < trimmed.length; i += 1) {
      hash = ((hash << 5) + hash) ^ trimmed.charCodeAt(i);
    }
    return `${trimmed.length}:${(hash >>> 0).toString(36)}`;
  }

  /** Evita re-ejecutar prepare completo en cada tick `values` cuando el borrador no cambió. */
  private async prepareMddForStreamDraft(
    cache: { draftKey: string; markdown: string },
    input: Parameters<typeof prepareMddForOutputCore>[0],
    options?: PrepareMddForOutputOptions,
  ): Promise<string> {
    const draft = typeof input === "string" ? input.trim() : (input.mddDraft ?? "").trim();
    const key = this.streamDraftCacheKey(draft);
    if (key && key === cache.draftKey && cache.markdown.length > 80) {
      return cache.markdown;
    }
    const prepared = await this.runPrepareMddForOutput(input, {
      ...options,
      formatForPersist: false,
      streamPreview: true,
    });
    if (key && prepared.length > 80) {
      cache.draftKey = key;
      cache.markdown = prepared;
    }
    return prepared;
  }

  /** Evita persistir MDD con §2–§7 borradas por prepare/dedupe tras borrador sustancial. */
  private guardMarkdownTailForPersist(
    prePrepareDraft: string,
    markdown: string,
  ): { markdown: string; errorMessage?: string } {
    let working = markdown;
    if (mddHasDuplicateSectionHeadings(working)) {
      const deduped = deduplicateMddDraftSections(working);
      if (!mddHasDuplicateSectionHeadings(deduped)) {
        this.logger.warn(
          `[MDD:PersistCheck] auto-dedupe headings duplicados (len ${working.length}→${deduped.length})`,
        );
        working = deduped;
      } else {
        return {
          markdown: working,
          errorMessage:
            "El borrador final repite headings canónicos §1–§7 (secciones duplicadas). " +
            "No se persistió; reintenta la generación del MDD.",
        };
      }
    }

    const guard = evaluateMddPersistTailGuard(prePrepareDraft, working, "PersistCheck");
    if (guard.restored) {
      this.logger.warn(
        `[MDD:PersistCheck] §2–§7 restaurada(s) tras prepare (draftLen=${prePrepareDraft.length})`,
      );
    }
    if (guard.errorMessage) {
      this.logger.error(`[MDD:PersistCheck] ${guard.errorMessage}`);
    }
    return { markdown: guard.markdown, errorMessage: guard.errorMessage };
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

  /**
   * Borra checkpoint para ese par proyecto / etapa (`mddStageId` vacío = hilo DBGA).
   * Además purga el hilo en las tablas LangGraph (checkpoints / checkpoint_writes / checkpoint_blobs)
   * vía PostgresSaver.deleteThread: sin esto crecen sin límite y un thread_id reutilizado podría
   * reanudar un estado viejo.
   */
  async clearMddCheckpoint(projectId: string, mddStageId = ""): Promise<void> {
    if (!projectId?.trim()) return;
    const where = { projectId: projectId.trim(), mddStageId: mddStageId.trim() };
    const rows = await this.prisma.agentStateCheckpoint.findMany({ where, select: { threadId: true } });
    await this.prisma.agentStateCheckpoint.deleteMany({ where });
    this.nodeCacheService.invalidateAll();
    if (rows.length === 0) return;
    const checkpointer = await this.checkpointerService.getCheckpointer().catch(() => null);
    if (!checkpointer) return;
    for (const row of rows) {
      await checkpointer.deleteThread(row.threadId).catch((err: unknown) => {
        this.logger.warn(`deleteThread(${row.threadId}) falló: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // ─── Hilo MDD: lease por hilo, persistencia server-side y memoria de checkpoint ───────────────

  /** Etapa efectiva del hilo MDD (misma resolución que el stream manager) para la clave del lease. */
  private async resolveMddLockStageId(projectId: string, stageIdFromClient?: string | null): Promise<string> {
    const fallback = (stageIdFromClient ?? "").trim();
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId.trim() },
        include: { stages: { orderBy: { ordinal: "asc" } } },
      });
      if (!project) return fallback;
      const route = await this.agentSupervisor.resolveRouteFromProject(project, stageIdFromClient);
      return (route.stageId ?? "").trim();
    } catch {
      return fallback;
    }
  }

  /**
   * Valores del checkpoint del hilo si ya hay memoria de turnos previos (borrador, score del Auditor o
   * respuestas acumuladas del usuario); `null` en hilo nuevo. Con memoria, el stream NO debe arrancar con
   * `initialState` completo: `defaultMDDState` pisaría auditorScore/mddIteration/managerRound con ceros.
   */
  private async readThreadCheckpointMemory(
    graph: { getState: (config: { configurable: Record<string, string> }) => Promise<{ values?: unknown }> },
    config: { configurable: Record<string, string> },
  ): Promise<MDDState | null> {
    try {
      const snapshot = await graph.getState(config);
      const values = snapshot?.values as MDDState | undefined;
      if (!values || typeof values !== "object") return null;
      const hasMemory =
        !!values.mddDraft?.trim() ||
        (typeof values.auditorScore === "number" && values.auditorScore > 0) ||
        !!values.userInputAccumulated?.trim();
      return hasMemory ? values : null;
    } catch {
      return null;
    }
  }

  /**
   * Persistidor de borradores MDD con suelo anti-wipe (`evaluateMddDraftPersistFloor`): compartido por el
   * job BullMQ y por el `done` de los streams manager/resume.
   */
  private createMddPersister(args: {
    projectId: string;
    stageId?: string;
    label: string;
    lockedPatternIds: ReadonlySet<string>;
    /** Longitud del MDD almacenado al inicio (suelo entre reintentos / turnos). */
    storedBaselineLen: number;
    /** También aplica el suelo con `finalize` (un `done` degenerado no debe pisar un MDD grande). */
    enforceFloorOnFinalize?: boolean;
    onPersisted?: (info: { length: number; finalize: boolean }) => void;
  }): { persist: (markdown: string, finalize: boolean) => Promise<boolean>; lastLen: () => number } {
    let lastPersistedLen = 0;
    const persist = async (markdown: string, finalize: boolean): Promise<boolean> => {
      const cleaned = cleanDocumentContent(markdown);
      if (cleaned.trim().length < 48) return false;
      if (cleaned.length === lastPersistedLen && !finalize) return false;
      const floor = evaluateMddDraftPersistFloor({
        candidateLen: cleaned.trim().length,
        storedBaselineLen: args.storedBaselineLen,
        finalize: finalize && !args.enforceFloorOnFinalize,
      });
      if (!floor.allowed) {
        this.logger.warn(`${args.label}: ${floor.reason}`);
        return false;
      }
      lastPersistedLen = cleaned.length;
      await this.projects.persistMddFromBackgroundJob(args.projectId, markdown, {
        stageId: args.stageId?.trim() || undefined,
        finalize,
        lockedPatternIds: [...args.lockedPatternIds],
      });
      args.onPersisted?.({ length: cleaned.length, finalize });
      return true;
    };
    return { persist, lastLen: () => lastPersistedLen };
  }

  /** Prepara el persistidor del `done` de un stream (resuelve patrones bloqueados y baseline actuales). */
  private async createMddStreamPersister(
    projectId: string,
    stageId: string | undefined,
    clientDraft: string | undefined,
    label: string,
  ): Promise<ReturnType<AiAnalysisService["createMddPersister"]>> {
    const resolved = await this.resolveLockedPatternIdsForMddJob({
      mode: "manager",
      projectId,
      stageId,
      mddContent: clientDraft,
    });
    const { correctedIds } = resolveGovernancePatternIncompatibilities(resolved.lockedPatternIds);
    return this.createMddPersister({
      projectId,
      stageId: resolved.stageId ?? stageId,
      label,
      lockedPatternIds: correctedIds,
      storedBaselineLen: peelDocumentBodyForPersist(resolved.stageMddContent).trim().length,
      enforceFloorOnFinalize: true,
    });
  }

  /**
   * Persiste el MDD final de un stream ANTES de emitir `done` (antes solo persistía el job: un stream
   * cerrado por el cliente perdía el trabajo). Intenta finalize (delivery gate); si el gate rechaza,
   * conserva el borrador como intermedio. Nunca rompe el stream.
   */
  private async persistMddStreamDone(
    persister: ReturnType<AiAnalysisService["createMddPersister"]>,
    markdown: string | undefined,
    label: string,
  ): Promise<boolean> {
    const md = (markdown ?? "").trim();
    if (md.length < 48 || (md.length < 200 && /\(Sin contenido generado\.\)/.test(md))) return false;
    try {
      await persister.persist(md, true);
      return true;
    } catch (err) {
      this.logger.warn(
        `${label}: persist final falló (${err instanceof Error ? err.message : String(err)}); guardando como borrador`,
      );
    }
    try {
      await persister.persist(md, false);
      return true;
    } catch (err) {
      this.logger.warn(`${label}: persist borrador falló: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Envuelve un turno MDD: lease por hilo (Redis `SET NX PX` / Map en dev; `THREAD_BUSY` si ya hay un turno),
   * contexto de aborto LLM y persistencia server-side en `done`. El lease se libera en `finally`
   * (también si el cliente corta el stream y el generador recibe `return()`).
   */
  private async *runGuardedMddStream<E extends { type: string }>(params: {
    tag: string;
    /** Sin projectId no hay hilo que bloquear. */
    projectId: string | undefined;
    lockStageId: string | undefined;
    options?: MddStreamRunOptions;
    persist?: { stageId: string | undefined; clientDraft?: string };
    inner: () => AsyncGenerator<E, void, undefined>;
  }): AsyncGenerator<E, void, undefined> {
    const pid = params.projectId?.trim();
    let lease: ThreadRunLease | null = null;
    if (pid) {
      lease = await this.threadLock.acquire(mddThreadLockKey(pid, params.lockStageId));
      if (!lease) {
        this.logger.warn(`[${params.tag}] hilo ocupado projectId=${pid} stage=${params.lockStageId ?? ""}`);
        yield { type: "error", code: THREAD_BUSY_CODE, message: THREAD_BUSY_MESSAGE } as unknown as E;
        return;
      }
    }
    try {
      let persister: ReturnType<AiAnalysisService["createMddPersister"]> | null = null;
      if (pid && params.persist && params.options?.persistOnDone !== false) {
        persister = await this.createMddStreamPersister(
          pid,
          params.persist.stageId,
          params.persist.clientDraft,
          `[${params.tag}] persist`,
        ).catch((err: unknown) => {
          this.logger.warn(
            `[${params.tag}] no se pudo preparar la persistencia server-side: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        });
      }
      for await (const event of withLlmAbortContext(params.options?.signal, params.inner())) {
        if (persister && event.type === "done") {
          const persisted = await this.persistMddStreamDone(persister, (event as { markdown?: string }).markdown, `[${params.tag}] persist`);
          // El cliente web no debe volver a hacer PATCH del mismo contenido (doble guardado reseteaba pendingCascadeDelta).
          if (persisted) (event as { persistedOnServer?: boolean }).persistedOnServer = true;
        }
        yield event;
      }
    } finally {
      await lease?.release();
    }
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
    options?: MddStreamRunOptions,
  ): AsyncGenerator<StreamProgressEvent> {
    const pid = projectId?.trim();
    yield* this.runGuardedMddStream<StreamProgressEvent>({
      tag: "MDD stream/pipeline",
      projectId: pid,
      lockStageId: pid ? await this.resolveMddLockStageId(pid, stageId) : undefined,
      options,
      inner: () => this.runMddPipelineStream(dbgaContent, projectId, stageId, clientMddContent, options?.signal),
    });
  }

  private async *runMddPipelineStream(
    dbgaContent: string,
    projectId: string | undefined,
    stageId: string | null | undefined,
    clientMddContent: string | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<StreamProgressEvent, void, undefined> {
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
      const formatted = formatDbgaStreamError(err, "mdd");
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
    const streamPrepareCache = { draftKey: "", markdown: "" };
    const auditTrail: string[] = [];
    const editLogTracker = new MddStreamEditLogTracker(
      initialState.mddDraft ?? "",
      initialState.internalDirectives,
    );

    try {
      const stream = await graph.stream(initialState, {
        recursionLimit: LANGGRAPH_RECURSION_LIMIT,
        streamMode: ["updates", "values"] as const,
        ...(signal ? { signal } : {}),
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
              this.estimationService.setAuditorGaps(projectId.trim(), lastState.auditorGaps, estimationStage, hashMddDraft(draft));
            }
            const prepared = await this.prepareMddForStreamDraft(
              streamPrepareCache,
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
        {
          ...prepareOpts,
          baselineDraft: mddDraftRaw || undefined,
          // Sin esto la pasada de persist corre sin ningún snapshot §1–§7: normalize/dedupe/SSOT
          // pueden vaciar secciones ya validadas y nada las restaura antes del gate.
          tailSnapshotSource: lastState,
        },
      );
      const tailPersistGuard = this.guardMarkdownTailForPersist(mddDraftRaw, markdown);
      markdown = tailPersistGuard.markdown;
      console.log(
        `[MDD:PersistCheck:diag] stream-done preLen=${mddDraftRaw.length} postLen=${markdown.length} err=${tailPersistGuard.errorMessage ? "yes" : "no"}`,
      );
      logMddPersistFenceDiag("PersistCheck:stream-done-pre", mddDraftRaw);
      logMddPersistFenceDiag("PersistCheck:stream-done-post", markdown);
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
        ...(lastState?.lastStepFailed ? { failedStep: lastState.lastStepFailed } : {}),
      };
    } catch (err) {
      if (projectId?.trim() && !isMddUserCancellationError(err)) {
        this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
      }
      const formatted = formatDbgaStreamError(err, "mdd");
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
    options?: MddStreamRunOptions,
  ): AsyncGenerator<StreamMddManagerEvent> {
    const lockStageId = await this.resolveMddLockStageId(projectId, stageIdFromClient);
    yield* this.runGuardedMddStream<StreamMddManagerEvent>({
      tag: "MDD stream/manager",
      projectId,
      lockStageId,
      options,
      persist: { stageId: lockStageId || undefined, clientDraft: (initialMddDraft ?? "").trim() || undefined },
      inner: () =>
        this.runMddManagerStream(
          dbgaContent,
          projectId,
          initialMessage,
          initialMddDraft,
          stageIdFromClient,
          imageAttachments,
          options?.signal,
        ),
    });
  }

  private async *runMddManagerStream(
    dbgaContent: string,
    projectId: string,
    initialMessage: string | undefined,
    initialMddDraft: string | undefined,
    stageIdFromClient: string | null | undefined,
    imageAttachments: ChatImagePart[] | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<StreamMddManagerEvent, void, undefined> {
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
      update: {},
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
      const formatted = formatDbgaStreamError(err, "mdd");
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

    // El checkpoint ya no se borra al terminar un turno: un hilo con memoria (auditorScore, auditorFeedback,
    // userInputAccumulated, borrador) continúa con una ACTUALIZACIÓN PARCIAL (solo lo que cambia en este turno)
    // y no con `initialState` completo, cuyos defaults (auditorScore=0, mddIteration=0, managerRound=0,
    // clarifiedScope="") pisarían esa memoria. Se pasa como input plano (no `Command({ update })`): sobre un
    // hilo terminado un Command sin `goto` no dispara el nodo START, así que el grafo no correría.
    // Los flags transitorios de gate los resetea el Manager al inicio del turno.
    const checkpointMemory = await this.readThreadCheckpointMemory(graph, config);
    const continuationInput: Partial<MDDState> | null = checkpointMemory
      ? {
          dbgaContent: dbgaEffective,
          brdContent: (brdContent ?? "").trim() || undefined,
          // "" (no undefined): un campo undefined no se escribe y quedaría el mensaje del turno anterior.
          lastUserMessage: lastUserMessage ?? "",
          ...(existingMdd ? { mddDraft: existingMdd } : {}),
          projectId: projectId?.trim(),
          ...agentCtx,
        }
      : null;
    const streamInput: MDDState | Partial<MDDState> = continuationInput ?? initialState;
    const seedState: MDDState = checkpointMemory
      ? ({ ...checkpointMemory, ...continuationInput } as MDDState)
      : initialState;
    if (checkpointMemory) {
      this.logger.log(
        `[MDD stream/manager] hilo con memoria (auditorScore=${checkpointMemory.auditorScore ?? 0}, draftLen=${(checkpointMemory.mddDraft ?? "").length}); input parcial threadId=${threadId}`,
      );
    }

    let lastState: MDDState = seedState;
    let lastNonEmptyDraft = (seedState.mddDraft ?? "").trim() || "";
    const streamPrepareCache = { draftKey: "", markdown: "" };
    const auditTrail: string[] = [];
    const editLogTracker = new MddStreamEditLogTracker(
      seedState.mddDraft ?? "",
      seedState.internalDirectives,
    );

    try {
      const stream = await graph.stream(streamInput, {
        ...config,
        ...(signal ? { signal } : {}),
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
              questions = fallbackClarifierQuestions(lastState?.auditorFeedback);
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
              this.estimationService.setAuditorGaps(projectId.trim(), lastState.auditorGaps, estimationStageId, hashMddDraft(draft));
            }
            const prepared = await this.prepareMddForStreamDraft(
              streamPrepareCache,
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
        {
          ...managerPrepareOpts,
          baselineDraft: finalDraft || undefined,
          tailSnapshotSource: lastState ?? undefined,
        },
      );
      const managerTailGuard = this.guardMarkdownTailForPersist(finalDraft, markdown);
      markdown = managerTailGuard.markdown;
      if (managerTailGuard.errorMessage) {
        yield { type: "error", message: managerTailGuard.errorMessage };
        return;
      }
      logSection3Debug("final (stream/manager done)", markdown);
      
      if (projectId?.trim()) {
        // El checkpoint se conserva al terminar: contiene la memoria de turno (auditorScore, feedback,
        // respuestas acumuladas). Solo el reset explícito (DELETE dbga/checkpoint) o el inicio DBGA lo borran.
        this.estimationService.clearLiveDraft(projectId.trim(), estimationStageId);
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
        ...(lastState?.lastStepFailed ? { failedStep: lastState.lastStepFailed } : {}),
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
          questions = fallbackClarifierQuestions(lastState?.auditorFeedback);
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
      if (!isMddUserCancellationError(err)) {
        this.estimationService.clearLiveDraft(projectId.trim(), estimationStageId);
      }
      const formatted = formatDbgaStreamError(err, "mdd");
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
    options?: MddStreamRunOptions,
  ): AsyncGenerator<StreamMddManagerEvent> {
    // Etapa del hilo: define la clave del lease y el destino de la persistencia en `done`.
    const cpRow = await this.prisma.agentStateCheckpoint
      .findFirst({
        where: { projectId: projectId.trim(), threadId: threadId.trim() },
        select: { mddStageId: true },
      })
      .catch(() => null);
    const clientDraftForPersist = mddContentFromClient?.trim() || undefined;
    yield* this.runGuardedMddStream<StreamMddManagerEvent>({
      tag: "MDD stream/resume",
      // Sin checkpoint no hay hilo que bloquear; el stream interno responde con el error habitual.
      projectId: cpRow ? projectId : undefined,
      lockStageId: cpRow?.mddStageId ?? undefined,
      options,
      persist: { stageId: cpRow?.mddStageId?.trim() || undefined, clientDraft: clientDraftForPersist },
      inner: () =>
        this.runMddResumeStream(
          projectId,
          threadId,
          userMessage,
          mddContentFromClient,
          imageAttachments,
          options?.signal,
        ),
    });
  }

  private async *runMddResumeStream(
    projectId: string,
    threadId: string,
    userMessage: string,
    mddContentFromClient: string | undefined,
    imageAttachments: ChatImagePart[] | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<StreamMddManagerEvent, void, undefined> {
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
      const formatted = formatDbgaStreamError(err, "mdd");
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
    const streamPrepareCache = { draftKey: "", markdown: "" };
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
    let threadHasPendingWork = true;
    try {
      const cpSnapshot = await graph.getState(config);
      const cpValues = cpSnapshot?.values as MDDState | undefined;
      if (cpValues?.mddDraft?.trim()) resumeInitialDraft = cpValues.mddDraft.trim();
      resumeInitialDirectives = cpValues?.internalDirectives;
      // `next` vacío = el grafo llegó a END (turno anterior terminado en `done`, ya sin borrar el checkpoint):
      // no hay interrupt que reanudar y un `Command({ resume })` terminaría sin procesar el mensaje.
      if (Array.isArray(cpSnapshot?.next) && cpSnapshot.next.length === 0) threadHasPendingWork = false;
    } catch {
      /* usar clientDraft o vacío */
    }
    if (!threadHasPendingWork) {
      this.logger.log(
        `[MDD stream/resume] hilo ${threadId} sin interrupt pendiente (turno previo terminado): se procesa como turno nuevo con memoria del checkpoint`,
      );
      yield* this.runMddManagerStream(
        "",
        projectId,
        resumeText,
        clientDraft,
        cp.mddStageId.trim() || undefined,
        undefined,
        signal,
      );
      return;
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
          ...(signal ? { signal } : {}),
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
              questions = fallbackClarifierQuestions(lastState?.auditorFeedback);
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
                this.estimationService.setAuditorGaps(projectId.trim(), lastState.auditorGaps, estimationStage, hashMddDraft(draft));
              }
            }
            const prepared = await this.prepareMddForStreamDraft(
              streamPrepareCache,
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
          {
            ...resumePrepareOpts,
            baselineDraft: finalDraft || undefined,
            tailSnapshotSource: lastState ?? undefined,
          },
        );
        const resumeTailGuard = this.guardMarkdownTailForPersist(finalDraft, markdown);
        markdown = resumeTailGuard.markdown;
        if (resumeTailGuard.errorMessage) {
          yield { type: "error", message: resumeTailGuard.errorMessage };
          return;
        }
        logSection3Debug("final (stream/resume done)", markdown);
        
        if (projectId?.trim()) {
          // Checkpoint conservado (memoria de turno); ver nota en el stream manager.
          this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
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
          ...(lastState?.lastStepFailed ? { failedStep: lastState.lastStepFailed } : {}),
        };
      }
    } catch (err) {
      if (projectId?.trim() && !isMddUserCancellationError(err)) {
        this.estimationService.clearLiveDraft(projectId.trim(), estimationStage);
      }
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
          questions = fallbackClarifierQuestions(lastState?.auditorFeedback);
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
      const formatted = formatDbgaStreamError(err, "mdd");
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
    regenOptions?: { pipelineParity?: boolean },
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
    const pipelineParity = regenOptions?.pipelineParity === true && section === 5;
    const tracer = new MddRegenTracer({
      mode: pipelineParity ? "section-pipeline" : "section",
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
      const formatted = formatDbgaStreamError(err, "mdd");
      tracer.summary(false, { error: formatted.message });
      yield { type: "error", message: formatted.message, code: formatted.code };
      return;
    }
    try {
      if (section === 1) {
        const prompt = `${CONTEXT_SYNTHESIZER_PROMPT}${contextSynthesizerComplexityAppendix(regenCx)}\n\n---\n\n**Documento MDD (usa las secciones 2–7 para sintetizar la sección 1):**\n\n${mddContent}`;
        const response = yield* runRegenWithHeartbeat(
          invokeLlmWithRetry(llm, [new HumanMessage(prompt)], { tag: "Regen:§1" }),
          "Contexto",
          "Regenerando §1…",
          tracer,
        );
        const text = (response ? extractLlmText(response) : "").trim();
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
        const preflight = preflightSanitizeDraftForSection5(mddContent);
        mddContent = preflight.draft;
        // Nodo quirúrgico: SOLO reescribe ## 5. No usar Software Architect aquí —
        // ese agente regenera §2–§5 como bloque y puede borrar contenido bueno en §2–§4.
        const section5Node = createMddSection5Node(llm);
        const result = yield* runRegenWithHeartbeat(
          section5Node({ ...(state as MDDStateType), mddDraft: mddContent } as MDDStateType),
          getAgentLabel("section5"),
          pipelineParity
            ? "Regenerando §5 (pipeline: section5 + Formatter lite)…"
            : "Regenerando §5 Lógica y Edge Cases…",
          tracer,
        );
        let workingState: MDDStateType = { ...(state as MDDStateType), mddDraft: mddContent, ...result };
        if (pipelineParity) {
          if (mddHasDuplicateSectionHeadings(workingState.mddDraft ?? "")) {
            const deduped = deduplicateMddDraftSections(workingState.mddDraft ?? "");
            if (!mddHasDuplicateSectionHeadings(deduped)) {
              this.logger.warn(
                `[MDD regenerate-section] §5 section-pipeline: dedupe pre-formatter (len ${(workingState.mddDraft ?? "").length}→${deduped.length})`,
              );
              workingState = { ...workingState, mddDraft: deduped };
            }
          }
          const formatterNode = createMddFormatterNode({ lite: true });
          const formatterState: MDDStateType = {
            ...workingState,
            securitySectionMd: undefined,
            integrationSectionMd: undefined,
            securityArchitectMddDraftSnapshot: undefined,
            integrationArchitectMddDraftSnapshot: undefined,
            mddStructured: workingState.mddStructured
              ? {
                  ...workingState.mddStructured,
                  seguridad: undefined,
                  integracion: undefined,
                }
              : undefined,
          };
          const formatResult = await tracer.step(
            "format-after-architect",
            async () => formatterNode(formatterState),
            { draftLen: (workingState.mddDraft ?? mddContent).length },
          );
          workingState = { ...workingState, ...formatResult };
        }
        const finalDraft = (workingState.mddDraft ?? mddContent).trim();
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
        const prepareOpts: PrepareMddForOutputOptions = pipelineParity
          ? {
              ...regenPrepareOpts,
              baselineDraft: regenBaselineMdd,
              tailSnapshotSource: undefined,
              preserveExcludeSections: [5],
            }
          : regenPrepareOpts;
        const markdown = await tracer.step(
          "prepare-output",
          async () =>
            this.runPrepareMddForOutput(
              {
                mddStructured: workingState.mddStructured ?? state.mddStructured,
                mddDraft: finalDraft,
              },
              prepareOpts,
            ),
          { draftLen: finalDraft.length, pipelineParity },
        );
        if (pipelineParity && mddHasDuplicateSectionHeadings(markdown)) {
          this.logger.error(
            `[MDD regenerate-section] §5 section-pipeline: headings duplicados tras prepare projectId=${pid}`,
          );
          tracer.summary(false, { reason: "section5-pipeline-duplicate-headings" });
          yield {
            type: "error",
            message:
              "La regeneración de §5 (pipeline) dejó secciones duplicadas §1–§7. " +
              "No se persistió el borrador corrupto; reintenta o regenera el MDD completo.",
          };
          return;
        }
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
   * Misma mecánica que `streamMddRegenerateSection` por cada §N (§1 = sintetizador de contexto, no Clarifier).
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

    const upstreamCtx = { dbgaContent, changeSummary };
    const gapLines = changeSummary.trim() ? [changeSummary.trim()] : [];

    for (const section of ordered) {
      const title = MDD_SECTION_TITLES[section] ?? `§${section}`;
      const syncAgent =
        section === 1
          ? "Contexto"
          : section === 5
            ? getAgentLabel("section5")
            : section === 6
              ? getAgentLabel("security")
              : section === 7
                ? getAgentLabel("integration")
                : getAgentLabel("software_architect");
      yield {
        type: "progress",
        agent: syncAgent,
        message: `Sincronizando ${title}…`,
        phase: "active",
      };

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

    // Suelo anti-wipe entre reintentos de BullMQ: `lastPersistedLen` se reinicia en cada
    // intento, así que sin este baseline el esqueleto del Clarificador del intento 2 pisa
    // el MDD bueno del intento 1 (job 92: 70k → 3084).
    const storedBaselineLen = peelDocumentBodyForPersist(resolvedPatterns.stageMddContent).trim().length;

    const persister = this.createMddPersister({
      projectId,
      stageId: stageId?.trim() || undefined,
      label: `MDD job ${mode} (${projectId})`,
      lockedPatternIds,
      storedBaselineLen,
      onPersisted: ({ length, finalize }) =>
        onProgress({ phase: finalize ? "persisted" : "draft", mddLength: length }),
    });
    const persistMarkdown = async (markdown: string, finalize: boolean): Promise<void> => {
      await persister.persist(markdown, finalize);
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
            mddLength: event.markdown?.length ?? persister.lastLen(),
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
          const isSectionRegen =
            mode === "section" || mode === "section-pipeline" || mode === "upstream-sync";
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

    // El job persiste él mismo (arriba) y es dueño del abort: los streams internos no persisten en `done`
    // y reciben la señal del job (corta el nodo LLM en vuelo al cancelar/preemptar).
    const streamOptions: MddStreamRunOptions = { signal: options?.signal, persistOnDone: false };
    // Un stream HTTP y un job nunca corren a la vez sobre el mismo hilo: el job toma el mismo lease
    // (reentrante, así los streams internos no se autobloquean). Si está ocupado lanza THREAD_BUSY
    // (no reintentable en BullMQ).
    const withThreadLease = async <T,>(fn: () => Promise<T>): Promise<T> => {
      const lockStage = await this.resolveMddLockStageId(projectId, stageId);
      return this.threadLock.runExclusive(mddThreadLockKey(projectId, lockStage), fn);
    };

    switch (mode) {
      case "pipeline": {
        if (data.forceFullPipeline) {
          this.nodeCacheService.invalidateAll();
          this.logger.log(`MDD pipeline forceFullPipeline: node cache invalidated projectId=${projectId}`);
        }
        const jobResult = await withThreadLease(() =>
          consume(
            this.streamMddAnalysis(
              data.dbgaContent ?? "",
              projectId,
              stageId,
              data.mddContent,
              streamOptions,
            ) as AsyncGenerator<MddJobEvent>,
          ),
        );
        if (jobResult.ok && jobResult.outcome === "done") {
          return this.finalizeMddJobUpstreamBaseline(projectId, stageId, jobResult);
        }
        return jobResult;
      }
      case "manager":
      case "resume": {
        // Chat con Manager: mismo turno que el stream HTTP (persistencia en `done`, interrupt → waiting_user),
        // ejecutado bajo el lease del hilo. El worker de la cola añade el relay de eventos (`executeChatJob`).
        return this.runMddChatTurn(data, { signal: options?.signal, onProgress });
      }
      case "section-pipeline": {
        const rawSection = data.section;
        if (rawSection !== 5) {
          throw new Error("section-pipeline only supports section 5");
        }
        onProgress({
          phase: "section-pipeline",
          section: 5,
          message: "Regenerando §5 (paridad pipeline)…",
        });
        const jobResult = await consume(
          this.streamMddRegenerateSection(
            projectId,
            5,
            data.mddContent,
            stageId,
            data.gapReasons,
            undefined,
            { pipelineParity: true },
          ),
        );
        if (jobResult.ok && jobResult.outcome === "done") {
          return this.finalizeMddJobUpstreamBaseline(projectId, stageId, jobResult);
        }
        return jobResult;
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

  /**
   * Turno de chat con Manager (`manager` / `resume`) para el worker BullMQ. Reutiliza los streams HTTP
   * (`streamMddAnalysisWithManager` / `streamMddResume`) con persistencia en `done` (`persistedOnServer`),
   * bajo el mismo lease por hilo: si hay otro turno en curso lanza `ThreadBusyError` (el job no se reintenta).
   * `interrupt` completa el job con `status: "waiting_user"`; la respuesta del usuario encola un `resume`.
   * Los errores del propio turno (evento `error`) también completan el job (`ok: false`) para no re-ejecutarlo.
   */
  async runMddChatTurn(data: MddJobData, hooks: MddChatTurnHooks = {}): Promise<MddJobResult> {
    const { mode, projectId } = data;
    const signal = hooks.signal;
    const requestedStage = data.stageId?.trim() || undefined;
    const streamOptions: MddStreamRunOptions = { signal };
    let lockKey: string | null;
    let resultStageId: string | undefined = requestedStage;
    let open: () => AsyncGenerator<StreamMddManagerEvent>;

    if (mode === "resume") {
      const threadId = data.threadId?.trim() ?? "";
      if (!projectId?.trim() || !threadId) throw new Error("projectId y threadId son obligatorios en mode resume");
      const cp = await this.prisma.agentStateCheckpoint
        .findFirst({ where: { projectId: projectId.trim(), threadId }, select: { mddStageId: true } })
        .catch(() => null);
      // Sin checkpoint no hay hilo que bloquear: el stream responde con su error habitual.
      lockKey = cp ? mddThreadLockKey(projectId, cp.mddStageId) : null;
      resultStageId = cp?.mddStageId?.trim() || requestedStage;
      open = () =>
        this.streamMddResume(
          projectId,
          threadId,
          data.userMessage ?? "",
          data.mddContent?.trim() || undefined,
          data.imageAttachments,
          streamOptions,
        );
    } else if (mode === "manager") {
      const lockStage = await this.resolveMddLockStageId(projectId, requestedStage);
      lockKey = mddThreadLockKey(projectId, lockStage);
      open = () =>
        this.streamMddAnalysisWithManager(
          data.dbgaContent ?? "",
          projectId,
          data.initialMessage,
          data.mddContent,
          requestedStage,
          data.imageAttachments,
          streamOptions,
        );
    } else {
      throw new Error(`Modo de chat MDD no soportado: ${mode}`);
    }

    const consume = async (): Promise<MddJobResult> => {
      let result: MddJobResult | null = null;
      for await (const raw of open()) {
        let event: MddChatJobEvent = raw;
        if (event.type === "error" && signal?.aborted) {
          event = { type: "error", message: "Cancelado por el usuario", code: "CANCELLED" };
        }
        await hooks.onEvent?.(event);
        if (event.type === "progress") {
          await hooks.onProgress?.({ agent: event.agent, message: event.message, phase: event.phase });
        } else if (event.type === "draft") {
          await hooks.onProgress?.({ phase: "draft", mddLength: event.markdown?.length });
        }
        // Eventos posteriores al primero terminal se relayan, pero no cambian el resultado del job.
        if (result) continue;
        if (event.type === "interrupt") {
          result = {
            ok: true,
            mode,
            projectId,
            stageId: resultStageId,
            mddLength: event.markdown?.length,
            outcome: "interrupt",
            status: "waiting_user",
            threadId: event.threadId,
            interrupt: { reply: event.reply, questions: event.questions, planMessage: event.planMessage },
          };
        } else if (event.type === "done") {
          result = {
            ok: true,
            mode,
            projectId,
            stageId: resultStageId,
            mddLength: event.markdown?.length ?? 0,
            outcome: "done",
          };
        } else if (event.type === "error" || event.type === "blocked") {
          result = {
            ok: false,
            mode,
            projectId,
            stageId: resultStageId,
            outcome: "error",
            error: event.message,
            errorCode: event.code,
          };
        }
      }
      if (signal?.aborted && (!result || result.errorCode === "CANCELLED")) {
        throw new Error("Cancelado por el usuario");
      }
      return (
        result ?? {
          ok: false,
          mode,
          projectId,
          stageId: resultStageId,
          outcome: "error",
          error: "El turno terminó sin respuesta del Manager.",
        }
      );
    };

    return lockKey ? this.threadLock.runExclusive(lockKey, consume) : consume();
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
