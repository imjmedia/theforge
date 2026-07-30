/**
 * @fileoverview Nodo clarificador — genera preguntas para requisitos incompletos.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { CLARIFIER_MDD_PROMPT, CLARIFIER_QUESTIONS_ONLY_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { mergeMddStructured } from "../utils/mdd-merge-structured.js";
import { getMddDraftSummary, extractAlreadyDocumentedTopics, extractIdentifiedInfraFromText, logMddNodeOutput, deduplicateMddDraftSections, mergeSection1IntoDraft, mddHasDuplicateSectionHeadings } from "../utils/mdd-sanitize.js";
import {
  draftIsSubstantialForScopedRepair,
  preserveValidatedSectionsIfSubstantial,
} from "../utils/mdd-section-preserve.util.js";
import { draftMeetsSection1Quality } from "../utils/mdd-section1-quality.util.js";
import {
  finalizeClarifierDraft,
  assembleClarifierMddDraft,
  stripClarifierGovernanceFromDraft,
  stripClarifierAgentBriefFromSection1,
  section1FallbackFromClarifiedScope,
  isSafeClarifierMergeBaseline,
} from "../utils/mdd-clarifier-draft.util.js";
import { buildClarifierDbgaBrief } from "../utils/mdd-clarifier-dbga-brief.util.js";
import { enrichClarifiedScopeFromInventory } from "../utils/enrich-clarified-scope.util.js";
import { getUserBrief } from "../utils/mdd-user-brief.js";
import { buildUserDeclaredStackPromptBlock } from "../utils/user-declared-stack.util.js";
import { extractFirstJsonObject, parseJsonOrThrow } from "../utils/parse-json.js";
import { clarifierComplexityAppendix } from "../utils/mdd-complexity-rigor.js";
import { buildInventoryFromMddState, domainInventoryPromptBlock } from "../utils/mdd-domain-prompt.util.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { resolveMddClarifierHardTimeoutMs } from "../utils/mdd-llm-timeout.util.js";
import {
  dbgaSnippetForClarifierFallback,
  resolveClarifierWorkingDraft,
  shouldPreserveClarifierDraftOnLlmFailure,
} from "../utils/mdd-clarifier-llm-fallback.util.js";
import {
  applySection1OnlyResult,
  buildClarifierFormatBlock,
  buildSection1OnlyPromptBlock,
  canUseSection1OnlyMode,
  parseClarifierDelimitedOutput,
} from "../utils/mdd-clarifier-section1-only.util.js";
import { z } from "zod";

/** Acepta string o objeto (el LLM a veces devuelve objeto); normaliza a string. */
function toScopeString(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const obj = x as Record<string, unknown>;
    const key = ["content", "text", "scope", "summary", "clarifiedScope"].find((k) => typeof obj[k] === "string");
    if (key) return String(obj[key]);
  }
  return typeof x === "object" ? JSON.stringify(x, null, 2) : String(x);
}
const stringOrObject = z
  .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
  .transform(toScopeString)
  .pipe(z.string());

const clarifierOutputSchema = z.object({
  clarifiedScope: stringOrObject,
  mddDraft: stringOrObject,
  title: z.string().optional(),
  contextoAlcance: z.string().optional(),
});

/** Tipo de salida tras parse (stringOrObject se transforma a string). */
type ClarifierParsed = z.output<typeof clarifierOutputSchema>;

const questionsOnlySchema = z.object({
  questions: z.array(z.string()).min(1).max(2),
});

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Clarifier] ${msg}`, ...args);

const clarifierLlmOpts = { hardTimeoutMs: resolveMddClarifierHardTimeoutMs() };

/** Si el LLM falla pero ya hay borrador sustancial, no resetear a template placeholder. */
function clarifierFallbackOnLlmFailure(
  draftTrimmed: string,
  state: MDDStateType,
  reason: string,
): Partial<MDDStateType> | null {
  if (!shouldPreserveClarifierDraftOnLlmFailure(draftTrimmed)) return null;
  LOG("%s — preservando borrador existente (len=%s)", reason, draftTrimmed.trim().length);
  return {
    clarifiedScope: (state.clarifiedScope ?? state.dbgaContent ?? "").slice(0, 2000),
    mddDraft: draftTrimmed.trim(),
    clarifierJustGeneratedQuestions: false,
  };
}

/** Creates the MDD Clarifier node. */
export function createMddClarifierNode(llm: BaseChatModel) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const requestQuestionsOnly = state.requestQuestionsOnly === true;
    LOG("entry requestQuestionsOnly=%s dbgaContentLen=%s", requestQuestionsOnly, (state.dbgaContent ?? "").length);

    if (requestQuestionsOnly) {
      try {
        const feedback =
          state.auditorFeedback?.trim() ||
          "Precisión baja: genera preguntas para cubrir las dimensiones que evalúa el Auditor: modelo de datos/entidades, contratos u operaciones (API u otro), seguridad, infraestructura/despliegue, resiliencia.";
        const draftAndUser = `${state.mddDraft ?? ""} ${state.userInputAccumulated ?? ""}`;
        const identifiedInfra = extractIdentifiedInfraFromText(draftAndUser);
        const alreadyDocumented = extractAlreadyDocumentedTopics(state.mddDraft ?? "");
        const contextParts = [
          "**Precisión actual:** " + (state.auditorScore ?? 0) + "%. Objetivo: 85% (a partir de 85% se cede la intervención al usuario).",
          "**Borrador actual del MDD:**",
          state.mddDraft || "(vacío)",
          alreadyDocumented.length > 0
            ? "**Ya documentado en el borrador (lista indicativa; NO preguntes sobre estos temas; revisa además el texto completo del borrador — cualquier tema ya cubierto en cualquier dominio no debe generar pregunta):** " + alreadyDocumented.join(", ") + "."
            : "",
          "**Huecos a cubrir:**",
          feedback,
          identifiedInfra.length === 0
            ? "**Hueco detectado:** El borrador no menciona infraestructura, orquestación ni despliegue (Docker, Kubernetes, Dokploy, AWS, GCP, etc.). Incluye una pregunta para definirlo: propón opciones concretas (ej. Docker Compose vs K8s, Dokploy vs AWS ECS) y pide validación."
            : "",
          "**Instrucción:** Para cada hueco genera una PROPUESTA concreta + validación (o opción A vs B). Si un hueco del feedback ya está cubierto en el borrador (cualquier dominio), NO preguntes por ese tema; elige otro hueco pendiente. Prohibido: '¿Podrías detallar cómo...?', '¿Qué medidas específicas...?', '¿Cómo se gestionan...?'. Ejemplos: transacciones → proponer ACID/eventual y preguntar si validan; infra/resiliencia → proponer Docker + health checks + reintentos y preguntar Docker Compose vs K8s.",
        ].filter(Boolean);
        if (state.userInputAccumulated?.trim()) {
          contextParts.splice(
            contextParts.length - 1,
            0,
            "**Respuestas acumuladas del usuario (si ya describen entidades/relaciones/reglas, NO pidas estructuras ni diagramas; pregunta siguiente nivel):**",
            state.userInputAccumulated.trim(),
          );
        }
        if (state.managerQuestions?.length) {
          contextParts.splice(
            contextParts.length - 1,
            0,
            "**Preguntas que ya hiciste al usuario en la ronda anterior (NO repitas ninguna de estas ni variantes; el usuario ya respondió):**",
            state.managerQuestions.join("\n"),
            "Genera preguntas sobre **otros** huecos pendientes; si no queda hueco distinto, propón una sola pregunta sobre el siguiente tema no cubierto.",
          );
        }
        const context = contextParts.join("\n");
        const prompt = `${CLARIFIER_QUESTIONS_ONLY_MDD_PROMPT}\n\n---\n${context}`;
        const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
          tag: "Clarifier:questions",
          ...clarifierLlmOpts,
        });
        if (!response) {
          LOG("questions-only: LLM sin respuesta tras reintentos — usando fallback");
          return {
            managerQuestions: ["¿Cuáles son los objetivos principales del sistema?", "¿Qué requisitos técnicos o integraciones son prioritarios?"],
            requestQuestionsOnly: false,
            clarifierJustGeneratedQuestions: true,
          };
        }
        const text = extractLlmText(response);
        const questions = text.trim()
          ? parseJsonOrThrow(text, questionsOnlySchema).questions.slice(0, 2)
          : ["¿Cuáles son los objetivos principales del sistema?", "¿Qué requisitos técnicos o integraciones son prioritarios?"];
        LOG("questions-only ok count=%s", questions.length);
        return {
          managerQuestions: questions,
          requestQuestionsOnly: false,
          clarifierJustGeneratedQuestions: true,
        };
      } catch (err) {
        LOG("questions-only error: %s", err instanceof Error ? err.message : String(err));
        return {
          managerQuestions: ["¿Cuáles son los objetivos principales del sistema?", "¿Qué integraciones o sistemas externos necesitas?"],
          requestQuestionsOnly: false,
          clarifierJustGeneratedQuestions: true,
        };
      }
    }

    try {
      const startedAt = Date.now();
      const brief = getUserBrief(state);
      const draftTrimmed = resolveClarifierWorkingDraft(state);
      const preserveBaseline =
        state.deliveryGateLoopActive === true &&
        state.deliveryGateFixTarget === "clarifier" &&
        (state.previousMddDraftForMerge ?? "").trim().length > 200
          ? (state.previousMddDraftForMerge ?? "").trim()
          : draftTrimmed;
      const dbgaRaw = state.dbgaContent ?? "";
      const { brief: dbgaBrief, briefChars: dbgaBriefChars, usedFullDbga } = buildClarifierDbgaBrief({
        dbgaContent: dbgaRaw,
      });
      const { inventory } = buildInventoryFromMddState(state);
      const hasSubstantialDraft =
        draftIsSubstantialForScopedRepair(draftTrimmed) ||
        (draftTrimmed.length > 500 && /##\s*2\.\s*Arquitectura/i.test(draftTrimmed));
      const briefBlock = brief && !hasSubstantialDraft
        ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar la sección 1. Contexto para una aplicación que cumple este objetivo; las secciones 2–7 son placeholders de una línea.\n\n---\n\n`
        : brief && hasSubstantialDraft
          ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Revisa y modifica el borrador existente del MDD según el objetivo. Preserva el contenido completo de todas las secciones (1-7) y solo aplica los cambios necesarios para cumplir el objetivo.\n\n---\n\n`
          : "";
      let prompt = `${CLARIFIER_MDD_PROMPT}${clarifierComplexityAppendix(state.mddComplexity)}\n\n---\n${briefBlock}**DBGA (entrada):**\n${dbgaBrief || "(vacío)"}`;
      const stackBlock = buildUserDeclaredStackPromptBlock(
        state.userInputAccumulated,
        state.lastUserMessage,
        brief,
        dbgaBrief.slice(0, 1500) || dbgaRaw.slice(0, 1500),
      );
      if (stackBlock) {
        prompt += `\n\n---\n${stackBlock}`;
      }
      const inventoryBlock = domainInventoryPromptBlock(state, { maxChars: 4_800 });
      if (inventoryBlock) {
        prompt += inventoryBlock;
        prompt +=
          "\n\n**Obligatorio en §1 Contexto:** enumera las capacidades de negocio del inventario (no solo auth/RBAC). Las capacidades de autenticación van como complemento.";
      }
      // §1-only: la rama `hasSubstantialDraft` de abajo descarta §2–§7 del LLM, así que
      // pedirlas es latencia y coste por trabajo tirado. Ver mdd-clarifier-section1-only.util.
      const section1OnlyMode = canUseSection1OnlyMode(draftTrimmed, hasSubstantialDraft);
      if (section1OnlyMode) {
        prompt += buildSection1OnlyPromptBlock(draftTrimmed);
      } else if (draftTrimmed) {
        const maxDraftLen = 14_000;
        const draftBlock =
          draftTrimmed.length > maxDraftLen
            ? draftTrimmed.slice(0, maxDraftLen) + "\n\n...(truncado; mantén el resto del documento en tu salida basándote en la estructura anterior)..."
            : draftTrimmed;
        prompt += `\n\n**Borrador actual del MDD (refinar con las respuestas del usuario y feedback; NO reemplazar por un resumen nuevo; incorpora cambios y devuelve el documento completo):**\n${draftBlock}`;
      }
      if (state.auditorFeedback?.trim()) {
        prompt += `\n\n**Feedback del Auditor (incorporar):**\n${state.auditorFeedback.trim()}`;
      }
      if (state.userInputAccumulated?.trim()) {
        prompt += `\n\n**Respuestas del usuario (incorporar al borrador; el v2 debe reflejar esto):**\n${state.userInputAccumulated.trim()}`;
        const lastSegment = state.userInputAccumulated.split(/\n\n---\n\n/).pop()?.trim() ?? "";
        if (lastSegment.length <= 80 && /^(?:usuario:\s*)?(?:s[ií]|s[ií]\s*,\s*de\s*acuerdo|de\s*acuerdo|ok|vale|correcto|estoy\s+de\s+acuerdo|perfecto|acepto)[\s.]*$/i.test(lastSegment)) {
          prompt += `\n\n**Importante:** La última respuesta es un acuerdo breve; el usuario acepta la propuesta concreta del Feedback del Auditor (ej. transacciones ACID, consistencia eventual, Docker, etc.). Incorpórala explícitamente al borrador en la sección correspondiente.`;
        }
      }
      prompt += buildClarifierFormatBlock(section1OnlyMode ? "section1-only" : "full");
      LOG(
        "invoke mode=%s promptChars=%s (draftLen=%s)",
        section1OnlyMode ? "section1-only" : "full",
        prompt.length,
        draftTrimmed.length,
      );
      const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
        tag: "Clarifier:draft",
        ...clarifierLlmOpts,
      });
      if (!response) {
        const preserved = clarifierFallbackOnLlmFailure(draftTrimmed, state, "LLM sin respuesta tras reintentos");
        if (preserved) return preserved;
        LOG("LLM sin respuesta tras reintentos — usando fallback (template placeholder)");
        const noBench = /sin benchmark|no hay benchmark/i.test(state.dbgaContent);
        const base = noBench
          ? getMddTemplatePlaceholder("(Genera un MDD base; el usuario refinará después.)")
          : getMddTemplatePlaceholder(
              `(Basado en: ${dbgaSnippetForClarifierFallback(state.dbgaContent ?? "")}.)`,
            );
        return {
          clarifiedScope: dbgaSnippetForClarifierFallback(state.dbgaContent ?? "", 2000),
          mddDraft: base,
          clarifierJustGeneratedQuestions: false,
        };
      }
      const text = extractLlmText(response);
      if (!text.trim()) {
        const preserved = clarifierFallbackOnLlmFailure(draftTrimmed, state, "LLM vacío tras reintentos");
        if (preserved) return preserved;
        LOG("LLM vacío, usando fallback");
        const noBench = /sin benchmark|no hay benchmark/i.test(state.dbgaContent);
        const base = noBench
          ? getMddTemplatePlaceholder("(Genera un MDD base; el usuario refinará después.)")
          : getMddTemplatePlaceholder(
              `(Basado en: ${dbgaSnippetForClarifierFallback(state.dbgaContent ?? "")}.)`,
            );
        return {
          clarifiedScope: dbgaSnippetForClarifierFallback(state.dbgaContent ?? "", 2000),
          mddDraft: base,
          clarifierJustGeneratedQuestions: false,
        };
      }
      /**
       * Formato delimitado primero; JSON como compatibilidad con modelos que
       * ignoran la instrucción de formato. En §1-only la §1 devuelta se reinyecta
       * en el borrador previo para que el resto del nodo vea un documento completo.
       */
      const toParsedFromDelimited = (raw: string): ClarifierParsed | undefined => {
        const delimited = parseClarifierDelimitedOutput(raw);
        if (!delimited) return undefined;
        if (section1OnlyMode) {
          if (!delimited.section1Body) return undefined;
          const mergedFull = applySection1OnlyResult(draftTrimmed, delimited.section1Body);
          if (!mergedFull) return undefined;
          return { clarifiedScope: delimited.clarifiedScope, mddDraft: mergedFull };
        }
        if (!delimited.mddDraft) return undefined;
        return { clarifiedScope: delimited.clarifiedScope, mddDraft: delimited.mddDraft };
      };

      let parsed: ClarifierParsed | undefined = toParsedFromDelimited(text);
      if (parsed) {
        LOG("salida delimitada parseada (mode=%s draftLen=%s)", section1OnlyMode ? "section1-only" : "full", parsed.mddDraft.length);
      } else {
        const jsonStr = extractFirstJsonObject(text) ?? text.trim();
        try {
          parsed = parseJsonOrThrow(jsonStr, clarifierOutputSchema) as ClarifierParsed;
          if (section1OnlyMode) {
            // El modelo devolvió JSON pese al modo acotado: su `mddDraft` es sólo §1
            // si no trae encabezados canónicos, así que se reinyecta igual.
            const jsonDraft = String(parsed.mddDraft ?? "").trim();
            if (jsonDraft && !/^##\s*[2-7]\.\s/m.test(jsonDraft)) {
              const mergedFull = applySection1OnlyResult(draftTrimmed, jsonDraft);
              if (mergedFull) parsed = { ...parsed, mddDraft: mergedFull };
            }
          }
        } catch {
          // Reintento antes del fallback: si el Clarificador falla, §1/§2 quedan como placeholders
          // y el borrador nace sin headings canónicos, así que el resto del pipeline trabaja en
          // vano (job 81: §2/§3/§4 generadas y descartadas).
          LOG("salida no parseable (ni delimitada ni JSON) — reintentando 1x con formato reforzado");
          const retryPrompt =
            `${prompt}\n\n---\n**RECORDATORIO DE FORMATO (reintento):** tu respuesta anterior no ` +
            "respetó los delimitadores. Responde EXCLUSIVAMENTE con los bloques delimitados " +
            "indicados arriba, cada delimitador solo en su línea, sin JSON, sin ```json y sin " +
            "texto fuera de los bloques.";
          const retryResponse = await invokeLlmWithRetry(llm, [new HumanMessage(retryPrompt)], {
            tag: "Clarifier:draft:retry",
            ...clarifierLlmOpts,
          });
          const retryText = retryResponse ? extractLlmText(retryResponse) : "";
          if (retryText.trim()) {
            parsed = toParsedFromDelimited(retryText);
            if (!parsed) {
              try {
                parsed = parseJsonOrThrow(
                  extractFirstJsonObject(retryText) ?? retryText.trim(),
                  clarifierOutputSchema,
                ) as ClarifierParsed;
              } catch {
                LOG("retry del Clarificador también falló");
              }
            }
            if (parsed) LOG("retry del Clarificador OK");
          }
        }
      }
      if (!parsed) {
        LOG("JSON inválido en respuesta del Clarificador, usando borrador anterior y scope de fallback");
        const fallbackScope =
          (state.clarifiedScope ?? "").trim() ||
          (state.userInputAccumulated ?? "").trim().split(/\n\n---\n\n/).map((s) => s.trim()).filter((s) => s.length > 50 && !/^(Usuario:\s*)?(sí|ok|vale)/i.test(s))[0]?.slice(0, 500) ||
          state.dbgaContent?.trim().slice(0, 500) ||
          "Alcance pendiente de refinar.";
        const fallbackDraft = draftTrimmed && draftTrimmed.length > 200 ? draftTrimmed : undefined;
        return {
          clarifiedScope: fallbackScope,
          mddDraft: fallbackDraft ?? getMddTemplatePlaceholder(fallbackScope),
          clarifierJustGeneratedQuestions: false,
        };
      }
      let scope = String(parsed.clarifiedScope ?? "").trim();
      let draft = stripClarifierGovernanceFromDraft(String(parsed.mddDraft ?? "").trim());
      draft = assembleClarifierMddDraft(draft, section1FallbackFromClarifiedScope(scope));

      const enriched = enrichClarifiedScopeFromInventory(scope, inventory);
      if (enriched.enriched) {
        scope = enriched.scope;
        LOG(
          "clarifiedScope enriched from inventory (entities=%s capabilities=%s len=%s)",
          enriched.addedEntities,
          enriched.addedCapabilities,
          scope.length,
        );
      }

      if (scope.length < 300 && (state.userInputAccumulated ?? "").trim().length > 80) {
        const acc = state.userInputAccumulated!.trim();
        const blocks = acc.split(/\n\n---\n\n/).map((s) => s.trim()).filter(Boolean);
        const trivialReply = /^(?:Usuario:\s*)?(?:s[ií]|ok|vale|de\s*acuerdo)[\s.]*$/i;
        const substantial = blocks.filter((b) => b.length > 80 && !trivialReply.test(b.replace(/^Usuario:\s*/i, "").trim()));
        if (substantial.length > 0) {
          const excerpt = substantial[0].slice(0, 800);
          scope = scope + "\n\n**Requisitos explícitos del usuario:** " + excerpt;
          LOG("clarifiedScope enriquecido con requisitos del usuario (scopeOutLen=%s)", scope.length);
        }
      }

      const scopeSummary = scope.length > 100 ? scope.slice(0, 100) + "..." : scope;
      const draftSummary = draft.length > 100 ? draft.slice(0, 100) + "..." : draft;
      LOG("Input detected -> Clarified Scope: %s", scopeSummary);
      LOG("Draft update -> Start: %s", draftSummary);

      const isBrokenDraft = (d: string): boolean => {
        if (d.slice(0, 500).includes("useMermaidForDiagrams") || d.slice(0, 500).includes("## document")) return true;
        if (d.startsWith("{") && d.includes('"document"') && (d.includes("useMermaidForDiagrams") || d.includes("leaveUncovered"))) {
          try {
            const o = JSON.parse(d) as Record<string, unknown>;
            return typeof o.document === "object" && (o.useMermaidForDiagrams !== undefined || o.leaveUncovered !== undefined);
          } catch {
            return false;
          }
        }
        return false;
      };

      if (isBrokenDraft(draft)) {
        LOG("mddDraft con forma useMermaidForDiagrams/document rechazado, usando borrador anterior o mínimo");
        draft =
          draftTrimmed && !isBrokenDraft(draftTrimmed)
            ? draftTrimmed
            : getMddTemplatePlaceholder(scope || "(Pendiente de definir según alcance.)");
      }

      const section1Match = draft.match(/\n##\s*1\.\s*Contexto\s*\n+([\s\S]*?)(?=\n##\s|\n#\s|$)/i) ?? draft.match(/\n##\s*Contexto\s*\n+([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
      const section1Body = section1Match?.[1]?.trim() ?? "";
      const isSection1Placeholder = (body: string) =>
        !body ||
        body.length < 20 ||
        /^\s*\(?\s*(Pendiente|Pendiente de definir)[^)]*\)?\s*$/i.test(body) ||
        /^\s*\(?\s*vacío\s*\)?\s*$/i.test(body);

      let slice: { title?: string; contextoAlcance?: string } | undefined =
        parsed.title !== undefined || parsed.contextoAlcance !== undefined
          ? { title: parsed.title?.trim(), contextoAlcance: parsed.contextoAlcance?.trim() }
          : undefined;
      if (scope && isSection1Placeholder(section1Body)) {
        const contextFallback = scope.split(/\n\n+/)[0]?.trim() ?? scope;
        const contextoAlcance = (contextFallback.length > 800 ? contextFallback.slice(0, 800) + "…" : contextFallback).trim();
        slice = slice ? { ...slice, contextoAlcance: slice.contextoAlcance || contextoAlcance } : { contextoAlcance };
      }
      const merged = slice ? mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "") : state.mddStructured;
      const finalizedDraft = finalizeClarifierDraft({
        llmDraft: draft,
        previousDraft: draftTrimmed,
        clarifiedScope: scope,
        dbgaContent: state.dbgaContent ?? "",
        mddComplexity: state.mddComplexity,
        log: LOG,
      });
      let mergedDraft = finalizedDraft;
      if ((hasSubstantialDraft || preserveBaseline !== draftTrimmed) && preserveBaseline.length > 200) {
        mergedDraft = preserveValidatedSectionsIfSubstantial(preserveBaseline, finalizedDraft);
        const safeBaseline = deduplicateMddDraftSections(preserveBaseline);
        const canMergeSection1 =
          isSafeClarifierMergeBaseline(safeBaseline, finalizedDraft) &&
          finalizedDraft !== safeBaseline &&
          draftMeetsSection1Quality(finalizedDraft, state.mddComplexity);
        if (canMergeSection1) {
          mergedDraft = mergeSection1IntoDraft(mergedDraft, finalizedDraft);
          LOG("draft sustancial: merge §1 only, preservadas §2–§7 (len %s→%s)", finalizedDraft.length, mergedDraft.length);
        } else if (mergedDraft !== finalizedDraft) {
          LOG(
            "draft sustancial: preservadas secciones desde baseline (len %s→%s)",
            finalizedDraft.length,
            mergedDraft.length,
          );
        } else if (finalizedDraft !== draftTrimmed && !canMergeSection1) {
          LOG(
            "merge §1 omitido (baseline dupes o bloat: baselineLen=%s finalizedLen=%s dupes=%s)",
            safeBaseline.length,
            finalizedDraft.length,
            mddHasDuplicateSectionHeadings(safeBaseline),
          );
        }
      }
      const mddDraft = stripClarifierAgentBriefFromSection1(
        deduplicateMddDraftSections(mergedDraft),
      );
      const outStructured = merged ?? (slice ? mergeMddStructured(undefined, slice) : undefined);
      const sum = getMddDraftSummary(mddDraft);
      const durationMs = Date.now() - startedAt;
      LOG(
        "ok durationMs=%s promptChars=%s dbgaBriefChars=%s dbgaFull=%s clarifiedScopeLen=%s mddDraftLen=%s section3=%s",
        durationMs,
        prompt.length,
        dbgaBriefChars,
        usedFullDbga,
        scope.length,
        sum.length,
        sum.section3,
      );
      logMddNodeOutput("Clarifier", mddDraft, { inputLen: draftTrimmed.length });
      const out: Partial<MDDStateType> = {
        clarifiedScope: scope,
        mddDraft,
        clarifierJustGeneratedQuestions: false,
        ...(draftMeetsSection1Quality(mddDraft, state.mddComplexity)
          ? { clarifierMddDraftSnapshot: mddDraft }
          : {}),
      };
      if (outStructured != null) {
        out.mddStructured = outStructured;
      }
      return out;
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}
