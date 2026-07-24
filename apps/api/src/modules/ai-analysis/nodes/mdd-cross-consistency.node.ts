import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { CROSS_CONSISTENCY_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import {
  applyCrossConsistencyPatches,
  applyDeterministicCrossConsistencyFixes,
  detectCrossConsistencyIssues,
  parseCrossConsistencyPatches,
  validateMddStructure,
} from "../utils/mdd-sanitize.js";
import { mddDeliveryGateHasBlockers } from "../utils/mdd-delivery-gate.util.js";
import { preserveTailSectionsIfSubstantial } from "../utils/mdd-section-preserve.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:CrossConsistency] ${msg}`, ...args);

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
      const preserved = preserveTailSectionsIfSubstantial(baselineDraft, deterministicDraft);
      return preserved !== draft ? { mddDraft: preserved } : {};
    }

    LOG(
      "LLM parches directos (issues=%d, draftLen=%d)",
      issues.length,
      deterministicDraft.length,
    );

    try {
      const prompt = `${CROSS_CONSISTENCY_MDD_PROMPT}\n\n---\n${buildCrossConsistencyUserMessage(deterministicDraft, issues)}`;
      const response = await llm.invoke([new HumanMessage(prompt)]);
      const text = typeof response.content === "string" ? response.content : "";

      if (text.includes("OK_CONSISTENT")) {
        LOG("LLM: OK_CONSISTENT");
        current = preserveTailSectionsIfSubstantial(baselineDraft, current);
        return current !== draft ? { mddDraft: current } : {};
      }

      const patches = parseCrossConsistencyPatches(text);
      if (patches.length === 0) {
        LOG("LLM sin parches parseables, conservando paso determinista");
        current = preserveTailSectionsIfSubstantial(baselineDraft, current);
        return current !== draft ? { mddDraft: current } : {};
      }

      const patched = applyCrossConsistencyPatches(current, patches);
      current = applyDeterministicCrossConsistencyFixes(patched);
      const remaining = detectCrossConsistencyIssues(current);
      LOG("aplicados %d parches LLM; issues restantes=%d", patches.length, remaining.length);

      current = preserveTailSectionsIfSubstantial(baselineDraft, current);
      return current !== draft ? { mddDraft: current } : {};
    } catch (err) {
      LOG("error LLM: %s — conservando paso determinista", err instanceof Error ? err.message : String(err));
      current = preserveTailSectionsIfSubstantial(baselineDraft, current);
      return current !== draft ? { mddDraft: current } : {};
    }
  };
}
