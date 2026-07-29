import { extractSection5Body } from "./mdd-sanitize/section-merge.js";
import { guardTailSectionsForPersist } from "./mdd-section-preserve.util.js";

export type MddPersistTailGuardResult = {
  markdown: string;
  errorMessage?: string;
  restored: boolean;
  failedSections: number[];
};

/** Evalúa si el markdown post-prepare puede persistirse sin perder §2–§7 sustanciales. */
export function evaluateMddPersistTailGuard(
  prePrepareDraft: string,
  markdown: string,
  logTag = "PersistCheck",
): MddPersistTailGuardResult {
  const guard = guardTailSectionsForPersist(prePrepareDraft, markdown, logTag);
  if (guard.failedSections.length > 0) {
    const preS5Len = extractSection5Body(prePrepareDraft)?.length ?? 0;
    const postS5Len = extractSection5Body(guard.markdown)?.length ?? 0;
    return {
      markdown: guard.markdown,
      restored: guard.restored,
      failedSections: guard.failedSections,
      errorMessage:
        `El borrador final perdió contenido sustancial en §${guard.failedSections.join(", §")} tras prepare-output ` +
        `(§5 pre=${preS5Len} post=${postS5Len}). No se persistió la versión dañada; reintenta la generación del MDD.`,
    };
  }
  return {
    markdown: guard.markdown,
    restored: guard.restored,
    failedSections: [],
  };
}
