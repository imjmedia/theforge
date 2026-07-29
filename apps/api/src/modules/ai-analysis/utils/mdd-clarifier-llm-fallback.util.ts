import { draftIsSubstantialForScopedRepair } from "./mdd-section-preserve.util.js";

/** true si el Clarifier debe conservar el borrador cuando el LLM no responde. */
export function shouldPreserveClarifierDraftOnLlmFailure(draftTrimmed: string): boolean {
  const draft = draftTrimmed.trim();
  return (
    draftIsSubstantialForScopedRepair(draft) ||
    (draft.length > 500 && /##\s*2\.\s*Arquitectura/i.test(draft))
  );
}
