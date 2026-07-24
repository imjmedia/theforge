/**
 * Auditoría manual del MDD — mismo patrón que Phase0InterviewService.audit().
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@theforge/database";
import { AIFactory } from "../../ai/ai.factory.js";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { pickPrimaryStage } from "../../projects/stage-helpers.js";
import { createDbgaLLM, createMddAuditorLLM } from "../llm/create-dbga-llm.js";
import { createMddAuditorNode } from "../nodes/mdd-auditor.node.js";
import { getMddAuditorTools } from "../tools/tool-registry.js";
import { EstimationService } from "../estimation/estimation.service.js";
import { MDD_AUDIT_UPDATE_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import type { MddComplexityLevel } from "../state/mdd-state.schema.js";
import { validateMddStructure } from "../utils/mdd-sanitize.js";
import { synthesizeStructuralAuditorGaps } from "../utils/mdd-auditor-gaps.util.js";
import { parseJsonOrThrow } from "../utils/parse-json.js";
import { z } from "zod";
import {
  buildMddQuestionPlan,
  hasMddAuditDocument,
  isMddAuditPass,
} from "./mdd-manual-audit.util.js";
import { MDD_MIN_AUDIT_CHARS } from "./mdd-manual-audit.types.js";
import {
  parseMddAuditInterview,
  rehydrateMddAuditState,
  serializeMddAuditInterview,
} from "./mdd-manual-audit-persist.util.js";
import {
  MDD_AUDIT_COMPLETE_MESSAGE,
  MDD_AUDIT_DONE_MESSAGE,
  type MddManualAuditEvent,
  type MddManualAuditState,
} from "./mdd-manual-audit.types.js";

const mddUpdateOutputSchema = z.object({
  mddContent: z.string(),
});

@Injectable()
export class MddManualAuditService {
  private readonly logger = new Logger(MddManualAuditService.name);
  private readonly states = new Map<string, MddManualAuditState>();
  private readonly threadMeta = new Map<string, { projectId: string; stageId: string }>();

  constructor(
    private readonly aiFactory: AIFactory,
    private readonly prisma: PrismaService,
    private readonly estimation: EstimationService,
  ) {}

  async audit(
    projectId: string,
    stageId?: string | null,
    mddContentOverride?: string | null,
  ): Promise<MddManualAuditEvent> {
    const pid = projectId?.trim();
    if (!pid) return { type: "error", message: "projectId es requerido" };

    const resolvedStageId = await this.resolveStageId(pid, stageId);
    if (!resolvedStageId) {
      return { type: "error", message: "No se encontró etapa del proyecto" };
    }

    const mddDraft =
      (mddContentOverride?.trim() ||
        (await this.estimation.getMddContentForProject(pid, resolvedStageId)) ||
        "").trim();

    if (!hasMddAuditDocument(mddDraft)) {
      return {
        type: "error",
        message:
          "No hay MDD para auditar. Genera o escribe el documento en la pestaña MDD antes de auditar.",
      };
    }

    const stage = await this.prisma.stage.findUnique({
      where: { id: resolvedStageId },
      select: { brdContent: true },
    });
    const projectRow = await this.prisma.project.findUnique({
      where: { id: pid },
      select: { userId: true, complexity: true, dbgaContent: true },
    });
    if (!projectRow) return { type: "error", message: "Proyecto no encontrado" };

    const auditResult = await this.runAuditor(
      projectRow.userId,
      mddDraft,
      pid,
      resolvedStageId,
      (projectRow.complexity as MddComplexityLevel) ?? "MEDIUM",
      stage?.brdContent ?? null,
      projectRow.dbgaContent ?? null,
    );

    const validation = validateMddStructure(mddDraft);
    const score = auditResult.auditorScore ?? 0;
    const gaps = auditResult.auditorGaps ?? null;
    const feedback = auditResult.auditorFeedback ?? "";

    await this.persistAuditSnapshot(pid, resolvedStageId, mddDraft, score, gaps, feedback);

    if (isMddAuditPass(score, validation, gaps)) {
      return {
        type: "audit_complete",
        message: MDD_AUDIT_COMPLETE_MESSAGE,
        mddContent: mddDraft,
        auditorScore: score,
        gaps,
      };
    }

    const questionPlan = buildMddQuestionPlan(validation, gaps);
    if (questionPlan.length === 0) {
      return {
        type: "audit_complete",
        message: MDD_AUDIT_COMPLETE_MESSAGE,
        mddContent: mddDraft,
        auditorScore: score,
        gaps,
      };
    }

    const threadId = randomUUID();
    const state: MddManualAuditState = {
      projectId: pid,
      stageId: resolvedStageId,
      threadId,
      mddDraft,
      auditorScore: score,
      auditorFeedback: feedback,
      auditorGaps: gaps,
      questionPlan,
      planCursor: 0,
      preguntasRealizadas: 0,
      maxPreguntas: questionPlan.length,
      historial: [],
      status: "interviewing",
      mddComplexity: (projectRow.complexity as MddComplexityLevel) ?? "MEDIUM",
    };

    this.rememberState(state);
    await this.persistInterviewState(state);

    const first = this.questionForPlan(state);
    if (first.type !== "question") {
      return { type: "error", message: "No se pudo iniciar la auditoría del MDD" };
    }

    return {
      type: "audit_started",
      threadId,
      question: first.question,
      n: first.n,
      total: first.total,
      mddContent: state.mddDraft,
      auditorScore: score,
      gaps,
    };
  }

  async processAnswer(
    threadId: string,
    answer: string,
    projectIdHint?: string,
    stageIdHint?: string | null,
  ): Promise<MddManualAuditEvent> {
    const state = await this.ensureState(threadId, projectIdHint, stageIdHint);
    if (!state) {
      return { type: "error", message: "Thread no encontrado. Ejecuta la auditoría de nuevo." };
    }

    const trimmedAnswer = answer?.trim();
    if (!trimmedAnswer) {
      return { type: "error", message: "La respuesta no puede estar vacía" };
    }

    const currentGap = state.questionPlan[state.planCursor];
    state.historial.push({
      pregunta: state.ultimaPregunta ?? "—",
      respuesta: trimmedAnswer,
      issue: currentGap?.issue,
    });
    state.preguntasRealizadas += 1;
    state.planCursor += 1;

    const project = await this.prisma.project.findUnique({
      where: { id: state.projectId },
      select: { userId: true },
    });
    if (!project) return { type: "error", message: "Proyecto no encontrado" };

    const updated = await this.applyAnswerToMdd(
      project.userId,
      state.mddDraft,
      state.ultimaPregunta ?? currentGap?.sugerenciaPregunta ?? "—",
      trimmedAnswer,
      currentGap?.sections ?? [],
    );
    if (updated) state.mddDraft = updated;

    const auditResult = await this.runAuditor(
      project.userId,
      state.mddDraft,
      state.projectId,
      state.stageId,
      state.mddComplexity,
    );
    state.auditorScore = auditResult.auditorScore ?? state.auditorScore;
    state.auditorFeedback = auditResult.auditorFeedback ?? state.auditorFeedback;
    state.auditorGaps = auditResult.auditorGaps ?? state.auditorGaps;

    await this.persistInterviewState(state);

    const validation = validateMddStructure(state.mddDraft);
    if (isMddAuditPass(state.auditorScore, validation, state.auditorGaps)) {
      return await this.finalize(state, MDD_AUDIT_COMPLETE_MESSAGE);
    }

    if (state.planCursor >= state.maxPreguntas) {
      return await this.finalize(state, MDD_AUDIT_DONE_MESSAGE);
    }

    const next = this.questionForPlan(state);
    if (next.type === "question") {
      return { ...next, mddContent: state.mddDraft };
    }

    return await this.finalize(state, MDD_AUDIT_DONE_MESSAGE);
  }

  private async finalize(state: MddManualAuditState, message: string): Promise<MddManualAuditEvent> {
    state.status = "done";
    await this.persistMddContent(state.projectId, state.stageId, state.mddDraft);
    await this.persistAuditSnapshot(
      state.projectId,
      state.stageId,
      state.mddDraft,
      state.auditorScore,
      state.auditorGaps,
      state.auditorFeedback,
    );
    await this.clearInterviewPersist(state.projectId, state.stageId);
    this.states.delete(state.threadId);
    this.threadMeta.delete(state.threadId);

    return {
      type: "done",
      mddContent: state.mddDraft,
      message,
      auditorScore: state.auditorScore,
      gaps: state.auditorGaps,
    };
  }

  private questionForPlan(state: MddManualAuditState): MddManualAuditEvent {
    if (state.planCursor >= state.maxPreguntas) {
      return { type: "done", mddContent: state.mddDraft };
    }
    const gap = state.questionPlan[state.planCursor];
    if (!gap) {
      return { type: "done", mddContent: state.mddDraft };
    }
    state.ultimaPregunta = gap.sugerenciaPregunta;
    return {
      type: "question",
      question: gap.sugerenciaPregunta,
      n: state.planCursor + 1,
      total: Math.max(state.maxPreguntas, 1),
    };
  }

  private async runAuditor(
    userId: string,
    mddDraft: string,
    projectId: string,
    stageId: string,
    complexity: MddComplexityLevel,
    brdContent?: string | null,
    dbgaContent?: string | null,
  ): Promise<Partial<MDDStateType>> {
    let brd = brdContent;
    let dbga = dbgaContent;
    if (brd == null || dbga == null) {
      const [stage, project] = await Promise.all([
        this.prisma.stage.findUnique({ where: { id: stageId }, select: { brdContent: true } }),
        this.prisma.project.findUnique({ where: { id: projectId }, select: { dbgaContent: true } }),
      ]);
      brd ??= stage?.brdContent ?? null;
      dbga ??= project?.dbgaContent ?? null;
    }
    try {
      const llm = await createMddAuditorLLM(this.aiFactory, userId);
      const node = createMddAuditorNode(llm, getMddAuditorTools(), null);
      const partial = await node({
        mddDraft,
        dbgaContent: dbga ?? "",
        brdContent: brd ?? undefined,
        projectId,
        activeStageId: stageId,
        mddComplexity: complexity,
        mddIteration: 0,
      } as MDDStateType);
      return partial;
    } catch (err) {
      this.logger.error(`[MddAudit] auditor failed: ${err}`);
      const validation = validateMddStructure(mddDraft);
      const structural = synthesizeStructuralAuditorGaps(validation);
      return {
        auditorScore: structural.score,
        auditorFeedback: validation.issues.join(" ") || "Auditoría LLM no disponible",
        auditorGaps: structural,
        auditorDecision: "clarifier",
      };
    }
  }

  private async applyAnswerToMdd(
    userId: string,
    mddDraft: string,
    question: string,
    answer: string,
    sections: string[],
  ): Promise<string | null> {
    const llm = await this.getUserLLM(userId);
    if (!llm) return null;

    try {
      const payload = JSON.stringify(
        {
          mdd_actual: mddDraft.slice(0, 48_000),
          pregunta_auditoria: question,
          respuesta_usuario: answer,
          secciones_afectadas: sections,
        },
        null,
        2,
      );
      const response = await llm.invoke([
        { role: "system", content: MDD_AUDIT_UPDATE_PROMPT },
        { role: "user", content: payload },
      ]);
      const content =
        typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const parsed = parseJsonOrThrow(content, mddUpdateOutputSchema);
      const next = parsed.mddContent?.trim();
      return next && next.length >= MDD_MIN_AUDIT_CHARS / 2 ? next : null;
    } catch (err) {
      this.logger.warn(`[MddAudit] apply answer failed: ${err}`);
      return null;
    }
  }

  private async persistAuditSnapshot(
    projectId: string,
    stageId: string,
    _mddContent: string,
    _score: number,
    gaps: MddManualAuditState["auditorGaps"],
    feedback: string,
  ): Promise<void> {
    if (gaps) {
      this.estimation.setAuditorGaps(projectId, gaps, stageId);
    }
    const trail: string[] = [];
    if (feedback.trim()) trail.push(feedback.trim());
    for (const g of gaps?.critical_gaps ?? []) {
      trail.push(`[${(g.sections ?? []).join(", ")}] ${g.issue}`);
    }
    try {
      await this.estimation.saveMddAuditSnapshot(projectId, stageId, {
        auditTrail: trail.length > 0 ? trail : undefined,
        auditorGaps: gaps ?? undefined,
      });
    } catch (err) {
      this.logger.warn(`[MddAudit] snapshot failed for ${projectId}: ${err}`);
    }
  }

  private async resolveStageId(
    projectId: string,
    stageId?: string | null,
  ): Promise<string | null> {
    if (stageId?.trim()) return stageId.trim();
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    return pickPrimaryStage(project?.stages ?? [])?.id ?? null;
  }

  private async persistMddContent(
    projectId: string,
    stageId: string,
    mddContent: string,
  ): Promise<void> {
    await this.prisma.stage.update({
      where: { id: stageId },
      data: { mddContent },
    });
    this.estimation.clearLiveDraft(projectId, stageId);
  }

  private rememberState(state: MddManualAuditState): void {
    this.states.set(state.threadId, state);
    this.threadMeta.set(state.threadId, {
      projectId: state.projectId,
      stageId: state.stageId,
    });
  }

  private async ensureState(
    threadId: string,
    projectIdHint?: string,
    stageIdHint?: string | null,
  ): Promise<MddManualAuditState | null> {
    const cached = this.states.get(threadId);
    if (cached) return cached;

    const meta = this.threadMeta.get(threadId);
    const projectId = (meta?.projectId ?? projectIdHint)?.trim();
    const stageId = (meta?.stageId ?? stageIdHint)?.trim();
    if (!projectId || !stageId) return null;

    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { shortTermContext: true, projectId: true },
    });
    if (!stage || stage.projectId !== projectId) return null;

    const ctx = stage.shortTermContext;
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return null;
    const envelope = parseMddAuditInterview(
      (ctx as Record<string, unknown>).mddAuditInterview,
    );
    if (!envelope) return null;

    const rehydrated = rehydrateMddAuditState(envelope, threadId);
    if (!rehydrated) return null;

    this.rememberState(rehydrated);
    return rehydrated;
  }

  private async persistInterviewState(state: MddManualAuditState): Promise<void> {
    try {
      const stage = await this.prisma.stage.findUnique({
        where: { id: state.stageId },
        select: { shortTermContext: true },
      });
      const prev =
        stage?.shortTermContext && typeof stage.shortTermContext === "object" && !Array.isArray(stage.shortTermContext)
          ? (stage.shortTermContext as Record<string, unknown>)
          : {};
      await this.prisma.stage.update({
        where: { id: state.stageId },
        data: {
          shortTermContext: {
            ...prev,
            mddAuditInterview: JSON.parse(
              JSON.stringify(serializeMddAuditInterview(state)),
            ) as Prisma.InputJsonValue,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(`[MddAudit] persist interview failed: ${err}`);
    }
  }

  private async clearInterviewPersist(projectId: string, stageId: string): Promise<void> {
    try {
      const stage = await this.prisma.stage.findUnique({
        where: { id: stageId },
        select: { shortTermContext: true, projectId: true },
      });
      if (!stage || stage.projectId !== projectId) return;
      const prev =
        stage.shortTermContext && typeof stage.shortTermContext === "object" && !Array.isArray(stage.shortTermContext)
          ? { ...(stage.shortTermContext as Record<string, unknown>) }
          : {};
      delete prev.mddAuditInterview;
      await this.prisma.stage.update({
        where: { id: stageId },
        data: { shortTermContext: prev as Prisma.InputJsonValue },
      });
    } catch {
      /* ignore */
    }
  }

  private async getUserLLM(userId: string) {
    try {
      return await createDbgaLLM(this.aiFactory, userId);
    } catch (err) {
      this.logger.warn(`[MddAudit] getUserLLM failed: ${err}`);
      return null;
    }
  }
}
