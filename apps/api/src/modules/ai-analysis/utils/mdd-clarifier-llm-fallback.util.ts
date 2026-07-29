import { peelDocumentBodyForPersist } from "@theforge/shared-types";
import { draftIsSubstantialForScopedRepair } from "./mdd-section-preserve.util.js";

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

/** true si el Clarifier debe conservar el borrador cuando el LLM no responde. */
export function shouldPreserveClarifierDraftOnLlmFailure(draftTrimmed: string): boolean {
  const draft = draftTrimmed.trim();
  return (
    draftIsSubstantialForScopedRepair(draft) ||
    (draft.length > 500 && /##\s*2\.\s*Arquitectura/i.test(draft))
  );
}
