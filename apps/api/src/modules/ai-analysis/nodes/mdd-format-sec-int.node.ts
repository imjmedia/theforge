/**
 * @fileoverview Nodo formateador de seguridad/integración — formatea secciones §6/§7.
 */

import type { MDDStateType } from "../state/index.js";
import {
  fixJwtAlgorithmCoherence,
  fixSection7OutboxNarrative,
  replaceSection6Or7InDraft,
} from "../utils/mdd-sanitize.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:FormatSecInt] ${msg}`, ...args);

/**
 * Merge node for parallel Security + Integration execution.
 * Both nodes stage their section markdown in securitySectionMd / integrationSectionMd
 * instead of writing directly to mddDraft, avoiding the LastValue reducer conflict.
 * This node applies both sections to the accumulated mddDraft and clears the staging fields.
 */
export function createMddFormatSecIntNode() {
  return (state: MDDStateType): Partial<MDDStateType> => {
    const sec6Md = state.securitySectionMd;
    const sec7Md = state.integrationSectionMd;

    if (!sec6Md && !sec7Md) return {};

    let draft = state.mddDraft ?? "";
    if (sec6Md) {
      draft = replaceSection6Or7InDraft(draft, 6, sec6Md);
      LOG("applied §6 draftLen=%s", draft.length);
    }
    if (sec7Md) {
      draft = replaceSection6Or7InDraft(draft, 7, sec7Md);
      LOG("applied §7 draftLen=%s", draft.length);
    }

    draft = fixSection7OutboxNarrative(fixJwtAlgorithmCoherence(draft));

    return {
      mddDraft: draft,
      securitySectionMd: undefined,
      integrationSectionMd: undefined,
    };
  };
}
