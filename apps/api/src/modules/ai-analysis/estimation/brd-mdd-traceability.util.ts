import { READINESS_CONSISTENCY_GREEN_MIN } from "@theforge/shared-types";
import { computeCrossDocumentConsistency } from "./consistency.util.js";
import type { CrossDocumentGap } from "./estimation.types.js";

export const BRD_MDD_TRACEABILITY_BLOCKER_PREFIX = "brd-mdd-traceability:";
export const MAX_BRD_MDD_TRACEABILITY_BLOCKERS = 8;

export type BrdToMddTraceabilityEvaluation = {
  score: number;
  gaps: CrossDocumentGap[];
  missingGaps: CrossDocumentGap[];
  blockers: string[];
};

/** Misma fuente que el semáforo (consistency.util) para auditoría y delivery gate. */
export function evaluateBrdToMddTraceability(
  brdMarkdown: string | null | undefined,
  mddMarkdown: string | null | undefined,
): BrdToMddTraceabilityEvaluation {
  const brd = brdMarkdown?.trim() ?? "";
  const mdd = mddMarkdown?.trim() ?? "";
  if (!brd || brd.length < 200 || !mdd) {
    return { score: 100, gaps: [], missingGaps: [], blockers: [] };
  }

  const { score, gaps } = computeCrossDocumentConsistency({
    brdContent: brd,
    mddContent: mdd,
  });
  const missingGaps = gaps.filter((g) => g.severity === "missing");
  const blockers = missingGaps
    .slice(0, MAX_BRD_MDD_TRACEABILITY_BLOCKERS)
    .map((g) => `${BRD_MDD_TRACEABILITY_BLOCKER_PREFIX} ${g.hint ?? `[BRD→MDD] ${g.concept}`}`);

  if (
    blockers.length === 0 &&
    score < READINESS_CONSISTENCY_GREEN_MIN &&
    gaps.length > 0
  ) {
    blockers.push(
      `${BRD_MDD_TRACEABILITY_BLOCKER_PREFIX} Trazabilidad BRD→MDD ${score}% (< ${READINESS_CONSISTENCY_GREEN_MIN}%). Cierra brechas en §1, §4 o §5.`,
    );
  }

  return { score, gaps, missingGaps, blockers };
}

export function hasBrdToMddTraceabilityBlockers(
  brdMarkdown: string | null | undefined,
  mddMarkdown: string | null | undefined,
): boolean {
  return evaluateBrdToMddTraceability(brdMarkdown, mddMarkdown).blockers.length > 0;
}
