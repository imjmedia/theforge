/**
 * Informe unificado de auditoría SDD (fuente única para Workshop, MCP y semáforo compuesto).
 */

import type {
  ReadinessGapSummary,
  CompositeReadinessResult,
} from "@theforge/shared-types";
import { summarizeClassifiedGaps, UNIFIED_AUDIT_GAP_LIMIT } from "@theforge/shared-types";
import type { ConformanceSummary } from "../engine/mdd-quality-audit.util.js";
import type {
  ApiConformanceResult,
  ConformanceResult,
} from "../engine/conformance.service.js";

export type UnifiedAuditReport = {
  generatedAt: string;
  conformance: {
    blueprint: ConformanceResult;
    blueprintDataModel: ConformanceResult;
    api: ApiConformanceResult;
    logicFlows: ConformanceResult;
    infra: ConformanceResult;
  };
  /** Opinión LLM opcional (no sustituye badges heurísticos). */
  llmVerification?: {
    blueprint: ConformanceResult;
    api: ApiConformanceResult;
    logicFlows: ConformanceResult;
    infra: ConformanceResult;
  };
  conformanceSummary: ConformanceSummary;
  crossArtifactGaps: string[];
  gapSummary: ReadinessGapSummary;
  compositeReadiness?: CompositeReadinessResult;
  consistencyScore?: number;
  conformanceOk: boolean;
};

export function buildUnifiedAuditReport(params: {
  conformance: UnifiedAuditReport["conformance"];
  llmVerification?: UnifiedAuditReport["llmVerification"];
  conformanceSummary: ConformanceSummary;
  crossArtifactGaps: string[];
  compositeReadiness?: CompositeReadinessResult;
  consistencyScore?: number;
  gapLimit?: number;
}): UnifiedAuditReport {
  const limit = params.gapLimit ?? UNIFIED_AUDIT_GAP_LIMIT;
  return {
    generatedAt: new Date().toISOString(),
    conformance: params.conformance,
    llmVerification: params.llmVerification,
    conformanceSummary: params.conformanceSummary,
    crossArtifactGaps: params.crossArtifactGaps.slice(0, limit),
    gapSummary: summarizeClassifiedGaps(params.crossArtifactGaps, limit),
    compositeReadiness: params.compositeReadiness,
    consistencyScore: params.consistencyScore,
    conformanceOk: params.conformanceSummary.ok,
  };
}
