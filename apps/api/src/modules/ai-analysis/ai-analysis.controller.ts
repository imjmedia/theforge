import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res } from "@nestjs/common";
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
  ) { }

  private registerMddStreamLock(projectId: string | undefined): void {
    if (projectId?.trim()) this.generationGuard.registerMddStream(projectId.trim());
  }

  private releaseMddStreamLock(projectId: string | undefined): void {
    if (projectId?.trim()) this.generationGuard.unregisterMddStream(projectId.trim());
  }

  /**
   * Métricas en vivo de estimación (Semáforo + MXN) para un proyecto.
   * GET: usa borrador en vivo si hay stream MDD activo; sino mddContent del proyecto en DB.
   * POST: si body.mddContent está presente, calcula métricas sobre ese contenido (lo que ve el usuario); sino igual que GET.
   */
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
   * Borra el checkpoint LangGraph del hilo DBGA (mddStageId vacío) para el proyecto.
   * Usar al limpiar el benchmark en el taller para no reanudar un grafo antiguo.
   */
  @Delete("dbga/checkpoint")
  async clearDbgaCheckpoint(@Query("projectId") projectId: string) {
    const id = typeof projectId === "string" ? projectId.trim() : "";
    if (!id) {
      throw new BadRequestException("projectId is required");
    }
    await this.aiAnalysis.clearMddCheckpoint(id, "");
    return { ok: true };
  }

  /**
   * Starts a DBGA analysis for the given idea.
   * Body: { idea: string, projectId?: string }. Si projectId viene, se persiste estado por thread para retomar Fase 0.
   */
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
  @Post("mdd/audit")
  async auditMdd(
    @Body() body: { projectId?: string; stageId?: string; mddContent?: string },
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    const mddContent =
      typeof body?.mddContent === "string" ? body.mddContent.trim() || undefined : undefined;
    return this.mddManualAudit.audit(projectId, stageId, mddContent);
  }

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
    return this.mddManualAudit.processAnswer(threadId, answer, projectId, stageId);
  }

  /**
   * Analiza diff upstream (DBGA/BRD/Benchmark) vs baseline del MDD para sincronización incremental.
   */
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
   * Devuelve el threadId del flujo MDD para el proyecto, si existe.
   * El frontend lo usa para rehidratar managerThreadId al reabrir la app y seguir con resume.
   */
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
   * Body: { mode: pipeline|manager|section, projectId, stageId?, dbgaContent?, initialMessage?, mddContent?, section?, gapReasons? }
   */
  @Post("mdd/jobs")
  async enqueueMddJob(@Body() body: Record<string, unknown>) {
    const mode = body?.mode as MddJobMode | undefined;
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    if (!mode || !["pipeline", "manager", "section", "upstream-sync"].includes(mode)) {
      throw new BadRequestException("mode must be pipeline, manager, section, or upstream-sync");
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project && (project as { projectType?: string }).projectType === "LEGACY") {
      throw new BadRequestException("Usa POST …/legacy/generate-mdd para proyectos LEGACY.");
    }
    const data: MddJobData = {
      mode,
      projectId,
      stageId: typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined,
      dbgaContent: typeof body?.dbgaContent === "string" ? body.dbgaContent : undefined,
      initialMessage: typeof body?.initialMessage === "string" ? body.initialMessage.trim() : undefined,
      mddContent: typeof body?.mddContent === "string" ? body.mddContent : undefined,
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
    if (mode === "section") {
      const section = data.section;
      if (!Number.isInteger(section) || section! < 1 || section! > 7) {
        throw new BadRequestException("section must be 1–7");
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
    };
  }

  @Get("mdd/jobs/:jobId")
  async getMddJobStatus(@Param("jobId") jobId: string) {
    const status = await this.mddQueue.getJobStatus(jobId);
    if (status.status === "unknown") {
      throw new BadRequestException("Job no encontrado");
    }
    return status;
  }

  /**
   * Streams the MDD (Master Design Document) pipeline: Clarificador → Security → Integration → Auditor.
   * NDJSON: { type: "progress"|"done"|"error", agent?, message?, markdown? }.
   * Body: { dbgaContent?: string, projectId?: string }. dbgaContent opcional; si no hay Benchmark, los agentes generan un MDD base.
   * Preferir POST mdd/jobs para ejecución en background.
   */
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

    this.registerMddStreamLock(projectId);
    const service = this.aiAnalysis;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const event of service.streamMddAnalysis(dbgaContent, projectId, stageId)) {
            yield JSON.stringify(event) + "\n";
          }
        } catch (err) {
          const payload = formatDbgaStreamError(err);
          console.error("[MDD stream] error:", payload.message);
          yield JSON.stringify({ type: "error", ...payload }) + "\n";
        }
      })(),
    );
    // Si el cliente se desconecta, destruir el stream para no quedarlo colgado
    res.on("close", () => {
      this.releaseMddStreamLock(projectId);
      stream.destroy();
    });
    stream.on("error", (err) => {
      console.error("[MDD stream] stream error:", err);
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  /**
   * Flujo MDD con Manager (Supervisor): conversación o entrevista; el Manager responde, hace preguntas o delega en agentes.
   * NDJSON: progress | interrupt { threadId, reply?, questions? } | done | error.
   * Body: { dbgaContent?: string, projectId: string, initialMessage?: string, mddContent?: string }. Requiere projectId.
   * mddContent = borrador actual del MDD para no perder contenido al delegar.
   */
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

    this.registerMddStreamLock(projectId);
    const service = this.aiAnalysis;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const event of service.streamMddAnalysisWithManager(
            dbgaContent,
            projectId,
            initialMessage,
            mddContent,
            stageId,
            imageAttachments,
          )) {
            yield JSON.stringify(event) + "\n";
          }
        } catch (err) {
          const payload = formatDbgaStreamError(err);
          console.error("[MDD stream/manager] error:", payload.message);
          yield JSON.stringify({ type: "error", ...payload }) + "\n";
        }
      })(),
    );
    // Si el cliente se desconecta, destruir el stream para no quedarlo colgado
    res.on("close", () => {
      this.releaseMddStreamLock(projectId);
      stream.destroy();
    });
    stream.on("error", (err) => {
      console.error("[MDD stream/manager] stream error:", err);
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  /**
   * Regenera solo una sección del MDD (2–7) con el resto del documento como contexto.
   * Usado por comandos / en el chat (ej. /infraestructura).
   * Body: { projectId: string, section: number, mddContent?: string }. NDJSON: progress | done | error.
   */
  @Post("mdd/stream/regenerate-section")
  async streamMddRegenerateSection(
    @Body() body: { projectId?: string; section?: number; mddContent?: string; stageId?: string; gapReasons?: string[] },
    @Res() res: Response,
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const section = typeof body?.section === "number" ? body.section : Number(body?.section);
    const mddContent = typeof body?.mddContent === "string" ? body.mddContent.trim() : undefined;
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() || undefined : undefined;
    const gapReasons = Array.isArray(body?.gapReasons)
      ? body.gapReasons.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
      : undefined;
    if (!projectId) {
      res.status(400).json({ message: "projectId is required" });
      return;
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project && (project as { projectType?: string }).projectType === "LEGACY") {
      throw new BadRequestException(
        "Regenerar sección MDD es solo para proyectos nuevos. En legacy usa el flujo de modificaciones.",
      );
    }
    if (!Number.isInteger(section) || section < 1 || section > 7) {
      res.status(400).json({ message: "section must be 1–7" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    this.registerMddStreamLock(projectId);
    const service = this.aiAnalysis;
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const event of service.streamMddRegenerateSection(projectId, section, mddContent, stageId, gapReasons)) {
            yield JSON.stringify(event) + "\n";
          }
        } catch (err) {
          const payload = formatDbgaStreamError(err);
          console.error("[MDD stream/regenerate-section] error:", payload.message);
          yield JSON.stringify({ type: "error", ...payload }) + "\n";
        }
      })(),
    );
    res.on("close", () => {
      this.releaseMddStreamLock(projectId);
      stream.destroy();
    });
    stream.on("error", (err) => {
      console.error("[MDD stream/regenerate-section] stream error:", err);
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  /**
   * Reanuda el flujo MDD con Manager tras la respuesta del usuario.
   * Body: { projectId: string, threadId: string, userMessage: string, mddContent?: string }.
   * mddContent opcional: si viene, se inyecta en el estado para no perder el documento actual (evita revertir al checkpoint viejo).
   */
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
    const stream = Readable.from(
      (async function* () {
        try {
          for await (const event of service.streamMddResume(
            projectId,
            threadId,
            userMessage,
            mddContent,
            imageAttachments,
          )) {
            yield JSON.stringify(event) + "\n";
          }
        } catch (err) {
          const payload = formatDbgaStreamError(err);
          console.error("[MDD stream/resume] error:", payload.message);
          yield JSON.stringify({ type: "error", ...payload }) + "\n";
        }
      })(),
    );
    // Si el cliente se desconecta, destruir el stream para no quedarlo colgado
    res.on("close", () => { stream.destroy(); });
    stream.on("error", (err) => {
      console.error("[MDD stream/resume] stream error:", err);
      if (!res.destroyed) {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    stream.pipe(res);
  }

  /**
   * Obtiene las decisiones arquitectónicas (ADRs) guardadas para el proyecto.
   */
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
  @Post("traceability/suggest-fix")
  async suggestTraceabilityFix(@Body() body: TraceabilitySuggestFixRequest) {
    return this.traceabilitySuggest.suggestFix(body);
  }

  @Post("mdd/suggest-governance-patterns")
  async suggestGovernancePatterns(
    @Body() body: { projectId?: string; stageId?: string },
  ) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    const stageId = typeof body?.stageId === "string" ? body.stageId.trim() : undefined;
    return this.aiAnalysis.suggestGovernancePatterns(projectId, stageId);
  }

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
  @Post("phase0/start")
  async startPhase0(@Body() body: { idea?: string; projectId?: string }) {
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!idea) throw new BadRequestException("idea is required");
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.start(idea, projectId);
  }

  /**
   * Obtiene la siguiente pregunta del entrevistador.
   */
  @Get("phase0/question/:threadId")
  async getPhase0Question(
    @Param("threadId") threadId: string,
    @Query("projectId") projectId?: string,
  ) {
    if (!threadId) throw new BadRequestException("threadId is required");
    const pid = typeof projectId === "string" ? projectId.trim() || undefined : undefined;
    return this.phase0Interview.getQuestion(threadId, pid);
  }

  @Post("phase0/audit")
  async auditPhase0(@Body() body: { projectId?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.audit(projectId);
  }

  /** Genera dbgaContent (markdown) desde phase0SummaryContent si falta. */
  @Post("phase0/sync-markdown")
  async syncPhase0Markdown(@Body() body: { projectId?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.syncMarkdown(projectId);
  }

  /**
   * Envía respuesta a la última pregunta y recibe borrador actualizado.
   */
  @Post("phase0/answer")
  async answerPhase0(@Body() body: { threadId?: string; answer?: string; projectId?: string }) {
    const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() || undefined : undefined;
    if (!threadId) throw new BadRequestException("threadId is required");
    if (!answer) throw new BadRequestException("answer is required");
    return this.phase0Interview.processAnswer(threadId, answer, projectId);
  }

  // ─── Fase 0 — Modo asistido (chat Workshop) ─────────────────────

  @Post("phase0/assisted/start")
  async startPhase0Assisted(@Body() body: { projectId?: string; idea?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const idea = typeof body?.idea === "string" ? body.idea.trim() : undefined;
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.startAssisted(projectId, idea);
  }

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
    return this.phase0Interview.processAssistedAnswer(projectId, answer, threadId);
  }

  @Post("phase0/assisted/stop")
  async stopPhase0Assisted(@Body() body: { projectId?: string }) {
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.phase0Interview.stopAssisted(projectId);
  }

  /**
   * Obtiene el estado actual de la entrevista Fase 0.
   */
  @Get("phase0/state/:threadId")
  async getPhase0State(@Param("threadId") threadId: string) {
    const state = this.phase0Interview.getState(threadId);
    if (!state) throw new BadRequestException("Thread no encontrado");
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
