/**
 * @fileoverview Turno final forzado tras agotar un bucle de tool-calling.
 *
 * Todos los nodos con `while (loopCount < MAX_TOOL_LOOPS)` pueden terminar con el último AIMessage
 * todavía pidiendo herramientas (o vacío). Antes eso se traducía en "sin respuesta" y un fallback
 * estructural / documento sin cambios. `forceFinalAnswer` pide al modelo una respuesta final sin
 * herramientas usando el contexto ya acumulado en `messages`.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

export const FINAL_ANSWER_INSTRUCTION =
  "No llames más herramientas. Con la información que ya tienes en esta conversación, responde AHORA con la salida final en el formato exacto que se te pidió (solo el JSON/markdown solicitado, sin explicaciones).";

/** Modelo con tools ya ligadas (resultado de `llm.bindTools(...)`) o el propio LLM base. */
export type ToolBoundLlm = {
  invoke: (messages: BaseMessage[], options?: Record<string, unknown>) => Promise<unknown>;
};

/** Texto de un mensaje: content string, o concatenación de los campos `text` si content es un array de partes. */
export function messageText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        const text = (part as { text?: unknown } | null | undefined)?.text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return "";
}

export function hasToolCalls(msg: unknown): boolean {
  const calls = (msg as AIMessage | null | undefined)?.tool_calls;
  return Array.isArray(calls) && calls.length > 0;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fuerza una respuesta final sin herramientas tras agotar el bucle de tools.
 * 1) Añade FINAL_ANSWER_INSTRUCTION como HumanMessage (muta `messages`).
 * 2) Intenta `llmWithTools.invoke(messages, { tool_choice: "none" })`; si lanza o la respuesta sigue
 *    trayendo tool_calls, 3) cae al LLM base `llm.invoke(messages)`.
 * Devuelve el texto ("" si nada utilizable). Nunca lanza.
 */
export async function forceFinalAnswer(
  llm: BaseChatModel,
  llmWithTools: ToolBoundLlm,
  messages: BaseMessage[],
  instruction: string = FINAL_ANSWER_INSTRUCTION,
): Promise<string> {
  try {
    messages.push(new HumanMessage(instruction));

    try {
      console.log("[ToolLoop] Forzando respuesta final sin herramientas (tool_choice: none)");
      const reply = await llmWithTools.invoke(messages, { tool_choice: "none" });
      const text = messageText(reply).trim();
      if (text && !hasToolCalls(reply)) {
        console.log(`[ToolLoop] Respuesta final obtenida con tool_choice none (${text.length} chars)`);
        return text;
      }
      console.log(`[ToolLoop] tool_choice none sin texto utilizable (tool_calls=${hasToolCalls(reply)}), fallback a LLM base`);
    } catch (err) {
      console.log(`[ToolLoop] tool_choice none falló: ${errorMessage(err)}. Fallback a LLM base`);
    }

    const base = await llm.invoke(messages);
    if (hasToolCalls(base)) {
      console.log("[ToolLoop] LLM base devolvió tool_calls tras forzar respuesta final; se descarta");
      return "";
    }
    const text = messageText(base).trim();
    console.log(`[ToolLoop] Respuesta final por LLM base (${text.length} chars)`);
    return text;
  } catch (err) {
    console.log(`[ToolLoop] No se pudo forzar respuesta final: ${errorMessage(err)}`);
    return "";
  }
}
