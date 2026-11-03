/**
 * @fileoverview Invocación de herramientas estructuradas para agentes MDD.
 *
 * Cada llamada al LLM de la ronda se acota con el presupuesto del turno que recibe del caller (el Manager):
 * si no queda holgura (`MIN_AGENT_TOOLS_STAGE_BUDGET_MS`) no se invoca y la ronda lo informa con
 * `budgetExhausted`, para que el caller delegue en vez de seguir buscando.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
// bindTools existe en ChatOpenAI / ChatGoogle; el tipo base no siempre lo declara.
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { FINAL_ANSWER_INSTRUCTION, hasToolCalls, messageText, type ToolBoundLlm } from "./tool-loop.js";
import { deriveLlmIdentity, invokeLlmWithRetry, type InvokableLlm } from "./mdd-llm-retry.util.js";
import { resolveLlmTimeoutMs } from "./mdd-llm-timeout.util.js";

const MAX_TOOL_ROUNDS = 3;
const NO_RESPONSE_TEXT = "(Sin respuesta del modelo en la ronda de herramientas.)";

/** Holgura mínima (ms) para lanzar una llamada de la ronda; por debajo no se invoca. */
export const MIN_AGENT_TOOLS_STAGE_BUDGET_MS = 15_000;

/** Presupuesto del turno que consume la ronda: mismo reloj que el turno del caller. */
export type AgentToolsBudget = {
  /** Instante (ms, en el reloj `now`) en que expira el turno. */
  deadlineAt: number;
  /** Reloj inyectable (default `Date.now`); pensado para pruebas. */
  now?: () => number;
};

export type AgentToolsRoundResult = {
  /** Resumen de las herramientas (vacío si no se llegó a obtener respuesta). */
  text: string;
  /**
   * true si no quedaba presupuesto para otra llamada. El caller debe delegar (fallback) en vez de
   * tratar `text` como un resultado completo.
   */
  budgetExhausted: boolean;
};

function budgetLeftMs(budget: AgentToolsBudget | undefined): number {
  if (!budget) return Number.POSITIVE_INFINITY;
  return Math.max(0, budget.deadlineAt - (budget.now ?? Date.now)());
}

function hasStageBudget(budget: AgentToolsBudget | undefined): boolean {
  return budgetLeftMs(budget) >= MIN_AGENT_TOOLS_STAGE_BUDGET_MS;
}

/**
 * Una llamada del LLM de la ronda: sin streaming, un solo intento, tope = min(restante del turno, timeout LLM).
 * Devuelve `null` si la llamada falla o se agota el tiempo. Una cancelación externa se propaga como `AbortError`.
 * El caller comprueba `hasStageBudget` antes de llamar.
 */
async function invokeToolsStage(
  llm: BaseChatModel,
  runnable: ToolBoundLlm | BaseChatModel,
  messages: BaseMessage[],
  budget: AgentToolsBudget | undefined,
  tag: string,
): Promise<AIMessage | null> {
  const response = await invokeLlmWithRetry(runnable as unknown as InvokableLlm, messages, {
    tag,
    maxAttempts: 1,
    disableStreaming: true,
    timeoutMs: Math.min(budgetLeftMs(budget), resolveLlmTimeoutMs()),
    // Un paso intermedio puede venir solo con tool_calls y sin texto: es una respuesta válida.
    acceptToolCallsWithoutContent: true,
    identityOverride: deriveLlmIdentity(llm),
  });
  return (response ?? null) as AIMessage | null;
}

/**
 * Respuesta final sin herramientas tras agotar las rondas. Igual que `forceFinalAnswer` (tool_choice none y
 * luego el LLM base), pero cada llamada va acotada por el presupuesto: `forceFinalAnswer` no admite timeout.
 */
async function forceFinalWithinBudget(
  llm: BaseChatModel,
  modelWithTools: ToolBoundLlm,
  messages: BaseMessage[],
  budget: AgentToolsBudget | undefined,
): Promise<AgentToolsRoundResult> {
  messages.push(new HumanMessage(FINAL_ANSWER_INSTRUCTION));
  const noTools: ToolBoundLlm = {
    invoke: (msgs, opts) => modelWithTools.invoke(msgs, { ...opts, tool_choice: "none" }),
  };
  const candidates: Array<[string, ToolBoundLlm | BaseChatModel]> = [
    ["ToolsFinal", noTools],
    ["ToolsFinalBase", llm],
  ];
  for (const [tag, runnable] of candidates) {
    if (!hasStageBudget(budget)) return { text: "", budgetExhausted: true };
    const reply = await invokeToolsStage(llm, runnable, messages, budget, tag);
    if (!reply) continue;
    const text = messageText(reply).trim();
    if (text && !hasToolCalls(reply)) return { text: text.slice(0, 12000), budgetExhausted: false };
  }
  return { text: "", budgetExhausted: !hasStageBudget(budget) };
}

/**
 * Una o más rondas tool-calling (ReAct ligero) para consultar Grafo SDD y/o TheForge.
 *
 * `budget` (opcional) es el presupuesto del turno del caller: antes de cada llamada al LLM se comprueba la
 * holgura. Sin `budget` no hay tope de turno, pero cada llamada sigue acotada por el timeout del LLM.
 */
export async function runAgentToolsRound(
  llm: BaseChatModel,
  tools: StructuredToolInterface[],
  instruction: string,
  budget?: AgentToolsBudget,
): Promise<AgentToolsRoundResult> {
  if (!tools.length || !instruction.trim()) return { text: "", budgetExhausted: false };
  if (!hasStageBudget(budget)) return { text: "", budgetExhausted: true };
  const bindTools = (llm as { bindTools?: (t: StructuredToolInterface[]) => ToolBoundLlm }).bindTools;
  if (typeof bindTools !== "function") return { text: "(El modelo no soporta bindTools.)", budgetExhausted: false };
  const modelWithTools = bindTools.call(llm, tools);
  const human = new HumanMessage(
    `Instrucción: ${instruction.trim()}\n\nUsa las herramientas cuando necesites datos del grafo SDD o del código (TheForge). Resume hallazgos en español, conciso.`,
  );
  const messages: BaseMessage[] = [human];
  let ai = await invokeToolsStage(llm, modelWithTools, messages, budget, "ToolsRound");
  if (!ai) return { text: NO_RESPONSE_TEXT, budgetExhausted: !hasStageBudget(budget) };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (!ai.tool_calls?.length) break;
    messages.push(ai);
    for (const tc of ai.tool_calls) {
      const name = tc.name;
      const args = (tc.args ?? {}) as Record<string, unknown>;
      const tool = tools.find((t) => t.name === name);
      let out: string;
      try {
        out = tool ? await tool.invoke(args) : `Tool desconocida: ${name}`;
      } catch (e) {
        out = `Error en tool ${name}: ${e instanceof Error ? e.message : String(e)}`;
      }
      const id = tc.id ?? `call_${name}_${round}`;
      messages.push(
        new ToolMessage({
          content: typeof out === "string" ? out : JSON.stringify(out),
          tool_call_id: id,
        }),
      );
    }
    // Las herramientas pueden haber consumido el tiempo: sin holgura no se vuelve a invocar al LLM.
    if (!hasStageBudget(budget)) return { text: "", budgetExhausted: true };
    ai = await invokeToolsStage(llm, modelWithTools, messages, budget, "ToolsRound");
    if (!ai) return { text: NO_RESPONSE_TEXT, budgetExhausted: !hasStageBudget(budget) };
  }
  // Rondas agotadas con tool_calls pendientes: turno final forzado sin tools con lo ya recopilado.
  // No se añade `ai` (petición de tools sin sus ToolMessages): `messages` termina en los resultados
  // de la última ronda ejecutada, que es un historial válido para cualquier proveedor.
  if (ai.tool_calls?.length) {
    return forceFinalWithinBudget(llm, modelWithTools, messages, budget);
  }
  const lastText = typeof ai.content === "string" ? ai.content : JSON.stringify(ai.content);
  return { text: lastText.slice(0, 12000), budgetExhausted: false };
}
