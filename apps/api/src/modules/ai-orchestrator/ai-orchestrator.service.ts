import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ChatImagePart, ChatMessage, WorkshopChatScope } from "@theforge/shared-types";
import {
  filterChatForWorkshopView,
  resolveWorkshopChatScope,
} from "@theforge/shared-types";
import {
  PROJECTS_ORCHESTRATOR_PORT,
  type IOrchestratorProjectsPort,
} from "../projects/projects-service.port.js";
import { SessionsService } from "../sessions/sessions.service.js";
import {
  THEFORGE_ORCHESTRATOR_PORT,
  type IOrchestratorTheForgePort,
} from "../theforge/theforge-service.port.js";
import { LEGACY_DOCUMENTATION_PROMPT } from "../ai/prompts/legacy-documentation-prompt.js";
import { AgentSupervisorService } from "../agent-supervisor/agent-supervisor.service.js";
import { resolvePlatformConfigBoolean } from "../system-config/platform-config.runtime.js";
import type { SupervisorRouteResult } from "../agent-supervisor/agent-supervisor.types.js";
import { AgentEvaluatorService } from "../agent-supervisor/agent-evaluator.service.js";
import { EpisodicMemoryKind } from "@theforge/database";
import { mddContextForUxGuide, uxGuideLlmOptions } from "../ai/ux-guide-llm-context.js";
import { buildMddContextForUxGuide } from "../ai/utils/mdd-ux-guide-brief.util.js";
import { appendUxGuideDesignAttribution } from "../design-ref/design-ref-attribution.util.js";
import { wouldShrinkDbgaDangerously } from "../sessions/dbga-edit.util.js";
import { cleanDocumentContent } from "../sessions/document-content.util.js";
import {
  buildMddDocumentPersistStatus,
  extractMddPersistErrorFromException,
  MISSING_FIN_MDD_DELIMITER,
  MISSING_FIN_MDD_HINT,
  shouldReportMissingMddDelimiter,
  type OrchestratorDocumentPersist,
} from "./orchestrator-document-persist.util.js";
import {
  orchestratorTabAllowsDocPersist,
} from "./orchestrator-doc-policy.util.js";
import { UpstreamPropagateService } from "../projects/upstream-propagate.service.js";
import {
  detectUpstreamPropagateConfirmation,
  upstreamPropagateQueuedAssistantMessage,
} from "../sessions/upstream-propagate-chat.util.js";
import { mergeMddForOrchestratorPersist } from "./orchestrator-mdd-persist.util.js";

export type OrchestratorClientDeliverables = {
  architectureContent?: string;
  blueprintContent?: string;
  useCasesContent?: string;
  userStoriesContent?: string;
  apiContractsContent?: string;
  logicFlowsContent?: string;
  tasksContent?: string;
  infraContent?: string;
};

function docForActiveTab(
  activeTab: string | undefined,
  expectedTab: string,
  fromClient: string | undefined,
  fromProject: string | null | undefined,
): string | undefined {
  if ((activeTab ?? "mdd").trim() !== expectedTab) return undefined;
  const client = fromClient?.trim();
  if (client) return client;
  const persisted = fromProject?.trim();
  return persisted || undefined;
}

function resolveOrchestratorChatScope(
  project: { projectType?: string; stages?: unknown[] },
  chatScopeFromClient?: WorkshopChatScope,
): WorkshopChatScope {
  const projectType = project.projectType === "LEGACY" ? "LEGACY" : "NEW";
  return resolveWorkshopChatScope(projectType, project.stages?.length ?? 0, chatScopeFromClient);
}

function workshopTabHistory(
  log: ChatMessage[],
  tab: string,
  stageId: string | undefined,
  chatScope: WorkshopChatScope,
): ChatMessage[] {
  return filterChatForWorkshopView(log, tab, { stageId, scope: chatScope });
}

function mddForRouteStage(
  project: { mddContent?: string | null; stages?: { id: string; mddContent: string | null }[] },
  routeStageId: string,
): string | null | undefined {
  const st = project.stages?.find((s) => s.id === routeStageId);
  return st?.mddContent ?? project.mddContent;
}

function stageBrdContent(
  project: { stages?: { id: string; brdContent: string | null }[] | null },
  routeStageId: string,
): string | null | undefined {
  const st = project.stages?.find((s) => s.id === routeStageId);
  return st?.brdContent ?? undefined;
}

@Injectable()
export class AiOrchestratorService {
  constructor(
    private readonly sessions: SessionsService,
    @Inject(PROJECTS_ORCHESTRATOR_PORT) private readonly projects: IOrchestratorProjectsPort,
    @Inject(THEFORGE_ORCHESTRATOR_PORT) private readonly theforge: IOrchestratorTheForgePort,
    private readonly agentSupervisor: AgentSupervisorService,
    private readonly agentEvaluator: AgentEvaluatorService,
    private readonly upstreamPropagate: UpstreamPropagateService,
  ) { }

  private lastAssistantContentForTab(
    session: { chatLog?: unknown } | null | undefined,
    tab: string,
  ): string {
    const log = (session?.chatLog ?? []) as ChatMessage[];
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i];
      if (m?.role === "assistant" && (m.tab ?? "mdd") === tab) {
        return m.content ?? "";
      }
    }
    return "";
  }

  private async tryPersistMddContent(
    projectId: string,
    mddContent: string,
    stageId: string,
    extras?: {
      documentAst?: Record<string, unknown> | null;
      documentVersion?: number | null;
    },
  ): Promise<{
    saved: boolean;
    project?: Awaited<ReturnType<IOrchestratorProjectsPort["update"]>>;
    code?: string;
    deliveryGate?: import("@theforge/shared-types").MddDeliveryGateResult;
    hint?: string;
  }> {
    try {
      const existingProject = await this.projects.findOne(projectId);
      const stageRow = existingProject.stages?.find((s) => s.id === stageId);
      const existingMdd = String(stageRow?.mddContent ?? existingProject.mddContent ?? "").trim();
      const { content: mergedMdd, stats, defensiveMerge } = mergeMddForOrchestratorPersist(
        existingMdd,
        mddContent,
      );
      if (defensiveMerge || mergedMdd.length !== mddContent.length) {
        console.log("[Orchestrator] mergeMddBySection persist", {
          existingLen: existingMdd.length,
          incomingLen: mddContent.length,
          mergedLen: mergedMdd.length,
          truncatedIncoming: stats.truncatedIncoming,
          replaced: stats.sectionsReplaced,
          kept: stats.sectionsKept,
        });
      }
      const project = await this.projects.update(projectId, {
        mddContent: mergedMdd,
        stageId,
        ...(extras?.documentAst !== undefined
          ? { documentAst: extras.documentAst ?? undefined }
          : {}),
        ...(extras?.documentVersion !== undefined
          ? { documentVersion: extras.documentVersion ?? undefined }
          : {}),
      });
      return { saved: true, project };
    } catch (err) {
      const extracted = extractMddPersistErrorFromException(err);
      return {
        saved: false,
        code: extracted.code,
        hint: extracted.message,
        deliveryGate: extracted.deliveryGate,
      };
    }
  }

  private resolveMddDocumentPersist(params: {
    userMessage: string;
    assistantContent: string;
    currentMddLen: number;
    mddFromResponse?: string | null;
    persistResult?: Awaited<ReturnType<AiOrchestratorService["tryPersistMddContent"]>>;
    parsedFromResponse: boolean;
  }): OrchestratorDocumentPersist | undefined {
    const { userMessage, assistantContent, currentMddLen, persistResult, parsedFromResponse } =
      params;
    if (parsedFromResponse && persistResult) {
      return buildMddDocumentPersistStatus({
        parsedFromResponse: true,
        saved: persistResult.saved,
        ...(persistResult.saved
          ? {}
          : {
              reason: persistResult.code ?? "ERR_VALIDATION",
              deliveryGate: persistResult.deliveryGate,
              hint: persistResult.hint,
            }),
      });
    }
    if (
      shouldReportMissingMddDelimiter({
        userMessage,
        assistantContent,
        flags: { hasMdd: false },
        currentMddLen,
      })
    ) {
      return buildMddDocumentPersistStatus({
        parsedFromResponse: false,
        saved: false,
        reason: MISSING_FIN_MDD_DELIMITER,
        hint: MISSING_FIN_MDD_HINT,
      });
    }
    return undefined;
  }

  /** Sufijo de prompt con rechazos/reflexión recientes (legacy / SDD). */
  private async episodicPromptSuffix(stageId: string): Promise<string> {
    const eps = await this.agentSupervisor.getRecentEpisodicMemory(stageId, 12);
    const lines = eps.filter(
      (e) =>
        e.kind === EpisodicMemoryKind.EVALUATOR_REJECTION ||
        e.kind === EpisodicMemoryKind.REFLEXION_FEEDBACK,
    );
    if (!lines.length) return "";
    const body = lines
      .map((e) => e.content.trim().slice(0, 2000))
      .join("\n---\n")
      .slice(0, 8000);
    return `\n\n[Memoria episódica — correcciones exigidas por el evaluador; no repitas el mismo error]\n${body}`;
  }

  /**
   * Instrucciones Fase 0 (DBGA) + contexto HITL si hay `complexityPending` (no aplica nivel hasta confirmación).
   */
  private buildComplexityInterviewContext(project: {
    complexityPending?: unknown;
    dbgaContent?: string | null;
  }): string {
    const chunks: string[] = [];
    chunks.push(
      `ENTREVISTA PROACTIVA (Fase 0 / Benchmark / DBGA):
- Si el alcance **no es evidente** en el DBGA o en los mensajes, formula **1 o 2 preguntas clave** para clarificar la escala (ej.: ¿corrección rápida, integración de un módulo, o sistema central desde cero?).
- No asumas complejidad sin señales claras; prioriza preguntas breves y concretas.`,
    );
    const raw = project.complexityPending;
    if (raw != null && typeof raw === "object" && "level" in raw) {
      const p = raw as { level?: string; planSummary?: string; reason?: string };
      chunks.push(
        `HITL — PROPUESTA DE COMPLEJIDAD PENDIENTE (el nivel **no** queda aplicado al proyecto hasta confirmación explícita, p. ej. "sí", "de acuerdo", "ejecuta este plan"):
- Nivel propuesto: **${p.level ?? "?"}**
- Plan sugerido: ${p.planSummary ?? ""}
- Motivo: ${p.reason ?? ""}
**Instrucción:** Propón en el chat esta clasificación y el plan (ej.: "Basado en tu requerimiento, clasifico esto como Baja Complejidad (LOW). Para ser ágiles, propongo generar únicamente Historias de Usuario y Tasks. ¿Estás de acuerdo o prefieres un diseño estructurado?"). **No** digas que el nivel ya está fijado ni que se ejecutará generación hasta que el usuario confirme explícitamente.`,
      );
    }
    return chunks.join("\n\n");
  }

  private async maybeEvaluatorCritique(
    projectId: string,
    route: SupervisorRouteResult,
    userMessage: string,
  ): Promise<string | undefined> {
    if (!resolvePlatformConfigBoolean("agent_evaluator_legacy")) return undefined;
    if (route.flow !== "LEGACY" || !route.theforgeProjectId) return undefined;
    const r = await this.agentEvaluator.evaluateLegacyProposal(projectId, route.stageId, userMessage);
    return r.approved ? undefined : r.critique;
  }

  /**
   * Envía un mensaje en la entrevista: obtiene o crea sesión, llama a la IA, persiste y devuelve sesión + proyecto actualizado.
   * Si mddContent viene en la petición (ediciones del usuario), la IA lo recibe como contexto actual del documento.
   */
  async chat(
    projectId: string,
    message: string,
    sessionId?: string,
    mddContentFromClient?: string,
    activeTab?: string,
    uxUiGuideContentFromClient?: string,
    dbgaContentFromClient?: string,
    brdContentFromClient?: string,
    stageIdFromClient?: string,
    chatScopeFromClient?: WorkshopChatScope,
    userImages: ChatImagePart[] = [],
  ) {
    let project = await this.projects.findOne(projectId);
    const hitlLine = message.trim() || (userImages.length ? "(Imagen adjunta)" : "");
    const hitl = await this.projects.tryConfirmComplexityFromChatMessage(projectId, hitlLine);
    if (hitl.confirmed || hitl.rejected) {
      project = await this.projects.findOne(projectId);
    }

    const route = await this.agentSupervisor.resolveRouteFromProject(project, stageIdFromClient);
    const chatScope = resolveOrchestratorChatScope(project, chatScopeFromClient);

    let session;
    if (sessionId) {
      session = await this.sessions.findOne(sessionId);
      if (session.projectId !== projectId) throw new NotFoundException("Session does not belong to project");
    } else {
      const sessions = await this.sessions.findByProject(projectId);
      if (sessions.length > 0) {
        session = await this.sessions.findOne(sessions[0].id);
      } else {
        session = await this.sessions.create({
          projectId,
          contextStep: "CONTEXT",
          chatLog: [],
        });
      }
    }

    const tab = activeTab?.trim() ?? "mdd";
    const isUxUiGuide = activeTab?.trim() === "ux-ui-guide";
    const fullMddForUx = isUxUiGuide
      ? mddContextForUxGuide(project, route.stageId, mddContentFromClient)
      : "";
    const currentMdd =
      tab === "mdd"
        ? (mddContentFromClient ?? mddForRouteStage(project, route.stageId) ?? undefined)
        : isUxUiGuide && fullMddForUx
          ? buildMddContextForUxGuide(fullMddForUx)
          : undefined;
    const isBenchmarkTab = activeTab?.trim() === "benchmark";
    const hasComplexityPending =
      project.complexityPending != null && typeof project.complexityPending === "object";
    const complexityInterviewContext =
      isBenchmarkTab || hasComplexityPending
        ? this.buildComplexityInterviewContext(project)
        : undefined;
    const currentDbga =
      isBenchmarkTab && (dbgaContentFromClient ?? project.dbgaContent ?? "")?.trim()
        ? (dbgaContentFromClient ?? project.dbgaContent ?? "").trim()
        : !(currentMdd?.trim()) && (project.dbgaContent?.trim())
          ? project.dbgaContent
          : undefined;
    const currentUxUiGuide =
      uxUiGuideContentFromClient ?? project.uxUiGuideContent ?? undefined;
    const currentBrd =
      stageBrdContent(project, route.stageId) ?? brdContentFromClient ?? undefined;
    if (tab === "mdd" && mddContentFromClient != null && mddContentFromClient.trim().length > 0) {
      await this.tryPersistMddContent(projectId, mddContentFromClient, route.stageId);
    }
    if (tab === "ux-ui-guide" && uxUiGuideContentFromClient != null && uxUiGuideContentFromClient.trim().length > 0) {
      await this.projects.update(projectId, { uxUiGuideContent: uxUiGuideContentFromClient });
    }
    if (tab === "brd" && brdContentFromClient != null && brdContentFromClient.trim().length > 0) {
      const persistedBrd = stageBrdContent(project, route.stageId);
      const normalizedBrd = cleanDocumentContent(brdContentFromClient);
      // Solo persiste si no hay un valor más reciente en BD
      if (!persistedBrd || persistedBrd !== normalizedBrd) {
        await this.projects.patchStage(projectId, route.stageId, { brdContent: normalizedBrd });
      }
    }
    let systemPrompt: string | undefined;
    if (route.flow === "LEGACY" && route.theforgeProjectId) {
      const theforgeProjectId = route.theforgeProjectId;
      systemPrompt = LEGACY_DOCUMENTATION_PROMPT;
      systemPrompt += await this.episodicPromptSuffix(route.stageId);
      const theforgeQuery =
        message.trim() ||
        (userImages.length
          ? "El usuario adjuntó imágenes en el chat; resume el contexto útil para documentación."
          : "");
      const theforgeContext = await this.theforge.askCodebase(theforgeQuery, theforgeProjectId);
      if (theforgeContext.trim()) {
        systemPrompt += "\n\n[Contexto TheForge (respuesta a la pregunta del usuario)]\n---\n" + theforgeContext.trim() + "\n---";
      }
    }
    let updatedSession;
    let mddFromResponse: string | null | undefined;
    let uxUiGuideFromResponse: string | null | undefined;
    let dbgaFromResponse: string | null | undefined;
    let phase0FromResponse: string | null | undefined;
    let brdFromResponse: string | null | undefined;
    let documentAstFromResponse: Record<string, unknown> | null | undefined;
    let documentVersionFromResponse: number | null | undefined;
    try {
      const chatResult = await this.sessions.chat(session.id, message, {
        currentMddContent: currentMdd,
        currentDbgaContent: currentDbga,
        currentUxUiGuideContent: currentUxUiGuide,
        currentPhase0SummaryContent: activeTab?.trim() === "phase0"
          ? (dbgaContentFromClient ?? project.phase0SummaryContent ?? "").trim() || undefined
          : undefined,
        currentBlueprintContent: (isUxUiGuide || activeTab?.trim() === "api-contracts") ? (project.blueprintContent ?? undefined) : undefined,
      currentBrdContent: activeTab?.trim() === "brd" ? currentBrd : undefined,
      activeTab,
        systemPrompt,
        stageId: route.stageId,
        chatScope,
        complexityInterviewContext,
        userImages,
        ...uxGuideLlmOptions(
          project,
          mddContextForUxGuide(project, route.stageId, mddContentFromClient),
        ),
      });
      updatedSession = chatResult.session;
      mddFromResponse = chatResult.mddContent;
      uxUiGuideFromResponse = chatResult.uxUiGuideContent;
      dbgaFromResponse = chatResult.dbgaContent;
      phase0FromResponse = chatResult.phase0SummaryContent;
      brdFromResponse = chatResult.brdContent;
      documentAstFromResponse = chatResult.documentAst;
      documentVersionFromResponse = chatResult.documentVersion;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al generar la respuesta";
      throw new HttpException(
        msg,
        HttpStatus.INTERNAL_SERVER_ERROR,
        { cause: err instanceof Error ? err : undefined },
      );
    }
    if (!updatedSession) throw new NotFoundException("Session not found after chat");

    let updatedProject: Awaited<ReturnType<IOrchestratorProjectsPort["update"]>> | null = null;
    let mddPersistResult: Awaited<ReturnType<AiOrchestratorService["tryPersistMddContent"]>> | undefined;
    if (tab === "mdd" && mddFromResponse != null && mddFromResponse.length > 0) {
      mddPersistResult = await this.tryPersistMddContent(
        projectId,
        mddFromResponse,
        route.stageId,
        {
          documentAst: documentAstFromResponse,
          documentVersion: documentVersionFromResponse,
        },
      );
      if (mddPersistResult.saved && mddPersistResult.project) {
        updatedProject = mddPersistResult.project;
      }
    }
    if (tab === "ux-ui-guide" && uxUiGuideFromResponse != null && uxUiGuideFromResponse.length > 0) {
      console.log("[Orchestrator] persisting uxUiGuideContent (Guía UX/UI) length:", uxUiGuideFromResponse.length);
      const uxWithAttribution = appendUxGuideDesignAttribution(
        uxUiGuideFromResponse,
        project.uxGuideDesignRef,
        mddContextForUxGuide(project, route.stageId, mddContentFromClient),
      );
      updatedProject = await this.projects.update(projectId, { uxUiGuideContent: uxWithAttribution });
    }
    if (dbgaFromResponse != null && dbgaFromResponse.length > 0) {
      const prevDbga = (currentDbga ?? project.dbgaContent ?? "").trim();
      if (prevDbga && wouldShrinkDbgaDangerously(prevDbga, dbgaFromResponse)) {
        console.warn(
          "[Orchestrator] dbgaContent no persistido (reducción peligrosa)",
          { prevLen: prevDbga.length, nextLen: dbgaFromResponse.length },
        );
        dbgaFromResponse = undefined;
      }
    }
    if (dbgaFromResponse != null && dbgaFromResponse.length > 0) {
      console.log("[Orchestrator] persisting dbgaContent (Benchmark refinado) length:", dbgaFromResponse.length);
      updatedProject = await this.projects.update(projectId, { dbgaContent: dbgaFromResponse });
      // Fase 0 es sub-tab de Benchmark — mirror a phase0SummaryContent para que el panel lo muestre
    }
    if (mddFromResponse == null && dbgaFromResponse == null) {
      // Phase0 document from chat — persist if it came back
      // (only when no higher-priority document was returned)
    }
    if (phase0FromResponse != null && phase0FromResponse.length > 0) {
      console.log("[Orchestrator] persisting phase0SummaryContent length:", phase0FromResponse.length);
      updatedProject = await this.projects.update(projectId, { phase0SummaryContent: phase0FromResponse });
    }
    if (brdFromResponse != null && brdFromResponse.length > 0) {
      await this.projects.patchStage(projectId, route.stageId, { brdContent: brdFromResponse });
      updatedProject = await this.projects.findOne(projectId);
    }
    if (!updatedProject) {
      updatedProject = await this.projects.findOne(projectId);
    }
    const outUx = updatedProject?.uxUiGuideContent ?? null;
    const uxToReturn = (uxUiGuideFromResponse != null && uxUiGuideFromResponse.length > 0)
      ? uxUiGuideFromResponse
      : outUx;
    console.log("[Orchestrator] returning uxUiGuideContent (Guía UX/UI) length:", uxToReturn?.length ?? 0);

    const finalProject = updatedProject ?? (await this.projects.findOne(projectId)) ?? project;
    if (uxToReturn != null && finalProject && "uxUiGuideContent" in finalProject) {
      (finalProject as { uxUiGuideContent: string | null }).uxUiGuideContent = uxToReturn;
    }

    const evaluatorCritique = await this.maybeEvaluatorCritique(projectId, route, hitlLine);

    let documentPersist: OrchestratorDocumentPersist | undefined;
    if (tab === "mdd") {
      const assistantContent = this.lastAssistantContentForTab(updatedSession, tab);
      const currentMddLen = (currentMdd ?? mddForRouteStage(project, route.stageId) ?? "").trim()
        .length;
      documentPersist = this.resolveMddDocumentPersist({
        userMessage: hitlLine,
        assistantContent,
        currentMddLen,
        mddFromResponse,
        persistResult: mddPersistResult,
        parsedFromResponse: Boolean(mddFromResponse && mddFromResponse.length > 0),
      });
    }

    return {
      session: updatedSession,
      project: finalProject,
      uxUiGuideContent: uxToReturn ?? undefined,
      dbgaContent: dbgaFromResponse ?? finalProject?.dbgaContent ?? undefined,
      phase0SummaryContent:
        phase0FromResponse ?? finalProject?.phase0SummaryContent ?? undefined,
      evaluatorCritique,
      ...(documentPersist ? { documentPersist } : {}),
    };
  }

  /**
   * Paridad con `POST /ai-orchestrator/chat`: mismo flujo (HITL, PATCH MDD/UX/DBGA desde body,
   * supervisor, legacy + TheForge, `uxGuideLlmOptions`, persistencia de respuesta, ingest SDD, evaluador).
   * `projectId` se toma de la sesión.
   */
  async chatBySessionId(
    sessionId: string,
    args: {
      message: string;
      userImages?: ChatImagePart[];
      mddContentFromClient?: string;
      activeTab?: string;
      uxUiGuideContentFromClient?: string;
      dbgaContentFromClient?: string;
      phase0SummaryContentFromClient?: string;
      brdContentFromClient?: string;
      stageIdFromClient?: string;
      chatScopeFromClient?: WorkshopChatScope;
    },
  ) {
    const session = await this.sessions.findOne(sessionId);
    return this.chat(
      session.projectId,
      args.message,
      sessionId,
      args.mddContentFromClient,
      args.activeTab,
      args.uxUiGuideContentFromClient,
      args.dbgaContentFromClient,
      args.brdContentFromClient,
      args.stageIdFromClient,
      args.chatScopeFromClient,
      args.userImages ?? [],
    );
  }

  /**
   * Streaming chat: same setup as chat(), yields SSE events (chunk then done).
   */
  async *chatStream(
    projectId: string,
    message: string,
    sessionId?: string,
    mddContentFromClient?: string,
    activeTab?: string,
    uxUiGuideContentFromClient?: string,
    dbgaContentFromClient?: string,
    specContentFromClient?: string,
    brdContentFromClient?: string,
    stageIdFromClient?: string,
    clientDeliverables?: OrchestratorClientDeliverables,
    chatScopeFromClient?: WorkshopChatScope,
    userImages: ChatImagePart[] = [],
  ): AsyncGenerator<{ event: string; data: unknown }> {
    let project = await this.projects.findOne(projectId);
    const hitlLineStream = message.trim() || (userImages.length ? "(Imagen adjunta)" : "");
    const hitl = await this.projects.tryConfirmComplexityFromChatMessage(projectId, hitlLineStream);
    if (hitl.confirmed || hitl.rejected) {
      project = await this.projects.findOne(projectId);
    }

    const routeStream = await this.agentSupervisor.resolveRouteFromProject(project, stageIdFromClient);
    const chatScope = resolveOrchestratorChatScope(project, chatScopeFromClient);

    let session;
    if (sessionId) {
      session = await this.sessions.findOne(sessionId);
      if (session.projectId !== projectId) throw new NotFoundException("Session does not belong to project");
    } else {
      const sessions = await this.sessions.findByProject(projectId);
      if (sessions.length > 0) {
        session = await this.sessions.findOne(sessions[0].id);
      } else {
        session = await this.sessions.create({
          projectId,
          contextStep: "CONTEXT",
          chatLog: [],
        });
      }
    }

    const tab = activeTab?.trim() ?? "mdd";
    const isUxUiGuideStream = tab === "ux-ui-guide";
    const tabAllowsDocPersist = orchestratorTabAllowsDocPersist(tab);

    const historyForPropagate = workshopTabHistory(
      (session.chatLog ?? []) as ChatMessage[],
      tab,
      routeStream.stageId,
      chatScope,
    );
    const propagateConfirm = detectUpstreamPropagateConfirmation(message, historyForPropagate, tab);
    if (propagateConfirm.confirmed) {
      const enqueued = await this.upstreamPropagate.enqueue(
        projectId,
        propagateConfirm.originTab,
        routeStream.stageId,
      );
      const assistantContent = upstreamPropagateQueuedAssistantMessage(enqueued.plan.summary);
      const updatedSession = await this.sessions.recordTabChatTurn(
        session.id,
        hitlLineStream,
        assistantContent,
        tab,
        routeStream.stageId,
      );
      yield { event: "chunk", data: { content: assistantContent } };
      yield {
        event: "done",
        data: {
          session: updatedSession,
          project: await this.projects.findOne(projectId),
          upstreamPropagateJobId: enqueued.jobId,
        },
      };
      return;
    }

    const fullMddForUxStream = isUxUiGuideStream
      ? mddContextForUxGuide(project, routeStream.stageId, mddContentFromClient)
      : "";
    const currentMdd =
      tab === "mdd"
        ? (mddContentFromClient ?? mddForRouteStage(project, routeStream.stageId) ?? undefined)
        : isUxUiGuideStream && fullMddForUxStream
          ? buildMddContextForUxGuide(fullMddForUxStream)
          : undefined;
    const isBenchmarkTab = tab === "benchmark";
    const hasComplexityPendingStream =
      project.complexityPending != null && typeof project.complexityPending === "object";
    const complexityInterviewContext =
      isBenchmarkTab || hasComplexityPendingStream
        ? this.buildComplexityInterviewContext(project)
        : undefined;
    const currentDbga =
      isBenchmarkTab && (dbgaContentFromClient ?? project.dbgaContent ?? "")?.trim()
        ? (dbgaContentFromClient ?? project.dbgaContent ?? "").trim()
        : !(currentMdd?.trim()) && (project.dbgaContent?.trim())
          ? project.dbgaContent
          : undefined;
    const currentUxUiGuide = uxUiGuideContentFromClient ?? project.uxUiGuideContent ?? undefined;
    const currentSpec = docForActiveTab(tab, "spec", specContentFromClient, (project as { specContent?: string | null }).specContent);
    const currentBrdStream = docForActiveTab(
      tab,
      "brd",
      brdContentFromClient,
      stageBrdContent(project, routeStream.stageId),
    );
    const currentArchitecture = docForActiveTab(
      tab,
      "architecture",
      clientDeliverables?.architectureContent,
      (project as { architectureContent?: string | null }).architectureContent,
    );
    const currentBlueprint = docForActiveTab(
      tab,
      "blueprint",
      clientDeliverables?.blueprintContent,
      project.blueprintContent,
    );
    const currentUseCases = docForActiveTab(
      tab,
      "use-cases",
      clientDeliverables?.useCasesContent,
      (project as { useCasesContent?: string | null }).useCasesContent,
    );
    const currentUserStories = docForActiveTab(
      tab,
      "user-stories",
      clientDeliverables?.userStoriesContent,
      (project as { userStoriesContent?: string | null }).userStoriesContent,
    );
    const currentApiContracts = docForActiveTab(
      tab,
      "api-contracts",
      clientDeliverables?.apiContractsContent,
      (project as { apiContractsContent?: string | null }).apiContractsContent,
    );
    const currentLogicFlows = docForActiveTab(
      tab,
      "logic-flows",
      clientDeliverables?.logicFlowsContent,
      (project as { logicFlowsContent?: string | null }).logicFlowsContent,
    );
    const currentTasks = docForActiveTab(
      tab,
      "tasks",
      clientDeliverables?.tasksContent,
      (project as { tasksContent?: string | null }).tasksContent,
    );
    const currentInfra = docForActiveTab(
      tab,
      "infra",
      clientDeliverables?.infraContent,
      (project as { infraContent?: string | null }).infraContent,
    );
    if (tab === "mdd" && mddContentFromClient != null && mddContentFromClient.trim().length > 0) {
      await this.tryPersistMddContent(projectId, mddContentFromClient, routeStream.stageId);
    }
    if (tab === "ux-ui-guide" && uxUiGuideContentFromClient != null && uxUiGuideContentFromClient.trim().length > 0) {
      await this.projects.update(projectId, { uxUiGuideContent: uxUiGuideContentFromClient });
    }
    if (tab === "brd" && brdContentFromClient != null && brdContentFromClient.trim().length > 0) {
      const persistedBrdStream = stageBrdContent(project, routeStream.stageId);
      const normalizedBrd = cleanDocumentContent(brdContentFromClient);
      if (!persistedBrdStream || persistedBrdStream !== normalizedBrd) {
        await this.projects.patchStage(projectId, routeStream.stageId, { brdContent: normalizedBrd });
      }
    }
    const isUxUiGuide = isUxUiGuideStream;
    let systemPromptStream: string | undefined;
    if (routeStream.flow === "LEGACY" && routeStream.theforgeProjectId) {
      const theforgeProjectId = routeStream.theforgeProjectId;
      systemPromptStream = LEGACY_DOCUMENTATION_PROMPT;
      systemPromptStream += await this.episodicPromptSuffix(routeStream.stageId);
      const theforgeQueryStream =
        message.trim() ||
        (userImages.length
          ? "El usuario adjuntó imágenes en el chat; resume el contexto útil para documentación."
          : "");
      const theforgeContext = await this.theforge.askCodebase(theforgeQueryStream, theforgeProjectId);
      if (theforgeContext.trim()) {
        systemPromptStream += "\n\n[Contexto TheForge (respuesta a la pregunta del usuario)]\n---\n" + theforgeContext.trim() + "\n---";
      }
    }

    const stream = this.sessions.chatStream(session.id, message, {
      currentMddContent: currentMdd,
      currentDbgaContent: currentDbga,
      currentUxUiGuideContent: tab === "ux-ui-guide" ? currentUxUiGuide : undefined,
      currentPhase0SummaryContent:
        tab === "phase0"
          ? (specContentFromClient ?? (project as { phase0SummaryContent?: string | null }).phase0SummaryContent ?? "").trim() || undefined
          : undefined,
      currentBlueprintContent:
        tab === "blueprint"
          ? currentBlueprint
          : isUxUiGuide || tab === "api-contracts"
            ? (project.blueprintContent ?? undefined)
            : undefined,
      currentSpecContent: currentSpec,
      currentBrdContent: currentBrdStream,
      currentArchitectureContent: currentArchitecture,
      currentUseCasesContent: currentUseCases,
      currentUserStoriesContent: currentUserStories,
      currentApiContractsContent: currentApiContracts,
      currentLogicFlowsContent: currentLogicFlows,
      currentTasksContent: currentTasks,
      currentInfraContent: currentInfra,
      activeTab: tab,
      systemPrompt: systemPromptStream,
      stageId: routeStream.stageId,
      chatScope,
      complexityInterviewContext,
      userImages,
      ...uxGuideLlmOptions(
        project,
        mddContextForUxGuide(project, routeStream.stageId, mddContentFromClient),
      ),
    });

    for await (const msg of stream) {
      if (msg.type === "chunk") {
        yield { event: "chunk", data: { content: msg.content } };
      } else {
        let updatedProject: Awaited<ReturnType<IOrchestratorProjectsPort["update"]>> | null = null;
        let mddPersistResult:
          | Awaited<ReturnType<AiOrchestratorService["tryPersistMddContent"]>>
          | undefined;
        if (tab === "mdd" && msg.mddContent != null && msg.mddContent.length > 0) {
          mddPersistResult = await this.tryPersistMddContent(
            projectId,
            msg.mddContent,
            routeStream.stageId,
          );
          if (mddPersistResult.saved && mddPersistResult.project) {
            updatedProject = mddPersistResult.project;
          }
        }
        if (tab === "ux-ui-guide" && msg.uxUiGuideContent != null && msg.uxUiGuideContent.length > 0) {
          const uxWithAttribution = appendUxGuideDesignAttribution(
            msg.uxUiGuideContent,
            project.uxGuideDesignRef,
            mddContextForUxGuide(project, routeStream.stageId, mddContentFromClient),
          );
          updatedProject = await this.projects.update(projectId, { uxUiGuideContent: uxWithAttribution });
        }
        if (tab === "benchmark" && tabAllowsDocPersist && msg.dbgaContent != null && msg.dbgaContent.length > 0) {
          const prevDbga = (currentDbga ?? project.dbgaContent ?? "").trim();
          if (prevDbga && wouldShrinkDbgaDangerously(prevDbga, msg.dbgaContent)) {
            console.warn(
              "[Orchestrator] dbgaContent stream no persistido (reducción peligrosa)",
              { prevLen: prevDbga.length, nextLen: msg.dbgaContent.length },
            );
          } else {
            updatedProject = await this.projects.update(projectId, { dbgaContent: msg.dbgaContent });
          }
        }
        if (tab === "phase0" && tabAllowsDocPersist && msg.phase0SummaryContent != null && msg.phase0SummaryContent.length > 0) {
          updatedProject = await this.projects.update(projectId, {
            phase0SummaryContent: msg.phase0SummaryContent,
          });
        }
        if (tabAllowsDocPersist && tab === "spec" && msg.specContent != null && msg.specContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { specContent: msg.specContent });
        }
        if (tabAllowsDocPersist && tab === "brd" && msg.brdContent != null && msg.brdContent.length > 0) {
          await this.projects.patchStage(projectId, routeStream.stageId, { brdContent: msg.brdContent });
          updatedProject = await this.projects.findOne(projectId);
        }
        if (tabAllowsDocPersist && tab === "blueprint" && msg.blueprintContent != null && msg.blueprintContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { blueprintContent: msg.blueprintContent });
        }
        if (tabAllowsDocPersist && tab === "api-contracts" && msg.apiContractsContent != null && msg.apiContractsContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { apiContractsContent: msg.apiContractsContent });
        }
        if (tabAllowsDocPersist && tab === "logic-flows" && msg.logicFlowsContent != null && msg.logicFlowsContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { logicFlowsContent: msg.logicFlowsContent });
        }
        if (tabAllowsDocPersist && tab === "tasks" && msg.tasksContent != null && msg.tasksContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { tasksContent: msg.tasksContent });
        }
        if (tabAllowsDocPersist && tab === "infra" && msg.infraContent != null && msg.infraContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { infraContent: msg.infraContent });
        }
        if (tabAllowsDocPersist && tab === "architecture" && msg.architectureContent != null && msg.architectureContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { architectureContent: msg.architectureContent } as any);
        }
        if (tabAllowsDocPersist && tab === "use-cases" && msg.useCasesContent != null && msg.useCasesContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { useCasesContent: msg.useCasesContent } as any);
        }
        if (tabAllowsDocPersist && tab === "user-stories" && msg.userStoriesContent != null && msg.userStoriesContent.length > 0) {
          updatedProject = await this.projects.update(projectId, { userStoriesContent: msg.userStoriesContent } as any);
        }
        const finalProject =
          updatedProject ?? (await this.projects.findOne(projectId)) ?? project;
        const uxToReturn =
          msg.uxUiGuideContent != null && msg.uxUiGuideContent.length > 0
            ? msg.uxUiGuideContent
            : finalProject?.uxUiGuideContent ?? null;
        const projectOut = { ...finalProject } as typeof finalProject & { uxUiGuideContent?: string | null };
        if (uxToReturn != null) projectOut.uxUiGuideContent = uxToReturn;
        const evaluatorCritique = await this.maybeEvaluatorCritique(projectId, routeStream, hitlLineStream);

        let documentPersist: OrchestratorDocumentPersist | undefined;
        if (tab === "mdd") {
          const assistantContent = this.lastAssistantContentForTab(msg.session, tab);
          const currentMddLen = (currentMdd ?? mddForRouteStage(project, routeStream.stageId) ?? "")
            .trim().length;
          documentPersist = this.resolveMddDocumentPersist({
            userMessage: hitlLineStream,
            assistantContent,
            currentMddLen,
            mddFromResponse: msg.mddContent,
            persistResult: mddPersistResult,
            parsedFromResponse: Boolean(msg.mddContent && msg.mddContent.length > 0),
          });
        }

        yield {
          event: "done",
          data: {
            session: msg.session,
            project: projectOut,
            uxUiGuideContent: uxToReturn ?? undefined,
            dbgaContent:
              (msg as { dbgaContent?: string | null }).dbgaContent ??
              projectOut.dbgaContent ??
              undefined,
            phase0SummaryContent:
              (msg as { phase0SummaryContent?: string | null }).phase0SummaryContent ??
              projectOut.phase0SummaryContent ??
              undefined,
            evaluatorCritique,
            documentHadDelimiter: (msg as { documentHadDelimiter?: boolean }).documentHadDelimiter,
            documentPersisted: (msg as { documentPersisted?: boolean }).documentPersisted,
            ...(documentPersist ? { documentPersist } : {}),
          },
        };
      }
    }
  }

  /**
   * Borra el historial de la conversación de la sesión del proyecto. El MDD no se modifica.
   * Devuelve sesión (con chatLog vacío) y proyecto para que el front actualice y pueda pedir welcome de nuevo.
   */
  async clearChat(projectId: string, sessionId?: string) {
    const project = await this.projects.findOne(projectId);

    let session;
    if (sessionId) {
      session = await this.sessions.findOne(sessionId);
      if (session.projectId !== projectId) throw new NotFoundException("Session does not belong to project");
    } else {
      const sessions = await this.sessions.findByProject(projectId);
      if (sessions.length > 0) {
        session = await this.sessions.findOne(sessions[0].id);
      } else {
        return { session: null, project };
      }
    }

    const updatedSession = await this.sessions.clearChat(session.id);
    return {
      session: updatedSession,
      project,
    };
  }

  /**
   * Genera mensaje de bienvenida (y primera pregunta si no hay contenido, o continuación si ya hay MDD/historial).
   * Obtiene o crea sesión, persiste solo el mensaje del asistente y devuelve sesión + proyecto.
   * `stageId` opcional: alinea el contexto MDD del mensaje con la etapa del Workshop (no solo el MDD aplanado del proyecto).
   */
  async welcome(
    projectId: string,
    sessionId?: string,
    activeTab?: string,
    stageId?: string,
    chatScopeFromClient?: WorkshopChatScope,
  ) {
    const project = await this.projects.findOne(projectId);
    const route = await this.agentSupervisor.resolveRouteFromProject(project, stageId);
    const chatScope = resolveOrchestratorChatScope(project, chatScopeFromClient);
    const stageMdd = mddForRouteStage(project, route.stageId) ?? project.mddContent ?? null;

    let session;
    if (sessionId) {
      session = await this.sessions.findOne(sessionId);
      if (session.projectId !== projectId)
        throw new NotFoundException("Session does not belong to project");
    } else {
      const sessions = await this.sessions.findByProject(projectId);
      if (sessions.length > 0) {
        session = await this.sessions.findOne(sessions[0].id);
      } else {
        session = await this.sessions.create({
          projectId,
          contextStep: "CONTEXT",
          chatLog: [],
        });
      }
    }

    const chatLog = (session.chatLog ?? []) as ChatMessage[];
    const messagesForTab = workshopTabHistory(chatLog, activeTab ?? "mdd", route.stageId, chatScope);
    if (messagesForTab.length > 0) {
      return { session, project };
    }
    if ((activeTab ?? "mdd").trim().toLowerCase() === "mdd") {
      return { session, project };
    }

    const stageRow = project.stages?.find((s) => s.id === route.stageId);
    const updatedSession = await this.sessions.generateWelcome(session.id, {
      projectName: project.name,
      mddContent: stageMdd,
      dbgaContent: project.dbgaContent,
      uxUiGuideContent: project.uxUiGuideContent,
      brdContent: stageRow?.brdContent ?? undefined,
      chatLog: messagesForTab,
      activeTab,
      stageId: route.stageId,
    });

    const updatedProject = await this.projects.findOne(projectId);

    return {
      session: updatedSession,
      project: updatedProject ?? project,
    };
  }

}
