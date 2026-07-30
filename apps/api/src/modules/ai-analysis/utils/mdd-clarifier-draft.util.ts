/**
 * Evita que el Clarifier sobrescriba un borrador sustancial con §1 mínima
 * cuando el DBGA aporta contexto amplio (p. ej. 90k chars).
 */

import { stripGovernanceSection } from "@theforge/shared-types/mdd-governance-patterns";
import type { MddComplexityLevel } from "../state/mdd-state.schema.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
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
import {
  buildHydratedSection1Body,
  draftMeetsSection1Quality,
  evaluateSection1BodyQuality,
} from "./mdd-section1-quality.util.js";

/** Bloques de `clarifiedScope` / §1 que no deben volcar en el cuerpo de §1. */
const CLARIFIER_AGENT_BRIEF_IN_SECTION1_RE =
  /\n#{1,3}\s*Resumen para agentes(?:\s*\([^)]*\))?(?:\s+siguientes)?[\s\S]*?(?=\n#{1,3}\s|\n##\s*[2-7]\.\s|$)/gi;

const CLARIFIER_AGENT_BRIEF_HEADING_RE =
  /\n##\s*Resumen para agentes(?:\s*\([^)]*\))?(?:\s+siguientes)?[\s\S]*?(?=\n##\s*[2-7]\.\s)/gi;

const CLARIFIER_DECISIONES_VALIDADAS_RE =
  /\n\*\*Decisiones validadas:\*\*[\s\S]*?(?=\n#{1,3}\s|\n##\s*[2-7]\.\s|$)/gi;

/** Quita metadatos de agentes (scope leak) del borrador — bloque entre §1 y §2. */
export function stripClarifierAgentBriefFromSection1(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!/Resumen para agentes/i.test(trimmed)) return trimmed;
  let out = trimmed.replace(CLARIFIER_AGENT_BRIEF_HEADING_RE, "\n");
  const body = extractContextSectionBody(out);
  if (body?.trim()) {
    const cleanedBody = body
      .replace(CLARIFIER_AGENT_BRIEF_IN_SECTION1_RE, "")
      .replace(CLARIFIER_DECISIONES_VALIDADAS_RE, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (cleanedBody !== body.trim()) {
      out = replaceSection1BodyFromAnyHeading(out, cleanedBody);
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Evita usar `clarifiedScope` crudo como fallback de §1 (sólo primer párrafo útil). */
export function section1FallbackFromClarifiedScope(scope: string): string {
  const trimmed = (scope ?? "").trim();
  if (!trimmed) return "(Pendiente)";
  const withoutAgentBrief = trimmed
    .replace(CLARIFIER_AGENT_BRIEF_IN_SECTION1_RE, "")
    .replace(CLARIFIER_DECISIONES_VALIDADAS_RE, "")
    .replace(/^#{1,3}\s*Resumen para agentes(?:\s*\([^)]*\))?(?:\s+siguientes)?\s*/im, "")
    .trim();
  const firstParagraph = (withoutAgentBrief.split(/\n\n+/)[0] ?? withoutAgentBrief).trim();
  if (firstParagraph.length >= 20) return firstParagraph.slice(0, 800);
  return withoutAgentBrief.slice(0, 300) || "(Desde DBGA)";
}

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
  mddComplexity?: MddComplexityLevel;
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
  const complexity = params.mddComplexity ?? "HIGH";
  const llmS1Body = extractContextSectionBody(llmDraft);
  const llmQuality = evaluateSection1BodyQuality(llmS1Body, complexity);

  if (llmDraft && draftMeetsSection1Quality(llmDraft, complexity) && draftIsSubstantialForScopedRepair(llmDraft)) {
    return stripClarifierAgentBriefFromSection1(llmDraft);
  }

  if (
    previousDraft.length > 200 &&
    draftMeetsSection1Quality(previousDraft, complexity) &&
    !draftMeetsSection1Quality(llmDraft, complexity)
  ) {
    const s1Len = llmS1Body?.length ?? 0;
    log("preserve baseline draft (LLM §1 quality fail, §1Len=%s)", s1Len);
    if (draftHasSubstantialSection1(llmDraft)) {
      const body = extractContextSectionBody(llmDraft);
      return body ? replaceSection1BodyFromAnyHeading(previousDraft, body) : previousDraft;
    }
    return previousDraft;
  }

  const needsHydration =
    dbgaLen >= MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT && !draftMeetsSection1Quality(llmDraft, complexity);

  if (needsHydration) {
    const hydratedBody = buildHydratedSection1Body({
      existingBody: llmS1Body ?? "",
      clarifiedScope: scope,
      dbgaContent,
      complexity,
    });
    const shell =
      llmDraft.length > 80
        ? assembleClarifierMddDraft(llmDraft, section1FallbackFromClarifiedScope(scope))
        : getMddTemplatePlaceholder(section1FallbackFromClarifiedScope(scope));
    const hydrated = replaceSection1BodyFromAnyHeading(shell, hydratedBody);
    const hydratedQuality = evaluateSection1BodyQuality(extractContextSectionBody(hydrated), complexity);
    const hydratedS1Len = extractContextSectionBody(hydrated)?.length ?? 0;
    log(
      "hydrate §1 from scope/dbga (dbgaLen=%s, §1Len=%s, qualityOk=%s, missing=%s)",
      dbgaLen,
      hydratedS1Len,
      hydratedQuality.ok,
      hydratedQuality.missingSubsections.join("|") || "none",
    );
    if (hydratedQuality.ok || hydratedS1Len > llmQuality.bodyLen) {
      return stripClarifierAgentBriefFromSection1(hydrated);
    }

    if (!draftHasSubstantialSection1(llmDraft)) {
      const scopeBody =
        scope.length >= MIN_SUBSTANTIAL_SECTION1_BODY_LEN
          ? scope.slice(0, 12_000)
          : dbgaContent.slice(0, 8_000);
      const fallbackHydrated = replaceSection1BodyFromAnyHeading(shell, scopeBody);
      if (draftHasSubstantialSection1(fallbackHydrated)) {
        return fallbackHydrated;
      }
    }
  }

  if (llmDraft.length > 80) return stripClarifierAgentBriefFromSection1(llmDraft);
  return getMddTemplatePlaceholder(scope || "(Pendiente de definir según alcance.)");
}
