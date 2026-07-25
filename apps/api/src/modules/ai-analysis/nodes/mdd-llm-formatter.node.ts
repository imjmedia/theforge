/**
 * @fileoverview Nodo formateador — aplica reglas de formato y normalización al MDD.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { MDD_LLM_FORMATTER_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { getUserBrief } from "../utils/mdd-user-brief.js";
import { logMddNodeOutput, validateMddStructure } from "../utils/mdd-sanitize.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:LLMFormatter] ${msg}`, ...args);

/**
 * Nodo formateador LLM: toma mddStructured (estructura completa con §§1-7),
 * lo serializa como JSON y pide al LLM que genere markdown limpio.
 * Reemplaza mddDraft con el markdown generado.
 *
 * @deprecated REMOVIDO del grafo MDD (CHANGELOG [Unreleased] → Fixed →
 * "Eliminación del LLM formatter destructivo"). Era destructivo: en
 * pasadas posteriores (ej. tras section5 regen) el skip heurístico
 * podía fallar y el LLM re-formateaba con resultado peor que el
 * original. Si necesitas reintroducirlo, exígele un skip MUCHO más
 * estricto: 7 secciones con headings + §3 con `CREATE TABLE` + §4 con
 * endpoints JSON + sin patrones `(Pendiente)` en el cuerpo. Confía en
 * los 3 formatters deterministas (`format_after_architect`,
 * `format_sec_int`, `format_after_redactor`) + el substance check del
 * delivery gate para mantener la calidad.
 */
export function createMddLlmFormatterNode(llm: BaseChatModel) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const currentDraft = (state.mddDraft ?? "").trim();
    LOG("entry mddStructured=%s draftLen=%s",
      state.mddStructured ? "present" : "null",
      currentDraft.length,
    );

    // Skip LLM reformat when draft is already complete — preserves full content and avoids lossy rewrite
    if (currentDraft.length > 5000) {
      const validation = validateMddStructure(currentDraft);
      if (validation.missingSections.length === 0 && validation.section3HasPayloads) {
        LOG("draft completo (%d chars, 7 secciones) → skip LLM reformat", currentDraft.length);
        return {};
      }
    }

    try {
      const brief = getUserBrief(state);
      const structuredJson = JSON.stringify(state.mddStructured ?? {}, null, 2);
      const briefBlock = brief
        ? `**Objetivo del documento (contexto):** ${brief}\n\n`
        : "";

      const scope = (state.clarifiedScope ?? "").trim();
      const scopeBlock = scope
        ? `**Alcance:** ${scope}\n\n`
        : "";

      const context = [
        briefBlock,
        scopeBlock,
        "**Datos estructurados del MDD (genera markdown a partir de esto):**",
        "```json",
        structuredJson.slice(0, 12000), // cap para no exceder context
        "```",
        "",
        "Genera el MDD completo como markdown limpio, legible y bien formateado.",
        "Sigue el formato especificado en las instrucciones.",
      ].filter(Boolean).join("\n");

      const prompt = `${MDD_LLM_FORMATTER_PROMPT}\n\n---\n${context}`;
      const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], { tag: "LLMFormatter" });
      if (!response) {
        LOG("LLM sin respuesta tras reintentos, preservando draft actual");
        return {};
      }
      const text = extractLlmText(response);
      if (!text.trim()) {
        LOG("LLM vacío, preservando draft actual");
        return {};
      }

      // Strip possible code fences around the markdown
      let markdown = text.replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
      if (!markdown) {
        LOG("markdown vacío tras limpiar fences, preservando draft");
        return {};
      }

      LOG("generado markdown len=%s primeros 200: %s", markdown.length, markdown.slice(0, 200).replace(/\n/g, "\\n"));
      logMddNodeOutput("LLMFormatter", markdown);
      return { mddDraft: markdown };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      // On error, preserve existing state
      return {};
    }
  };
}
