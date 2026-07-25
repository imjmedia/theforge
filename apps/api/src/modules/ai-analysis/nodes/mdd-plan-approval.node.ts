/**
 * @fileoverview Nodo de aprobación de plan — presenta el plan para aprobación del usuario.
 */

import { Command, interrupt } from "@langchain/langgraph";
import type { MDDStateType } from "../state/index.js";

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
 */
export function createMddPlanApprovalNode() {
  return async (state: MDDStateType): Promise<Command> => {
    const pending = state.pendingPlanApproval;
    if (!pending?.mddPlan?.length) {
      LOG("sin pendingPlanApproval, volver al manager");
      return new Command({ goto: "manager" });
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
