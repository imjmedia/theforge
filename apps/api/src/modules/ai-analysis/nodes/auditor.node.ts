/**
 * @fileoverview Utilidad del pipeline MDD/DBGA.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { AUDITOR_PROMPT } from "../prompts/load-prompts.js";
import type { DBGAStateType } from "../state/index.js";
import { z } from "zod";

const auditorOutputSchema = z.object({
  techStackInsights: z.array(z.string()).max(10),
});

const MAX_TOOL_LOOPS = 5;

function buildToolsByName(tools: StructuredToolInterface[]): Record<string, StructuredToolInterface> {
  const byName: Record<string, StructuredToolInterface> = {};
  for (const t of tools) byName[t.name] = t;
  return byName;
}

/** Creates the Auditor (Tech Auditor) node with optional tools (e.g. scrape_url). */
export function createAuditorNode(
  llm: BaseChatModel,
  tools: StructuredToolInterface[] = []
) {
  const toolsByName = buildToolsByName(tools);
  const llmWithTools = llm.bindTools ? (tools.length > 0 ? llm.bindTools(tools) : llm) : llm;

  return async (state: DBGAStateType): Promise<Partial<DBGAStateType>> => {
    const context = [
      `Idea: ${state.rawIdea}`,
      state.competitors.length > 0
        ? `Competidores: ${state.competitors.map((c) => `${c.name} (${c.url})`).join(", ")}`
        : "Sin competidores aún.",
    ].join("\n");
    const prompt = `${AUDITOR_PROMPT}\n\n---\n${context}`;
    const messages = [new HumanMessage(prompt)];

    let lastContent = "";
    let loopCount = 0;

    while (loopCount < MAX_TOOL_LOOPS) {
      const response = await llmWithTools.invoke(messages);
      const aiMsg = response as AIMessage;
      lastContent = typeof aiMsg.content === "string" ? aiMsg.content : "";

      const toolCalls = aiMsg.tool_calls ?? [];
      if (toolCalls.length === 0) break;

      const toolMessages: ToolMessage[] = [];
      for (const tc of toolCalls) {
        const tool = toolsByName[tc.name];
        const toolCallId = tc.id ?? `tc-${loopCount}-${tc.name}`;
        if (!tool) {
          toolMessages.push(
            new ToolMessage({
              content: `Unknown tool: ${tc.name}`,
              tool_call_id: toolCallId,
              status: "error",
            })
          );
          continue;
        }
        const result = await tool.invoke(tc);
        const msg = result instanceof ToolMessage ? result : new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: toolCallId,
        });
        toolMessages.push(msg);
      }

      messages.push(aiMsg, ...toolMessages);
      loopCount++;
    }

    const stripped = lastContent.replace(/^```json?\s*|\s*```$/g, "").trim();
    let techStackInsights: string[] = [];
    if (stripped) {
      try {
        const parsed = auditorOutputSchema.parse(JSON.parse(stripped) as unknown);
        techStackInsights = parsed.techStackInsights ?? [];
      } catch {
        // Fallback si el modelo no devolvió JSON válido
      }
    }
    return {
      techStackInsights,
      status: "analyzing",
    };
  };
}
