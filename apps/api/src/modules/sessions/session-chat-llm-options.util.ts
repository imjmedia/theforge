import type { GenerateResponseOptions } from "../ai/interfaces/llm-provider.interface.js";
import type { IntentRouteResult } from "../ai/intent-route.types.js";
import type { ChatImagePart, WorkshopChatScope } from "@theforge/shared-types";

/** Opciones de turno compartidas por `SessionsService.chat` y `chatStream`. */
export type SessionChatTurnOptions = {
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
  activeTab?: string;
  systemPrompt?: string;
  stageId?: string;
  /** `stage` = solo mensajes de `stageId`; `global` = historial completo del tab. */
  chatScope?: WorkshopChatScope;
  complexityInterviewContext?: string;
  projectTypeForUxGuide?: GenerateResponseOptions["projectTypeForUxGuide"];
  uxGuideAdditionalDocs?: GenerateResponseOptions["uxGuideAdditionalDocs"];
  uxGuideDesignRef?: GenerateResponseOptions["uxGuideDesignRef"];
  uxGuideDesignRefPromptBlock?: GenerateResponseOptions["uxGuideDesignRefPromptBlock"];
  uxGuideDesignRefEffectiveSlug?: GenerateResponseOptions["uxGuideDesignRefEffectiveSlug"];
  uxGuideDesignRefMode?: GenerateResponseOptions["uxGuideDesignRefMode"];
  userImages?: ChatImagePart[];
};

export function buildSessionChatGenerateOptions(
  options: SessionChatTurnOptions | undefined,
  ctx: {
    intent: IntentRouteResult["intent"];
    learningHistory?: string;
    userMessageImages?: GenerateResponseOptions["userMessageImages"];
    /** Cuando se proporciona, persiste uso de tokens para este proyecto/etapa. */
    telemetryContext?: GenerateResponseOptions["telemetryContext"];
  },
): GenerateResponseOptions {
  return {
    currentMddContent: options?.currentMddContent,
    currentDbgaContent: options?.currentDbgaContent,
    currentUxUiGuideContent: options?.currentUxUiGuideContent,
    currentPhase0SummaryContent: options?.currentPhase0SummaryContent,
    currentBlueprintContent: options?.currentBlueprintContent,
    currentSpecContent: options?.currentSpecContent,
    currentBrdContent: options?.currentBrdContent,
    currentArchitectureContent: options?.currentArchitectureContent,
    currentUseCasesContent: options?.currentUseCasesContent,
    currentUserStoriesContent: options?.currentUserStoriesContent,
    currentApiContractsContent: options?.currentApiContractsContent,
    currentLogicFlowsContent: options?.currentLogicFlowsContent,
    currentTasksContent: options?.currentTasksContent,
    currentInfraContent: options?.currentInfraContent,
    activeTab: options?.activeTab,
    intent: ctx.intent,
    learningHistory: ctx.learningHistory,
    systemPrompt: options?.systemPrompt,
    complexityInterviewContext: options?.complexityInterviewContext,
    projectTypeForUxGuide: options?.projectTypeForUxGuide,
    uxGuideAdditionalDocs: options?.uxGuideAdditionalDocs,
    uxGuideDesignRef: options?.uxGuideDesignRef,
    uxGuideDesignRefPromptBlock: options?.uxGuideDesignRefPromptBlock,
    uxGuideDesignRefEffectiveSlug: options?.uxGuideDesignRefEffectiveSlug,
    uxGuideDesignRefMode: options?.uxGuideDesignRefMode,
    userMessageImages: ctx.userMessageImages,
    telemetryContext: ctx.telemetryContext,
  };
}
