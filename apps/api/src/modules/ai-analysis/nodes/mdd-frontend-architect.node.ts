/**
 * @fileoverview Nodo arquitecto frontend — genera especificaciones de frontend.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { FRONTEND_ARCHITECT_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { mddStructuredToMarkdown } from "../render/mdd-structured-to-markdown.js";
import { mergeMddStructured } from "../utils/mdd-merge-structured.js";
import { getUserBrief } from "../utils/mdd-user-brief.js";
import { getMddDraftSummary, jsonSectionToMarkdown, logMddNodeOutput } from "../utils/mdd-sanitize.js";
import { extractFirstJsonObject, parseJsonOrThrow } from "../utils/parse-json.js";
import { z } from "zod";

/** Schema de salida estructurada: solo arquitecturaFrontend. */
const frontendStructuredSchema = z.object({
  arquitecturaFrontend: z.string(),
});

/** Acepta string u objeto; normaliza a string. */
function sectionToStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const obj = x as Record<string, unknown>;
    const key = ["content", "text", "section", "frontendSection", "architecture"].find(
      (k) => typeof obj[k] === "string",
    );
    if (key) return String(obj[key]);
  }
  return typeof x === "object" ? JSON.stringify(x, null, 2) : String(x);
}

const legacyFrontendOutputSchema = z.object({
  frontendSection: z
    .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
    .transform(sectionToStr)
    .pipe(z.string()),
});

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:FrontendArchitect] ${msg}`, ...args);

/** Creates the MDD Frontend Architect node. Outputs structured arquitecturaFrontend; merge into mddStructured and derive mddDraft. */
export function createMddFrontendArchitectNode(llm: BaseChatModel) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    LOG("entry mddDraftLen=%s", (state.mddDraft ?? "").length);
    try {
      const brief = getUserBrief(state);
      const briefBlock = brief
        ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar la subsección Arquitectura Frontend (dentro de la sección 2. Arquitectura y Stack) para una aplicación que cumple este objetivo.\n\n---\n\n`
        : "";
      const context = [
        briefBlock,
        "**Alcance clarificado:**",
        state.clarifiedScope || "(vacío)",
        "",
        "**Borrador actual del MDD (Backend definido):**",
        state.mddDraft || "(vacío)",
      ]
        .filter(Boolean)
        .join("\n");
      const prompt = `${FRONTEND_ARCHITECT_MDD_PROMPT}\n\n---\n${context}`;
      const response = await llm.invoke([new HumanMessage(prompt)]);
      const text = typeof response.content === "string" ? response.content : "";

      if (!text.trim()) {
        LOG("LLM vacío, usando fallback");
        const slice = { arquitecturaFrontend: "(No se pudo generar arquitectura frontend.)" };
        const merged = mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "");
        const mddDraft = mddStructuredToMarkdown(merged);
        logMddNodeOutput("FrontendArchitect", mddDraft);
        return { mddStructured: merged, mddDraft };
      }

      const jsonStr = extractFirstJsonObject(text) ?? text.trim();
      let slice: { arquitecturaFrontend: string };
      try {
        const parsed = parseJsonOrThrow(jsonStr, frontendStructuredSchema);
        slice = { arquitecturaFrontend: parsed.arquitecturaFrontend.trim() };
      } catch {
        LOG("parse estructurado falló, fallback desde markdown");
        let section = "";
        try {
          const legacy = parseJsonOrThrow(text, legacyFrontendOutputSchema);
          section = String(legacy.frontendSection ?? "").trim();
        } catch {
          section = text.replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
        }
        if (section.startsWith("{") && section.includes('"')) {
          section = jsonSectionToMarkdown(section, "4. Arquitectura Frontend");
        }
        const h4 = "## 4. Arquitectura Frontend";
        const idx4 = section.indexOf(h4);
        if (idx4 !== -1 && (section.includes("## 1. Contexto") || section.includes("# Master Design Document"))) {
          const from4 = section.slice(idx4);
          const nextH2 = from4.slice(h4.length).search(/\n##\s+/);
          section = nextH2 !== -1 ? from4.slice(0, h4.length + nextH2).trim() : from4.trim();
        }
        if (!section.startsWith("##")) {
          section = `## 4. Arquitectura Frontend\n\n${section}`;
        }
        const body = section.replace(/^##\s*4\.\s*Arquitectura\s+Frontend\s*\n*/i, "").trim();
        slice = { arquitecturaFrontend: body || "(Pendiente: Arquitecto Frontend)" };
      }

      const merged = mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "");
      const mddDraft = mddStructuredToMarkdown(merged);
      const sum = getMddDraftSummary(mddDraft);
      LOG("ok arquitecturaFrontend merged mddDraftLen=%s section2=%s", sum.length, sum.section2);
      logMddNodeOutput("FrontendArchitect", mddDraft);
      return { mddStructured: merged, mddDraft };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}
