/**
 * @fileoverview Nodo de consistencia cruzada — valida coherencia entre secciones del MDD.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { CROSS_CONSISTENCY_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import {
  applyCrossConsistencyPatches,
  applyDeterministicCrossConsistencyFixes,
  detectCrossConsistencyIssues,
  validateMddStructure,
} from "../utils/mdd-sanitize.js";
import { mddDeliveryGateHasBlockers } from "../utils/mdd-delivery-gate.util.js";
import { invokeLlmStructured } from "../utils/mdd-llm-structured.util.js";
import { resolveMddCrossConsistencyBudgetMs } from "../utils/mdd-llm-timeout.util.js";
import { createLlmAbortError } from "../utils/mdd-llm-stream-invoke.util.js";
import { z } from "zod";
import { logMddNodeOutput } from "../utils/mdd-sanitize.js";
import { preserveTailSectionsIfSubstantial, preserveTailSectionsFromSnapshots } from "../utils/mdd-section-preserve.util.js";
import { filterCrossConsistencyPatchesForPinned } from "../utils/design-first-pinned.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:CrossConsistency] ${msg}`, ...args);

const OK_CONSISTENT = "OK_CONSISTENT";

/** Intentos de transporte de la pasada LLM; el tope total lo fija `deadlineMs`. */
const CROSS_CONSISTENCY_LLM_MAX_ATTEMPTS = 2;

/**
 * Respuesta del revisor: el sentinela `OK_CONSISTENT` (se normaliza a `{ consistent: true }`) o un
 * array de parches find/replace. Un parche mal formado invalida todo el array (→ reparación).
 */
export const crossConsistencyOutputSchema = z.union([
  z.object({ consistent: z.literal(true) }),
  z.array(z.object({ find: z.string(), replace: z.string() })),
]);

export type CrossConsistencyOutput = z.infer<typeof crossConsistencyOutputSchema>;

/** Extractor: sentinela → `{"consistent":true}`; si no, el array JSON (fence o primer `[`…último `]`). */
export function extractCrossConsistencyJson(text: string): string | null {
  if (text.includes(OK_CONSISTENT)) return JSON.stringify({ consistent: true });
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function preserveTailAfterCrossConsistency(
  state: MDDStateType,
  baselineDraft: string,
  currentDraft: string,
): string {
  return preserveTailSectionsFromSnapshots(state, preserveTailSectionsIfSubstantial(baselineDraft, currentDraft));
}

function shouldSkipLlmPass(draft: string, issues: string[]): boolean {
  if (issues.length > 0) return false;
  if (mddDeliveryGateHasBlockers(draft)) return false;
  if (draft.length <= 5000) return false;
  const validation = validateMddStructure(draft);
  return validation.missingSections.length === 0 && validation.section3HasPayloads;
}

function buildCrossConsistencyUserMessage(draft: string, issues: string[]): string {
  const issuesBlock =
    issues.length > 0
      ? `**Incoherencias detectadas (corrige con parches mínimos):**\n${issues.map((i) => `- ${i}`).join("\n")}\n\n`
      : "";
  return `${issuesBlock}**Borrador del MDD:**\n${draft.slice(0, 24_000)}`;
}

/**
 * Consistencia cruzada híbrida (single-pass):
 * 1. Siempre aplica correcciones deterministas y actualiza mddDraft.
 * 2. Si quedan incoherencias (o el draft está incompleto), LLM devuelve parches find/replace directos.
 */
export function createMddCrossConsistencyNode(llm: BaseChatModel) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    LOG("iniciando revisión de consistencia cruzada...");
    const draft = state.mddDraft ?? "";
    if (!draft) return {};

    const baselineDraft = draft;
    const deterministicDraft = applyDeterministicCrossConsistencyFixes(draft);
    const issues = detectCrossConsistencyIssues(deterministicDraft);
    let current = deterministicDraft;

    if (shouldSkipLlmPass(deterministicDraft, issues)) {
      LOG(
        "determinista OK (%d chars, 0 issues) → skip LLM",
        deterministicDraft.length,
      );
      const preserved = preserveTailAfterCrossConsistency(state, baselineDraft, deterministicDraft);
      return preserved !== draft ? { mddDraft: preserved } : {};
    }

    LOG(
      "LLM parches directos (issues=%d, draftLen=%d)",
      issues.length,
      deterministicDraft.length,
    );

    try {
      const prompt = `${CROSS_CONSISTENCY_MDD_PROMPT}\n\n---\n${buildCrossConsistencyUserMessage(deterministicDraft, issues)}`;
      const inputLen = deterministicDraft.length;
      const result = await invokeLlmStructured({
        llm,
        messages: [new HumanMessage(prompt)],
        schema: crossConsistencyOutputSchema,
        tag: "CrossConsistency",
        extractJson: extractCrossConsistencyJson,
        maxAttempts: CROSS_CONSISTENCY_LLM_MAX_ATTEMPTS,
        deadlineMs: resolveMddCrossConsistencyBudgetMs(),
      });

      if (!result.ok) {
        if (result.reason === "aborted") throw createLlmAbortError("CrossConsistency");
        console.warn(
          `[MDD:CrossConsistency] salida LLM sin validar (reason=${result.reason} attempts=${result.attempts}` +
            `${result.lastError ? ` error=${result.lastError.slice(0, 160)}` : ""}) — conservando solo el paso determinista (inputLen=${inputLen})`,
        );
        current = preserveTailSectionsIfSubstantial(baselineDraft, current);
        return current !== draft ? { mddDraft: current } : {};
      }

      const output = result.value;
      if (!Array.isArray(output)) {
        LOG("LLM: OK_CONSISTENT");
        current = preserveTailAfterCrossConsistency(state, baselineDraft, current);
        return current !== draft ? { mddDraft: current } : {};
      }

      const patches = filterCrossConsistencyPatchesForPinned(output, state);
      if (patches.length === 0 && Array.isArray(output) && output.length > 0) {
        LOG("parches §3/§4 descartados (Design-First pinned)");
        current = preserveTailAfterCrossConsistency(state, baselineDraft, current);
        return current !== draft ? { mddDraft: current } : {};
      }

      if (patches.length === 0) {
        LOG("LLM devolvió 0 parches, conservando paso determinista");
        current = preserveTailAfterCrossConsistency(state, baselineDraft, current);
        return current !== draft ? { mddDraft: current } : {};
      }

      const patched = applyCrossConsistencyPatches(current, patches);
      current = applyDeterministicCrossConsistencyFixes(patched);
      const remaining = detectCrossConsistencyIssues(current);
      LOG("aplicados %d parches LLM; issues restantes=%d", patches.length, remaining.length);

      current = preserveTailAfterCrossConsistency(state, baselineDraft, current);
      if (current !== draft) {
        logMddNodeOutput("CrossConsistency", current, { inputLen });
        return { mddDraft: current };
      }
      return {};
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      LOG("error LLM: %s — conservando paso determinista", err instanceof Error ? err.message : String(err));
      current = preserveTailAfterCrossConsistency(state, baselineDraft, current);
      if (current !== draft) {
        logMddNodeOutput("CrossConsistency", current, { inputLen: deterministicDraft.length });
        return { mddDraft: current };
      }
      return {};
    }
  };
}
