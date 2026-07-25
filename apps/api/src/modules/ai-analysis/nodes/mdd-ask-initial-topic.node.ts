/**
 * @fileoverview Nodo de consulta inicial — pregunta al usuario el tema/propósito del proyecto.
 */

import { Command, interrupt } from "@langchain/langgraph";
import type { MDDStateType } from "../state/index.js";

const INITIAL_QUESTION =
  "¿Sobre qué tema o problema necesitas el MDD? Indica, si puedes, el tipo de sistema (ej. app interna, SaaS, API pública) y requisitos clave (auth, roles, integraciones externas).";
const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:AskInitialTopic] ${msg}`, ...args);

/**
 * Caso de Uso 1 (Inicio de Proyecto): sin Bench ni MDD.
 * Primera invocación: marca askedInitialTopicQuestion y se re-invoca para interrumpir con la pregunta.
 * Al reanudar (usuario responde): acumula la respuesta y delega a Clarifier para Borrador v1.
 */
export function createMddAskInitialTopicNode() {
  return async (state: MDDStateType): Promise<Partial<MDDStateType> | Command> => {
    const asked = state.askedInitialTopicQuestion === true;

    if (!asked) {
      LOG("primera invocación: marcar askedInitialTopicQuestion y re-entrar");
      return new Command({
        update: { askedInitialTopicQuestion: true },
        goto: "ask_initial_topic",
      });
    }

    LOG("interrupt con pregunta inicial");
    const userAnswer = interrupt({ type: "questions", questions: [INITIAL_QUESTION] });
    const answerText = typeof userAnswer === "string" ? userAnswer : String(userAnswer ?? "").trim();
    const newAccumulated = answerText;
    const newDbgaContent = [state.dbgaContent?.trim(), `Tema/problema indicado por el usuario:\n${answerText}`].filter(Boolean).join("\n\n");
    LOG("resume: respuesta recibida, delegar a Clarifier");
    return new Command({
      update: {
        userInputAccumulated: newAccumulated,
        dbgaContent: newDbgaContent,
        askedInitialTopicQuestion: false,
        lastUserMessage: undefined,
        requestQuestionsOnly: false,
      },
      goto: "clarifier",
    });
  };
}
