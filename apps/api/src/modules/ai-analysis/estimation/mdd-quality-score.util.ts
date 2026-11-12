import type { EstimationComplexity } from "./estimation.types.js";
import type { AuditorGaps } from "./estimation.types.js";
import { computeTraceabilityGaps } from "../../engine/mdd-internal-audit.util.js";
import {
  computeConsistencyGaps,
  detectReferenceSections,
} from "./mdd-section-detectors.util.js";

function isRelaxedComplexity(c: EstimationComplexity): boolean {
  return c === "LOW" || c === "MEDIUM";
}

function adjustGapsForEstimationComplexity(
  gaps: ReturnType<typeof computeConsistencyGaps>,
  complexity: EstimationComplexity,
): ReturnType<typeof computeConsistencyGaps> {
  if (complexity === "HIGH") return gaps;
  const g = { ...gaps };
  if (isRelaxedComplexity(complexity)) {
    g.securityCompletenessGap = 0;
    g.infraStackGap = 0;
    g.securityEdgeCaseGap = 0;
  }
  if (complexity === "LOW") {
    g.missingManifest = 0;
  }
  return g;
}

/** Calidad MDD 0–100 por regex (misma heurística que el panel previo al núcleo). */
export function computeMddQualityRegex(md: string, complexity: EstimationComplexity = "HIGH"): number {
  const trimmed = (md ?? "").trim();
  if (!trimmed) return 0;
  const sections = detectReferenceSections(trimmed);
  const gaps = adjustGapsForEstimationComplexity(computeConsistencyGaps(trimmed), complexity);
  const traceability = computeTraceabilityGaps(trimmed);
  const traceabilityPenalty = traceability.inconsistentSections.length > 0 ? 15 : 0;
  const basePrecisionRaw = (sections.db + sections.endpoints + sections.security + sections.infra) * 25;
  const gapPenalty =
    gaps.contradictionGap * 22 +
    gaps.securityCompletenessGap * 12 +
    gaps.missingManifest * 16 +
    gaps.mermaidParityGap * 8 +
    gaps.infraStackGap * 10 +
    gaps.securityEdgeCaseGap * 8 +
    traceabilityPenalty;
  return Math.min(100, Math.round(Math.max(0, basePrecisionRaw - gapPenalty)));
}

export function resolveMddQualityScore(
  md: string,
  complexity: EstimationComplexity,
  auditorGaps?: AuditorGaps,
): { score: number; source: "auditor" | "regex"; auditorActive: boolean; auditorScore?: number } {
  const auditorForQuality =
    typeof auditorGaps?.score === "number" ? auditorGaps : undefined;
  if (auditorForQuality && typeof auditorForQuality.score === "number") {
    const score = Math.min(100, Math.max(0, Math.round(auditorForQuality.score)));
    return { score, source: "auditor", auditorActive: true, auditorScore: score };
  }
  const score = computeMddQualityRegex(md, complexity);
  return { score, source: "regex", auditorActive: false };
}
