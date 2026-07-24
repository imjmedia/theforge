import type { IntentRouteResult } from "../ai/intent-route.types.js";
import type { WorkshopChatAction } from "../ai/intent-route.types.js";
import type { ChatImagePart, ChatMessage } from "@theforge/shared-types";
import type { ChatMessage as LlmChatMessage } from "../ai/interfaces/llm-provider.interface.js";
import { benchmarkAssistantChatMessage, looksLikeDbgaEditRequest } from "./dbga-edit.util.js";
import { normalizeDashes } from "./document-content.util.js";
import type { DocPersistFlags } from "./orchestrator-doc-guard.util.js";
import type { SessionChatTurnOptions } from "./session-chat-llm-options.util.js";
import type { ParsedWorkshopAssistantResponse } from "./session-chat-response-parse.util.js";
import {
  applyIntentPersistGate,
  hadAnyDocumentDelimiter,
  sanitizeLlmResponse,
} from "./workshop-document-turn.util.js";

/** Delimitador de documento Workshop en respuestas stream (ocultar doc, emitir solo chat). */
export const WORKSHOP_DOC_DELIMITER_RE =
  /-{1,}\s*FIN_(?:MDD|UX_UI|DBGA|PHASE0|SPEC|BRD|BLUEPRINT|API|FLOWS|TASKS|INFRA|ARCH|USECASES|STORIES)\s*-{1,}/i;

export const EMPTY_LLM_RESPONSE_ERROR =
  "La IA no generó texto (respuesta vacía o bloqueada). Intenta de nuevo o reformula el mensaje.";

export type SessionChatUserTurn = {
  promptForModel: string;
  contentForLog: string;
  imagesForLlm?: ChatImagePart[];
};

export type SessionChatTurnSessionRef = {
  id: string;
  projectId: string;
  chatLog: unknown;
};

export type SessionChatTurnReady = {
  sessionId: string;
  session: SessionChatTurnSessionRef;
  fullLog: ChatMessage[];
  history: ChatMessage[];
  activeTab: string;
  tab: string;
  stageId?: string;
  userMessage: string;
  userTurn: SessionChatUserTurn;
  userEntry: ChatMessage;
  intentRoute: IntentRouteResult;
  llmUserPrompt: string;
  llmHistory: LlmChatMessage[];
  learningHistory: string;
  options: SessionChatTurnOptions | undefined;
};

export type SessionChatDbgaEarlyTurn = {
  kind: "dbga_early";
  sessionId: string;
  session: SessionChatTurnSessionRef;
  fullLog: ChatMessage[];
  tab: string;
  stageId?: string;
  userEntry: ChatMessage;
  assistantContent: string;
  finalDbga?: string;
};

export type SessionChatTurnPrepareResult =
  | SessionChatDbgaEarlyTurn
  | { kind: "ready"; ready: SessionChatTurnReady };

export function buildSessionChatUserLogEntry(
  userTurn: SessionChatUserTurn,
  tab: string,
  stageId?: string,
  userImages?: ChatImagePart[],
): ChatMessage {
  const userEntryBase = {
    role: "user" as const,
    content: userTurn.contentForLog,
    tab,
    ...(userImages?.length ? { images: userImages } : {}),
  };
  return stageId ? { ...userEntryBase, stageId } : userEntryBase;
}

export function buildSessionChatAssistantLogEntry(
  content: string,
  tab: string,
  stageId?: string,
): ChatMessage {
  const base = { role: "assistant" as const, content, tab };
  return stageId ? { ...base, stageId } : base;
}

export function appendSessionChatLogPair(
  fullLog: ChatMessage[],
  userEntry: ChatMessage,
  assistantEntry: ChatMessage,
): ChatMessage[] {
  return [...fullLog, userEntry, assistantEntry];
}

export function sanitizeAndAssertChatResponse(raw: string): string {
  const safeResponse = sanitizeLlmResponse(raw);
  if (!safeResponse.trim()) {
    throw new Error(EMPTY_LLM_RESPONSE_ERROR);
  }
  return safeResponse;
}

export async function* workshopStreamToChatEvents(
  stream: AsyncIterable<string>,
): AsyncGenerator<
  { type: "chunk"; content: string } | { type: "complete"; buffer: string }
> {
  let buffer = "";
  let documentChunksDone = false;
  for await (const chunk of stream) {
    buffer += chunk;
    if (documentChunksDone) {
      yield { type: "chunk", content: chunk };
    } else if (WORKSHOP_DOC_DELIMITER_RE.test(normalizeDashes(buffer))) {
      documentChunksDone = true;
      const normBuffer = normalizeDashes(buffer);
      const match = normBuffer.match(WORKSHOP_DOC_DELIMITER_RE);
      if (match) {
        const idx = normBuffer.indexOf(match[0]);
        const afterDelim = buffer.slice(idx + match[0].length);
        if (afterDelim.trim()) {
          yield { type: "chunk", content: afterDelim };
        }
      }
    }
  }
  yield { type: "complete", buffer };
}

export type DeliverableResolveResult = { content?: string; retried: boolean };

export type TabDocumentParts = {
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
};

export type SessionChatTurnProcessInput = {
  safeResponse: string;
  parsed: ParsedWorkshopAssistantResponse;
  activeTab: string;
  userMessage: string;
  llmUserPrompt: string;
  intentRoute: IntentRouteResult;
  options: SessionChatTurnOptions | undefined;
};

export type SessionChatTurnOutcome = {
  activeTab: string;
  dualMdd: ParsedWorkshopAssistantResponse["dualMdd"];
  mddSplit: ParsedWorkshopAssistantResponse["mddSplit"];
  infraSplit: ParsedWorkshopAssistantResponse["infraSplit"];
  uxDocPart: string | undefined;
  dbgaDocPart: string | undefined;
  hasMdd: boolean;
  hasInfra: boolean;
  hadDelimiter: boolean;
  docRetried: boolean;
  assistantContent: string;
  documentPersisted: boolean;
  parts: TabDocumentParts;
  resolved: {
    spec: DeliverableResolveResult;
    brd: DeliverableResolveResult;
    blueprint: DeliverableResolveResult;
    api: DeliverableResolveResult;
    flows: DeliverableResolveResult;
    tasks: DeliverableResolveResult;
    infra: DeliverableResolveResult;
    arch: DeliverableResolveResult;
    useCases: DeliverableResolveResult;
    stories: DeliverableResolveResult;
    ux: DeliverableResolveResult;
    phase0: DeliverableResolveResult;
  };
};

export type SessionChatTurnRunnerDeps = {
  finalizeBenchmarkTurn: (
    tab: string,
    safeResponse: string,
    userMessage: string,
    state: { hasDbga: boolean; dbgaDocPart?: string; rawChat: string },
    wantsDocumentEdit?: boolean,
  ) => { hasDbga: boolean; dbgaDocPart?: string; rawChat: string };
  resolveMddContentForReturn: (
    userMessage: string,
    options: { currentMddContent?: string; wantsDocumentEdit?: boolean },
    mddDocPart: string | undefined,
    dualMarkdown?: string,
  ) => Promise<DeliverableResolveResult>;
  resolveDbgaContentForReturn: (
    userMessage: string,
    options:
      | (SessionChatTurnOptions & { wantsDocumentEdit?: boolean })
      | undefined,
    dbgaDocPart: string | undefined,
  ) => Promise<string | undefined>;
  resolveDeliverableContentForReturn: (
    activeTab: string,
    expectedTab: string,
    hasDoc: boolean,
    rawPart: string | undefined,
    currentDoc: string | undefined,
    userMessage: string,
    wantsDocumentEdit: boolean,
  ) => Promise<DeliverableResolveResult>;
  stripChatLabel: (raw: string) => string;
  maybeWarnOrchestratorDocNotPersisted: (
    tab: string,
    userMessage: string,
    assistantContent: string,
    flags: DocPersistFlags,
    options: SessionChatTurnOptions | undefined,
    documentPersisted: boolean,
    hadDelimiter: boolean,
  ) => string;
  computeTabDocumentPersisted: (tab: string, parts: TabDocumentParts) => boolean;
};

export function userMessageForDocHeuristics(userMessage: string, llmUserPrompt: string): string {
  return userMessage.trim() || llmUserPrompt.trim();
}

export function wantsDocumentEditForTurn(
  intentAction: WorkshopChatAction,
  activeTab: string,
  heuristicsUserMsg: string,
): boolean {
  return (
    intentAction === "edit_document" ||
    (activeTab === "benchmark" && looksLikeDbgaEditRequest(heuristicsUserMsg))
  );
}

export function wantsDbgaDocumentProcessing(
  intentAction: WorkshopChatAction,
  userMessage: string,
  llmUserPrompt: string,
): boolean {
  if (intentAction === "edit_document") return true;
  return looksLikeDbgaEditRequest(userMessageForDocHeuristics(userMessage, llmUserPrompt));
}

export function isDocumentTurnPersisted(tab: string, parts: TabDocumentParts): boolean {
  return Boolean(
    (tab === "mdd" && parts.finalMdd) ||
      (tab === "benchmark" && parts.finalDbga) ||
      (tab === "spec" && parts.spec) ||
      (tab === "brd" && parts.brd) ||
      (tab === "blueprint" && parts.blueprint) ||
      (tab === "api-contracts" && parts.api) ||
      (tab === "logic-flows" && parts.flows) ||
      (tab === "tasks" && parts.tasks) ||
      (tab === "infra" && parts.infra) ||
      (tab === "architecture" && parts.arch) ||
      (tab === "use-cases" && parts.useCases) ||
      (tab === "user-stories" && parts.stories) ||
      (tab === "ux-ui-guide" && parts.ux) ||
      (tab === "phase0" && parts.phase0),
  );
}

export function buildSessionChatDonePayload(
  tab: string,
  outcome: SessionChatTurnOutcome,
): {
  documentHadDelimiter: boolean;
  documentPersisted: boolean;
  mddContent?: string | null;
  uxUiGuideContent?: string | null;
  dbgaContent?: string | null;
  phase0SummaryContent?: string | null;
  specContent?: string;
  brdContent?: string;
  blueprintContent?: string;
  apiContractsContent?: string;
  logicFlowsContent?: string;
  tasksContent?: string;
  infraContent?: string;
  architectureContent?: string;
  useCasesContent?: string;
  userStoriesContent?: string;
  documentAst?: Record<string, unknown> | null;
  documentVersion?: number | null;
} {
  const { parts, resolved, dualMdd, hadDelimiter, documentPersisted } = outcome;
  return {
    documentHadDelimiter: hadDelimiter,
    documentPersisted,
    mddContent: tab === "mdd" && parts.finalMdd && parts.finalMdd.length > 0 ? parts.finalMdd : undefined,
    uxUiGuideContent: tab === "ux-ui-guide" ? resolved.ux.content : undefined,
    dbgaContent: tab === "benchmark" ? parts.finalDbga : undefined,
    phase0SummaryContent: tab === "phase0" ? resolved.phase0.content : undefined,
    specContent: resolved.spec.content,
    brdContent: resolved.brd.content,
    blueprintContent: resolved.blueprint.content,
    apiContractsContent: resolved.api.content,
    logicFlowsContent: resolved.flows.content,
    tasksContent: resolved.tasks.content,
    infraContent: resolved.infra.content,
    architectureContent: resolved.arch.content,
    useCasesContent: resolved.useCases.content,
    userStoriesContent: resolved.stories.content,
    documentAst: (dualMdd?.ast as Record<string, unknown> | undefined) ?? null,
    documentVersion: dualMdd?.ast
      ? ((dualMdd.ast as { metadata?: { patchVersion?: number } }).metadata?.patchVersion ?? 0)
      : null,
  };
}

export async function processSessionChatTurnOutcome(
  input: SessionChatTurnProcessInput,
  deps: SessionChatTurnRunnerDeps,
): Promise<SessionChatTurnOutcome> {
  const { safeResponse, parsed, activeTab, userMessage, llmUserPrompt, intentRoute, options } = input;
  const tab = activeTab;

  let {
    dualMdd,
    mddSplit,
    specSplit,
    brdSplit,
    blueSplit,
    apiSplit,
    flowsSplit,
    tasksSplit,
    infraSplit,
    archSplit,
    useCasesSplit,
    storiesSplit,
    hasMdd,
    hasUx,
    hasDbga,
    hasSpec,
    hasBrd,
    hasPhase0,
    hasBlue,
    hasApi,
    hasFlows,
    hasTasks,
    hasInfra,
    hasArch,
    hasUseCases,
    hasStories,
    uxDocPart,
    dbgaDocPart,
    phase0DocPart,
    rawChat,
  } = parsed;

  const effectiveUserMessage = llmUserPrompt.trim() || userMessage.trim();
  const heuristicsUserMsg = userMessageForDocHeuristics(userMessage, llmUserPrompt);
  const wantsDocumentEdit = wantsDocumentEditForTurn(intentRoute.action, activeTab, heuristicsUserMsg);
  const processDbga = wantsDbgaDocumentProcessing(
    wantsDocumentEdit ? "edit_document" : intentRoute.action,
    userMessage,
    llmUserPrompt,
  );

  const docFlagsBeforeGate: DocPersistFlags = {
    hasMdd,
    hasSpec,
    hasArch,
    hasUseCases,
    hasStories,
    hasBlue,
    hasApi,
    hasFlows,
    hasTasks,
    hasInfra,
    hasBrd,
    hasDbga,
    hasUx,
    hasPhase0,
  };
  const hadDelimiter = hadAnyDocumentDelimiter(docFlagsBeforeGate);
  const gatedFlags = applyIntentPersistGate(
    wantsDocumentEdit ? "edit_document" : intentRoute.action,
    docFlagsBeforeGate,
    tab,
  );
  hasMdd = Boolean(gatedFlags.hasMdd);
  hasSpec = Boolean(gatedFlags.hasSpec);
  hasArch = Boolean(gatedFlags.hasArch);
  hasUseCases = Boolean(gatedFlags.hasUseCases);
  hasStories = Boolean(gatedFlags.hasStories);
  hasBlue = Boolean(gatedFlags.hasBlue);
  hasApi = Boolean(gatedFlags.hasApi);
  hasFlows = Boolean(gatedFlags.hasFlows);
  hasTasks = Boolean(gatedFlags.hasTasks);
  hasInfra = Boolean(gatedFlags.hasInfra);
  hasBrd = Boolean(gatedFlags.hasBrd);
  hasDbga = Boolean(gatedFlags.hasDbga);
  hasUx = Boolean(gatedFlags.hasUx);
  hasPhase0 = Boolean(gatedFlags.hasPhase0);

  ({
    hasDbga,
    dbgaDocPart,
    rawChat,
  } = deps.finalizeBenchmarkTurn(tab, safeResponse, effectiveUserMessage, {
    hasDbga,
    dbgaDocPart,
    rawChat,
  }, wantsDocumentEdit));

  const mddResolved = await deps.resolveMddContentForReturn(
    effectiveUserMessage,
    { ...options, wantsDocumentEdit },
    hasMdd ? mddSplit!.mddPart : undefined,
    dualMdd?.markdown,
  );
  const finalMdd = mddResolved.content;
  let docRetried = mddResolved.retried;

  const finalDbga = await deps.resolveDbgaContentForReturn(
    effectiveUserMessage,
    { ...options, wantsDocumentEdit: processDbga },
    processDbga ? dbgaDocPart : undefined,
  );

  const specResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "spec",
    hasSpec,
    specSplit?.docPart,
    options?.currentSpecContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const brdResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "brd",
    hasBrd,
    brdSplit?.docPart,
    options?.currentBrdContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const blueprintResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "blueprint",
    hasBlue,
    blueSplit?.docPart,
    options?.currentBlueprintContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const apiResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "api-contracts",
    hasApi,
    apiSplit?.docPart,
    options?.currentApiContractsContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const flowsResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "logic-flows",
    hasFlows,
    flowsSplit?.docPart,
    options?.currentLogicFlowsContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const tasksResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "tasks",
    hasTasks,
    tasksSplit?.docPart,
    options?.currentTasksContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const infraResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "infra",
    hasInfra,
    infraSplit?.docPart,
    options?.currentInfraContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const archResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "architecture",
    hasArch,
    archSplit?.docPart,
    options?.currentArchitectureContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const useCasesResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "use-cases",
    hasUseCases,
    useCasesSplit?.docPart,
    options?.currentUseCasesContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const storiesResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "user-stories",
    hasStories,
    storiesSplit?.docPart,
    options?.currentUserStoriesContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const uxResolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "ux-ui-guide",
    hasUx,
    uxDocPart,
    options?.currentUxUiGuideContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );
  const phase0Resolved = await deps.resolveDeliverableContentForReturn(
    tab,
    "phase0",
    hasPhase0,
    phase0DocPart,
    options?.currentPhase0SummaryContent,
    effectiveUserMessage,
    wantsDocumentEdit,
  );

  docRetried =
    docRetried ||
    specResolved.retried ||
    brdResolved.retried ||
    blueprintResolved.retried ||
    apiResolved.retried ||
    flowsResolved.retried ||
    tasksResolved.retried ||
    infraResolved.retried ||
    archResolved.retried ||
    useCasesResolved.retried ||
    storiesResolved.retried ||
    uxResolved.retried ||
    phase0Resolved.retried;

  const parts: TabDocumentParts = {
    finalMdd,
    finalDbga,
    spec: specResolved.content,
    brd: brdResolved.content,
    blueprint: blueprintResolved.content,
    api: apiResolved.content,
    flows: flowsResolved.content,
    tasks: tasksResolved.content,
    infra: infraResolved.content,
    arch: archResolved.content,
    useCases: useCasesResolved.content,
    stories: storiesResolved.content,
    ux: uxResolved.content,
    phase0: phase0Resolved.content,
  };

  const documentPersisted = deps.computeTabDocumentPersisted(tab, parts);

  let assistantContent = deps.stripChatLabel(
    tab === "benchmark" ? benchmarkAssistantChatMessage(rawChat, finalDbga) : rawChat,
  );
  assistantContent = deps.maybeWarnOrchestratorDocNotPersisted(
    tab,
    heuristicsUserMsg,
    assistantContent,
    {
      hasMdd: Boolean(finalMdd),
      hasSpec: Boolean(specResolved.content),
      hasArch: Boolean(archResolved.content),
      hasUseCases: Boolean(useCasesResolved.content),
      hasStories: Boolean(storiesResolved.content),
      hasBlue: Boolean(blueprintResolved.content),
      hasApi: Boolean(apiResolved.content),
      hasFlows: Boolean(flowsResolved.content),
      hasTasks: Boolean(tasksResolved.content),
      hasInfra: Boolean(infraResolved.content),
      hasBrd: Boolean(brdResolved.content),
      hasDbga: Boolean(finalDbga),
      hasUx: Boolean(uxResolved.content),
      hasPhase0: Boolean(phase0Resolved.content),
    },
    options,
    documentPersisted,
    hadDelimiter,
  );

  return {
    activeTab: tab,
    dualMdd,
    mddSplit,
    infraSplit,
    uxDocPart,
    dbgaDocPart,
    hasMdd,
    hasInfra,
    hadDelimiter,
    docRetried,
    assistantContent,
    documentPersisted,
    parts,
    resolved: {
      spec: specResolved,
      brd: brdResolved,
      blueprint: blueprintResolved,
      api: apiResolved,
      flows: flowsResolved,
      tasks: tasksResolved,
      infra: infraResolved,
      arch: archResolved,
      useCases: useCasesResolved,
      stories: storiesResolved,
      ux: uxResolved,
      phase0: phase0Resolved,
    },
  };
}
