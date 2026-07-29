/**
 * @fileoverview F4 — patch §3: añade solo tablas faltantes tras critic (sin regen completa).
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import type { MDDStateType } from "../state/index.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import {
  applyDataModelPatchToDraft,
  isUsableDataModelPatchSql,
  parseMissingTablesFromCriticFeedback,
} from "../utils/mdd-data-model-patch.util.js";
import { extractSection3Body, getMddDraftSummary, logMddNodeOutput } from "../utils/mdd-sanitize.js";
import { stripThinkingTags } from "../utils/mdd-security-parse.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:DataModelPatch] ${msg}`, ...args);

const PATCH_PROMPT = `Eres experto en PostgreSQL. Recibes SQL existente y una lista de tablas que FALTAN.
Genera **solo** bloques \`CREATE TABLE\` para las tablas faltantes (con FKs coherentes al SQL existente).
**PROHIBIDO** repetir tablas ya presentes. **PROHIBIDO** markdown ni MDD completo.
Responde únicamente con DDL SQL (sin fences).`;

export function createMddDataModelPatchNode(llm: BaseChatModel) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const feedback = (state.architectCriticFeedback ?? "").trim();
    const missing = parseMissingTablesFromCriticFeedback(feedback);
    if (!missing?.length) {
      LOG("sin tablas faltantes parseables, noop");
      return {};
    }

    const draft = (state.mddDraft ?? "").trim();
    const section3 = extractSection3Body(draft) ?? "";
    const sqlMatch = section3.match(/```sql\s*([\s\S]*?)```/i);
    const currentSql = sqlMatch?.[1]?.trim() ?? "";

    const prompt = `${PATCH_PROMPT}\n\n---\n**Tablas faltantes:** ${missing.join(", ")}\n\n**SQL actual:**\n\`\`\`sql\n${currentSql}\n\`\`\``;
    const startedAt = Date.now();
    const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
      tag: "DataModelPatch",
    });
    const raw = stripThinkingTags(response ? extractLlmText(response) : "");
    logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, prompt.length, raw.length), {
      tables: missing.join(","),
    });

    const appendedSql = raw.replace(/^```sql\s*|\s*```$/gi, "").trim();
    if (!appendedSql || !/CREATE\s+TABLE/i.test(appendedSql) || !isUsableDataModelPatchSql(appendedSql, missing)) {
      LOG("LLM sin DDL usable, noop");
      return {};
    }

    const mddDraft = applyDataModelPatchToDraft(draft, appendedSql);
    const sum = getMddDraftSummary(mddDraft);
    LOG("ok patch tablas=%s draftLen=%s section3=%s", missing.join(","), sum.length, sum.section3);
    logMddNodeOutput("DataModelPatch", mddDraft);
    return {
      mddDraft,
      architectCriticFeedback: undefined,
      architectCriticPhase: "after_section3" as const,
    };
  };
}
