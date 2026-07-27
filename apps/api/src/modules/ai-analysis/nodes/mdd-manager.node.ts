/**
 * @fileoverview Nodo manager — orquesta el pipeline completo de generación MDD.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Command } from "@langchain/langgraph";
import type { LivePrecisionCalculator } from "../estimation/estimation.types.js";
import type { MDDStateType } from "../state/index.js";
import { hasRealBenchmark, LOG, mddHasContent } from "./mdd-manager/manager-context.util.js";
import { handleManagerDelegateOutcome } from "./mdd-manager/manager-delegate.js";
import { runManagerLlmTurn } from "./mdd-manager/manager-llm-turn.js";
import { runDeterministicManagerHandlers } from "./mdd-manager/manager-state-handlers.js";
import type { MddManagerToolDeps } from "./mdd-manager/manager-types.js";

export { expandSectionsToRun } from "./mdd-manager/manager-plan.js";
export type { ExpandSectionsToRunOptions } from "./mdd-manager/manager-plan.js";
export type { MddManagerToolDeps } from "./mdd-manager/manager-types.js";

/**
 * Manager como Entrevistador de Estados (no pasapapeles).
 * Caso 1: Sin Bench ni MDD → no delegar; pregunta "¿Sobre qué tema o problema necesitas el MDD?"; al responder delega a agentes para v1; luego bucle refinamiento (preguntas del Clarifier).
 * Caso 2: MDD con contenido pero score < 85% → Manager asigna gaps a agentes; >= 85% cede al usuario.
 * Caso 3: Existe dbgaContent → delegar de inmediato a especialistas para v1; luego bucle refinamiento.
 * Done solo si Auditor >= 85% o usuario pide parar (umbral 85 = ceder intervención al usuario).
 * Si se pasa precisionCalculator, el % mostrado coincide con el semáforo (calculateLiveMetrics sobre mddDraft).
 */
export function createMddManagerNode(
  llm: BaseChatModel,
  precisionCalculator?: LivePrecisionCalculator | null,
  toolDeps?: MddManagerToolDeps | null,
) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType> | Command> => {
    const userMessage = (state.lastUserMessage ?? "").trim();
    const score = state.auditorScore ?? 0;
    const iteration = state.mddIteration ?? 0;
    LOG("entry lastUserMessage=%s mddDraftLen=%s auditorScore=%s", userMessage.slice(0, 80), (state.mddDraft ?? "").length, score);

    const deterministic = await runDeterministicManagerHandlers({
      state,
      llm,
      precisionCalculator,
      userMessage,
      score,
      iteration,
    });
    if (deterministic) return deterministic;

    const hasBench = hasRealBenchmark(state);
    const hasDraft = mddHasContent(state);
    const turn = await runManagerLlmTurn({
      llm,
      toolDeps,
      state,
      userMessage,
      hasBench,
      hasDraft,
    });
    return handleManagerDelegateOutcome({ state, llm, userMessage, hasDraft, turn });
  };
}
