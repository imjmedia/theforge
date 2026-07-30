/**
 * @fileoverview Nodo arquitecto de seguridad — genera especificaciones de seguridad.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { SECURITY_ARCHITECT_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { mddSeguridadItemSchema } from "../state/mdd-structured.schema.js";
import type { MddSeguridadItem } from "../state/mdd-structured.schema.js";
import { mergeMddStructured } from "../utils/mdd-merge-structured.js";
import { mergeSection6AvoidingRegression } from "../utils/mdd-credential-storage.util.js";
import {
  isCorruptedSeguridadSlice,
  isPlaceholderSeguridad,
  draftHasPreservableSection6,
  parseSecurityLlmResponse,
  recoverSeguridadItemsFromRawLlmText,
  seguridadItemsFromDraftSection6,
  stripThinkingTags,
} from "../utils/mdd-security-parse.js";
import { getUserBrief } from "../utils/mdd-user-brief.js";
import {
  getMddDraftSummary,
  logMddNodeOutput,
  seguridadItemsToSection6Markdown,
} from "../utils/mdd-sanitize.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { resolveMddTailNodeHardTimeoutMs } from "../utils/mdd-llm-timeout.util.js";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import { buildTrimmedTailAgentContext } from "../utils/mdd-tail-parallel.util.js";
import {
  draftHasSubstantialSection6,
  reinjectTailSectionsFromSnapshotsForGateLoop,
} from "../utils/mdd-section-preserve.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Security] ${msg}`, ...args);

export type MddSecurityNodeOptions = {
  /** F3: solo devuelve slice structured (sin mddDraft). */
  sliceOnly?: boolean;
  /** F3: contexto §1+§2+DDL§3+tabla§4 (sin JSON). */
  trimmedTailContext?: boolean;
};

const PENDING_SEGURIDAD: MddSeguridadItem[] = [
  mddSeguridadItemSchema.parse({ title: "Seguridad", content: ["(Pendiente de definir.)"] }),
];

/** Conserva §6 previa si el LLM devolvió basura o el parse falló. */
function resolveSeguridadSlice(
  state: MDDStateType,
  llmItems: MddSeguridadItem[] | null,
): MddSeguridadItem[] {
  if (llmItems?.length && !isCorruptedSeguridadSlice(llmItems) && !isPlaceholderSeguridad(llmItems)) {
    return llmItems;
  }

  LOG("respuesta LLM inválida o corrupta; preservando §6 anterior si existe");
  const prevStructured = state.mddStructured?.seguridad;
  if (
    prevStructured?.length &&
    !isCorruptedSeguridadSlice(prevStructured) &&
    !isPlaceholderSeguridad(prevStructured)
  ) {
    return prevStructured;
  }

  const fromDraft = seguridadItemsFromDraftSection6(state.mddDraft ?? "");
  if (fromDraft?.length) return fromDraft;

  return PENDING_SEGURIDAD;
}

function buildMddDraftWithSection6(state: MDDStateType, seguridad: MddSeguridadItem[]): string {
  const draft = state.mddDraft ?? "";
  // No conservar el draft si §6 sigue siendo el placeholder del arquitecto de software.
  if (isPlaceholderSeguridad(seguridad) && draftHasPreservableSection6(draft)) {
    return draft;
  }
  const section6Md = seguridadItemsToSection6Markdown(seguridad);
  return mergeSection6AvoidingRegression(draft, section6Md);
}

/** Creates the MDD Security Architect node. Outputs structured seguridad; merge into mddStructured and derive mddDraft. */
export function createMddSecurityNode(llm: BaseChatModel, opts?: MddSecurityNodeOptions) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const sliceOnly = opts?.sliceOnly === true;
    LOG("entry mddDraftLen=%s sliceOnly=%s", (state.mddDraft ?? "").length, sliceOnly);
    try {
      const brief = getUserBrief(state);
      const briefBlock = brief
        ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar la sección 6. Seguridad para una aplicación que cumple este objetivo.\n\n---\n\n`
        : "";
      const draftBlock = opts?.trimmedTailContext
        ? buildTrimmedTailAgentContext(state.mddDraft ?? "")
        : (state.mddDraft ?? "(vacío)");
      const contextParts = [
        briefBlock,
        "**Alcance clarificado:**",
        state.clarifiedScope || "(vacío)",
        "",
        opts?.trimmedTailContext
          ? "**Contexto MDD (referencia acotada):**"
          : "**Borrador actual del MDD:**",
        draftBlock,
      ];
      if (state.acceptedProposalDirective?.trim()) {
        const directive = state.acceptedProposalDirective.trim();
        const affectsSection6 = /\b(seguridad|mfa|totp|autenticaci[oó]n|rbac|roles?|permisos?|hash|jwt|oauth|sso)\b/i.test(directive);
        const priorityBlock = affectsSection6
          ? ["**Prioridad (léelo primero):** La ACCIÓN REQUERIDA siguiente tiene prioridad máxima. Aplícala en ## 6. Seguridad.", ""]
          : [];
        contextParts.unshift(
          ...priorityBlock,
          "**ACCIÓN REQUERIDA (usuario aceptó esta propuesta):**",
          directive,
          "Debes aplicar esta directiva en ## 6. Seguridad.",
          "",
        );
      }
      if (state.auditorFeedback?.trim()) {
        contextParts.push(
          "",
          "**Feedback del Auditor (relevante para Seguridad – aplicar en esta sección):**",
          state.auditorFeedback.trim(),
          "",
          "Aplica las correcciones que afecten a Seguridad: decisiones respaldadas por el modelo de datos, campos de auditoría, almacén de credenciales, etc.",
        );
      }
      const context = contextParts.filter(Boolean).join("\n");
      const prompt = `${SECURITY_ARCHITECT_MDD_PROMPT}\n\n---\n${context}`;
      const inputDraftLen = (state.mddDraft ?? "").trim().length;
      const startedAt = Date.now();
      const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
        tag: "Security",
        hardTimeoutMs: resolveMddTailNodeHardTimeoutMs(),
        maxAttempts: 2,
      });
      const rawText = response ? extractLlmText(response) : "";
      const text = stripThinkingTags(rawText);
      logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, prompt.length, rawText.length));

      LOG("[DIAG §6] LLM text len=%s rawPrefix=%s", text.length, text.slice(0, 200).replace(/\n/g, " "));
      let llmItems = text.trim() ? parseSecurityLlmResponse(text) : null;
      if (!llmItems && text.trim()) {
        llmItems = recoverSeguridadItemsFromRawLlmText(text);
        if (llmItems) LOG("[DIAG §6] recoverSeguridadItemsFromRawLlmText OK items=%s", llmItems.length);
      }
      if (!text.trim()) LOG("[DIAG §6] LLM vacío tras reintentos, usando fallback/preserve");
      LOG("[DIAG §6] llmItems=%s isCorrupted=%s isPlaceholder=%s",
        llmItems?.length ?? "null",
        llmItems ? isCorruptedSeguridadSlice(llmItems) : "n/a",
        llmItems ? isPlaceholderSeguridad(llmItems) : "n/a",
      );

      let seguridad = resolveSeguridadSlice(state, llmItems);
      // Retry adicional si cayó a placeholder sin §6 previa (invokeLlmWithRetry ya reintentó vacíos).
      const hasPrevSection6 =
        (state.mddStructured?.seguridad?.length && !isPlaceholderSeguridad(state.mddStructured.seguridad)) ||
        draftHasPreservableSection6(state.mddDraft ?? "");
      if (isPlaceholderSeguridad(seguridad) && !hasPrevSection6) {
        LOG("[DIAG §6] placeholder sin §6 previa tras retries — conservando placeholder mínimo");
      }
      const slice = { seguridad };
      const merged = mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "");
      let securitySectionMd = seguridadItemsToSection6Markdown(merged.seguridad ?? seguridad);
      const s6Body = securitySectionMd.replace(/^##[^\n]+\n+/, "").trim();
      if (
        (isPlaceholderSeguridad(seguridad) || !draftHasSubstantialSection6(`# MDD\n${securitySectionMd}`)) &&
        (state.securitySectionMd?.trim() || state.securityArchitectMddDraftSnapshot?.trim())
      ) {
        const reinjected = reinjectTailSectionsFromSnapshotsForGateLoop(state);
        if (reinjected?.securitySectionMd) {
          securitySectionMd = reinjected.securitySectionMd;
          LOG("[DIAG §6] placeholder/corto — restaurado desde snapshot (len=%s)", s6Body.length);
        }
      }
      if (sliceOnly) {
        LOG("ok sliceOnly seguridad items=%s", seguridad.length);
        return { mddStructured: { seguridad: merged.seguridad ?? seguridad }, securitySectionMd };
      }
      const mddDraft = buildMddDraftWithSection6(state, merged.seguridad ?? seguridad);
      const sum = getMddDraftSummary(mddDraft);
      LOG("ok seguridad §6 actualizada mddDraftLen=%s section2=%s", sum.length, sum.section2);
      logMddNodeOutput("Security", mddDraft, { inputLen: inputDraftLen });
      return { mddStructured: merged, mddDraft, securitySectionMd };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}
