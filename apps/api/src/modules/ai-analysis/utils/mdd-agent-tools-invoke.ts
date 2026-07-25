/**
 * @fileoverview Invocación de herramientas estructuradas para agentes MDD.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
// bindTools existe en ChatOpenAI / ChatGoogle; el tipo base no siempre lo declara.
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

const MAX_TOOL_ROUNDS = 3;

/**
 * Una o más rondas tool-calling (ReAct ligero) para consultar Grafo SDD y/o TheForge.
 */
export async function runAgentToolsRound(
  llm: BaseChatModel,
  tools: StructuredToolInterface[],
  instruction: string,
): Promise<string> {
  if (!tools.length || !instruction.trim()) return "";
  const bindTools = (llm as { bindTools?: (t: StructuredToolInterface[]) => { invoke: (m: unknown) => Promise<AIMessage> } }).bindTools;
  if (typeof bindTools !== "function") return "(El modelo no soporta bindTools.)";
  const modelWithTools = bindTools.call(llm, tools);
  const human = new HumanMessage(
    `Instrucción: ${instruction.trim()}\n\nUsa las herramientas cuando necesites datos del grafo SDD o del código (TheForge). Resume hallazgos en español, conciso.`,
  );
  const messages: (HumanMessage | AIMessage | ToolMessage)[] = [human];
  let ai = (await modelWithTools.invoke(messages)) as AIMessage;

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
    ai = (await modelWithTools.invoke(messages)) as AIMessage;
  }
  const lastText = typeof ai.content === "string" ? ai.content : JSON.stringify(ai.content);
  return lastText.slice(0, 12000);
}
