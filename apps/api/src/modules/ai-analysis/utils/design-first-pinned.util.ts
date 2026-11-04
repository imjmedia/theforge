import { createHash } from "node:crypto";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import { normalizeBenchmarkDocumentBody } from "@theforge/shared-types";
import type { MDDStateType } from "../state/index.js";
import type { DeliveryGateFixTarget } from "./mdd-delivery-gate-loop.util.js";
import {
  extractContratosSectionBody,
  extractSection3Body,
  replaceMddSection3Body,
  replaceMddSection4Body,
} from "./mdd-sanitize.js";
import type { CrossConsistencyPatch } from "./mdd-sanitize/cross-consistency.js";

export type DesignFirstPinnedState = {
  s3: string;
  s4: string;
  pagHash: string;
  pinnedSections?: number[];
};

export function isDesignFirstPinnedActive(state: Pick<MDDStateType, "designFirstPinned">): boolean {
  const pin = state.designFirstPinned;
  return !!(pin?.s3?.trim() && pin?.s4?.trim() && pin?.pagHash?.trim());
}

export function hashMddSectionBody(body: string): string {
  return createHash("sha256").update((body ?? "").trimEnd(), "utf8").digest("hex");
}

/** Hash estable del PAG persistido (misma canonicalización que benchmark JSON). */
export function hashProjectArchitectureGraphPag(pag: ProjectArchitectureGraph): string {
  const canonical = normalizeBenchmarkDocumentBody(JSON.stringify(pag));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function resolvePagHashForStage(
  pag: ProjectArchitectureGraph,
  architectureGraphSourceHash: string | null | undefined,
): string {
  const stored = architectureGraphSourceHash?.trim();
  if (stored) return stored;
  return hashProjectArchitectureGraphPag(pag);
}

function pinnedSectionNumbers(state: Pick<MDDStateType, "designFirstPinned">): readonly number[] {
  const raw = state.designFirstPinned?.pinnedSections;
  if (raw?.length) return raw;
  return [3, 4];
}

export function patchTouchesPinnedSection(
  patch: CrossConsistencyPatch,
  pinnedSections: readonly number[] = [3, 4],
): boolean {
  const blob = `${patch.find}\n${patch.replace}`;
  if (pinnedSections.includes(3)) {
    if (/##\s*3\./i.test(blob) || /\bCREATE\s+TABLE\b/i.test(blob) || /```\s*mermaid/i.test(blob)) {
      return true;
    }
  }
  if (pinnedSections.includes(4)) {
    if (/##\s*4\./i.test(blob) || /Contratos\s+de\s+API/i.test(blob) || /\|\s*M[eé]todo\s*\|/i.test(blob)) {
      return true;
    }
  }
  return false;
}

export function filterCrossConsistencyPatchesForPinned(
  patches: CrossConsistencyPatch[],
  state: Pick<MDDStateType, "designFirstPinned">,
): CrossConsistencyPatch[] {
  if (!isDesignFirstPinnedActive(state)) return patches;
  const sections = pinnedSectionNumbers(state);
  return patches.filter((p) => !patchTouchesPinnedSection(p, sections));
}

export function injectDesignFirstSealedSectionsIntoDraft(
  draft: string,
  pin: DesignFirstPinnedState,
): string {
  let out = (draft ?? "").trim();
  if (!out) return out;
  out = replaceMddSection3Body(out, pin.s3.trimEnd());
  out = replaceMddSection4Body(out, pin.s4.trimEnd());
  return out;
}

export type PinnedSectionDriftMetric = {
  section: 3 | 4;
  expectedHash: string;
  actualHash: string;
};

/** Reimpone §3/§4 selladas y devuelve drift detectado (RNF-06). */
export function reimposeDesignFirstPinnedSections(
  draft: string,
  state: Pick<MDDStateType, "designFirstPinned">,
): { draft: string; drifts: PinnedSectionDriftMetric[] } {
  const pin = state.designFirstPinned;
  if (!pin?.s3?.trim() || !pin?.s4?.trim()) {
    return { draft, drifts: [] };
  }
  const sections = pinnedSectionNumbers(state);
  const drifts: PinnedSectionDriftMetric[] = [];
  let out = draft;

  if (sections.includes(3)) {
    const expectedHash = hashMddSectionBody(pin.s3);
    const before = extractSection3Body(out) ?? "";
    const actualHash = hashMddSectionBody(before);
    if (actualHash !== expectedHash) {
      drifts.push({ section: 3, expectedHash, actualHash });
    }
    out = replaceMddSection3Body(out, pin.s3.trimEnd());
  }
  if (sections.includes(4)) {
    const expectedHash = hashMddSectionBody(pin.s4);
    const before = extractContratosSectionBody(out) ?? "";
    const actualHash = hashMddSectionBody(before);
    if (actualHash !== expectedHash) {
      drifts.push({ section: 4, expectedHash, actualHash });
    }
    out = replaceMddSection4Body(out, pin.s4.trimEnd());
  }

  return { draft: out, drifts };
}

export function logPinnedSectionDriftMetric(drifts: PinnedSectionDriftMetric[]): void {
  if (drifts.length === 0) return;
  for (const d of drifts) {
    console.log(
      `[MDD:metric] pinned_section_drift section=${d.section} expected=${d.expectedHash.slice(0, 12)} actual=${d.actualHash.slice(0, 12)}`,
    );
  }
}

export function buildDesignFirstPinnedSnapshots(
  mddDraft: string,
  pin: DesignFirstPinnedState,
): {
  dataModelArchitectMddDraftSnapshot: string;
  apiContractsArchitectMddDraftSnapshot: string;
} {
  const sealed = injectDesignFirstSealedSectionsIntoDraft(mddDraft, pin);
  return {
    dataModelArchitectMddDraftSnapshot: sealed,
    apiContractsArchitectMddDraftSnapshot: sealed,
  };
}

export function redirectPinnedDeliveryGateFixTarget(
  target: DeliveryGateFixTarget,
  state: Pick<MDDStateType, "designFirstPinned">,
): DeliveryGateFixTarget {
  if (!isDesignFirstPinnedActive(state)) return target;
  if (target === "data_model" || target === "api_contracts") {
    return "clarifier";
  }
  return target;
}

export function pinnedStackArchitectRouteTarget(
  state: MDDStateType,
  options?: { usePostCriticParallel?: boolean },
): "data_model" | "section5" | "post_critic_parallel" {
  if (!isDesignFirstPinnedActive(state)) return "data_model";
  if (options?.usePostCriticParallel) return "post_critic_parallel";
  return "section5";
}

export const DESIGN_FIRST_PINNED_PHASE2_GAP_MESSAGE =
  "Las secciones §3/§4 compiladas desde el diseño no coinciden con el PAG sellado. Vuelve a la fase 2 del Workshop, recompila el contrato (PAG) y reinicia el job MDD.";

export function evaluateDesignFirstPinnedSectionAuditorGaps(
  draft: string,
  state: Pick<MDDStateType, "designFirstPinned">,
): Array<{ sections: string[]; issue: string; fix: string }> {
  if (!isDesignFirstPinnedActive(state)) return [];
  const { drifts } = reimposeDesignFirstPinnedSections(draft, state);
  return drifts.map((d) => ({
    sections: d.section === 3 ? ["Sección 3"] : ["Sección 4"],
    issue: `§${d.section} desviada del PAG sellado (hash distinto).`,
    fix: DESIGN_FIRST_PINNED_PHASE2_GAP_MESSAGE,
  }));
}
