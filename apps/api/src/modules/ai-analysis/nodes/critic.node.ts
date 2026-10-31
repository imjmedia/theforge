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

type CriticOutput = z.infer<typeof criticOutputSchema>;

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
    // Salida no parseable (prosa, JSON truncado): continuar a synthesis con lo que hay en vez de
    // reventar el stream DBGA. El tope de re-research lo aplica routeDbgaAfterCritic (criticIterations).
    let parsed: CriticOutput;
    try {
      parsed = parseJsonOrThrow(text, criticOutputSchema);
    } catch (err) {
      console.warn(
        `[DBGA:Critic] respuesta no parseable (${err instanceof Error ? err.message : String(err)}); continuando a synthesis`,
      );
      return {
        criticDecision: "synthesis",
        refinedQuery: undefined,
        criticIterations: (state.criticIterations ?? 0) + 1,
      };
    }
    return {
      criticDecision: parsed.criticDecision,
      refinedQuery: parsed.refinedQuery ?? undefined,
      criticIterations: (state.criticIterations ?? 0) + 1,
    };
  };
}
