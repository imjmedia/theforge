/** Post-procesamiento de la decisión LLM del Manager (reply interrupt o delegate). */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Command, interrupt } from "@langchain/langgraph";
import type { MDDStateType } from "../../state/index.js";
import { getPlanDirective, getUserBrief } from "../../utils/mdd-user-brief.js";
import { generateImpactAnalysis } from "../../utils/mdd-impact-analysis.js";
import { detectLegacyIntegrationIntent, HANDOFF_SPEC_SUGGESTION } from "../../utils/integration-intent.util.js";
import { LOG } from "./manager-context.util.js";
import { buildMddPlan, generateMddPlanWithLLM } from "./manager-plan.js";
import type { ManagerLlmTurnResult } from "./manager-llm-turn.js";

export type ManagerDelegateContext = {
  state: MDDStateType;
  llm: BaseChatModel;
  userMessage: string;
  hasDraft: boolean;
  turn: ManagerLlmTurnResult;
};

export async function handleManagerDelegateOutcome(ctx: ManagerDelegateContext): Promise<Command> {
  const { state, llm, userMessage, hasDraft } = ctx;
  let { action, replyContent, delegateTarget, sectionsToRun } = ctx.turn;

  if (action === "reply") {
    // Prepared hook: surface IntegrationAgent (handoff-spec) when a legacy integration need is detected.
    if (
      state.isLegacyProject === true &&
      detectLegacyIntegrationIntent(userMessage) &&
      !replyContent.includes("Sincronizar Especificación de Handoff")
    ) {
      replyContent = `${replyContent ?? ""}${HANDOFF_SPEC_SUGGESTION}`.trim();
    }
    LOG("interrupt reply");
    const resumeValue = interrupt({ type: "reply", reply: replyContent });
    const newMsg = typeof resumeValue === "string" ? resumeValue : String(resumeValue ?? "").trim();
    const accumulatedWithReply = [state.userInputAccumulated?.trim(), userMessage ? `Usuario: ${userMessage}` : ""].filter(Boolean).join("\n\n---\n\n");
    return new Command({
      update: {
        lastUserMessage: newMsg,
        userInputAccumulated: accumulatedWithReply || state.userInputAccumulated,
      },
      goto: "manager",
    });
  }
  
  const accumulatedWithRequest = [state.userInputAccumulated?.trim(), userMessage ? `Petición: ${userMessage}` : ""].filter(Boolean).join("\n\n---\n\n");
  const dbgaWithRequest = [state.dbgaContent?.trim(), userMessage ? `Petición: ${userMessage}` : ""].filter(Boolean).join("\n\n");
  const baseUpdate = {
    userInputAccumulated: accumulatedWithRequest || state.userInputAccumulated,
    dbgaContent: dbgaWithRequest || state.dbgaContent,
    lastUserMessage: undefined,
    requestQuestionsOnly: false,
    lastStepFailed: undefined,
  };
  
  const planDirective = getPlanDirective(state);
  let mddPlan = await generateMddPlanWithLLM(llm, state, delegateTarget, sectionsToRun);
  if (!mddPlan.length) {
    LOG("plan generado por LLM vacío o inválido, usando buildMddPlan");
    mddPlan = buildMddPlan(delegateTarget, sectionsToRun, getUserBrief(state), planDirective, state.mddComplexity);
  } else {
    LOG("plan generado por LLM steps=%s", mddPlan.length);
  }
  
  // HITL 4.4: delegar al nodo plan_approval para interrumpir y mostrar el plan al usuario.
  if (mddPlan.length > 0) {
    let gotoNode: string;
    let previousMddDraftForMerge: string | undefined;
    if (delegateTarget === "sections" && sectionsToRun?.length) {
      gotoNode = sectionsToRun[0];
    } else if (delegateTarget === "clarifier_only" && hasDraft) {
      gotoNode = "clarifier";
      previousMddDraftForMerge = state.mddDraft ?? "";
    } else {
      gotoNode = "clarifier";
    }
    LOG("delegar a plan_approval mddPlanLen=%s goto=%s", mddPlan.length, gotoNode);
    const impactSummary = await generateImpactAnalysis(llm, state, userMessage || planDirective || "Re-planificación");
    return new Command({
      update: {
        pendingPlanApproval: {
          mddPlan,
          delegateTarget: delegateTarget ?? "full_pipeline",
          sectionsToRun,
          previousMddDraftForMerge,
          goto: gotoNode,
        },
        planUserIntent: planDirective,
        impactSummary,
      },
      goto: "plan_approval",
    });
  }
  
  // Delegar solo a los agentes indicados (sections) sin pasar por Clarifier (sin plan aprobación).
  if (delegateTarget === "sections" && sectionsToRun?.length) {
    LOG("delegate -> sections first=%s mddPlanLen=%s", sectionsToRun[0], mddPlan.length);
    return new Command({
      update: {
        ...baseUpdate,
        delegateTarget: "sections",
        sectionsToRun,
        mddPlan,
      },
      goto: sectionsToRun[0],
    });
  }
  
  // Delegar solo contexto y alcance (Clarifier + merge sección 1).
  if (delegateTarget === "clarifier_only" && hasDraft) {
    LOG("delegate -> clarifier_only mddPlanLen=%s", mddPlan.length);
    return new Command({
      update: {
        ...baseUpdate,
        delegateTarget: "clarifier_only",
        previousMddDraftForMerge: state.mddDraft ?? "",
        mddPlan,
      },
      goto: "clarifier",
    });
  }
  
  // Pipeline completo: Clarifier → ... → Auditor → Manager.
  LOG("delegate -> clarifier (full pipeline) mddPlanLen=%s", mddPlan.length);
  return new Command({
    update: {
      ...baseUpdate,
      delegateTarget: undefined,
      sectionsToRun: undefined,
      mddPlan,
    },
    goto: "clarifier",
  });
}
