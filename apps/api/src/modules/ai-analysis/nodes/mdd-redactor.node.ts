/**
 * @fileoverview Nodo redactor — reescribe y pule contenido del MDD.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { REDACTOR_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { getMddDraftSummary, logMddNodeOutput, objectSectionToMarkdown, sanitizeContextSection } from "../utils/mdd-sanitize.js";
import { extractFirstJsonObject, extractJsonFromCodeBlock } from "../utils/parse-json.js";
import { replaceOrAppendSection } from "./mdd-section-merge.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Redactor] ${msg}`, ...args);
const MAX_REDACTOR_TOOL_LOOPS = 2;

/** Extrae la sección completa (## Title + cuerpo hasta el siguiente ##) de un draft. */
function extractSectionFromDraft(draft: string, sectionName: string): string | null {
  const re = new RegExp(`\\n(##\\s+${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^\\n]*)`, "i");
  const match = draft.match(re);
  if (!match || match.index == null) return null;
  const start = match.index + 1;
  const rest = draft.slice(start + match[1].length).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2).trim() : rest.trim();
  if (body.length < 50) return null;
  return match[1] + "\n\n" + body;
}

function buildRedactorToolsByName(tools: StructuredToolInterface[]): Record<string, StructuredToolInterface> {
  const byName: Record<string, StructuredToolInterface> = {};
  for (const t of tools) byName[t.name] = t;
  return byName;
}

/** Creates the MDD Redactor node. Unifies the document and aligns Security/Integration to the clarified scope. Optionally with tools (validate_mdd_structure). */
export function createMddRedactorNode(llm: BaseChatModel, tools: StructuredToolInterface[] = []) {
  const toolsByName = buildRedactorToolsByName(tools);
  const llmWithTools = llm.bindTools ? (tools.length > 0 ? llm.bindTools(tools) : llm) : llm;

  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const draftLen = (state.mddDraft ?? "").length;
    LOG("entry mddDraftLen=%s clarifiedScopeLen=%s tools=%s", draftLen, (state.clarifiedScope ?? "").length, tools.length);
    try {
      const draft = (state.mddDraft ?? "").trim();
      const scope = (state.clarifiedScope ?? "").trim();
      if (!draft) {
        LOG("sin borrador, saliendo sin cambios");
        return {};
      }
      const contextParts = [
        "**Alcance clarificado:**",
        scope || "(vacío)",
        "",
        "**Borrador actual del MDD (Arquitecto + Seguridad + Integración):**",
        draft.slice(0, 14000) + (draft.length > 14000 ? "\n\n...(truncado)" : ""),
      ];
      if (state.auditorFeedback?.trim()) {
        contextParts.push(
          "",
          "**Feedback del Auditor (pendientes de cerrar en el documento final):**",
          state.auditorFeedback.trim(),
          "",
          "Unifica el documento y asegura que los gaps indicados (Missing Infrastructure, Ghost Features, Actionable Patches) queden resueltos en el texto final.",
        );
      }
      let context = contextParts.join("\n");
      if (tools.length > 0) {
        context += "\n\n**Opcional:** Usa la tool validate_mdd_structure con el borrador para obtener section3HasPayloads, missingSections, issues. Corrige lo que indiquen los issues y devuelve el documento en Markdown puro.";
      }
      const prompt = `${REDACTOR_MDD_PROMPT}\n\n---\n${context}`;
      const messages = [new HumanMessage(prompt)];

      let text = "";
      if (tools.length > 0) {
        let loopCount = 0;
        while (loopCount < MAX_REDACTOR_TOOL_LOOPS) {
          const response = await llmWithTools.invoke(messages);
          const aiMsg = response as AIMessage;
          text = typeof aiMsg.content === "string" ? aiMsg.content : "";
          const toolCalls = aiMsg.tool_calls ?? [];
          if (toolCalls.length === 0) break;
          const toolMessages: ToolMessage[] = [];
          for (const tc of toolCalls) {
            const tool = toolsByName[tc.name];
            const toolCallId = tc.id ?? `tc-${loopCount}-${tc.name}`;
            if (!tool) {
              toolMessages.push(new ToolMessage({ content: `Unknown tool: ${tc.name}`, tool_call_id: toolCallId, status: "error" }));
              continue;
            }
            const args = typeof tc.args === "object" && tc.args !== null ? (tc.args as Record<string, unknown>) : {};
            let result: unknown;
            try {
              result = await tool.invoke(args);
            } catch (toolErr) {
              console.log("[MDD:Redactor] tool.invoke error: %s args=%s", toolErr instanceof Error ? toolErr.message : String(toolErr), JSON.stringify(args).slice(0, 200));
              result = `Error: ${toolErr instanceof Error ? toolErr.message : "Tool call failed"}`;
            }
            const content = typeof result === "string" ? result : JSON.stringify(result);
            toolMessages.push(new ToolMessage({ content, tool_call_id: toolCallId }));
          }
          messages.push(aiMsg, ...toolMessages);
          loopCount++;
        }
      } else {
        const response = await llm.invoke(messages);
        text = typeof response.content === "string" ? response.content : "";
      }

      if (!text.trim()) {
        LOG("LLM vacío, conservando borrador");
        return {};
      }

      let mddDraft = "";

      // Intenta extraer JSON primero (por retrocompatibilidad o si el LLM decide ignorar el prompt)
      // Pero si no hay JSON, toma el texto crudo.
      const jsonStr = extractJsonFromCodeBlock(text) ?? extractFirstJsonObject(text);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          const candidateKeys = ["mddDraft", "mdd_draft", "content", "document", "markdown"];
          for (const key of candidateKeys) {
            const val = parsed[key];
            if (typeof val === "string" && val.trim().length >= 200) {
              mddDraft = val.trim();
              break;
            }
          }
          if (!mddDraft && typeof parsed.mddDraft === "string") {
            mddDraft = parsed.mddDraft.trim();
          }

          // No convertir objeto "metadata + document" (useMermaidForDiagrams, leaveUncovered, document.sections)
          // porque objectSectionToMarkdown produce ## useMermaidForDiagrams, ## document, etc. (documento roto).
          const isMetadataDocumentShape =
            typeof parsed.document === "object" &&
            (parsed.useMermaidForDiagrams !== undefined ||
              parsed.leaveUncovered !== undefined ||
              (parsed.document && typeof parsed.document === "object" && "sections" in (parsed.document as object)));

          const val = parsed.mddDraft || parsed;
          if (
            !mddDraft &&
            !isMetadataDocumentShape &&
            val &&
            typeof val === "object" &&
            !Array.isArray(val)
          ) {
            try {
              const converted = objectSectionToMarkdown(val as Record<string, unknown>);
              if (converted.length > 200) {
                mddDraft = converted;
                LOG("mddDraft convertido de objeto JSON a markdown (len=%s)", mddDraft.length);
              }
            } catch (e) {
              // ignore
            }
          }
        } catch {
          // ignore parsing error
        }
      }

      // Rechazar salida que sea JSON convertido a markdown con estructura rota (## useMermaidForDiagrams, ## document, etc.)
      if (
        mddDraft &&
        (mddDraft.startsWith("## useMermaidForDiagrams") ||
          mddDraft.startsWith("## leaveUncovered") ||
          (mddDraft.includes("## document") && !mddDraft.includes("## 1. Contexto")))
      ) {
        LOG("redactor output con estructura rota (metadata/document), conservando borrador");
        mddDraft = "";
      }

      if (!mddDraft || mddDraft.length < 200) {
        // Fallback: usar el texto crudo limpio de bloques de código
        const rawStripped = text.replace(/^```(?:markdown|json)?\s*|^json\s*|\s*```$/gi, "").trim();
        if (rawStripped.length >= 200) {
          // Last Resort: Ver si es JSON válido y convertirlo a la fuerza
          if (rawStripped.startsWith("{") || rawStripped.startsWith("[")) {
            try {
              const obj = JSON.parse(rawStripped) as Record<string, unknown>;
              const isMetadataDocumentShape =
                typeof obj.document === "object" &&
                (obj.useMermaidForDiagrams !== undefined ||
                  obj.leaveUncovered !== undefined ||
                  (obj.document && typeof obj.document === "object" && "sections" in (obj.document as object)));
              if (isMetadataDocumentShape) {
                LOG("fallback: JSON con metadata/document, no convertir; conservando borrador");
              } else {
                const converted = objectSectionToMarkdown(obj);
                if (converted.length > 200) {
                  mddDraft = converted;
                  LOG("fallback: convertido JSON crudo a Markdown (len=%s)", mddDraft.length);
                } else {
                  mddDraft = rawStripped;
                }
              }
            } catch {
              mddDraft = rawStripped;
            }
          } else {
            mddDraft = rawStripped;
          }
          if (!mddDraft && rawStripped.includes("# Master Design Document")) {
            mddDraft = rawStripped;
          }
          if (mddDraft) LOG("usando documento desde texto crudo (len=%s)", mddDraft.length);
        }
        // Si el resultado es mucho más corto que el draft: no reemplazar todo; mergear secciones que sí traiga el Redactor
        if (mddDraft && draft.length > 500 && mddDraft.length < draft.length * 0.6) {
          const shortRedactorOutput = mddDraft;
          LOG("fallback resultado muy corto (len=%s vs draft=%s), mergeando secciones del Redactor en el borrador", mddDraft.length, draft.length);
          const sectionsToMerge: Array<{ keyword: string; content: string | null }> = [
            { keyword: "Seguridad", content: extractSectionFromDraft(mddDraft, "Seguridad") },
            { keyword: "Integración", content: extractSectionFromDraft(mddDraft, "Integración") },
            { keyword: "4. Arquitectura Frontend", content: extractSectionFromDraft(mddDraft, "4. Arquitectura Frontend") },
          ];
          let merged = draft;
          let mergedCount = 0;
          for (const { keyword, content } of sectionsToMerge) {
            if (content && content.length > 100) {
              merged = replaceOrAppendSection(merged, keyword, content);
              mergedCount++;
            }
          }
          if (mergedCount > 0) {
            mddDraft = merged;
            LOG("mergeadas %s sección(es) del Redactor en el borrador", mergedCount);
          } else {
            // No había secciones mergeables: conservar trabajo del agente concatenando como observaciones
            mddDraft = draft + "\n\n## Observaciones del Redactor\n\n" + shortRedactorOutput.trim();
            LOG("sin secciones mergeables; trabajo del Redactor añadido como 'Observaciones del Redactor'");
          }
        }
      }

      // Rechazar también si el fallback produjo estructura rota (JSON metadata+document convertido)
      if (
        mddDraft &&
        (mddDraft.startsWith("## useMermaidForDiagrams") ||
          mddDraft.startsWith("## leaveUncovered") ||
          (mddDraft.includes("## document") && !mddDraft.includes("## 1. Contexto")))
      ) {
        LOG("redactor output con estructura rota (post-fallback), conservando borrador");
        mddDraft = "";
      }

      if (!mddDraft || mddDraft.length < 200) {
        LOG("mddDraft vacío o muy corto (len=%s), conservando borrador.", (mddDraft || "").length);
        return {};
      }
      const minRatio = 0.6;
      if (draft.length > 500 && mddDraft.length < draft.length * minRatio) {
        const shortRedactorOutput = mddDraft;
        LOG("redactor output mucho más corto (len=%s vs draft=%s), mergeando secciones en el borrador", mddDraft.length, draft.length);
        const sectionsToMerge: Array<{ keyword: string; content: string | null }> = [
          { keyword: "Seguridad", content: extractSectionFromDraft(mddDraft, "Seguridad") },
          { keyword: "Integración", content: extractSectionFromDraft(mddDraft, "Integración") },
          { keyword: "4. Arquitectura Frontend", content: extractSectionFromDraft(mddDraft, "4. Arquitectura Frontend") },
        ];
        let merged = draft;
        let mergedCount = 0;
        for (const { keyword, content } of sectionsToMerge) {
          if (content && content.length > 100) {
            merged = replaceOrAppendSection(merged, keyword, content);
            mergedCount++;
          }
        }
        if (mergedCount > 0) {
          const out = sanitizeContextSection(merged);
          const sum = getMddDraftSummary(out);
          LOG("mergeadas %s sección(es) mddDraftLen=%s section2=%s", mergedCount, sum.length, sum.section2);
          logMddNodeOutput("Redactor", out);
          return { mddDraft: out };
        }
        const outObs = sanitizeContextSection(draft + "\n\n## Observaciones del Redactor\n\n" + shortRedactorOutput.trim());
        const sumObs = getMddDraftSummary(outObs);
        LOG("observaciones añadidas mddDraftLen=%s section2=%s", sumObs.length, sumObs.section2);
        logMddNodeOutput("Redactor", outObs);
        return { mddDraft: outObs };
      }
      const out = sanitizeContextSection(mddDraft);
      const sum = getMddDraftSummary(out);
      LOG("ok mddDraftLen=%s section2=%s", sum.length, sum.section2);
      logMddNodeOutput("Redactor", out);
      return { mddDraft: out };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      return {};
    }
  };
}
