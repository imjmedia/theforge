/**
 * @fileoverview Nodo ejecutor — despacha y coordina generación de secciones MDD.
 */

import { Command } from "@langchain/langgraph";
import type { MDDStateType } from "../state/index.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Executor] ${msg}`, ...args);

/**
 * Tope de saltos "mesh" (directiva interna → nodo anterior del plan) por plan.
 * Sin tope, Security/Integration podían emitir una directiva al Arquitecto en cada
 * pasada y el plan reejecutaba architect → format → security → … hasta `recursionLimit`
 * (GraphRecursionError → "Reanuda con un mensaje"). Un salto basta para aplicar la
 * corrección; la segunda directiva se registra y el plan sigue adelante.
 */
export const MAX_MESH_JUMPS_PER_PLAN = 1;

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
        update: { executorControlled: false, mddPlanCurrentStep: undefined, mddPlan: undefined, currentStepAllowedTools: undefined, currentStepGoal: undefined, meshJumpCount: undefined },
        goto: "manager",
      });
    }

    const nextStep = (state.mddPlanCurrentStep ?? -1) + 1;

    // Mesh Topology: Colaboración lateral.
    // Si el nodo que acaba de correr (ej. Security) dejó una directiva para un nodo anterior (ej. Software Architect),
    // el Executor puede volver atrás UNA vez por plan (MAX_MESH_JUMPS_PER_PLAN).
    const lastNode = state.mddPlanCurrentStep !== undefined && state.mddPlan ? state.mddPlan[state.mddPlanCurrentStep]?.node : null;
    const directives = state.internalDirectives ?? [];
    const meshJumps = state.meshJumpCount ?? 0;
    if (lastNode && directives.length > 0) {
      // Buscar si el último nodo envió algo a un nodo anterior en el plan
      const lastNodeDirectives = directives.filter(d => d.from === lastNode);
      for (const dir of lastNodeDirectives) {
        const targetNode = dir.to;
        const targetStepIdx = plan.findIndex((s, idx) => s.node === targetNode && idx < nextStep);
        if (targetStepIdx === -1) continue;
        if (meshJumps >= MAX_MESH_JUMPS_PER_PLAN) {
          LOG(
            "mesh topology: directiva de %s para %s ignorada (tope de %s salto(s) por plan alcanzado); el plan continúa",
            lastNode,
            targetNode,
            MAX_MESH_JUMPS_PER_PLAN,
          );
          break;
        }
        LOG("mesh topology: detectada directiva de %s para %s. Saltando atrás al paso %s (salto %s/%s)", lastNode, targetNode, targetStepIdx + 1, meshJumps + 1, MAX_MESH_JUMPS_PER_PLAN);
        const step = plan[targetStepIdx];
        return new Command({
          update: {
            mddPlanCurrentStep: targetStepIdx,
            currentStepAllowedTools: step.required_tools,
            currentStepGoal: `[DIRECTIVA DE ${lastNode.toUpperCase()}]: ${dir.message}`,
            // Consumimos las directivas para no entrar en bucle infinito
            internalDirectives: [],
            meshJumpCount: meshJumps + 1,
          },
          goto: step.node,
        });
      }
    }

    if (nextStep >= plan.length) {
      LOG("plan completado steps=%s, volver al manager", plan.length);
      return new Command({
        update: { executorControlled: false, mddPlanCurrentStep: undefined, mddPlan: undefined, currentStepAllowedTools: undefined, currentStepGoal: undefined, meshJumpCount: undefined },
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
        // Plan nuevo: el contador de saltos arranca en 0.
        ...(nextStep === 0 ? { meshJumpCount: 0 } : {}),
      },
      goto: step.node,
    });
  };
}
