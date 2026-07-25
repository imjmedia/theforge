/**
 * @fileoverview Utilidad del pipeline MDD/DBGA.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { SYNTHESIS_PROMPT } from "../prompts/load-prompts.js";
import type { DBGAStateType } from "../state/index.js";
import { buildUserDeclaredStackPromptBlock } from "../utils/user-declared-stack.util.js";

/** Creates the Synthesis (Gap Analysis) node. */
export function createSynthesisNode(llm: BaseChatModel) {
  return async (state: DBGAStateType): Promise<Partial<DBGAStateType>> => {
    const context = [
      `Idea del usuario: ${state.rawIdea}`,
      "Competidores identificados:",
      ...state.competitors.map(
        (c) =>
          `- ${c.name} (${c.url})${c.uvp ? ` — UVP: ${c.uvp}` : ""}${c.pricing ? ` — Precio: ${c.pricing}` : ""}${c.relevance ? ` — Relevancia: ${c.relevance}` : ""}`,
      ),
      "Tech stack observado:",
      ...state.techStackInsights.map((s) => `- ${s}`),
      state.userPainPoints.length > 0
        ? `Pain points del usuario: ${state.userPainPoints.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const stackBlock = buildUserDeclaredStackPromptBlock(state.rawIdea);
    const prompt = `${SYNTHESIS_PROMPT}\n\n---\n${context}${stackBlock ? `\n\n---\n${stackBlock}` : ""}`;
    const response = await llm.invoke([new HumanMessage(prompt)]);
    const gapAnalysis = typeof response.content === "string" ? response.content.trim() : "";
    return {
      gapAnalysis: gapAnalysis || "# Domain Benchmark & Gap Analysis\n\n(Sin contenido generado.)",
      status: "finalizing",
    };
  };
}
