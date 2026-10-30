/**
 * @fileoverview Utilidad del pipeline MDD/DBGA.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { CRITIC_PROMPT } from "../prompts/load-prompts.js";
import { parseJsonOrThrow } from "../utils/parse-json.js";
import { criticDecisionSchema, type DBGAStateType } from "../state/index.js";
import { z } from "zod";

const criticOutputSchema = z.object({
  criticDecision: criticDecisionSchema,
  refinedQuery: z.string().optional().nullable(),
});

/** Creates the Critic (Validation) node. */
export function createCriticNode(llm: BaseChatModel) {
  return async (state: DBGAStateType): Promise<Partial<DBGAStateType>> => {
    const context = [
      `Idea del usuario: ${state.rawIdea}`,
      `Competidores encontrados (${state.competitors.length}):`,
      ...state.competitors.map((c) => `- ${c.name} (${c.url}) — UVP: ${c.uvp || "N/A"} — Relevancia declarada: ${c.relevance || "no especificada"}`),
      `Tech insights: ${state.techStackInsights.join("; ") || "ninguno"}`,
    ].join("\n");
    const prompt = `${CRITIC_PROMPT}\n\n---\n${context}`;
    const response = await llm.invoke([new HumanMessage(prompt)]);
    const text = typeof response.content === "string" ? response.content : "";
    const parsed = parseJsonOrThrow(text, criticOutputSchema);
    return {
      criticDecision: parsed.criticDecision,
      refinedQuery: parsed.refinedQuery ?? undefined,
      criticIterations: (state.criticIterations ?? 0) + 1,
    };
  };
}
