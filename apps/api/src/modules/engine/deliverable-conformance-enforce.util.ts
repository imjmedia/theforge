/**
 * Reparación determinista de entregables vs MDD (post-LLM / post-cascada).
 */

import { repairApiProgrammaticGaps } from "./api-conformance-repair.util.js";
import { repairBlueprintProgrammaticGaps } from "./blueprint-conformance-repair.util.js";
import { repairLogicFlowsProgrammaticGaps } from "./logic-flows-conformance-repair.util.js";
import {
  isLogicFlowsInsufficientContent,
  resolveLegacyAsIsLogicFlowsDeterministic,
} from "../ai/utils/legacy-as-is-logic-flows-ariadne.util.js";
import { checkApiVsMdd } from "./conformance.service.js";

export type DeliverableConformancePatch = {
  apiContractsContent?: string;
  blueprintContent?: string;
  logicFlowsContent?: string;
};

const MIN_DOC = 80;

/** Calcula parches deterministas sin LLM para alinear derivados al MDD. */
export function buildDeterministicDeliverableConformancePatches(
  mddContent: string,
  source: {
    apiContractsContent?: string | null;
    blueprintContent?: string | null;
    logicFlowsContent?: string | null;
  },
  options?: { codebaseDoc?: string | null },
): DeliverableConformancePatch {
  const patches: DeliverableConformancePatch = {};
  const mdd = (mddContent ?? "").trim();
  if (!mdd) return patches;

  const api = (source.apiContractsContent ?? "").trim();
  if (api.length >= MIN_DOC) {
    const fixed = repairApiProgrammaticGaps(mdd, api);
    if (fixed !== api && checkApiVsMdd(mdd, fixed).ok) {
      patches.apiContractsContent = fixed;
    }
  }

  const blueprint = (source.blueprintContent ?? "").trim();
  if (blueprint.length >= MIN_DOC) {
    const fixed = repairBlueprintProgrammaticGaps(mdd, blueprint);
    if (fixed !== blueprint) patches.blueprintContent = fixed;
  }

  const flows = (source.logicFlowsContent ?? "").trim();
  if (isLogicFlowsInsufficientContent(flows)) {
    const built = resolveLegacyAsIsLogicFlowsDeterministic({
      mddMarkdown: mdd,
      codebaseDoc: options?.codebaseDoc,
    });
    if (built) patches.logicFlowsContent = built;
  } else if (flows.length >= MIN_DOC) {
    const fixed = repairLogicFlowsProgrammaticGaps(mdd, flows);
    if (fixed !== flows) patches.logicFlowsContent = fixed;
  }

  return patches;
}
