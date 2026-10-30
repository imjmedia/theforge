/**
 * @fileoverview Nodo de aprobación de plan — presenta el plan para aprobación del usuario.
 */

import { Command, interrupt } from "@langchain/langgraph";
import type { MDDStateType } from "../state/index.js";
import { getLastSubstantiveUserMessage } from "../utils/mdd-user-brief.js";
import { planWillAutoApprove } from "./mdd-manager/manager-plan.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:PlanApproval] ${msg}`, ...args);

/**
 * Mensaje para aprobación del plan: pide revisar la lista de tareas y quién las ejecuta.
 */
function buildPlanSummaryMessage(impactSummary?: string): string {
  let msg = "Revisa la lista de tareas y quién las ejecuta. Confirma para ejecutar o escribe qué quieres cambiar.";
  if (impactSummary) {
    msg = `${impactSummary}\n\n---\n${msg}`;
  }
  return msg;
}

/**
 * Nodo HITL 4.4: interrumpe para aprobación del plan antes de ejecutar.
 * El mensaje muestra las actividades que cada agente ejecutará, no el último mensaje del usuario.
 * Al reanudar, interrupt() devuelve el mensaje del usuario y delegamos de vuelta al Manager.
 * Si el plan es trivial (1 paso, un solo agente escritor en `sections`, o `autoApprove` tras responder
 * preguntas), se ejecuta directo en el Executor sin interrumpir: el mismo update que aplica el Manager
 * cuando el usuario escribe "sí".
 */
export function createMddPlanApprovalNode() {
  return async (state: MDDStateType): Promise<Command> => {
    const pending = state.pendingPlanApproval;
    if (!pending?.mddPlan?.length) {
      LOG("sin pendingPlanApproval, volver al manager");
      return new Command({ goto: "manager" });
    }

    if (planWillAutoApprove(pending.mddPlan, pending.delegateTarget, pending.autoApprove)) {
      const reason =
        pending.autoApprove === true
          ? "tras responder preguntas"
          : pending.mddPlan.length <= 1
            ? "plan de 1 paso"
            : "un solo agente escritor";
      LOG("auto-aprobado (%s) mddPlanLen=%s goto=%s → executor", reason, pending.mddPlan.length, pending.goto);
      const directive = state.planUserIntent ?? getLastSubstantiveUserMessage(state);
      const { mddPlan, delegateTarget, sectionsToRun, previousMddDraftForMerge } = pending;
      return new Command({
        update: {
          lastUserMessage: undefined,
          requestQuestionsOnly: delegateTarget === "clarifier_only",
          lastStepFailed: undefined,
          mddPlan,
          delegateTarget,
          sectionsToRun,
          previousMddDraftForMerge,
          pendingPlanApproval: undefined,
          planUserIntent: undefined,
          impactSummary: undefined,
          executorControlled: true,
          mddPlanCurrentStep: undefined,
          architectCriticFeedback: undefined,
          architectCriticAttempts: undefined,
          ...(directive ? { acceptedProposalDirective: directive } : {}),
        },
        goto: "executor",
      });
    }

    const planMessage = buildPlanSummaryMessage(state.impactSummary);

    LOG("interrupt plan_approval mddPlanLen=%s", pending.mddPlan.length);
    const userResponse = interrupt({
      type: "plan_approval",
      plan: pending.mddPlan,
      message: planMessage,
      impactSummary: state.impactSummary,
    });
    const message = typeof userResponse === "string" ? userResponse : String(userResponse ?? "").trim();
    LOG("resume: usuario respondió (len=%s), volver al manager", message.length);
    return new Command({
      update: { lastUserMessage: message },
      goto: "manager",
    });
  };
}
