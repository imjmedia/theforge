import { peelDocumentBodyForPersist } from "@theforge/shared-types";
import type { MDDStateType } from "../state/index.js";
import {
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  draftHasPersistableSection4,
  draftIsSubstantialForScopedRepair,
  preserveValidatedSectionsIfSubstantial,
} from "./mdd-section-preserve.util.js";

/** Recorte seguro de DBGA/BRD para fallback del Clarifier (sin stamp ni cabecera vacía). */
export function dbgaSnippetForClarifierFallback(dbgaContent: string, maxLen = 1500): string {
  const stripBoilerplate = (raw: string): string =>
    raw
      .replace(/<!--\s*theforge-doc:created=[^>]+\s*-->\s*\n?/gi, "")
      .replace(/^>\s*📅[^\n]*\n?/gm, "")
      .replace(/^##\s*Contexto\s*[—–-]\s*BRD[^\n]*\n+/i, "")
      .trim();

  let body = stripBoilerplate(peelDocumentBodyForPersist((dbgaContent ?? "").trim()));
  if (body.length < 40) {
    body = stripBoilerplate((dbgaContent ?? "").trim());
  }
  return body.slice(0, maxLen);
}

/**
 * Borrador de trabajo del Clarifier: en revisión por delivery gate usa
 * `previousMddDraftForMerge` si el draft actual regresó a cascarón.
 */
export function resolveClarifierWorkingDraft(
  state: Pick<
    MDDStateType,
    "mddDraft" | "previousMddDraftForMerge" | "deliveryGateLoopActive" | "deliveryGateFixTarget"
  >,
): string {
  const current = (state.mddDraft ?? "").trim();
  const previous = (state.previousMddDraftForMerge ?? "").trim();
  if (!previous) return current;

  const deliveryGateClarifier =
    state.deliveryGateLoopActive === true && state.deliveryGateFixTarget === "clarifier";

  const previousHasCoreSections =
    draftHasSubstantialSection2(previous) &&
    (draftHasSubstantialSection3(previous) || draftHasPersistableSection4(previous));

  if (deliveryGateClarifier && previousHasCoreSections) {
    if (!draftIsSubstantialForScopedRepair(current) || current.length < previous.length * 0.5) {
      return previous;
    }
  }

  if (
    deliveryGateClarifier ||
    (draftIsSubstantialForScopedRepair(previous) &&
      (!draftIsSubstantialForScopedRepair(current) || current.length < previous.length * 0.5))
  ) {
    return preserveValidatedSectionsIfSubstantial(previous, current);
  }
  return current;
}

/** true si el Clarifier debe conservar el borrador cuando el LLM no responde. */
export function shouldPreserveClarifierDraftOnLlmFailure(draftTrimmed: string): boolean {
  const draft = draftTrimmed.trim();
  return (
    draftIsSubstantialForScopedRepair(draft) ||
    (draft.length > 500 && /##\s*2\.\s*Arquitectura/i.test(draft))
  );
}
