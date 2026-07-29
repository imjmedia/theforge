/**
 * Contexto compuesto para evaluación de semáforo (conformance + gaps + trazabilidad).
 */

import type { Project, Stage } from "@theforge/database";
import { ComplexityLevel } from "@theforge/database";
import {
  applyCompositeReadinessGates,
  type CompositeReadinessResult,
  classifyGap,
} from "@theforge/shared-types";
import { ConformanceService } from "../engine/conformance.service.js";
import {
  buildConformanceSummary,
  collectConformanceGaps,
  type ProjectDeliverableSource,
} from "./conformance-gaps.util.js";
import {
  buildLowMediumConformanceSummary,
  collectLowMediumReadinessGaps,
} from "../engine/low-medium-readiness.util.js";
import { computeCrossDocumentConsistency } from "../ai-analysis/estimation/consistency.util.js";
import type { PlanningDocumentFields } from "../ai-analysis/estimation/estimation.types.js";
import { countSddPrecisionGaps } from "./project-semaphore.util.js";
import { SemaphoreService, type SemaphoreEvaluationInput } from "../engine/semaphore.service.js";
import type { Status } from "@theforge/database";

export type CompositeSemaphoreEvaluation = {
  status: Status;
  precisionScore: number;
  composite: CompositeReadinessResult;
  crossArtifactGapCount: number;
  humanRequiredGapCount: number;
  conformanceOk: boolean;
  consistencyScore?: number;
  readinessProfile: "high_mdd" | "low" | "medium";
};

export function buildProjectDeliverableSource(
  project: Project,
  stage?: Stage | null,
): ProjectDeliverableSource {
  return {
    blueprintContent: project.blueprintContent,
    apiContractsContent: project.apiContractsContent,
    logicFlowsContent: project.logicFlowsContent,
    infraContent: project.infraContent,
    architectureContent: project.architectureContent,
    tasksContent: project.tasksContent,
    useCasesContent: project.useCasesContent,
    userStoriesContent: project.userStoriesContent,
    uiScreensContent: project.uiScreensContent,
    phase0SummaryContent: project.phase0SummaryContent,
    specContent: project.specContent,
    uxUiGuideContent: project.uxUiGuideContent,
    brdContent: stage?.brdContent ?? null,
    dbgaContent: project.dbgaContent ?? null,
    domainInventory: stage?.domainInventory ?? null,
    mddContent: stage?.mddContent ?? null,
  };
}

function hasCanonicalMdd(source: ProjectDeliverableSource): boolean {
  return (source.mddContent ?? "").trim().length >= 120;
}

const SDD_DERIVATIVE_FIELDS = [
  "blueprintContent",
  "apiContractsContent",
  "logicFlowsContent",
  "infraContent",
] as const;

const MIN_DERIVATIVE_DOC_LENGTH = 80;

/** MDD presente pero derivados SDD clave aún no generados (post-borrado o pre-cascada). */
export function areSddDerivativesPending(source: ProjectDeliverableSource): boolean {
  if (!hasCanonicalMdd(source)) return false;
  return SDD_DERIVATIVE_FIELDS.every((field) => {
    const body = (source[field] ?? "").trim();
    return body.length < MIN_DERIVATIVE_DOC_LENGTH;
  });
}

export function collectFullCrossArtifactGaps(
  conformance: ConformanceService,
  mdd: string,
  source: ProjectDeliverableSource,
  complexity: ComplexityLevel = ComplexityLevel.HIGH,
): string[] {
  if (complexity === ComplexityLevel.LOW) {
    return collectLowMediumReadinessGaps(ComplexityLevel.LOW, source);
  }
  if (complexity === ComplexityLevel.MEDIUM) {
    return collectLowMediumReadinessGaps(ComplexityLevel.MEDIUM, source);
  }
  if (!mdd.trim()) return ["MDD vacío: no se puede verificar conformidad"];
  if (areSddDerivativesPending(source)) {
    return [
      "derivatives-pending: MDD listo; genera entregables SDD (Blueprint, API, Flujos, Infra) para alinear la auditoría.",
    ];
  }
  return collectConformanceGaps(conformance, mdd, source);
}

export function computeConsistencyScoreForProject(
  mdd: string,
  source: ProjectDeliverableSource,
  complexity: ComplexityLevel = ComplexityLevel.HIGH,
): number | undefined {
  const brd = source.brdContent?.trim();
  if (!brd || brd.length < 200) return undefined;

  const downstreamMarkdown =
    complexity === ComplexityLevel.HIGH && hasCanonicalMdd(source)
      ? mdd
      : (source.specContent ?? source.dbgaContent ?? "").trim();

  if (!downstreamMarkdown) return undefined;

  const docs: PlanningDocumentFields = {
    brdContent: source.brdContent ?? undefined,
    mddContent: downstreamMarkdown,
    specContent: source.specContent ?? undefined,
    architectureContent: source.architectureContent ?? undefined,
    blueprintContent: source.blueprintContent ?? undefined,
    useCasesContent: source.useCasesContent ?? undefined,
    userStoriesContent: source.userStoriesContent ?? undefined,
    apiContractsContent: source.apiContractsContent ?? undefined,
    logicFlowsContent: source.logicFlowsContent ?? undefined,
    infraContent: source.infraContent ?? undefined,
    tasksContent: source.tasksContent ?? undefined,
  };
  return computeCrossDocumentConsistency(docs).score;
}

function resolveReadinessProfile(
  complexity: ComplexityLevel,
): CompositeSemaphoreEvaluation["readinessProfile"] {
  if (complexity === ComplexityLevel.LOW) return "low";
  if (complexity === ComplexityLevel.MEDIUM) return "medium";
  return "high_mdd";
}

/** Evalúa semáforo base + puertas compuestas según complejidad greenfield. */
export function evaluateCompositeSemaphore(
  semaphore: SemaphoreService,
  input: SemaphoreEvaluationInput & {
    mddMarkdown?: string;
    project?: Pick<
      Project,
      | "architectureContent"
      | "blueprintContent"
      | "tasksContent"
      | "logicFlowsContent"
      | "userStoriesContent"
      | "useCasesContent"
      | "apiContractsContent"
      | "uiScreensContent"
      | "phase0SummaryContent"
      | "uxUiGuideContent"
      | "specContent"
    >;
    conformance?: ConformanceService;
    deliverableSource?: ProjectDeliverableSource;
  },
): CompositeSemaphoreEvaluation {
  const complexity = input.complexity ?? ComplexityLevel.HIGH;
  const mdd = input.mddMarkdown ?? "";
  const source = input.deliverableSource;
  const profile = source ? resolveReadinessProfile(complexity) : "high_mdd";
  const useHighMddPath = profile === "high_mdd" && hasCanonicalMdd(source ?? {});

  const precisionGapCount =
    input.sddCrossArtifactGapCount ??
    (useHighMddPath && input.project && mdd.trim().length >= 120
      ? countSddPrecisionGaps(input.project, mdd)
      : 0);

  let crossArtifactGapCount = precisionGapCount;
  let conformanceOk = true;
  let consistencyScore: number | undefined;
  let humanRequiredGapCount = 0;
  let conformanceReason = "Conformidad MDD↔derivados incompleta";
  let traceReason = "Trazabilidad BRD→MDD";

  if (input.conformance && source) {
    if (useHighMddPath && mdd.trim()) {
      const allGaps = collectConformanceGaps(input.conformance, mdd, source);
      crossArtifactGapCount = allGaps.length;
      humanRequiredGapCount = allGaps.filter((g) => classifyGap(g).kind === "human").length;
      const summary = buildConformanceSummary(input.conformance, mdd, source);
      conformanceOk = summary.ok;
      consistencyScore = computeConsistencyScoreForProject(mdd, source, complexity);
    } else if (profile === "low" || profile === "medium") {
      const lmComplexity =
        profile === "low" ? ComplexityLevel.LOW : ComplexityLevel.MEDIUM;
      const allGaps = collectLowMediumReadinessGaps(lmComplexity, source);
      crossArtifactGapCount = allGaps.length;
      humanRequiredGapCount = allGaps.filter((g) => classifyGap(g).kind === "human").length;
      const summary = buildLowMediumConformanceSummary(lmComplexity, source);
      conformanceOk = summary.ok;
      consistencyScore = computeConsistencyScoreForProject(mdd, source, complexity);
      conformanceReason =
        profile === "low"
          ? "Conformidad HU↔Tasks incompleta"
          : "Conformidad Spec↔API↔Tasks incompleta";
      traceReason = profile === "low" ? "Trazabilidad BRD→Spec/HU" : "Trazabilidad BRD→Spec";
    }
  }

  const base = semaphore.evaluate({
    ...input,
    sddCrossArtifactGapCount: useHighMddPath ? precisionGapCount : crossArtifactGapCount,
  });

  const composite = applyCompositeReadinessGates({
    baseStatus: base.status as "ROJO" | "AMARILLO" | "VERDE",
    basePrecisionScore: base.precisionScore,
    conformanceOk,
    crossArtifactGapCount,
    consistencyScore,
    humanRequiredGapCount,
    conformanceReason,
    traceReason,
  });

  return {
    status: composite.status as Status,
    precisionScore: composite.precisionScore,
    composite,
    crossArtifactGapCount,
    humanRequiredGapCount,
    conformanceOk,
    consistencyScore,
    readinessProfile: profile,
  };
}
