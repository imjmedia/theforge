import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { Readable } from "node:stream";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AiAnalysisService } from "./ai-analysis.service.js";
import { EstimationService } from "./estimation/estimation.service.js";
import { Phase0InterviewService } from "./phase0/phase0-interview.service.js";
import { MddManualAuditService } from "./mdd/mdd-manual-audit.service.js";
import { TraceabilitySuggestService } from "./traceability/traceability-suggest.service.js";
import type { TraceabilitySuggestFixRequest } from "@theforge/shared-types";
import { parseChatImageAttachments } from "../ai/utils/chat-image-attachments.util.js";
import { formatDbgaStreamError } from "./utils/dbga-stream-error.util.js";
import { ProjectGenerationGuardService } from "../projects/project-generation-guard.service.js";
import { MddQueueService, type MddJobData, type MddJobMode } from "./mdd/mdd-queue.service.js";
import { MddUpstreamSyncService } from "./mdd/mdd-upstream-sync.service.js";
import { TokenUsageService } from "./token-usage/token-usage.service.js";
import {
  getActiveTokenUsageContext,
  runWithTokenUsageContext,
} from "./token-usage/token-usage.context.js";
import { ndjsonLinesWithHeartbeat } from "./utils/ndjson-stream.util.js";
import { MddJobEventsService } from "./mdd/mdd-job-events.service.js";
import { parseMddJobEventsCursor, type MddJobRelayEvent } from "./mdd/mdd-job-events.util.js";
import { isMddChatJobMode, validateMddChatJobPayload } from "./mdd/mdd-queue-job-payload.util.js";
import { resolveMddChatConfig } from "./mdd/mdd-chat-config.util.js";
import {
  isProjectAccessDenied,
  ProjectAccessExempt,
  ProjectAccessService,
  ProjectScoped,
} from "../../common/access/index.js";
import {
  assertDesignFirstMddJobGate,
  loadDesignFirstStageContext,
} from "../design-first/design-first-gate.util.js";

/**
 * Autorización por proyecto (`@ProjectScoped`): este controller recibe el proyecto por body o query.
 * `spend` = genera con LLM (credenciales del dueño); `contribute` = escritura sin LLM; `read` = lectura.
 * `stageId` es opcional y, si viene, debe pertenecer al proyecto.
 */
const READ_QUERY = {
  from: "query",
  key: "projectId",
  level: "read",
  stage: { from: "query", key: "stageId", optional: true },
} as const;
const CONTRIBUTE_QUERY = {
  from: "query",
  key: "projectId",
  level: "contribute",
  stage: { from: "query", key: "stageId", optional: true },
} as const;
const CONTRIBUTE_BODY = {
  from: "body",
  key: "projectId",
  level: "contribute",
  stage: { from: "body", key: "stageId", optional: true },
} as const;
const SPEND_BODY = {
  from: "body",
  key: "projectId",
  level: "spend",
  stage: { from: "body", key: "stageId", optional: true },
} as const;

@Controller("ai-analysis")
export class AiAnalysisController {
  constructor(
    private readonly aiAnalysis: AiAnalysisService,
    private readonly estimationService: EstimationService,
    private readonly phase0Interview: Phase0InterviewService,
    private readonly mddManualAudit: MddManualAuditService,
    private readonly traceabilitySuggest: TraceabilitySuggestService,
    private readonly prisma: PrismaService,
    private readonly generationGuard: ProjectGenerationGuardService,
    private readonly mddQueue: MddQueueService,
    private readonly mddUpstreamSync: MddUpstreamSyncService,
    private readonly tokenUsage: TokenUsageService,
    private readonly mddJobEvents: MddJobEventsService,
    private readonly access: ProjectAccessService,
  ) { }

  /**
   * Abre el contexto de coste (`TokenUsage`) para un handler request/response que llama al LLM.
   * Si ya hay un contexto activo (p. ej. un job o un caller externo), o no hay projectId, lo conserva y no crea otro.
   * El `projectId` es el ya autorizado por `@ProjectScoped`.
   */
  private withUsageContext<T>(
    projectId: string,
    stageId: string | null | undefined,
    documentField: string,
    context: "initial" | "regenerate",
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!projectId || getActiveTokenUsageContext()) return fn();
    return Promise.resolve(
      runWithTokenUsageContext({ projectId, stageId: stageId ?? null, documentField, context }, fn),
    );
  }

  private registerMddStreamLock(projectId: string | undefined): void {
    if (projectId?.trim()) this.generationGuard.registerMddStream(projectId.trim());
  }

  private releaseMddStreamLock(projectId: string | undefined): void {
    if (projectId?.trim()) this.generationGuard.unregisterMddStream(projectId.trim());
  }

  /**
   * Resuelve el job a su proyecto y exige `read` sobre él. Nunca 403: job inexistente y job de un proyecto
   * ajeno responden igual ("Job no encontrado") para no revelar existencia. Si el cliente envía `projectId`,
   * debe coincidir con el del job.
   */
  private async assertMddJobReadable(jobId: string, projectIdFromClient?: string): Promise<void> {
    const ref = await this.mddQueue.getJobAccessRef(jobId);
    if (!ref) throw new NotFoundException("Job no encontrado");
    if (projectIdFromClient && projectIdFromClient !== ref.projectId) {
      throw new NotFoundException("Job no encontrado");
    }
    try {
      await this.access.assertProject(this.access.actorFromRequest(), ref.projectId, "read");
    } catch (err) {
      if (isProjectAccessDenied(err)) throw new NotFoundException("Job no encontrado");
      throw err;
    }
  }

  /** El hilo de Fase 0 vive en memoria ligado a un proyecto: debe ser el ya autorizado por el guard. */
  private assertPhase0ThreadInProject(threadId: string, projectId: string): void {
    const state = this.phase0Interview.getState(threadId);
    if (state && state.projectId !== projectId.trim()) {
      throw new NotFoundException("Thread no encontrado");
    }
  }

  /** Igual que Fase 0, para el hilo de auditoría manual del MDD. */
  private assertMddAuditThreadInProject(threadId: string, projectId: string): void {
    const owner = this.mddManualAudit.getThreadProjectId(threadId);
    if (owner && owner !== projectId.trim()) {
      throw new NotFoundException("Thread no encontrado");
    }
  }

  /**
   * Responde un stream MDD como NDJSON con:
   * - `AbortSignal` por stream: si el cliente cierra la conexión se aborta `graph.stream` y la llamada LLM
   *   en vuelo (antes LangGraph seguía ejecutando el nodo y gastando tokens).
   * - heartbeat cada 15 s sin eventos (un nodo silencioso >10 min no llega al timeout de 600 s del socket).
   * - registro en el guard de generación mientras dure el stream (también en resume).
   * El lease por hilo y la persistencia en `done` viven en el servicio (`runGuardedMddStream`).
   */
  private pipeMddNdjson(
    res: Response,
    options: {
      tag: string;
      projectId: string | undefined;
      run: (signal: AbortSignal) => AsyncIterable<unknown>;
    },
  ): void {
    const abort = new AbortController();
    this.registerMddStreamLock(options.projectId);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.releaseMddStreamLock(options.projectId);
    };
    const stream = Readable.from(
      ndjsonLinesWithHeartbeat(options.run(abort.signal), {
        tag: options.tag,
        // Este helper solo sirve a los streams MDD (stream, manager, resume): mensaje de recursión del flujo MDD.
        formatError: (err) => ({ ...formatDbgaStreamError(err, "mdd") }),
      }),
    );
    // Cliente desconectado (o respuesta terminada): abortar el trabajo en vuelo y soltar el guard.
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
      release();
      stream.destroy();
    });
    stream.on("error", (err) => {
      console.error(`[${options.tag}] stream error:`, err);
      release();
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  /**
   * Métricas en vivo de estimación (Semáforo + MXN) para un proyecto.
   * GET: usa borrador en vivo si hay stream MDD activo; sino mddContent del proyecto en DB.
   * POST: si body.mddContent está presente, calcula métricas sobre ese contenido (lo que ve el usuario); sino igual que GET.
   */
  @ProjectScoped(READ_QUERY)
  @Get("estimation")
  async getEstimation(
    @Query("projectId") projectId: string,
    @Query("stageId") stageId?: string,
  ) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    const sid = typeof stageId === "string" ? stageId.trim() || undefined : undefined;
    const metrics = await this.estimationService.getLiveMetricsForProject(id, undefined, sid);
    const mddContent = await this.estimationService.getMddContentForProject(id, sid);
    const snapshot = await this.estimationService.getMddAuditSnapshot(id, sid);
    const precisionBreakdown =
      mddContent && mddContent.trim().length > 80
        ? this.estimationService.getPrecisionBreakdown(mddContent, { projectId: id, stageId: sid ?? null })
        : snapshot?.precisionBreakdown;
    return {
      ...metrics,
      precisionBreakdown,
      auditTrail: snapshot?.auditTrail,
      mddAgentEditLog: snapshot?.mddAgentEditLog,
      lastAuditAt: snapshot?.updatedAt,
    };
  }

  @ProjectScoped(CONTRIBUTE_BODY)
  @Post("estimation")
  async postEstimation(@Body() body: { projectId?: string; mddContent?: string; stageId?: string }) {
    const id = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    const sid = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    const mddContent =
      typeof body?.mddContent === "string" ? body.mddContent.trim() || undefined : undefined;
    const metrics = await this.estimationService.getLiveMetricsForProject(id, mddContent, sid);
    const contentForBreakdown =
      mddContent ?? (await this.estimationService.getMddContentForProject(id, sid));
    const snapshot = await this.estimationService.getMddAuditSnapshot(id, sid);
    const precisionBreakdown =
      contentForBreakdown && contentForBreakdown.trim().length > 80
        ? this.estimationService.getPrecisionBreakdown(contentForBreakdown, { projectId: id, stageId: sid ?? null })
        : snapshot?.precisionBreakdown;
    return {
      ...metrics,
      precisionBreakdown,
      auditTrail: snapshot?.auditTrail,
      mddAgentEditLog: snapshot?.mddAgentEditLog,
      lastAuditAt: snapshot?.updatedAt,
    };
  }

  /**
   * Limpia el borrador en vivo del proyecto (para que la estimación use mddContent guardado en DB).
   * Llamar tras PATCH project con mddContent para que el semáforo refleje el contenido guardado.
   */
  @ProjectScoped(CONTRIBUTE_BODY)
  @Post("estimation/clear-draft")
  async clearEstimationDraft(@Body() body: { projectId?: string; stageId?: string }) {
    const id = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    const sid = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    this.estimationService.clearLiveDraft(id, sid);
    return { ok: true };
  }

  /**
   * Borra checkpoint LangGraph: siempre el hilo DBGA (`mddStageId` vacío).
   * Con `stageId`, también el hilo MDD Manager de esa etapa.
   */
  @ProjectScoped(CONTRIBUTE_QUERY)
  @Delete("dbga/checkpoint")
  async clearDbgaCheckpoint(
    @Query("projectId") projectId: string,
    @Query("stageId") stageId?: string,
  ) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    await this.aiAnalysis.clearMddCheckpoint(id, "");
    const sid = typeof stageId === "string" ? stageId.trim() : "";
    if (sid) {
      await this.aiAnalysis.clearMddCheckpoint(id, sid);
    }
    return { ok: true };
  }

  /**
   * Starts a DBGA analysis for the given idea.
   * Body: { idea: string, projectId?: string }. Si projectId viene, se persiste estado por thread para retomar Fase 0.
   */
  @ProjectScoped({ ...SPEND_BODY, optional: true })
  @Post("start")
  startAnalysis(@Body() body: { idea?: string; projectId?: string }) {
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    if (!idea) {
      throw new BadRequestException("idea is required");
    }
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || undefined : undefined;
    return this.aiAnalysis.startAnalysis(idea, projectId);
  }

  /**
   * Streams the DBGA analysis: NDJSON con eventos { type: "progress"|"done"|"error", agent?, message?, markdown? }.
   * Body: { idea: string, projectId?: string }.
   */
  @ProjectScoped({ ...SPEND_BODY, optional: true })
  @Post("stream")
  async streamAnalysis(
    @Body() body: { idea?: string; projectId?: string },
    @Res() res: Response,
  ) {
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    if (!idea) {
      throw new BadRequestException("idea is required");
    }
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || undefined : undefined;

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const service = this.aiAnalysis;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const event of service.streamAnalysis(idea, projectId)) {
            yield JSON.stringify(event) + "\n";
          }
        } catch (err) {
          const payload = formatDbgaStreamError(err);
          console.error("[DBGA stream] error:", payload.message);
          yield JSON.stringify({ type: "error", ...payload }) + "\n";
        }
      })(),
    );
    res.on("close", () => { stream.destroy(); });
    stream.on("error", (err) => {
      console.error("[DBGA stream] stream error:", err);
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  /**
   * Revisión de consistencia del MDD: re-deriva diagramas (ER desde SQL, etc.) y devuelve el documento actualizado.
   * Body: { projectId: string, mddContent?: string }. Si mddContent no viene, se usa el del proyecto en DB.
   * Respuesta: { mddContent: string }.
   */
  @ProjectScoped(SPEND_BODY)
  @Post("mdd/review")
  async reviewMdd(@Body() body: { projectId?: string; mddContent?: string }) {
    const id = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    const mddContent =
      typeof body?.mddContent === "string" ? body.mddContent.trim() || undefined : undefined;
    const updated = await this.aiAnalysis.reviewMddConsistency(id, mddContent);
    return { mddContent: updated };
  }

  /** Auditoría manual del MDD visible en el Workshop. */
  @ProjectScoped(SPEND_BODY)
  @Post("mdd/audit")
  async auditMdd(
    @Body() body: { projectId?: string; stageId?: string; mddContent?: string },
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    const mddContent =
      typeof body?.mddContent === "string" ? body.mddContent.trim() || undefined : undefined;
    return this.withUsageContext(projectId, stageId, "mddContent", "regenerate", () =>
      this.mddManualAudit.audit(projectId, stageId, mddContent),
    );
  }

  @ProjectScoped(SPEND_BODY)
  @Post("mdd/audit/answer")
  async answerMddAudit(
    @Body() body: { threadId?: string; answer?: string; projectId?: string; stageId?: string },
  ) {
    const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    if (!threadId) throw new BadRequestException("threadId is required");
    if (!answer) throw new BadRequestException("answer is required");
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || undefined : undefined;
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    // El guard exige projectId (body): el hilo debe ser de ese proyecto.
    if (projectId) this.assertMddAuditThreadInProject(threadId, projectId);
    return this.withUsageContext(
      projectId ?? this.mddManualAudit.getThreadProjectId(threadId) ?? "",
      stageId,
      "mddContent",
      "regenerate",
      () => this.mddManualAudit.processAnswer(threadId, answer, projectId, stageId),
    );
  }

  /**
   * Analiza diff upstream (DBGA/BRD/Benchmark) vs baseline del MDD para sincronización incremental.
   */
  @ProjectScoped(READ_QUERY)
  @Get("mdd/upstream-sync/analysis")
  async getMddUpstreamSyncAnalysis(
    @Query("projectId") projectId: string,
    @Query("stageId") stageId?: string,
  ) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) throw new BadRequestException("projectId is required");
    const sid = typeof stageId === "string" ? stageId.trim() || undefined : undefined;
    return this.mddUpstreamSync.analyze(id, sid);
  }

  /**
   * Marca el MDD como sincronizado con el upstream actual (re-ancla baseline sin regenerar contenido).
   * Query: projectId (required), stageId (optional).
   */
  @ProjectScoped(CONTRIBUTE_QUERY)
  @Post("mdd/upstream-sync/accept-baseline")
  async acceptMddUpstreamBaseline(
    @Query("projectId") projectId: string,
    @Query("stageId") stageId?: string,
  ) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) throw new BadRequestException("projectId is required");
    const sid = typeof stageId === "string" ? stageId.trim() || undefined : undefined;
    const result = await this.mddUpstreamSync.acceptBaseline(id, sid);
    return {
      stageId: result.stageId,
      mddLength: result.mddLength,
      pendingSync: result.syncStatus.pendingSync,
      syncStatus: result.syncStatus,
      analysis: result.analysis,
    };
  }

  /**
   * Devuelve el threadId del flujo MDD para el proyecto, si existe.
   * El frontend lo usa para rehidratar managerThreadId al reabrir la app y seguir con resume.
   */
  @ProjectScoped(READ_QUERY)
  @Get("mdd/thread")
  async getMddThread(@Query("projectId") projectId: string, @Query("stageId") stageId?: string) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    const sid = typeof stageId === "string" ? stageId.trim() || undefined : undefined;
    const threadId = await this.aiAnalysis.getMddThreadId(id, sid);
    return { threadId };
  }

  /**
   * Encola generación/regeneración MDD en background (sobrevive cerrar el navegador con Redis).
   * Body: { mode: pipeline|manager|resume|section|section-pipeline|upstream-sync, projectId, stageId?, dbgaContent?, initialMessage?, mddContent?, section?, gapReasons? }
   * Chat con Manager: `manager` (turno nuevo) y `resume` (threadId + userMessage; `images?`). Los eventos del turno
   * se consumen con `GET mdd/jobs/:jobId/events?cursor=N`.
   */
  @ProjectScoped(SPEND_BODY)
  @Post("mdd/jobs")
  async enqueueMddJob(@Body() body: Record<string, unknown>) {
    const mode = body?.mode as MddJobMode | undefined;
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    if (!mode || !["pipeline", "manager", "resume", "section", "section-pipeline", "upstream-sync"].includes(mode)) {
      throw new BadRequestException(
        "mode must be pipeline, manager, resume, section, section-pipeline, or upstream-sync",
      );
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project && (project as { projectType?: string }).projectType === "LEGACY") {
      throw new BadRequestException("Usa POST …/legacy/generate-mdd para proyectos LEGACY.");
    }
    if (project?.projectType === "DESIGN_FIRST") {
      const stageIdForGate =
        typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
      const dfCtx = await loadDesignFirstStageContext(this.prisma, projectId, stageIdForGate);
      if (dfCtx) assertDesignFirstMddJobGate(dfCtx);
    }
    const isChat = isMddChatJobMode(mode);
    const data: MddJobData = {
      mode,
      projectId,
      stageId: typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined,
      dbgaContent: typeof body?.dbgaContent === "string" ? body.dbgaContent : undefined,
      initialMessage: typeof body?.initialMessage === "string" ? body.initialMessage.trim() : undefined,
      mddContent:
        typeof body?.mddContent === "string" ? (isChat ? body.mddContent.trim() : body.mddContent) : undefined,
      threadId: typeof body?.threadId === "string" ? body.threadId.trim() || undefined : undefined,
      userMessage: typeof body?.userMessage === "string" ? body.userMessage.trim() || undefined : undefined,
      imageAttachments: isChat ? parseChatImageAttachments(body?.images) : undefined,
      section: typeof body?.section === "number" ? body.section : Number(body?.section) || undefined,
      gapReasons: Array.isArray(body?.gapReasons)
        ? body.gapReasons.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
        : undefined,
      upstreamSections: Array.isArray(body?.upstreamSections)
        ? body.upstreamSections
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
        : undefined,
      upstreamChangeSummary:
        typeof body?.upstreamChangeSummary === "string" ? body.upstreamChangeSummary.trim() : undefined,
      forceFullPipeline: body?.forceFullPipeline === true,
    };
    const chatPayloadError = validateMddChatJobPayload(data);
    if (chatPayloadError) throw new BadRequestException(chatPayloadError);
    if (mode === "section" || mode === "section-pipeline") {
      const section = data.section;
      if (!Number.isInteger(section) || section! < 1 || section! > 7) {
        throw new BadRequestException("section must be 1–7");
      }
      if (mode === "section-pipeline" && section !== 5) {
        throw new BadRequestException("section-pipeline only supports section 5");
      }
    }
    if (mode === "upstream-sync") {
      const analysis = await this.mddUpstreamSync.analyze(projectId, data.stageId);
      if (!analysis.canSync && !analysis.needsFullRegen) {
        throw new BadRequestException("No hay cambios upstream pendientes de sincronizar en el MDD.");
      }
      if (analysis.needsFullRegen) {
        throw new BadRequestException("Genera el MDD completo antes de sincronizar desde upstream.");
      }
    }
    const jobId = await this.mddQueue.enqueue(data);
    return {
      queued: true,
      jobId,
      statusPath: `/ai-analysis/mdd/jobs/${jobId}`,
      projectStatusPath: `/projects/${projectId}/mdd-jobs/${jobId}`,
      ...(isChat ? { eventsPath: `/ai-analysis/mdd/jobs/${jobId}/events` } : {}),
    };
  }

  /**
   * Configuración pública del chat MDD: `chatViaQueue` (env `MDD_CHAT_VIA_QUEUE`, default "1") decide si el
   * Workshop encola el turno en BullMQ o usa el NDJSON legacy dentro del request.
   */
  @Get("mdd/config")
  getMddConfig() {
    return resolveMddChatConfig();
  }

  /**
   * Eventos del turno de chat de un job (`manager` / `resume`) como NDJSON con cursor: reproduce desde
   * `cursor` y sigue en vivo hasta un evento terminal (`done`, `error`, `interrupt`, `blocked`) o hasta que
   * el cliente se desconecta (el job NO se cancela: sigue en el worker). Cada línea incluye `cursor`
   * (índice de la siguiente entrada) para reanudar; `{"type":"heartbeat"}` cada 15 s.
   */
  @ProjectAccessExempt("autorizado por getJobAccessRef en el handler")
  @Get("mdd/jobs/:jobId/events")
  async streamMddJobEvents(
    @Param("jobId") jobId: string,
    @Query("projectId") projectIdRaw: string | undefined,
    @Query("cursor") cursorRaw: string | undefined,
    @Res() res: Response,
  ) {
    const projectId = typeof projectIdRaw === "string" ? projectIdRaw.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    await this.assertMddJobReadable(jobId, projectId);
    const status = await this.mddQueue.getJobStatus(jobId);
    if (status.status === "unknown") throw new NotFoundException("Job no encontrado");
    const cursor = parseMddJobEventsCursor(cursorRaw);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abort = new AbortController();
    const queue = this.mddQueue;
    const events = this.mddJobEvents;
    let completedIdleChecks = 0;
    const onIdle = async (): Promise<MddJobRelayEvent | null> => {
      const st = await queue.getJobStatus(jobId);
      if (st.status === "failed") {
        const cancelled = /cancelad/i.test(st.error ?? "");
        return {
          type: "error",
          message: cancelled ? "Cancelado por el usuario" : (st.error ?? "El job del chat falló en el worker."),
          code: cancelled ? "CANCELLED" : "JOB_FAILED",
        };
      }
      if (st.status === "unknown") {
        return { type: "error", message: "El job del chat ya no existe en la cola.", code: "JOB_GONE" };
      }
      if (st.status === "completed") {
        // El evento terminal se agrega antes de completar el job: una segunda ronda ociosa sin él = perdido.
        completedIdleChecks += 1;
        if (completedIdleChecks >= 2) {
          return { type: "error", message: "El turno terminó pero sus eventos ya no están disponibles.", code: "NO_RESULT" };
        }
      }
      return null;
    };
    const lines = (async function* (): AsyncGenerator<string, void, undefined> {
      try {
        for await (const line of events.tail(jobId, cursor, { signal: abort.signal, onIdle })) {
          yield JSON.stringify(line) + "\n";
        }
      } catch (err) {
        const payload = formatDbgaStreamError(err, "mdd");
        console.error("[MDD job events] error:", payload.message);
        yield JSON.stringify({ type: "error", ...payload, cursor }) + "\n";
      }
    })();
    const stream = Readable.from(lines);
    res.on("close", () => {
      abort.abort();
      stream.destroy();
    });
    stream.on("error", (err) => {
      console.error("[MDD job events] stream error:", err);
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  @ProjectAccessExempt("autorizado por getJobAccessRef en el handler")
  @Get("mdd/jobs/:jobId")
  async getMddJobStatus(@Param("jobId") jobId: string) {
    await this.assertMddJobReadable(jobId);
    const status = await this.mddQueue.getJobStatus(jobId);
    if (status.status === "unknown") {
      throw new NotFoundException("Job no encontrado");
    }
    return status;
  }

  /**
   * Streams the MDD (Master Design Document) pipeline: Clarificador → Security → Integration → Auditor.
   * NDJSON: { type: "progress"|"done"|"error", agent?, message?, markdown? }.
   * Body: { dbgaContent?: string, projectId?: string }. dbgaContent opcional; si no hay Benchmark, los agentes generan un MDD base.
   * Preferir POST mdd/jobs para ejecución en background.
   */
  @ProjectScoped(SPEND_BODY)
  @Post("mdd/stream")
  async streamMdd(
    @Body() body: { dbgaContent?: string; projectId?: string; stageId?: string },
    @Res() res: Response,
  ) {
    const dbgaContent = typeof body?.dbgaContent === "string" ? body.dbgaContent.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || undefined : undefined;
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const service = this.aiAnalysis;
    this.pipeMddNdjson(res, {
      tag: "MDD stream",
      projectId,
      run: (signal) => service.streamMddAnalysis(dbgaContent, projectId, stageId, undefined, { signal }),
    });
  }

  /**
   * Flujo MDD con Manager (Supervisor): conversación o entrevista; el Manager responde, hace preguntas o delega en agentes.
   * NDJSON: progress | interrupt { threadId, reply?, questions? } | done | error.
   * Body: { dbgaContent?: string, projectId: string, initialMessage?: string, mddContent?: string }. Requiere projectId.
   * mddContent = borrador actual del MDD para no perder contenido al delegar.
   */
  @ProjectScoped(SPEND_BODY)
  @Post("mdd/stream/manager")
  async streamMddManager(
    @Body() body: {
      dbgaContent?: string;
      projectId?: string;
      initialMessage?: string;
      mddContent?: string;
      stageId?: string;
      images?: unknown;
    },
    @Res() res: Response,
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      throw new BadRequestException("projectId is required for the Manager flow");
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project && (project as { projectType?: string }).projectType === "LEGACY") {
      throw new BadRequestException(
        "Generar MDD con agentes (Manager) es solo para proyectos nuevos. En legacy usa el flujo de modificaciones.",
      );
    }
    const dbgaContent = typeof body?.dbgaContent === "string" ? body.dbgaContent.trim() : "";
    const initialMessage = typeof body?.initialMessage === "string" ? body.initialMessage.trim() : undefined;
    const mddContent = typeof body?.mddContent === "string" ? body.mddContent.trim() : undefined;
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    const imageAttachments = parseChatImageAttachments(body?.images);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const service = this.aiAnalysis;
    this.pipeMddNdjson(res, {
      tag: "MDD stream/manager",
      projectId,
      run: (signal) =>
        service.streamMddAnalysisWithManager(
          dbgaContent,
          projectId,
          initialMessage,
          mddContent,
          stageId,
          imageAttachments,
          { signal },
        ),
    });
  }

  /**
   * Reanuda el flujo MDD con Manager tras la respuesta del usuario.
   * Body: { projectId: string, threadId: string, userMessage: string, mddContent?: string }.
   * mddContent opcional: si viene, se inyecta en el estado para no perder el documento actual (evita revertir al checkpoint viejo).
   */
  @ProjectScoped(SPEND_BODY)
  @Post("mdd/stream/resume")
  async streamMddResume(
    @Body() body: {
      projectId?: string;
      threadId?: string;
      userMessage?: string;
      mddContent?: string;
      images?: unknown;
    },
    @Res() res: Response,
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
    const userMessage = typeof body?.userMessage === "string" ? body.userMessage.trim() : "";
    const mddContent = typeof body?.mddContent === "string" ? body.mddContent.trim() : undefined;
    const imageAttachments = parseChatImageAttachments(body?.images);
    if (!projectId || !threadId) {
      throw new BadRequestException("projectId and threadId are required");
    }
    if (!userMessage && !imageAttachments.length) {
      throw new BadRequestException("userMessage or images are required");
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const service = this.aiAnalysis;
    this.pipeMddNdjson(res, {
      tag: "MDD stream/resume",
      projectId,
      run: (signal) =>
        service.streamMddResume(projectId, threadId, userMessage, mddContent, imageAttachments, { signal }),
    });
  }

  /**
   * Obtiene las decisiones arquitectónicas (ADRs) guardadas para el proyecto.
   */
  @ProjectScoped(READ_QUERY)
  @Get("mdd/adrs")
  async getAdrs(@Query("projectId") projectId: string) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    return this.aiAnalysis.getProjectDecisions(id);
  }

  /**
   * Sugiere un parche markdown para cerrar una brecha BRD→MDD (§1/§4/§5).
   */
  @ProjectScoped(SPEND_BODY)
  @Post("traceability/suggest-fix")
  async suggestTraceabilityFix(@Body() body: TraceabilitySuggestFixRequest) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    return this.withUsageContext(projectId, stageId, "mddContent", "regenerate", () =>
      this.traceabilitySuggest.suggestFix(body),
    );
  }

  @ProjectScoped(SPEND_BODY)
  @Post("mdd/suggest-governance-patterns")
  async suggestGovernancePatterns(
    @Body() body: { projectId?: string; stageId?: string },
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() : undefined;
    return this.withUsageContext(projectId, stageId, "mddContent", "regenerate", () =>
      this.aiAnalysis.suggestGovernancePatterns(projectId, stageId),
    );
  }

  @ProjectScoped(CONTRIBUTE_BODY)
  @Post("mdd/record-governance-pattern-adrs")
  async recordGovernancePatternAdrs(
    @Body()
    body: {
      projectId?: string;
      patterns?: Array<{ label: string; group: string; affects: string; description: string }>;
    },
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    const patterns = Array.isArray(body?.patterns) ? body.patterns : [];
    if (patterns.length === 0) {
      throw new BadRequestException("patterns is required");
    }
    return this.aiAnalysis.recordGovernancePatternAdrs(projectId, patterns);
  }

  // ─── Fase 0 — Entrevista Interactiva ─────────────────────────────

  /**
   * Inicia la Fase 0: toma idea o documento externo, ejecuta prompt de arranque,
   * devuelve borrador inicial + gaps.
   */
  @ProjectScoped(SPEND_BODY)
  @Post("phase0/start")
  async startPhase0(@Body() body: { idea?: string; projectId?: string }) {
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!idea) throw new BadRequestException("idea is required");
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.withUsageContext(projectId, null, "dbgaContent", "initial", () =>
      this.phase0Interview.start(idea, projectId),
    );
  }

  /**
   * Obtiene la siguiente pregunta del entrevistador.
   */
  @ProjectScoped(READ_QUERY)
  @Get("phase0/question/:threadId")
  async getPhase0Question(
    @Param("threadId") threadId: string,
    @Query("projectId") projectId?: string,
  ) {
    if (!threadId) throw new BadRequestException("threadId is required");
    const pid = typeof projectId === "string" ? projectId.trim() || undefined : undefined;
    // El guard exige projectId (query): el hilo debe ser de ese proyecto.
    if (pid) this.assertPhase0ThreadInProject(threadId, pid);
    return this.phase0Interview.getQuestion(threadId, pid);
  }

  @ProjectScoped(SPEND_BODY)
  @Post("phase0/audit")
  async auditPhase0(@Body() body: { projectId?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.withUsageContext(projectId, null, "dbgaContent", "regenerate", () =>
      this.phase0Interview.audit(projectId),
    );
  }

  /** Genera dbgaContent (markdown) desde phase0SummaryContent si falta. */
  @ProjectScoped(CONTRIBUTE_BODY)
  @Post("phase0/sync-markdown")
  async syncPhase0Markdown(@Body() body: { projectId?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.syncMarkdown(projectId);
  }

  /**
   * Envía respuesta a la última pregunta y recibe borrador actualizado.
   */
  @ProjectScoped(SPEND_BODY)
  @Post("phase0/answer")
  async answerPhase0(@Body() body: { threadId?: string; answer?: string; projectId?: string }) {
    const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || undefined : undefined;
    if (!threadId) throw new BadRequestException("threadId is required");
    if (!answer) throw new BadRequestException("answer is required");
    // El guard exige projectId (body): el hilo debe ser de ese proyecto.
    if (projectId) this.assertPhase0ThreadInProject(threadId, projectId);
    return this.withUsageContext(
      projectId ?? this.phase0Interview.getState(threadId)?.projectId ?? "",
      null,
      "dbgaContent",
      "regenerate",
      () => this.phase0Interview.processAnswer(threadId, answer, projectId),
    );
  }

  // ─── Fase 0 — Modo asistido (chat Workshop) ─────────────────────

  @ProjectScoped(SPEND_BODY)
  @Post("phase0/assisted/start")
  async startPhase0Assisted(@Body() body: { projectId?: string; idea?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const idea = typeof body?.idea === "string" ? body.idea.trim() : undefined;
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.withUsageContext(projectId, null, "dbgaContent", "initial", () =>
      this.phase0Interview.startAssisted(projectId, idea),
    );
  }

  @ProjectScoped(SPEND_BODY)
  @Post("phase0/assisted/answer")
  async answerPhase0Assisted(
    @Body() body: { projectId?: string; answer?: string; threadId?: string },
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    const threadId =
      typeof body?.threadId === "string" ? body.threadId.trim() || undefined : undefined;
    if (!projectId) throw new BadRequestException("projectId is required");
    if (!answer) throw new BadRequestException("answer is required");
    return this.withUsageContext(projectId, null, "dbgaContent", "regenerate", () =>
      this.phase0Interview.processAssistedAnswer(projectId, answer, threadId),
    );
  }

  @ProjectScoped(SPEND_BODY)
  @Post("phase0/assisted/stop")
  async stopPhase0Assisted(@Body() body: { projectId?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.stopAssisted(projectId);
  }

  /**
   * Obtiene el estado actual de la entrevista Fase 0.
   */
  @ProjectScoped(READ_QUERY)
  @Get("phase0/state/:threadId")
  async getPhase0State(@Param("threadId") threadId: string, @Query("projectId") projectId: string) {
    const state = this.phase0Interview.getState(threadId);
    // Hilo inexistente y hilo de otro proyecto responden igual (404): no revela existencia.
    // El guard exige projectId (query): el hilo debe ser de ese proyecto.
    if (!state || state.projectId !== (projectId ?? "").trim()) {
      throw new NotFoundException("Thread no encontrado");
    }
    return {
      status: state.status,
      preguntasRealizadas: state.preguntasRealizadas,
      maxPreguntas: state.maxPreguntas,
      borrador: state.borrador,
      gaps: state.gaps,
    };
  }

  // ─── Telemetry: Token Usage & Cost ─────────────────────────

  /**
   * Resumen agregado de uso de tokens por documento (incluye regeneraciones) para un proyecto.
   * Excluye el chat del Workshop a menos que `includeChat=true`; opcionalmente filtra por stageId.
   * Costes en USD según catálogo del proveedor activo + estimación MXN (TC fijo 20).
   */
  @ProjectScoped(READ_QUERY)
  @Get("token-usage")
  async getTokenUsage(
    @Query("projectId") projectId: string,
    @Query("stageId") stageId?: string,
    @Query("includeChat") includeChat?: string,
  ) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) throw new BadRequestException("projectId is required");
    const sid = typeof stageId === "string" ? stageId.trim() || undefined : undefined;
    const withChat = includeChat === "true" || includeChat === "1";
    return this.tokenUsage.getSummary(id, { stageId: sid, includeChat: withChat });
  }

  /**
   * Lista cruda de eventos de uso (último N). Pensado para vista detallada / admin.
   */
  @ProjectScoped(READ_QUERY)
  @Get("token-usage/events")
  async listTokenUsageEvents(
    @Query("projectId") projectId: string,
    @Query("stageId") stageId?: string,
    @Query("documentField") documentField?: string,
    @Query("limit") limit?: string,
  ) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) throw new BadRequestException("projectId is required");
    const sid = typeof stageId === "string" ? stageId.trim() || undefined : undefined;
    const field = typeof documentField === "string" ? documentField.trim() || undefined : undefined;
    const lim = limit ? Math.min(Math.max(Number(limit) || 100, 1), 500) : 100;
    return this.tokenUsage.listEvents(id, { stageId: sid, documentField: field, limit: lim });
  }
}
