/**
 * Evita que el Clarifier sobrescriba un borrador sustancial con §1 mínima
 * cuando el DBGA aporta contexto amplio (p. ej. 90k chars).
 */

import { stripGovernanceSection } from "@theforge/shared-types/mdd-governance-patterns";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { buildDbgaHydrationSource } from "./mdd-clarifier-dbga-brief.util.js";
import {
  deduplicateMddDraftSections,
  extractContextSectionBody,
  mddHasDuplicateSectionHeadings,
  replaceSection1BodyFromAnyHeading,
} from "./mdd-sanitize.js";
import {
  draftHasSubstantialSection1,
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  draftIsSubstantialForScopedRepair,
  MIN_SUBSTANTIAL_SECTION1_BODY_LEN,
} from "./mdd-section-preserve.util.js";

/** Removes governance wizard from LLM draft — system re-injects on persist. */
export function stripClarifierGovernanceFromDraft(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return trimmed;
  return stripGovernanceSection(trimmed).trim();
}

/**
 * Assembles full MDD shell when LLM returned only §1 or placeholders for §2–7.
 * Preserves substantial §1 from LLM; fills missing sections from template.
 */
export function assembleClarifierMddDraft(llmDraft: string, section1Fallback?: string): string {
  const stripped = stripClarifierGovernanceFromDraft(llmDraft);
  const s1Body = extractContextSectionBody(stripped)?.trim();
  const hasCanonSections = /\n##\s*2\.\s*Arquitectura/i.test(stripped);
  if (hasCanonSections) {
    if (draftIsSubstantialForScopedRepair(stripped)) return stripped;
    if (draftHasSubstantialSection2(stripped) || draftHasSubstantialSection3(stripped)) return stripped;
    if (s1Body && s1Body.length >= 20) return stripped;
  }
  const s1 =
    s1Body && s1Body.length >= 20
      ? s1Body
      : (section1Fallback ?? s1Body ?? "(Pendiente)").trim() || "(Pendiente)";
  return getMddTemplatePlaceholder(s1);
}

/** DBGA grande: exigir §1 sustancial o preservar/hidratar baseline. */
export const MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT = 5_000;

/** Ratio máximo newDraft/baseline para merge §1-only tras retry (evita bloat 20× job 71). */
export const CLARIFIER_MERGE_MAX_BASELINE_RATIO = 3;

export const CLARIFIER_MERGE_MAX_DRAFT_LEN = 400_000;

/**
 * Baseline seguro para merge §1-only: sin headings duplicados ni hinchazón absurda.
 */
export function isSafeClarifierMergeBaseline(previousDraft: string, newDraft: string): boolean {
  const raw = (previousDraft ?? "").trim();
  if (raw.length <= 200) return false;
  if (mddHasDuplicateSectionHeadings(raw)) return false;
  const baseline = deduplicateMddDraftSections(raw);
  if (mddHasDuplicateSectionHeadings(baseline)) return false;
  const newLen = (newDraft ?? "").trim().length;
  if (newLen > CLARIFIER_MERGE_MAX_DRAFT_LEN) return false;
  if (baseline.length > 0 && newLen > baseline.length * CLARIFIER_MERGE_MAX_BASELINE_RATIO) return false;
  return true;
}

export type FinalizeClarifierDraftParams = {
  llmDraft: string;
  previousDraft: string;
  clarifiedScope: string;
  dbgaContent: string;
  log?: (msg: string, ...args: unknown[]) => void;
};

/**
 * Devuelve el borrador a persistir tras el Clarifier.
 * - Preserva baseline si el LLM regresa §1 insustancial.
 * - Hidrata §1 desde scope/DBGA cuando hay entrada grande y draft vacío/corrupto.
 */
export function finalizeClarifierDraft(params: FinalizeClarifierDraftParams): string {
  const log = params.log ?? (() => {});
  const llmDraft = stripClarifierGovernanceFromDraft(params.llmDraft ?? "");
  const previousDraft = (params.previousDraft ?? "").trim();
  const scope = (params.clarifiedScope ?? "").trim();
  const dbgaContent = (params.dbgaContent ?? "").trim();
  const dbgaLen = dbgaContent.length;

  if (llmDraft && draftHasSubstantialSection1(llmDraft) && draftIsSubstantialForScopedRepair(llmDraft)) {
    return llmDraft;
  }

  if (
    previousDraft.length > 200 &&
    draftHasSubstantialSection1(previousDraft) &&
    !draftHasSubstantialSection1(llmDraft)
  ) {
    const s1Len = extractContextSectionBody(llmDraft)?.length ?? 0;
    log("preserve baseline draft (LLM §1 insubstantial, §1Len=%s)", s1Len);
    if (draftHasSubstantialSection1(llmDraft)) {
      const body = extractContextSectionBody(llmDraft);
      return body ? replaceSection1BodyFromAnyHeading(previousDraft, body) : previousDraft;
    }
    return previousDraft;
  }

  if (dbgaLen >= MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT && !draftHasSubstantialSection1(llmDraft)) {
    const scopeBody = buildDbgaHydrationSource({
      clarifiedScope: scope,
      dbgaContent,
      minScopeLen: MIN_SUBSTANTIAL_SECTION1_BODY_LEN,
    });
    const shell =
      llmDraft.length > 80
        ? assembleClarifierMddDraft(llmDraft, scope.slice(0, 300) || "(Desde DBGA)")
        : getMddTemplatePlaceholder(scope.slice(0, 300) || "(Desde DBGA)");
    const hydrated = replaceSection1BodyFromAnyHeading(shell, scopeBody);
    const hydratedS1Len = extractContextSectionBody(hydrated)?.length ?? 0;
    log("hydrate §1 from scope/dbga (dbgaLen=%s, §1Len=%s)", dbgaLen, hydratedS1Len);
    if (draftHasSubstantialSection1(hydrated)) {
      return hydrated;
    }
  }

  if (llmDraft.length > 80) return llmDraft;
  return getMddTemplatePlaceholder(scope || "(Pendiente de definir según alcance.)");
}
