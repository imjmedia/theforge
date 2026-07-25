/**
 * @fileoverview Nodo ejecutor — despacha y coordina generación de secciones MDD.
 */

import { Command } from "@langchain/langgraph";
import type { MDDStateType } from "../state/index.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Executor] ${msg}`, ...args);

/**
 * Nodo Executor (patrón Planner–Executor): ejecuta el plan paso a paso.
 * Recibe mddPlan y mddPlanCurrentStep; invoca el nodo del paso actual y setea currentStepAllowedTools (4.3).
 * Cuando cada nodo termina, el grafo vuelve aquí (si executorControlled); avanzamos el paso o finalizamos.
 */
export function createMddExecutorNode() {
  return async (state: MDDStateType): Promise<Command> => {
    const plan = state.mddPlan;
    LOG("[DIAG] plan steps=%s currentStep=%s executorControlled=%s nodes=%s",
      plan?.length ?? 0,
      state.mddPlanCurrentStep ?? "none",
      state.executorControlled,
      plan?.map((s) => s.node).join(",") ?? "none",
    );
    if (!plan?.length) {
      LOG("sin plan, volver al manager");
      return new Command({
        update: { executorControlled: false, mddPlanCurrentStep: undefined, mddPlan: undefined, currentStepAllowedTools: undefined, currentStepGoal: undefined },
        goto: "manager",
      });
    }

    const nextStep = (state.mddPlanCurrentStep ?? -1) + 1;

    // Mesh Topology: Colaboración lateral.
    // Si el nodo que acaba de correr (ej. Security) dejó una directiva para un nodo anterior (ej. Software Architect),
    // y no estamos ya en un bucle infinito, el Executor puede decidir volver atrás.
    const lastNode = state.mddPlanCurrentStep !== undefined && state.mddPlan ? state.mddPlan[state.mddPlanCurrentStep]?.node : null;
    const directives = state.internalDirectives ?? [];
    if (lastNode && directives.length > 0) {
      // Buscar si el último nodo envió algo a un nodo anterior en el plan
      const lastNodeDirectives = directives.filter(d => d.from === lastNode);
      if (lastNodeDirectives.length > 0) {
        for (const dir of lastNodeDirectives) {
          const targetNode = dir.to;
          const targetStepIdx = plan.findIndex((s, idx) => s.node === targetNode && idx < nextStep);
          if (targetStepIdx !== -1) {
            // Encontrado un salto atrás válido. 
            // Para evitar bucles infinitos, podríamos verificar si ya saltamos por esta directiva, 
            // pero por simplicidad permitiremos un salto si el mensaje es "nuevo" o si el goal lo justifica.
            LOG("mesh topology: detectada directiva de %s para %s. Saltando atrás al paso %s", lastNode, targetNode, targetStepIdx + 1);
            const step = plan[targetStepIdx];
            return new Command({
              update: {
                mddPlanCurrentStep: targetStepIdx,
                currentStepAllowedTools: step.required_tools,
                currentStepGoal: `[DIRECTIVA DE ${lastNode.toUpperCase()}]: ${dir.message}`,
                // Consumimos las directivas para no entrar en bucle infinito
                internalDirectives: [],
              },
              goto: step.node,
            });
          }
        }
      }
    }

    if (nextStep >= plan.length) {
      LOG("plan completado steps=%s, volver al manager", plan.length);
      return new Command({
        update: { executorControlled: false, mddPlanCurrentStep: undefined, mddPlan: undefined, currentStepAllowedTools: undefined, currentStepGoal: undefined },
        goto: "manager",
      });
    }

    const step = plan[nextStep];
    LOG("ejecutar paso %s/%s node=%s required_tools=%s goal=%s", nextStep + 1, plan.length, step.node, step.required_tools?.length ?? "all", step.goal ? "yes" : "no");
    return new Command({
      update: {
        mddPlanCurrentStep: nextStep,
        currentStepAllowedTools: step.required_tools,
        currentStepGoal: step.goal,
        internalDirectives: [], // Consumir directivas en cada transición
      },
      goto: step.node,
    });
  };
}
