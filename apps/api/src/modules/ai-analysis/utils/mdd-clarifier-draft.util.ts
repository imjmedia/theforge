/**
 * Evita que el Clarifier sobrescriba un borrador sustancial con §1 mínima
 * cuando el DBGA aporta contexto amplio (p. ej. 90k chars).
 */

import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { extractContextSectionBody, replaceSection1BodyFromAnyHeading } from "./mdd-sanitize.js";
import {
  draftHasSubstantialSection1,
  draftIsSubstantialForScopedRepair,
  MIN_SUBSTANTIAL_SECTION1_BODY_LEN,
} from "./mdd-section-preserve.util.js";

/** DBGA grande: exigir §1 sustancial o preservar/hidratar baseline. */
export const MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT = 5_000;

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
  const llmDraft = (params.llmDraft ?? "").trim();
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
    const scopeBody =
      scope.length >= MIN_SUBSTANTIAL_SECTION1_BODY_LEN
        ? scope.slice(0, 12_000)
        : dbgaContent.slice(0, 8_000);
    const shell =
      llmDraft.length > 80 ? llmDraft : getMddTemplatePlaceholder(scope.slice(0, 300) || "(Desde DBGA)");
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
