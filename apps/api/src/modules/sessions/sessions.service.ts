import { BadRequestException, Injectable, NotFoundException, Logger } from "@nestjs/common";
import type { Session } from "@theforge/database";
import { getRequestUserId } from "../../common/request-user.store.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AiService } from "../ai/ai.service.js";
import { IntentRouterService } from "../ai/intent-router.service.js";
import type { IntentRouteResult } from "../ai/intent-route.types.js";
import { hasWorkshopDocumentForTab } from "../ai/intent-router.util.js";
import type { GenerateResponseOptions, ChatMessage as LlmChatMessage } from "../ai/interfaces/llm-provider.interface.js";
import { PreferencesService } from "../ai/preferences.service.js";
import { ChatResponseParserService } from "./chat-response-parser.service.js";
import {
  createSessionSchema,
  appendChatSchema,
  contextStepEnum,
  contentIncludesVisionBlock,
  type AppendChatDto,
  type ChatMessage,
  type ChatImagePart,
  filterChatForWorkshopView,
  type WorkshopChatScope,
} from "@theforge/shared-types";
import {
  formatVisionContextBlock,
  mergeUserTextWithVisionBlock,
} from "../ai/utils/vision-context.util.js";
import { resolveLlmMaxTokensForPurpose } from "../ai/config/llm-config.js";
import {
  appendOrchestratorDocNotPersistedWarning,
  currentDocLengthForTab,
  shouldWarnOrchestratorDocNotPersisted,
  type DocPersistFlags,
} from "./orchestrator-doc-guard.util.js";
import { validateDocumentForPersist } from "./document-shrink.util.js";
import {
  BENCHMARK_CHAT_ACK,
  benchmarkAssistantChatMessage,
  dbgaReflectsUserEditIntent,
  extractDbgaEditKeywords,
  extractDbgaProposedLabels,
  dbgaContainsUserEditKeywords,
  acceptCompleteDbgaWithoutFinMarker,
  isDbgaContentNearlyIdentical,
  isDbgaEditEffectivelyUnchanged,
  isPartialBenchmarkDoc,
  mergeBenchmarkPartialDoc,
  parseBenchmarkResponse,
  wouldShrinkDbgaDangerously,
} from "./dbga-edit.util.js";
import {
  isAssistantAwaitingDocumentEditApproval,
  looksLikeApiEndpointCatalog,
  looksLikeDbgaDocumentBody,
  looksLikeDbgaEditRequest,
  looksLikeDbgaSpecIntegrationRequest,
  mergeApiEndpointCatalogIntoDbga,
} from "@theforge/shared-types";
import { llmDebug, llmWarn } from "../ai/config/llm-debug.util.js";
import { ModelsUnavailableError } from "../ai/config/llm-model-fallback.js";
import { DocumentSnapshotService } from "../document-snapshot/document-snapshot.service.js";
import { stampMarkdownIfBodyChanged } from "../engine/document-date-header.util.js";
import { isPhase0StructuredMarkdown } from "../ai-analysis/phase0/phase0-from-markdown.js";
import { PHASE0_MARKDOWN_FORMAT_RULES } from "../ai-analysis/prompts/load-prompts.js";
import type { WorkshopChatAction } from "../ai/intent-route.types.js";
import {
  buildEditModeUserPrompt,
  getLastAssistantMessage,
  isDocumentContentNearlyIdentical,
  logDocumentTurnMetrics,
  sanitizeLlmResponse,
  validateStructuralForTab,
} from "./workshop-document-turn.util.js";
import {
  buildSessionChatGenerateOptions,
  type SessionChatTurnOptions,
} from "./session-chat-llm-options.util.js";
import {
  maybeAppendUpstreamPropagateOffer,
} from "./upstream-propagate-chat.util.js";
import { isWorkshopFrozenDeliverableTab, workshopFrozenTabUserMessage } from "@theforge/shared-types";
import { parseWorkshopAssistantResponse } from "./session-chat-response-parse.util.js";
import {
  appendSessionChatLogPair,
  buildSessionChatAssistantLogEntry,
  buildSessionChatDonePayload,
  buildSessionChatUserLogEntry,
  isDocumentTurnPersisted,
  processSessionChatTurnOutcome,
  sanitizeAndAssertChatResponse,
  workshopStreamToChatEvents,
  type SessionChatTurnPrepareResult,
  type SessionChatTurnReady,
  type SessionChatTurnRunnerDeps,
} from "./session-chat-turn.runner.js";
import {
  buildDocumentRefinePrompt,
  buildLlmCurrentDocOptions,
  finTagForWorkshopTab,
} from "./document-refine.util.js";

function workshopHistoryForTurn(
  fullLog: ChatMessage[],
  activeTab: string,
  stageId: string | undefined,
  chatScope: WorkshopChatScope,
): ChatMessage[] {
  return filterChatForWorkshopView(fullLog, activeTab, { stageId, scope: chatScope });
}

/** Solo texto al LLM; las imágenes viven en el log para la UI y en el bloque de visión del content. */
function sessionHistoryToLlm(history: ChatMessage[]): LlmChatMessage[] {
  return history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gemini / Vertex suelen devolver 429 con mensaje "Resource exhausted" o status en el error. */
function isGeminiRateLimitError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err && (err as { status?: number }).status === 429) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /429|Too Many Requests|Resource exhausted/i.test(msg);
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly preferences: PreferencesService,
    private readonly parser: ChatResponseParserService,
    private readonly intentRouter: IntentRouterService,
    private readonly documentSnapshot: DocumentSnapshotService,
  ) { }

  private workshopDocContext(options?: {
    activeTab?: string;
    currentMddContent?: string;
    currentDbgaContent?: string;
    currentUxUiGuideContent?: string;
    currentPhase0SummaryContent?: string;
    currentBlueprintContent?: string;
    currentSpecContent?: string;
    currentBrdContent?: string;
    currentArchitectureContent?: string;
    currentUseCasesContent?: string;
    currentUserStoriesContent?: string;
    currentApiContractsContent?: string;
    currentLogicFlowsContent?: string;
    currentTasksContent?: string;
    currentInfraContent?: string;
  }): { activeTab: string; hasDocumentContent: boolean } {
    const activeTab = (options?.activeTab ?? "mdd").trim();
    return {
      activeTab,
      hasDocumentContent: hasWorkshopDocumentForTab(activeTab, {
        mdd: options?.currentMddContent,
        dbga: options?.currentDbgaContent,
        spec: options?.currentSpecContent,
        brd: options?.currentBrdContent,
        blueprint: options?.currentBlueprintContent,
        phase0Summary: options?.currentPhase0SummaryContent,
        uxGuide: options?.currentUxUiGuideContent,
        architecture: options?.currentArchitectureContent,
        useCases: options?.currentUseCasesContent,
        userStories: options?.currentUserStoriesContent,
        apiContracts: options?.currentApiContractsContent,
        logicFlows: options?.currentLogicFlowsContent,
        tasks: options?.currentTasksContent,
        infra: options?.currentInfraContent,
      }),
    };
  }

  private intentRouteContext(
    options?: Parameters<SessionsService["workshopDocContext"]>[0],
    history?: ChatMessage[],
  ) {
    return {
      ...this.workshopDocContext(options),
      lastAssistantMessage: history ? getLastAssistantMessage(history) : undefined,
    };
  }

  private promptForIntentTurn(
    userPrompt: string,
    action: WorkshopChatAction,
    activeTab?: string,
  ): string {
    return action === "edit_document"
      ? buildEditModeUserPrompt(userPrompt, activeTab)
      : userPrompt;
  }

  private extractDocPartFromRefineResponse(
    tab: string,
    response: string,
    currentDoc?: string,
  ): string | null {
    const sanitized = sanitizeLlmResponse(response);
    const finTag = finTagForWorkshopTab(tab);
    if (!finTag) return null;

    if (tab === "mdd") {
      const dual = this.parser.tryParseDualOutput(sanitized);
      if (dual?.markdown?.trim()) {
        return this.parser.cleanDocumentContent(dual.markdown);
      }
    }

    const split =
      this.parser.splitDocAndChat(sanitized, finTag) ??
      (tab === "benchmark"
        ? this.parser.splitDbgaAndChat(sanitized)
        : this.parser.detectDocFallback(sanitized, tab));

    if (!split?.docPart?.trim()) return null;

    const cleaned = this.parser.cleanDocumentContent(split.docPart);
    if (tab === "mdd") {
      return this.parser.mergeMddSectionOrUseFull(currentDoc, cleaned);
    }
    if (tab === "benchmark") {
      return this.parser.mergeDbgaOrUseFull(currentDoc, cleaned);
    }
    if (tab === "ux-ui-guide") {
      return this.parser.mergeUxUiGuideSectionOrUseFull(currentDoc, cleaned);
    }
    if (tab === "phase0") {
      return this.parser.mergePhase0OrUseFull(currentDoc, cleaned);
    }
    return this.parser.mergeDocSectionOrUseFull(currentDoc, cleaned);
  }

  async refineDocumentFromUserRequest(
    tab: string,
    userMessage: string,
    currentDoc: string,
  ): Promise<string | null> {
    const refinePrompt = buildDocumentRefinePrompt(tab, userMessage);
    const current = currentDoc.trim();
    const msg = userMessage.trim();
    if (!refinePrompt || !current || !msg || tab === "benchmark") return null;

    const llmOpts = {
      activeTab: tab,
      ...buildLlmCurrentDocOptions(tab, current),
      maxTokensOverride: resolveLlmMaxTokensForPurpose("document"),
    };

    try {
      let response = await this.ai.generateResponse(refinePrompt, [], llmOpts);
      let merged = this.extractDocPartFromRefineResponse(tab, response, current);

      const unchanged = merged != null && isDocumentContentNearlyIdentical(merged, current);
      if (merged && unchanged) {
        response = await this.ai.generateResponse(
          `${refinePrompt}\n\nREINTENTO: la respuesta anterior NO aplicó los cambios pedidos. Devuelve el documento COMPLETO actualizado con ---FIN_${finTagForWorkshopTab(tab)}---.`,
          [],
          llmOpts,
        );
        merged = this.extractDocPartFromRefineResponse(tab, response, current);
      }

      if (!merged || isDocumentContentNearlyIdentical(merged, current)) return null;

      const structural = validateStructuralForTab(tab, merged);
      if (!structural.ok) return null;

      const validation = validateDocumentForPersist(current, merged, {
        fieldLabel: tab === "mdd" ? "MDD" : tab,
      });
      if (!validation.ok) return null;

      return merged;
    } catch (err) {
      console.warn("[Sessions] refineDocumentFromUserRequest failed:", err);
      return null;
    }
  }

  private async resolveMddContentForReturn(
    userMessage: string,
    options: { currentMddContent?: string; wantsDocumentEdit?: boolean },
    mddDocPart: string | undefined,
    dualMarkdown?: string,
  ): Promise<{ content?: string; retried: boolean }> {
    const current = (options?.currentMddContent ?? "").trim();
    const wantsEdit = options?.wantsDocumentEdit === true;
    let retried = false;

    if (!wantsEdit) {
      return { retried: false };
    }

    const sourcePart = (mddDocPart ?? dualMarkdown)?.trim();
    let merged: string | undefined;
    if (sourcePart) {
      merged = this.parser.mergeMddSectionOrUseFull(
        current,
        this.parser.cleanDocumentContent(sourcePart),
      );
    }

    const needsRefine =
      current.length > 0 &&
      (!merged ||
        isDocumentContentNearlyIdentical(merged, current) ||
        !validateStructuralForTab("mdd", merged).ok);

    if (needsRefine) {
      const refined = await this.refineDocumentFromUserRequest("mdd", userMessage, current);
      retried = true;
      if (refined) merged = refined;
      else if (merged && isDocumentContentNearlyIdentical(merged, current)) merged = undefined;
    }

    if (!merged?.trim()) return { retried };

    const structural = validateStructuralForTab("mdd", merged);
    if (!structural.ok) {
      console.warn("[Sessions] MDD merge rechazado:", structural.message);
      return { retried };
    }

    const validation = validateDocumentForPersist(current, merged, { fieldLabel: "MDD" });
    if (!validation.ok) {
      console.warn("[Sessions] MDD merge rechazado:", validation.message);
      return { retried };
    }

    return { content: merged, retried };
  }

  private async resolveDeliverableContentForReturn(
    activeTab: string,
    expectedTab: string,
    hasDoc: boolean,
    rawPart: string | undefined,
    currentDoc: string | undefined,
    userMessage: string,
    wantsDocumentEdit: boolean,
  ): Promise<{ content?: string; retried: boolean }> {
    if (activeTab !== expectedTab) return { retried: false };
    if (!wantsDocumentEdit) {
      return { retried: false };
    }

    const current = (currentDoc ?? "").trim();
    let retried = false;
    let merged: string | undefined;

    if (hasDoc && rawPart?.trim()) {
      const cleaned = this.parser.cleanDocumentContent(rawPart);
      if (expectedTab === "phase0") {
        merged = this.parser.mergePhase0OrUseFull(currentDoc, cleaned);
      } else if (expectedTab === "ux-ui-guide") {
        merged = this.parser.mergeUxUiGuideSectionOrUseFull(currentDoc, cleaned);
      } else {
        merged = this.parser.mergeDocSectionOrUseFull(currentDoc, cleaned);
      }
    }

    const needsRefine =
      wantsDocumentEdit &&
      current.length > 0 &&
      (!hasDoc ||
        !merged ||
        isDocumentContentNearlyIdentical(merged, current));

    if (needsRefine) {
      const refined = await this.refineDocumentFromUserRequest(expectedTab, userMessage, current);
      retried = true;
      if (refined) merged = refined;
    }

    if (!merged?.trim()) return { retried };

    const structural = validateStructuralForTab(expectedTab, merged);
    if (!structural.ok) {
      console.warn(`[Sessions] ${expectedTab} merge rechazado:`, structural.message);
      return { retried };
    }

    const validation = validateDocumentForPersist(current, merged, {
      fieldLabel: expectedTab,
    });
    if (!validation.ok) {
      console.warn(`[Sessions] ${expectedTab} merge rechazado:`, validation.message);
      return { retried };
    }

    return { content: merged, retried };
  }

  private computeTabDocumentPersisted(
    tab: string,
    parts: {
      finalMdd?: string;
      finalDbga?: string;
      spec?: string;
      brd?: string;
      blueprint?: string;
      api?: string;
      flows?: string;
      tasks?: string;
      infra?: string;
      arch?: string;
      useCases?: string;
      stories?: string;
      ux?: string;
      phase0?: string;
    },
  ): boolean {
    switch (tab) {
      case "mdd":
        return Boolean(parts.finalMdd?.trim());
      case "benchmark":
        return Boolean(parts.finalDbga?.trim());
      case "spec":
        return Boolean(parts.spec?.trim());
      case "brd":
        return Boolean(parts.brd?.trim());
      case "blueprint":
        return Boolean(parts.blueprint?.trim());
      case "api-contracts":
        return Boolean(parts.api?.trim());
      case "logic-flows":
        return Boolean(parts.flows?.trim());
      case "tasks":
        return Boolean(parts.tasks?.trim());
      case "infra":
        return Boolean(parts.infra?.trim());
      case "architecture":
        return Boolean(parts.arch?.trim());
      case "use-cases":
        return Boolean(parts.useCases?.trim());
      case "user-stories":
        return Boolean(parts.stories?.trim());
      case "ux-ui-guide":
        return Boolean(parts.ux?.trim());
      case "phase0":
        return Boolean(parts.phase0?.trim());
      default:
        return false;
    }
  }

  private sessionScope(sessionId: string) {
    return { id: sessionId, userId: getRequestUserId() };
  }

  /** Misma regla que ProjectsService.assertProjectAccess: owner o SHARED. */
  private async assertProjectAccess(projectId: string): Promise<void> {
    const userId = getRequestUserId();
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: { userId: true, visibility: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    const isOwner = project.userId === userId;
    const isShared = project.visibility === "SHARED";
    if (!isOwner && !isShared) throw new NotFoundException("Project not found");
  }

  async create(data: { projectId: string; contextStep?: string; chatLog?: ChatMessage[] }) {
    const parsed = createSessionSchema.parse(data);
    const userId = getRequestUserId();
    await this.assertProjectAccess(parsed.projectId);
    return this.prisma.session.create({
      data: {
        userId,
        projectId: parsed.projectId,
        contextStep: parsed.contextStep,
        chatLog: (parsed.chatLog ?? []) as object,
      },
    });
  }

  async findByProject(projectId: string) {
    return this.prisma.session.findMany({
      where: { projectId, userId: getRequestUserId() },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: string) {
    const session = await this.prisma.session.findFirst({
      where: this.sessionScope(id),
      include: { project: true },
    });
    if (!session) throw new NotFoundException("Session not found");
    return session;
  }

  async clearChat(sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
    if (!session) throw new NotFoundException("Session not found");
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { chatLog: [] as object },
    });
    return this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
  }

  async appendMessage(sessionId: string, data: AppendChatDto) {
    const parsed = appendChatSchema.parse(data);
    const session = await this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
    if (!session) throw new NotFoundException("Session not found");

    let entry: ChatMessage = parsed;
    if (parsed.role === "user" && parsed.images?.length) {
      const enriched = await this.enrichUserContentWithVision(
        parsed.content,
        parsed.images,
        parsed.tab,
      );
      entry = { ...parsed, content: enriched };
    }

    const chatLog = session.chatLog as ChatMessage[];
    const updated = [...chatLog, entry];

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { chatLog: updated as object },
    });

    return this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
  }

  /** Modelo de visión → texto en el mensaje; las imágenes se conservan para la UI del chat. */
  private async enrichUserContentWithVision(
    userMessage: string,
    images: ChatImagePart[],
    activeTab?: string,
  ): Promise<string> {
    if (!images.length) return userMessage;
    if (contentIncludesVisionBlock(userMessage)) return userMessage;
    try {
      const summary = await this.ai.describeImagesForChat(userMessage, images, activeTab);
      const block = formatVisionContextBlock(summary);
      if (!block) return userMessage.trim() || "(Imagen adjunta)";
      return mergeUserTextWithVisionBlock(userMessage, block);
    } catch (err) {
      if (err instanceof ModelsUnavailableError || err instanceof BadRequestException) {
        throw err;
      }
      console.warn("[Sessions] enrichUserContentWithVision failed:", err);
      return userMessage.trim() || "(Imagen adjunta)";
    }
  }

  /**
   * Peticiones de edición al DBGA: refinado dedicado (BENCHMARK_REFINE) sin chat genérico.
   * Evita respuestas conversacionales sin `---FIN_DBGA---` que no persisten en el panel.
   */
  private async tryBenchmarkDbgaEditTurn(
    tab: string,
    userMessage: string,
    currentDbga: string | undefined,
    options?: { userImages?: ChatImagePart[]; intentRoute?: IntentRouteResult },
  ): Promise<{ finalDbga?: string; assistantContent: string } | null> {
    const current = (currentDbga ?? "").trim();
    const msg = userMessage.trim();
    if (tab !== "benchmark" || !current || !msg) {
      return null;
    }

    const route =
      options?.intentRoute ??
      (await this.intentRouter.route(msg, { activeTab: tab, hasDocumentContent: true }));
    if (route.action !== "edit_document") {
      return null;
    }

    const finalDbga = await this.resolveDbgaContentForReturn(
      msg,
      {
        activeTab: "benchmark",
        currentDbgaContent: current,
        userImages: options?.userImages,
        wantsDocumentEdit: true,
      },
      undefined,
    );

    let assistantContent = this.parser.stripChatLabel(
      benchmarkAssistantChatMessage("", finalDbga),
    );
    assistantContent = this.maybeWarnOrchestratorDocNotPersisted(
      tab,
      msg,
      assistantContent,
      { hasDbga: Boolean(finalDbga?.trim()) },
      { currentDbgaContent: current },
      Boolean(finalDbga?.trim()),
    );

    return { finalDbga, assistantContent };
  }


  private chatTurnRunnerDeps(): SessionChatTurnRunnerDeps {
    return {
      finalizeBenchmarkTurn: (...args) => this.finalizeBenchmarkTurn(...args),
      resolveMddContentForReturn: (...args) => this.resolveMddContentForReturn(...args),
      resolveDbgaContentForReturn: (...args) => this.resolveDbgaContentForReturn(...args),
      resolveDeliverableContentForReturn: (...args) => this.resolveDeliverableContentForReturn(...args),
      stripChatLabel: (raw) => this.parser.stripChatLabel(raw),
      maybeWarnOrchestratorDocNotPersisted: (...args) => this.maybeWarnOrchestratorDocNotPersisted(...args),
      computeTabDocumentPersisted: (...args) => this.computeTabDocumentPersisted(...args),
    };
  }

  private async processChatTurnFromResponse(
    input: Parameters<typeof processSessionChatTurnOutcome>[0],
  ) {
    return processSessionChatTurnOutcome(input, this.chatTurnRunnerDeps());
  }

  private buildSessionChatLlmOptions(ready: SessionChatTurnReady) {
    return buildSessionChatGenerateOptions(ready.options, {
      intent: ready.intentRoute.intent,
      learningHistory: ready.learningHistory || undefined,
      userMessageImages: ready.userTurn.imagesForLlm,
      telemetryContext: {
        projectId: ready.session.projectId,
        stageId: ready.options?.stageId ?? null,
        documentField: "chat",
        context: "chat",
        node: null,
        jobId: null,
      },
    });
  }

  private async prepareSessionChatTurn(
    sessionId: string,
    userMessage: string,
    options?: SessionChatTurnOptions,
  ): Promise<SessionChatTurnPrepareResult> {
    const session = await this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
    if (!session) throw new NotFoundException("Session not found");

    const fullLog = (session.chatLog as ChatMessage[]) ?? [];
    const activeTab = options?.activeTab ?? "mdd";
    const tab = activeTab;
    const stageId = options?.stageId?.trim();
    const chatScope = options?.chatScope ?? "global";
    const history = workshopHistoryForTurn(fullLog, activeTab, stageId, chatScope);
    const userTurn = await this.resolveUserTurnForLlm(
      userMessage,
      options?.userImages,
      activeTab,
    );
    const userEntry = buildSessionChatUserLogEntry(
      userTurn,
      tab,
      stageId,
      options?.userImages,
    );

    const intentRoute = await this.intentRouter.route(
      userTurn.promptForModel,
      this.intentRouteContext(options, history),
    );
    const llmUserPrompt = this.promptForIntentTurn(
      userTurn.promptForModel,
      intentRoute.action,
      activeTab,
    );

    const dbgaEditTurn = await this.tryBenchmarkDbgaEditTurn(
      tab,
      llmUserPrompt,
      options?.currentDbgaContent,
      { userImages: options?.userImages, intentRoute },
    );
    if (dbgaEditTurn) {
      return {
        kind: "dbga_early",
        sessionId,
        session,
        fullLog,
        tab,
        stageId,
        userEntry,
        assistantContent: dbgaEditTurn.assistantContent,
        finalDbga: dbgaEditTurn.finalDbga,
      };
    }

    const learningHistory = await this.preferences.getPreferencesForContext(session.projectId, 5);
    return {
      kind: "ready",
      ready: {
        sessionId,
        session,
        fullLog,
        history,
        activeTab,
        tab,
        stageId,
        userMessage,
        userTurn,
        userEntry,
        intentRoute,
        llmUserPrompt,
        llmHistory: sessionHistoryToLlm(history),
        learningHistory: learningHistory || "",
        options,
      },
    };
  }

  private async persistSessionChatTurn(
    sessionId: string,
    fullLog: ChatMessage[],
    userEntry: ChatMessage,
    assistantContent: string,
    tab: string,
    stageId?: string,
  ): Promise<Session | null> {
    const assistantEntry = buildSessionChatAssistantLogEntry(assistantContent, tab, stageId);
    const updated = appendSessionChatLogPair(fullLog, userEntry, assistantEntry);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { chatLog: updated as object },
    });
    return this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
  }

  /** Par usuario/asistente sin LLM (p. ej. confirmación de propagación upstream). */
  async recordTabChatTurn(
    sessionId: string,
    userMessage: string,
    assistantContent: string,
    tab: string,
    stageId?: string,
  ): Promise<Session | null> {
    const session = await this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
    if (!session) throw new NotFoundException("Session not found");
    const fullLog = (session.chatLog as ChatMessage[]) ?? [];
    const userEntry = buildSessionChatUserLogEntry(
      { promptForModel: userMessage, contentForLog: userMessage },
      tab,
      stageId,
    );
    return this.persistSessionChatTurn(
      sessionId,
      fullLog,
      userEntry,
      assistantContent,
      tab,
      stageId,
    );
  }

  private async completeSessionChatTurn(
    ready: SessionChatTurnReady,
    safeResponse: string,
    mode: "sync" | "stream",
  ): Promise<{ outcome: Awaited<ReturnType<typeof processSessionChatTurnOutcome>>; session: Session | null }> {
    const parsed = parseWorkshopAssistantResponse(safeResponse, this.parser, {
      activeTab: ready.activeTab,
      intentAction: ready.intentRoute.action,
      mode,
    });
    const outcome = await this.processChatTurnFromResponse({
      safeResponse,
      parsed,
      activeTab: ready.activeTab,
      userMessage: ready.userMessage,
      llmUserPrompt: ready.llmUserPrompt,
      intentRoute: ready.intentRoute,
      options: ready.options,
    });
    let assistantContent = outcome.assistantContent;
    const documentPersisted = isDocumentTurnPersisted(ready.tab, outcome.parts);
    if (documentPersisted) {
      assistantContent = maybeAppendUpstreamPropagateOffer(
        assistantContent,
        ready.tab,
        documentPersisted,
      );
    } else if (
      isWorkshopFrozenDeliverableTab(ready.tab) &&
      ready.intentRoute.action === "edit_document"
    ) {
      assistantContent = `${assistantContent.trim()}\n\n⚠️ ${workshopFrozenTabUserMessage(ready.tab)}`;
    }
    const sessionOut =
      assistantContent !== outcome.assistantContent
        ? await this.persistSessionChatTurn(
            ready.sessionId,
            ready.fullLog,
            ready.userEntry,
            assistantContent,
            ready.tab,
            ready.stageId,
          )
        : await this.persistSessionChatTurn(
            ready.sessionId,
            ready.fullLog,
            ready.userEntry,
            outcome.assistantContent,
            ready.tab,
            ready.stageId,
          );
    logDocumentTurnMetrics(this.logger, {
      tab: ready.tab,
      action: ready.intentRoute.action,
      source: ready.intentRoute.source,
      confidence: ready.intentRoute.confidence,
      hadDelimiter: outcome.hadDelimiter,
      persisted: documentPersisted,
      retried: outcome.docRetried,
    });
    return { outcome: { ...outcome, assistantContent }, session: sessionOut };
  }

  private async resolveUserTurnForLlm(
    userMessage: string,
    images: ChatImagePart[] | undefined,
    activeTab: string,
  ): Promise<{ promptForModel: string; contentForLog: string; imagesForLlm?: ChatImagePart[] }> {
    const trimmed = userMessage.trim();
    if (!images?.length) {
      return { promptForModel: trimmed, contentForLog: userMessage };
    }
    const contentForLog = await this.enrichUserContentWithVision(userMessage, images, activeTab);
    const promptForModel =
      contentForLog.trim() ||
      "(El usuario envió solo imágenes; usa el contexto visual descrito en el mensaje.)";
    return { promptForModel, contentForLog, imagesForLlm: undefined };
  }

  async chat(
    sessionId: string,
    userMessage: string,
    options?: SessionChatTurnOptions,
  ): Promise<{
    session: Session | null;
    mddContent?: string | null;
    uxUiGuideContent?: string | null;
    dbgaContent?: string | null;
    phase0SummaryContent?: string | null;
    specContent?: string | null;
    brdContent?: string | null;
    toBeManualContent?: string | null;
    blueprintContent?: string | null;
    apiContractsContent?: string | null;
    logicFlowsContent?: string | null;
    tasksContent?: string | null;
    infraContent?: string | null;
    architectureContent?: string | null;
    useCasesContent?: string | null;
    userStoriesContent?: string | null;
    documentAst?: Record<string, unknown> | null;
    documentVersion?: number | null;
    documentHadDelimiter?: boolean;
    documentPersisted?: boolean;
  }> {
    const prepared = await this.prepareSessionChatTurn(sessionId, userMessage, options);
    if (prepared.kind === "dbga_early") {
      const session = await this.persistSessionChatTurn(
        prepared.sessionId,
        prepared.fullLog,
        prepared.userEntry,
        prepared.assistantContent,
        prepared.tab,
        prepared.stageId,
      );
      return { session, dbgaContent: prepared.finalDbga };
    }

    const { ready } = prepared;
    const ts = () => new Date().toISOString();
    console.log(`[Chat] ${ts()} → Enviando mensaje al LLM:`, {
      activeTab: ready.activeTab,
      userMessagePreview: userMessage.slice(0, 200) + (userMessage.length > 200 ? "…" : ""),
      historyLength: ready.history.length,
    });

    let response: string;
    try {
      response = await this.ai.generateResponse(
        ready.llmUserPrompt,
        ready.llmHistory,
        this.buildSessionChatLlmOptions(ready),
      );
    } catch (err) {
      console.error("[Chat] ai.generateResponse error:", err);
      throw err;
    }

    const safeResponse = sanitizeAndAssertChatResponse(typeof response === "string" ? response : "");
    console.log(`[Chat] ${ts()} ← Respuesta del LLM recibida:`, {
      length: safeResponse.length,
      preview: safeResponse.slice(0, 300) + (safeResponse.length > 300 ? "…" : ""),
      isEmpty: !safeResponse.trim(),
    });

    const { outcome, session } = await this.completeSessionChatTurn(ready, safeResponse, "sync");
    const {
      assistantContent,
      parts,
      mddSplit,
      uxDocPart,
      dbgaDocPart,
      hasMdd,
      hasInfra,
      infraSplit,
    } = outcome;

    console.log(`[Chat] ${ts()} → Cliente recibirá:`, {
      chatPartLength: assistantContent.length,
      mddPartLength: hasMdd ? mddSplit!.mddPart.length : 0,
      uxDocPartLength: uxDocPart?.length ?? 0,
      dbgaDocPartLength: dbgaDocPart?.length ?? 0,
      dbgaPersistedLength: parts.finalDbga?.length ?? 0,
      infraLength: hasInfra ? infraSplit!.docPart.length : 0,
    });

    return {
      session,
      ...buildSessionChatDonePayload(ready.tab, outcome),
    };
  }

  /**
   * Streaming chat: yields chunks, then a final "done" with session and optional doc updates.
   */
  async *chatStream(
    sessionId: string,
    userMessage: string,
    options?: SessionChatTurnOptions,
  ): AsyncGenerator<
    | { type: "chunk"; content: string }
    | {
      type: "done";
      session: Session | null;
      mddContent?: string | null;
      uxUiGuideContent?: string | null;
      dbgaContent?: string | null;
      phase0SummaryContent?: string | null;
      specContent?: string | null;
      brdContent?: string | null;
      toBeManualContent?: string | null;
      blueprintContent?: string | null;
      apiContractsContent?: string | null;
      logicFlowsContent?: string | null;
      tasksContent?: string | null;
      infraContent?: string | null;
      architectureContent?: string | null;
      useCasesContent?: string | null;
      userStoriesContent?: string | null;
      documentHadDelimiter?: boolean;
      documentPersisted?: boolean;
    }
  > {
    const prepared = await this.prepareSessionChatTurn(sessionId, userMessage, options);
    if (prepared.kind === "dbga_early") {
      const session = await this.persistSessionChatTurn(
        prepared.sessionId,
        prepared.fullLog,
        prepared.userEntry,
        prepared.assistantContent,
        prepared.tab,
        prepared.stageId,
      );
      yield { type: "chunk", content: prepared.assistantContent };
      yield { type: "done", session, dbgaContent: prepared.finalDbga };
      return;
    }

    const { ready } = prepared;
    llmDebug("ChatStream", "inicio generateResponseStream", {
      sessionId: ready.sessionId,
      projectId: ready.session.projectId,
      activeTab: ready.activeTab,
      userId: getRequestUserId(),
      historyTurns: ready.llmHistory.length,
    });

    let stream: AsyncIterable<string>;
    try {
      stream = await this.ai.generateResponseStream(
        ready.llmUserPrompt,
        ready.llmHistory,
        this.buildSessionChatLlmOptions(ready),
      );
    } catch (err) {
      if (err instanceof ModelsUnavailableError) {
        llmWarn("ChatStream", "ModelsUnavailableError", {
          sessionId: ready.sessionId,
          projectId: ready.session.projectId,
          activeTab: ready.activeTab,
          message: err.message,
          details: err.details,
        });
      } else {
        llmWarn("ChatStream", "generateResponseStream error", {
          sessionId: ready.sessionId,
          projectId: ready.session.projectId,
          activeTab: ready.activeTab,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.logger.error("[ChatStream] ai.generateResponseStream error:", err);
      throw err;
    }

    let buffer = "";
    for await (const event of workshopStreamToChatEvents(stream)) {
      if (event.type === "chunk") {
        yield event;
      } else {
        buffer = event.buffer;
      }
    }

    const safeResponse = sanitizeAndAssertChatResponse(buffer);
    const { outcome, session } = await this.completeSessionChatTurn(ready, safeResponse, "stream");
    yield {
      type: "done",
      session,
      ...buildSessionChatDonePayload(ready.tab, outcome),
    };
  }

  /** Reintentos con backoff ante 429 (welcome disparado al cambiar de tab puede encadenar peticiones). */
  private async invokeWelcomeLlmWithRetries(
    syntheticPrompt: string,
    activeTab?: string,
  ): Promise<string> {
    const opts: GenerateResponseOptions = {
      activeTab: activeTab?.trim() || undefined,
      welcomeBrief: true,
    };
    const maxAttempts = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.ai.generateResponse(syntheticPrompt, [], opts);
      } catch (e) {
        lastErr = e;
        if (!isGeminiRateLimitError(e) || attempt === maxAttempts - 1) {
          throw e;
        }
        const backoffMs = 700 * 2 ** attempt + Math.floor(Math.random() * 400);
        console.warn(
          `[SessionsService.generateWelcome] LLM 429, reintento ${attempt + 2}/${maxAttempts} en ${backoffMs}ms`,
        );
        await sleepMs(backoffMs);
      }
    }
    throw lastErr;
  }

  private static fallbackWelcomeAfterRateLimit(activeTabNorm: string, projectName?: string): string {
    const name = projectName?.trim();
    const p = name ? ` **${name}**` : "";
    const tail =
      "\n\n_El proveedor de IA devolvió límite temporal de uso; se reintentó varias veces._ Escribe aquí cuando quieras y seguimos, o edita en el panel y usa **Guardar**.";
    if (activeTabNorm === "brd") {
      return `Hola${p}. En esta pestaña trabajamos el **BRD de la etapa**: problema, objetivos, alcance, riesgos (markdown en el panel + **Guardar** / **Aprobar BRD**).${tail}`;
    }
    return `Hola${p}.${tail}`;
  }

  /**
   * Genera mensaje de bienvenida (y primera pregunta si no hay contenido, o continuación si ya hay MDD/historial)
   * y lo persiste como primer mensaje del asistente. No añade mensaje de usuario.
   */
  async generateWelcome(
    sessionId: string,
    context: {
      projectName?: string;
      mddContent?: string | null;
      dbgaContent?: string | null;
      uxUiGuideContent?: string | null;
      /** BRD de la etapa (tab brd). */
      brdContent?: string | null;
      chatLog?: ChatMessage[];
      activeTab?: string;
      stageId?: string;
    },
  ) {
    const session = await this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
    if (!session) throw new NotFoundException("Session not found");

    const chatLogForTab = (context.chatLog ?? []) as ChatMessage[];
    const mddContent = (context.mddContent ?? "").trim();
    const dbgaContent = (context.dbgaContent ?? "").trim();
    const uxUiGuideContent = (context.uxUiGuideContent ?? "").trim();
    const brdStageContent = (context.brdContent ?? "").trim();
    const activeTab = (context.activeTab ?? "mdd").trim().toLowerCase();
    const isBenchmarkTab = activeTab === "benchmark";
    const isUxUiGuideTab = activeTab === "ux-ui-guide";
    const isBrdTab = activeTab === "brd";

    const activeTabHint = context.activeTab?.trim()
      ? ` El usuario tiene abierto el tab "${context.activeTab}": adapta tu mensaje EXCLUSIVAMENTE a ese documento (Paso 0 = Benchmark & Gap Analysis; MDD = Master Design Document; etc.).`
      : "";

    let syntheticPrompt: string;

    if (isBenchmarkTab) {
      const hasBenchmarkContent = chatLogForTab.length > 0 || dbgaContent.length > 0;
      // Paso 0 sin contenido: no añadimos burbuja conversacional; el front muestra "Escribe un mensaje para continuar..."
      if (!hasBenchmarkContent) {
        return session;
      }
      syntheticPrompt = chatLogForTab.length > 0
        ? `El usuario está en el tab **Paso 0 (Benchmark & Gap Analysis)**. Ya hay conversación en este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Historial de chat de este tab (últimos mensajes):
${chatLogForTab.slice(-10).map((m) => `[${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`).join("\n")}

Retoma el hilo del Benchmark & Gap Analysis: saluda brevemente y propón la siguiente pregunta o paso para refinar el benchmark o las brechas. Responde en un solo mensaje. NO hables de MDD, arquitectura ni despliegue a menos que el usuario lo pida en este tab.`
        : `El usuario está en el tab **Paso 0 (Benchmark & Gap Analysis)**. Ya tiene un Benchmark generado pero no hay mensajes en este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Benchmark & Gap Analysis del usuario:
---
${dbgaContent.slice(0, 4000)}${dbgaContent.length > 4000 ? "\n…" : ""}
---

Saluda y pregunta si quiere revisar/ajustar el benchmark o pasar a construir el MDD. Responde en un solo mensaje. Enfócate solo en Paso 0 (benchmark y brechas).`;
    } else if (isUxUiGuideTab) {
      const hasUxContent = chatLogForTab.length > 0 || uxUiGuideContent.length > 0;
      syntheticPrompt = hasUxContent
        ? chatLogForTab.length > 0
          ? `El usuario está en el tab **Guía UX/UI**. Ya hay conversación en este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Historial de chat de este tab (últimos mensajes):
${chatLogForTab.slice(-10).map((m) => `[${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`).join("\n")}

Retoma el hilo de la Guía UX/UI: saluda brevemente y propón la siguiente pregunta (marca, colores, prioridades, accesibilidad, etc.) o genera el documento si ya tienes suficiente información (terminando con ---FIN_UX_UI---). Responde en un solo mensaje.`
          : `El usuario está en el tab **Guía UX/UI**. Ya tiene un documento UX/UI generado pero no hay mensajes en este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Guía UX/UI actual (fragmento):
---
${uxUiGuideContent.slice(0, 2000)}${uxUiGuideContent.length > 2000 ? "\n…" : ""}
---

Saluda y pregunta si quiere revisar/ajustar la guía o añadir más criterios. Responde en un solo mensaje.`
        : `El usuario está en el tab **Guía UX/UI**. No hay documento ni historial en este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Según tu rol (Guía UX/UI): saluda al usuario y lanza la primera pregunta para construir la Guía UX/UI: ¿tienen equipo UX/UI o la IA/dev elegirán estilos? ¿Marca, colores, tipografía? ¿Prioridades (accesibilidad, móvil primero)? Responde en un solo mensaje.`;
    } else if (isBrdTab) {
      syntheticPrompt =
        chatLogForTab.length > 0
          ? `El usuario está en el tab **BRD** (etapa del Workshop). Ya hay conversación en este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Historial de chat de este tab (últimos mensajes):
${chatLogForTab.slice(-10).map((m) => `[${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`).join("\n")}

Retoma el hilo: saluda brevemente y propón la siguiente pregunta o mejora al BRD. Si actualizas el documento, termina el bloque markdown con \`---FIN_BRD---\` y un mensaje breve después. Responde en un solo mensaje.`
          : brdStageContent.length > 0
            ? `El usuario está en el tab **BRD**. Hay un borrador guardado pero aún no hay mensajes en el chat de este tab.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

BRD actual (fragmento):
---
${brdStageContent.slice(0, 3500)}${brdStageContent.length > 3500 ? "\n…" : ""}
---

Saluda y pregunta si quiere refinar alcance, KPIs o riesgos. Responde en un solo mensaje.`
            : dbgaContent.length > 0
              ? `El usuario está en el tab **BRD**. No hay BRD aún ni historial en este tab; sí hay **Domain Benchmark & Gap Analysis** como insumo.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Benchmark (fragmento):
---
${dbgaContent.slice(0, 3500)}${dbgaContent.length > 3500 ? "\n…" : ""}
---

Saluda y propón construir el BRD a partir del benchmark (objetivos, alcance, exclusiones). Si entregas un borrador, termina con \`---FIN_BRD---\`. Responde en un solo mensaje.`
              : `El usuario está en el tab **BRD**. No hay BRD ni benchmark en contexto todavía.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Saluda y lanza 1–2 preguntas clave para iniciar el BRD (problema de negocio, usuarios, éxito medible). Responde en un solo mensaje.`;
    } else {
      const hasContent = chatLogForTab.length > 0 || mddContent.length > 0;
      syntheticPrompt = hasContent
        ? `El usuario acaba de abrir el Workshop. Ya hay contenido en la sesión (tab: ${activeTab}).
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Historial de chat (últimos mensajes de este tab):
${chatLogForTab.slice(-10).map((m) => `[${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`).join("\n")}

MDD actual (fragmento):
${mddContent.slice(0, 1500)}${mddContent.length > 1500 ? "\n…" : ""}

Analiza lo que llevan y continúa la entrevista para este documento: saluda brevemente, retoma el hilo y propón la siguiente pregunta o paso. Responde en un solo mensaje.`
        : dbgaContent.length > 0
          ? `El usuario acaba de abrir el Workshop. No hay documento MDD ni historial de chat en este tab, pero tiene un **Domain Benchmark & Gap Analysis** que debe servir como contexto base para redactar el MDD.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Benchmark & Gap Analysis del usuario (úsalo como referencia de industria, checklist y brechas para guiar la entrevista):
---
${dbgaContent.slice(0, 4000)}${dbgaContent.length > 4000 ? "\n…" : ""}
---

Según tu rol (INICIO DE SESIÓN): saluda al usuario, reconoce que ya tienen un Benchmark y lanza la primera pregunta o instrucción para comenzar a construir el MDD a partir de ese contexto. Responde en un solo mensaje.`
          : `El usuario acaba de abrir el Workshop. No hay documento MDD ni historial de chat.
Proyecto: ${context.projectName ?? "Sin nombre"}${activeTabHint}

Según tu rol (INICIO DE SESIÓN en tus instrucciones): saluda al usuario y lanza la primera pregunta o instrucción para comenzar la entrevista y construir el MDD. Responde en un solo mensaje.`;
    }

    /** Guía meta para que el primer mensaje (welcome) no sea genérico ante “¿cómo se llena?” u omisión del usuario. */
    const brdWelcomeExtras = `
|[Instrucciones adicionales para tu respuesta única:]
|- Incluye una **mini-guía** (3–5 frases): qué es el BRD de etapa en The Forge, bloques típicos en markdown (problema, objetivos/KPIs, alcance, actores, riesgos), que el **panel** es editable con **Guardar** / **Aprobar BRD**, y que **aquí** refináis por chat.
|- Si el usuario pregunta explícitamente cómo rellenarlo, sé **concreto**; no pidas “área o proceso genérico” si ya hay **Benchmark** o **BRD** en el contexto de este prompt: **ancla** en ese texto.
|- Solo si entregas un **borrador BRD completo** nuevo desde el chat, termina el markdown con la línea exacta \`---FIN_BRD---\`. Si solo orientas o conversas, **sin** delimitador.`;

    if (isBrdTab) {
      syntheticPrompt += brdWelcomeExtras;
    }

    const activeTabForLlm = context.activeTab?.trim() || undefined;
    let response: string;
    try {
      response = await this.invokeWelcomeLlmWithRetries(syntheticPrompt, activeTabForLlm);
    } catch (err) {
      if (isGeminiRateLimitError(err)) {
        const at = (context.activeTab ?? "mdd").trim().toLowerCase();
        console.warn(
          "[SessionsService.generateWelcome] LLM 429 tras reintentos; mensaje estático de bienvenida.",
        );
        response = SessionsService.fallbackWelcomeAfterRateLimit(at, context.projectName);
      } else {
        throw err;
      }
    }
    const mddSplit = this.parser.splitMddAndChat(response);
    const uxSplit = this.parser.splitUxUiGuideAndChat(response);
    const brdWelcomeSplit = this.parser.splitDocAndChat(response, "BRD");
    const tobeWelcomeSplit = this.parser.splitDocAndChat(response, "TOBE");
    const rawChat =
      mddSplit !== null
        ? mddSplit.chatPart
        : uxSplit !== null
          ? uxSplit.chatPart
          : brdWelcomeSplit !== null
            ? brdWelcomeSplit.chatPart
            : tobeWelcomeSplit !== null
              ? tobeWelcomeSplit.chatPart
              : response;
    const contentToAppend = this.parser.stripChatLabel(rawChat);
    const sid = context.stageId?.trim();
    return this.appendMessage(
      sessionId,
      sid
        ? { role: "assistant", content: contentToAppend, tab: context.activeTab, stageId: sid }
        : { role: "assistant", content: contentToAppend, tab: context.activeTab },
    );
  }

  async updateContextStep(sessionId: string, contextStep: string) {
    const step = contextStepEnum.includes(contextStep as (typeof contextStepEnum)[number])
      ? contextStep
      : "CONTEXT";
    const r = await this.prisma.session.updateMany({
      where: this.sessionScope(sessionId),
      data: { contextStep: step },
    });
    if (r.count === 0) throw new NotFoundException("Session not found");
    const row = await this.prisma.session.findFirst({
      where: this.sessionScope(sessionId),
    });
    if (!row) throw new NotFoundException("Session not found");
    return row;
  }

  /**
   * Separa documento vs chat en tab benchmark y evita persistir el DBGA entero en chatLog.
   */
  private finalizeBenchmarkTurn(
    tab: string,
    safeResponse: string,
    userMessage: string,
    state: { hasDbga: boolean; dbgaDocPart?: string; rawChat: string },
    wantsDocumentEdit = false,
  ): { hasDbga: boolean; dbgaDocPart?: string; rawChat: string } {
    if (tab.trim() !== "benchmark") return state;

    const parsed = parseBenchmarkResponse(safeResponse);
    if (parsed) {
      const awaitingApproval =
        isAssistantAwaitingDocumentEditApproval(parsed.chatPart) ||
        isAssistantAwaitingDocumentEditApproval(safeResponse);
      if (awaitingApproval) {
        const chat = parsed.chatPart.trim();
        const proposal = parsed.docPart.trim();
        const rawChat =
          chat.length >= 180 || !proposal || looksLikeDbgaDocumentBody(proposal)
            ? chat || safeResponse.trim()
            : `${chat}\n\n**Propuesta para el DBGA:**\n\n${proposal}`.trim();
        return { hasDbga: false, rawChat: rawChat || safeResponse.trim() };
      }
      return {
        hasDbga: true,
        dbgaDocPart: parsed.docPart,
        rawChat: parsed.chatPart || BENCHMARK_CHAT_ACK,
      };
    }

    if (state.hasDbga && state.dbgaDocPart?.trim()) {
      const chat = state.rawChat.trim();
      if (
        chat.length > 280 &&
        (looksLikeDbgaDocumentBody(chat) || state.dbgaDocPart.length > 400)
      ) {
        return { ...state, rawChat: BENCHMARK_CHAT_ACK };
      }
      return state;
    }

    const fb = this.parser.detectBenchmarkDocFallback(safeResponse.trim());
    if (fb?.docPart?.trim()) {
      return {
        hasDbga: true,
        dbgaDocPart: fb.docPart,
        rawChat: fb.chatPart || BENCHMARK_CHAT_ACK,
      };
    }

    if (
      safeResponse.length > 400 &&
      (wantsDocumentEdit ||
        looksLikeDbgaEditRequest(userMessage) ||
        looksLikeDbgaSpecIntegrationRequest(userMessage) ||
        /\btenant_id\b|multi-?tenant|###\s+Módulos del proyecto/i.test(safeResponse))
    ) {
      const fb2 = this.parser.detectBenchmarkDocFallback(safeResponse.trim());
      if (fb2?.docPart?.trim()) {
        return {
          hasDbga: true,
          dbgaDocPart: fb2.docPart,
          rawChat: fb2.chatPart || BENCHMARK_CHAT_ACK,
        };
      }
    }

    return state;
  }

  /**
   * Segunda pasada cuando el stream/chat no trajo `---FIN_DBGA---` pero el usuario pidió cambios.
   * Usa el mismo prompt de refinado (BENCHMARK_REFINE) con el DBGA actual en system.
   */
  private async resolveDbgaContentForReturn(
    userMessage: string,
    options:
      | {
          activeTab?: string;
          currentDbgaContent?: string;
          userImages?: ChatImagePart[];
          wantsDocumentEdit?: boolean;
        }
      | undefined,
    dbgaDocPart: string | undefined,
  ): Promise<string | undefined> {
    const tab = (options?.activeTab ?? "mdd").trim();
    const current = options?.currentDbgaContent?.trim() ?? "";
    const wantsEdit =
      options?.wantsDocumentEdit === true ||
      looksLikeDbgaEditRequest(userMessage) ||
      looksLikeDbgaSpecIntegrationRequest(userMessage) ||
      looksLikeApiEndpointCatalog(userMessage);
    const hadImages = (options?.userImages?.length ?? 0) > 0;

    // Respuesta a pregunta pendiente = catálogo HTTP: fusión determinista (sin depender de FIN_DBGA).
    if (tab === "benchmark" && current.length > 0 && looksLikeApiEndpointCatalog(userMessage)) {
      const deterministic = mergeApiEndpointCatalogIntoDbga(current, userMessage);
      const validation = validateDocumentForPersist(current, deterministic, { fieldLabel: "DBGA" });
      if (
        validation.ok &&
        !wouldShrinkDbgaDangerously(current, deterministic) &&
        dbgaReflectsUserEditIntent(deterministic, userMessage)
      ) {
        console.log(
          "[Sessions] mergeApiEndpointCatalogIntoDbga aplicado, length:",
          deterministic.length,
        );
        return deterministic;
      }
    }

    const cleanedPart = dbgaDocPart
      ? this.parser.cleanDocumentContent(dbgaDocPart)
      : undefined;

    let merged = cleanedPart
      ? tab === "benchmark" && isPartialBenchmarkDoc(cleanedPart, current)
        ? this.parser.cleanDocumentContent(mergeBenchmarkPartialDoc(current, cleanedPart))
        : this.parser.mergeDbgaOrUseFull(options?.currentDbgaContent, cleanedPart)
      : undefined;

    const needsRefine =
      tab === "benchmark" &&
      wantsEdit &&
      current.length > 0 &&
      (!merged ||
        isDbgaContentNearlyIdentical(merged, current) ||
        !dbgaReflectsUserEditIntent(merged, userMessage) ||
        (hadImages && !merged));

    if (needsRefine) {
      const refined = await this.refineDbgaFromUserRequest(userMessage, current);
      if (refined) {
        merged = refined;
        console.log("[Sessions] refineDbgaFromUserRequest aplicado, length:", refined.length);
      } else if (merged && isDbgaContentNearlyIdentical(merged, current)) {
        console.warn(
          "[Sessions] DBGA sin cambios tras refinado; el panel puede seguir igual que antes del mensaje.",
        );
        merged = undefined;
      }
    }

    if (merged && current) {
      const validation = validateDocumentForPersist(current, merged, { fieldLabel: "DBGA" });
      if (!validation.ok || wouldShrinkDbgaDangerously(current, merged)) {
        console.warn(
          "[Sessions] DBGA merge rechazado;",
          validation.ok ? "reducción peligrosa" : validation.message,
          { currentLen: current.length, mergedLen: merged.length },
        );
        merged = undefined;
      }
    }

    return merged && merged.length > 0 ? merged : undefined;
  }

  /**
   * Tras el chat/stream: devuelve `candidate` si ya refleja la petición; si no, segunda pasada de refinado.
   */
  async maybeRefineBenchmarkDbga(
    userMessage: string,
    currentDbga: string,
    candidate: string | null | undefined,
  ): Promise<string | null> {
    const current = currentDbga.trim();
    const c = candidate?.trim();
    if (
      c &&
      !isDbgaContentNearlyIdentical(c, current) &&
      dbgaReflectsUserEditIntent(c, userMessage)
    ) {
      return c;
    }
    return this.refineDbgaFromUserRequest(userMessage, current);
  }

  async refineDbgaFromUserRequest(
    userMessage: string,
    currentDbga: string,
  ): Promise<string | null> {
    const msg = userMessage.trim();
    const current = currentDbga.trim();
    if (!msg || !current) return null;

    const mirrorHint = /\bespejo\b|id\s+(de\s+)?origen|id\s+propio|tablas?\s+espejo/i.test(msg)
      ? "\n\n**Tablas espejo (obligatorio si aplica):** En cada tabla espejo documenta `tenant_id`, el **id de origen** (clave en el sistema fuente) y el **id propio** (PK de la fila en la tabla espejo). Refleja esto en SQL o tablas markdown del DBGA."
      : "";

    const proposedLabels = extractDbgaProposedLabels(msg);
    const renameHint =
      proposedLabels.length > 0
        ? `\n\n**Renombres / etiquetas (obligatorio):** Usa explícitamente estas etiquetas en el documento (en las menciones relevantes): ${proposedLabels.map((l) => `"${l}"`).join(", ")}. No inventes otros nombres para esos conceptos.`
        : "";

    const fase0FormatHint = isPhase0StructuredMarkdown(current)
      ? `\n\n${PHASE0_MARKDOWN_FORMAT_RULES}`
      : "";

    const refinePrompt = `Aplica OBLIGATORIAMENTE al documento completo los cambios que pide el usuario. No respondas solo en chat: devuelve el DBGA/Fase 0 COMPLETO en markdown y termina con la línea exacta ---FIN_DBGA---.

**Anti-borrado (crítico):** Conserva TODAS las secciones existentes del documento actual (cabecera, industria, funcionalidades, arquitectura, gaps, etc.). Si el usuario aporta un catálogo de endpoints (GET/POST/…) o una lista numerada corta, **añádelo o fusiónalo** en una sección de integración/API — NUNCA reemplaces el documento entero por solo esa lista.

**Delimitador inviolable:** La última línea del documento (antes del mensaje de chat) DEBE ser exactamente ---FIN_DBGA---. Sin ella el sistema descarta la respuesta.

Petición del usuario:
---
${msg}
---${mirrorHint}${renameHint}${fase0FormatHint}`;

    const llmOpts = {
      activeTab: "benchmark" as const,
      currentDbgaContent: current,
      maxTokensOverride: resolveLlmMaxTokensForPurpose("document"),
    };

    try {
      let response = await this.ai.generateResponse(refinePrompt, [], llmOpts);
      let merged = this.extractMergedDbgaFromModelResponse(response, current, {
        requireFinDelimiter: true,
      });

      const unchanged =
        merged != null && isDbgaEditEffectivelyUnchanged(merged, current, userMessage);
      const missingIntent =
        merged != null && !dbgaReflectsUserEditIntent(merged, userMessage);

      if (merged && (unchanged || missingIntent)) {
        console.warn(
          `[Sessions] refineDbga retry (unchanged=${unchanged}, missingIntent=${missingIntent})`,
        );
        response = await this.ai.generateResponse(
          `${refinePrompt}\n\nREINTENTO: la respuesta anterior NO aplicó los cambios. El documento debe reflejar explícitamente lo pedido (p. ej. PAT Wasender, QR de sesión, tenant_id). Termina con ---FIN_DBGA---.`,
          [],
          llmOpts,
        );
        merged = this.extractMergedDbgaFromModelResponse(response, current, {
          requireFinDelimiter: true,
        });
      }

      const stillBad =
        !merged ||
        isDbgaEditEffectivelyUnchanged(merged, current, userMessage) ||
        !dbgaReflectsUserEditIntent(merged, userMessage);
      if (stillBad) {
        const keywords = extractDbgaEditKeywords(userMessage, 10);
        const labels = extractDbgaProposedLabels(userMessage);
        // Preferir etiquetas cortas (PAT Wasender); no mezclar prosa del renameTail.
        const concepts = [...new Set([...labels, ...keywords.filter((k) => k.length <= 24)])].slice(
          0,
          12,
        );
        if (concepts.length > 0) {
          console.warn("[Sessions] refineDbga final retry with concepts:", concepts.join(", "));
          response = await this.ai.generateResponse(
            `${refinePrompt}\n\nREINTENTO FINAL (obligatorio): incorpora explícitamente en el DBGA COMPLETO estos conceptos: ${concepts.join(", ")}. Termina con ---FIN_DBGA---.`,
            [],
            llmOpts,
          );
          merged = this.extractMergedDbgaFromModelResponse(response, current, {
            requireFinDelimiter: true,
          });
        }
      }

      if (!merged || isDbgaEditEffectivelyUnchanged(merged, current, userMessage)) return null;
      if (!dbgaReflectsUserEditIntent(merged, userMessage)) {
        const grew = merged.length > current.length + 40;
        const mirrorCols =
          /\borigen_id\b|\bsource_id\b|\bid_origen\b|\bid_espejo\b|\bmirror_id\b|\bid_propio\b|\btenant_id\b/i;
        const proposedOk = extractDbgaProposedLabels(userMessage).some((l) =>
          merged!.toLowerCase().includes(l.toLowerCase()),
        );
        if (
          !(
            proposedOk ||
            (grew &&
              mirrorCols.test(merged) &&
              /\bespejo|origen|propio/i.test(userMessage)) ||
            (grew && dbgaContainsUserEditKeywords(merged, userMessage))
          )
        ) {
          return null;
        }
      }
      return merged;
    } catch (err) {
      console.warn("[Sessions] refineDbgaFromUserRequest failed:", err);
      return null;
    }
  }

  private extractMergedDbgaFromModelResponse(
    response: string,
    currentDbga?: string,
    opts?: { requireFinDelimiter?: boolean },
  ): string | null {
    const trimmed = response?.trim() ?? "";
    if (!trimmed) return null;

    // Preferir FIN_DBGA; si falta, aceptar DBGA completo (título + tamaño) — Gemma suele omitir el marcador.
    const finSplit =
      parseBenchmarkResponse(trimmed) ?? this.parser.splitDbgaAndChat(trimmed);
    let finFallbackSplit: { docPart: string; chatPart: string } | null = null;
    if (opts?.requireFinDelimiter && !finSplit) {
      finFallbackSplit = acceptCompleteDbgaWithoutFinMarker(trimmed, currentDbga);
      if (!finFallbackSplit) {
        console.warn("[Sessions] refineDbga: respuesta sin ---FIN_DBGA---; descartada");
        return null;
      }
      console.warn(
        "[Sessions] refineDbga: sin ---FIN_DBGA---; se acepta DBGA completo por título/tamaño",
      );
    }

    const finIdx = trimmed.search(/-{0,}[ \t]*FIN_DBGA[ \t]*-{0,}/i);
    const withoutFin = finIdx >= 0 ? trimmed.slice(0, finIdx).trim() : trimmed;

    const split =
      finSplit ??
      finFallbackSplit ??
      (!opts?.requireFinDelimiter
        ? this.parser.detectBenchmarkDocFallback(withoutFin) ??
          this.parser.detectBenchmarkDocFallback(trimmed)
        : null);

    let docPart = split?.docPart?.trim();
    if (
      !opts?.requireFinDelimiter &&
      !docPart &&
      withoutFin.length >= 400 &&
      /^#\s/m.test(withoutFin)
    ) {
      docPart = withoutFin;
    }
    if (!docPart) return null;

    const cleaned = this.parser.cleanDocumentContent(docPart);
    if (currentDbga?.trim() && isPartialBenchmarkDoc(docPart, currentDbga)) {
      const partialMerged = this.parser.cleanDocumentContent(
        mergeBenchmarkPartialDoc(currentDbga.trim(), cleaned),
      );
      return partialMerged.length > 0 ? partialMerged : null;
    }
    const merged = this.parser.mergeDbgaOrUseFull(currentDbga, cleaned);
    return merged.length > 0 ? merged : null;
  }

  salvageDbgaFromAssistantText(
    assistantText: string,
    currentDbga?: string,
  ): string | null {
    const trimmed = assistantText?.trim() ?? "";
    if (trimmed.length < 200) return null;

    const split =
      parseBenchmarkResponse(trimmed) ??
      this.parser.splitDbgaAndChat(trimmed) ??
      this.parser.detectBenchmarkDocFallback(trimmed);
    if (!split?.docPart?.trim()) return null;

    const docPart = split.docPart.trim();
    const cleaned = this.parser.cleanDocumentContent(docPart);
    if (currentDbga?.trim() && isPartialBenchmarkDoc(docPart, currentDbga)) {
      const partialMerged = this.parser.cleanDocumentContent(
        mergeBenchmarkPartialDoc(currentDbga.trim(), cleaned),
      );
      return partialMerged.length > 0 ? partialMerged : null;
    }
    const merged = this.parser.mergeDbgaOrUseFull(currentDbga, cleaned);
    return merged.length > 0 ? merged : null;
  }

  /**
   * Recupera el DBGA más completo encontrado en mensajes assistant del tab benchmark
   * y lo persiste de vuelta en el proyecto (panel Fase 0).
   */
  async salvageAndRestoreDbgaFromChat(projectId: string) {
    const userId = getRequestUserId();
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [{ userId }, { visibility: "SHARED" }],
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const sessions = await this.prisma.session.findMany({
      where: { projectId, userId },
      orderBy: { updatedAt: "desc" },
    });

    const currentDbga = (project.dbgaContent ?? "").trim();
    let best: { content: string; len: number; sessionId: string } | null = null;

    for (const session of sessions) {
      const log = (session.chatLog as ChatMessage[]) ?? [];
      for (const msg of log) {
        if (msg.role !== "assistant" || (msg.tab ?? "mdd") !== "benchmark") continue;
        const raw = msg.content?.trim() ?? "";
        if (raw.length < 400) continue;
        if (!/# Research Report|### Módulos del proyecto|Domain Benchmark|Fase 0 —/i.test(raw)) {
          continue;
        }

        const parsed = parseBenchmarkResponse(raw);
        const docRaw = parsed?.docPart?.trim() ?? raw;
        let candidate =
          this.salvageDbgaFromAssistantText(docRaw, currentDbga || undefined) ??
          (currentDbga && isPartialBenchmarkDoc(docRaw, currentDbga)
            ? this.parser.cleanDocumentContent(
                mergeBenchmarkPartialDoc(currentDbga, docRaw),
              )
            : this.parser.cleanDocumentContent(docRaw));

        if (!candidate?.trim()) continue;
        if (currentDbga && wouldShrinkDbgaDangerously(currentDbga, candidate)) continue;

        if (candidate.length > (best?.len ?? 0)) {
          best = { content: candidate, len: candidate.length, sessionId: session.id };
        }
      }
    }

    if (!best) {
      throw new NotFoundException(
        "No se encontró un DBGA recuperable en el historial del chat (tab benchmark).",
      );
    }

    const validation = validateDocumentForPersist(currentDbga, best.content, {
      fieldLabel: "DBGA",
    });
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    await this.documentSnapshot.snapshotBeforeOverwrite(
      projectId,
      "dbgaContent",
      project.dbgaContent,
      "salvage",
    );

    const stampedDbga = stampMarkdownIfBodyChanged(project.dbgaContent, best.content);

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        dbgaContent: stampedDbga,
        phase0SummaryContent: best.content,
      },
    });

    return {
      dbgaContent: stampedDbga,
      recoveredFromSessionId: best.sessionId,
      length: best.len,
    };
  }

  private maybeWarnOrchestratorDocNotPersisted(
    tab: string,
    userMessage: string,
    assistantContent: string,
    flags: DocPersistFlags,
    options?: {
      currentMddContent?: string;
      currentSpecContent?: string;
      currentArchitectureContent?: string;
      currentUseCasesContent?: string;
      currentUserStoriesContent?: string;
      currentBlueprintContent?: string;
      currentApiContractsContent?: string;
      currentLogicFlowsContent?: string;
      currentTasksContent?: string;
      currentInfraContent?: string;
      currentBrdContent?: string;
      currentDbgaContent?: string;
      currentUxUiGuideContent?: string;
      currentPhase0SummaryContent?: string;
    },
    docPersisted?: boolean,
    hadDelimiter = false,
  ): string {
    const currentDocLen = currentDocLengthForTab(tab, options);
    if (
      !shouldWarnOrchestratorDocNotPersisted({
        tab,
        userMessage,
        assistantContent,
        flags,
        currentDocLen,
        docPersisted,
        hadDelimiter,
      })
    ) {
      return assistantContent;
    }
    console.warn("[Chat] documento no persistido pese a pedido/afirmación de cambio", {
      tab,
      currentDocLen,
      hadDelimiter,
      assistantPreview: assistantContent.slice(0, 120),
    });
    return appendOrchestratorDocNotPersistedWarning(assistantContent, tab, { hadDelimiter });
  }
}
