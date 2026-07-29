/**
 * Evita que el Clarifier sobrescriba un borrador sustancial con §1 mínima
 * cuando el DBGA aporta contexto amplio (p. ej. 90k chars).
 */

import type { MddComplexityLevel } from "../state/mdd-state.schema.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { extractContextSectionBody, replaceSection1BodyFromAnyHeading } from "./mdd-sanitize.js";
import {
  draftHasSubstantialSection1,
  draftIsSubstantialForScopedRepair,
  MIN_SUBSTANTIAL_SECTION1_BODY_LEN,
} from "./mdd-section-preserve.util.js";
import {
  buildHydratedSection1Body,
  draftMeetsSection1Quality,
  evaluateSection1BodyQuality,
} from "./mdd-section1-quality.util.js";

/** DBGA grande: exigir §1 sustancial o preservar/hidratar baseline. */
export const MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT = 5_000;

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
  const llmDraft = (params.llmDraft ?? "").trim();
  const previousDraft = (params.previousDraft ?? "").trim();
  const scope = (params.clarifiedScope ?? "").trim();
  const dbgaContent = (params.dbgaContent ?? "").trim();
  const dbgaLen = dbgaContent.length;
  const complexity = params.mddComplexity ?? "HIGH";
  const llmS1Body = extractContextSectionBody(llmDraft);
  const llmQuality = evaluateSection1BodyQuality(llmS1Body, complexity);

  if (llmDraft && draftMeetsSection1Quality(llmDraft, complexity) && draftIsSubstantialForScopedRepair(llmDraft)) {
    return llmDraft;
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
      llmDraft.length > 80 ? llmDraft : getMddTemplatePlaceholder(scope.slice(0, 300) || "(Desde DBGA)");
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
      return hydrated;
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

  if (llmDraft.length > 80) return llmDraft;
  return getMddTemplatePlaceholder(scope || "(Pendiente de definir según alcance.)");
}
