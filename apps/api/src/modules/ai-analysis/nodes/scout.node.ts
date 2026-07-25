/**
 * @fileoverview Utilidad del pipeline MDD/DBGA.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SCOUT_PROMPT } from "../prompts/load-prompts.js";
import {
  competitorDataSchema,
  type DBGAStateType,
} from "../state/index.js";
import { buildUserDeclaredStackPromptBlock } from "../utils/user-declared-stack.util.js";
import { z } from "zod";
import { parseJsonOrThrow } from "../utils/parse-json.js";

const scoutOutputSchema = z.object({
  domainClassification: z.string().optional(),
  competitors: z.array(competitorDataSchema).max(5),
});

const MAX_TOOL_LOOPS = 5;

function buildToolsByName(tools: StructuredToolInterface[]): Record<string, StructuredToolInterface> {
  const byName: Record<string, StructuredToolInterface> = {};
  for (const t of tools) byName[t.name] = t;
  return byName;
}

/** Creates the Scout (Market Scout) node with optional tools (Tavily + scrape_url). */
export function createScoutNode(
  llm: BaseChatModel,
  tools: StructuredToolInterface[] = []
) {
  const toolsByName = buildToolsByName(tools);
  const llmWithTools = llm.bindTools ? (tools.length > 0 ? llm.bindTools(tools) : llm) : llm;

  return async (state: DBGAStateType): Promise<Partial<DBGAStateType>> => {
    const query = state.refinedQuery?.trim() || state.rawIdea;
    let prompt = `${SCOUT_PROMPT}\n\n---\nIdea del usuario: ${query}`;
    if (state.userPreferences?.trim()) {
      prompt += `\n\n**HISTORIAL_DE_PREFERENCIAS (usa para alinear el benchmark; NO sustituyas stack que el usuario ya nombró en la idea):**\n${state.userPreferences.trim()}`;
    }
    const stackBlock = buildUserDeclaredStackPromptBlock(query, state.rawIdea);
    if (stackBlock) {
      prompt += `\n\n---\n${stackBlock}`;
    }
    const messages = [new HumanMessage(prompt)];

    let lastContent: string = "";
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

    if (!lastContent.trim()) {
      return { competitors: [], status: "researching" };
    }
    let competitors: z.infer<typeof scoutOutputSchema>["competitors"] = [];
    try {
      const parsed = parseJsonOrThrow(lastContent, scoutOutputSchema);
      competitors = parsed.competitors.slice(0, 5);
    } catch {
      // El modelo a veces responde en prosa (p. ej. saludo); no abortar todo el stream DBGA.
      competitors = [];
    }
    return {
      competitors,
      status: "researching",
    };
  };
}
