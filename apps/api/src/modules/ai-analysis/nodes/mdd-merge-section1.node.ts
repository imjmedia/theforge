/**
 * @fileoverview Nodo merger §1 — fusiona contenido de sección 1 en el documento principal.
 */

import type { MDDStateType } from "../state/index.js";
import { logMddNodeOutput, mergeSection1IntoDraft } from "../utils/mdd-sanitize.js";

const LOG = (msg: string, ...args: unknown[]) => console.log("[MDD:MergeSection1]", msg, ...args);

/**
 * Nodo que fusiona solo la sección 1 (Contexto y alcance) del output del Clarifier
 * en el draft anterior (previousMddDraftForMerge). Se usa cuando el usuario pidió
 * "solo contexto y alcance" / "generar contexto y alcance a partir del documento":
 * el Manager delegó con delegateTarget=clarifier_only; tras el Clarifier, este nodo
 * actualiza mddDraft con la nueva sección 1 y el resto del documento se mantiene.
 * Sin LLM.
 */
export function createMddMergeSection1Node(): (state: MDDStateType) => Promise<Partial<MDDStateType>> {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    if (state.delegateTarget !== "clarifier_only" || !state.previousMddDraftForMerge?.trim()) {
      LOG("skip: delegateTarget=%s o sin previousMddDraftForMerge", state.delegateTarget);
      return { delegateTarget: undefined, previousMddDraftForMerge: undefined };
    }
    const previous = state.previousMddDraftForMerge.trim();
    const clarifierOutput = (state.mddDraft ?? "").trim();
    const merged = mergeSection1IntoDraft(previous, clarifierOutput);
    LOG("merged section 1 into draft len=%s", merged.length);
    logMddNodeOutput("MergeSection1", merged);
    return {
      mddDraft: merged,
      delegateTarget: undefined,
      previousMddDraftForMerge: undefined,
    };
  };
}
