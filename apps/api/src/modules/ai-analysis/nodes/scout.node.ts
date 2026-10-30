/**
 * @fileoverview Utilidad del pipeline MDD/DBGA.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SCOUT_PROMPT } from "../prompts/load-prompts.js";
import {
  competitorDataSchema,
  type CompetitorData,
  type DBGAStateType,
} from "../state/index.js";
import { buildUserDeclaredStackPromptBlock } from "../utils/user-declared-stack.util.js";
import { z } from "zod";
import { extractFirstJsonObject } from "../utils/parse-json.js";
import { forceFinalAnswer } from "../utils/tool-loop.js";

/** Forma esperada de la salida del Scout (sin tope en el schema: el recorte a MAX_COMPETITORS se hace con slice). */
const scoutOutputSchema = z.object({
  domainClassification: z.string().optional(),
  competitors: z.array(competitorDataSchema),
});

type ScoutOutput = z.infer<typeof scoutOutputSchema>;

const MAX_TOOL_LOOPS = 5;
const MAX_COMPETITORS = 5;

/** Añade https:// a URLs de dominio sin protocolo (p. ej. "acme.com/pricing"). */
export function normalizeCompetitorUrl(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function normalizeCompetitor(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const item = raw as Record<string, unknown>;
  return { ...item, url: normalizeCompetitorUrl(item.url) };
}

export type ParsedScoutCompetitors = {
  competitors: CompetitorData[];
  /** Competidores descartados por datos inválidos (p. ej. URL no verificable). */
  dropped: number;
  /** Primer motivo de descarte, para log. */
  firstIssue: string;
  /** false si el texto no contenía un objeto JSON parseable. */
  parsed: boolean;
};

/**
 * Parseo tolerante de la salida del Scout: un competidor con URL inválida ya no invalida
 * toda la ronda (antes `schema.parse` lanzaba y se perdían todos). Nunca lanza.
 */
export function parseScoutCompetitors(text: string, maxCompetitors = MAX_COMPETITORS): ParsedScoutCompetitors {
  const empty: ParsedScoutCompetitors = { competitors: [], dropped: 0, firstIssue: "", parsed: false };
  const stripped = (text ?? "").replace(/^```json?\s*|\s*```$/g, "").trim();
  if (!stripped) return empty;

  let raw: unknown;
  try {
    const json = extractFirstJsonObject(stripped);
    if (!json) return empty;
    raw = JSON.parse(json) as unknown;
  } catch {
    return empty;
  }

  const obj = (raw ?? {}) as Partial<ScoutOutput>;
  const rawList: unknown[] = Array.isArray(obj.competitors) ? obj.competitors : [];

  const competitors: CompetitorData[] = [];
  let dropped = 0;
  let firstIssue = "";
  for (const item of rawList) {
    const result = competitorDataSchema.safeParse(normalizeCompetitor(item));
    if (result.success) {
      competitors.push(result.data);
      continue;
    }
    dropped++;
    if (!firstIssue) {
      const issue = result.error.issues[0];
      firstIssue = issue ? `${issue.path.join(".")}: ${issue.message}` : "dato inválido";
    }
  }
  return { competitors: competitors.slice(0, maxCompetitors), dropped, firstIssue, parsed: true };
}

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
    let lastHadToolCalls = false;
    let loopCount = 0;

    while (loopCount < MAX_TOOL_LOOPS) {
      const response = await llmWithTools.invoke(messages);
      const aiMsg = response as AIMessage;
      lastContent = typeof aiMsg.content === "string" ? aiMsg.content : "";

      const toolCalls = aiMsg.tool_calls ?? [];
      lastHadToolCalls = toolCalls.length > 0;
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

    // Sin texto final, o bucle agotado con tool_calls pendientes: pedir respuesta final sin tools.
    if (!lastContent.trim() || lastHadToolCalls) {
      lastContent = await forceFinalAnswer(llm, llmWithTools, messages);
    }

    if (!lastContent.trim()) {
      console.warn("[DBGA:Scout] sin respuesta final del LLM; sin competidores en esta ronda");
      return { competitors: [], status: "researching" };
    }
    // El modelo a veces responde en prosa (p. ej. saludo) o con un competidor mal formado;
    // ni un caso ni el otro debe abortar el stream DBGA ni descartar los competidores válidos.
    const { competitors, dropped, firstIssue, parsed } = parseScoutCompetitors(lastContent);
    if (!parsed) {
      console.warn("[DBGA:Scout] respuesta no parseable; sin competidores en esta ronda");
    } else if (dropped > 0) {
      console.warn(`[DBGA:Scout] ${dropped} competidor(es) descartado(s) por datos inválidos. Primer motivo: ${firstIssue}`);
    }
    return {
      competitors,
      status: "researching",
    };
  };
}
