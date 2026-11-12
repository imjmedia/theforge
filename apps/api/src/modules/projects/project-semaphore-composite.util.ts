/**
 * Contexto compuesto para evaluación de semáforo (conformance + gaps + trazabilidad).
 */

import type { Project, Stage } from "@theforge/database";
import { ComplexityLevel } from "@theforge/database";
import {
  type CompositeReadinessResult,
  classifyGap,
} from "@theforge/shared-types";
import { ConformanceService } from "../engine/conformance.service.js";
import {
  buildSemaphoreInputsFromLoaded,
  type BuildSemaphoreInputsParams,
} from "../ai-analysis/estimation/semaphore-inputs.factory.js";
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
import { Status } from "@theforge/database";

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
  return computeCrossDocumentConsistency(docs).score ?? 50;
}

function resolveReadinessProfile(
  complexity: ComplexityLevel,
): CompositeSemaphoreEvaluation["readinessProfile"] {
  if (complexity === ComplexityLevel.LOW) return "low";
  if (complexity === ComplexityLevel.MEDIUM) return "medium";
  return "high_mdd";
}

function verdictStatusToDb(status: import("@theforge/shared-types").SemaphoreStatus): Status {
  if (status === "green") return Status.VERDE;
  if (status === "yellow") return Status.AMARILLO;
  return Status.ROJO;
}

function verdictToCompositeReadiness(verdict: {
  status: import("@theforge/shared-types").SemaphoreStatus;
  headline: number;
  reasons: string[];
}): CompositeReadinessResult {
  return {
    status: verdictStatusToDb(verdict.status) as CompositeReadinessResult["status"],
    precisionScore: verdict.headline,
    reasons: verdict.reasons,
  };
}

/** Adaptador del veredicto del núcleo para lista de proyectos y auditoría unificada. */
export function evaluateCompositeSemaphore(
  conformance: ConformanceService,
  input: {
    complexity?: ComplexityLevel;
    mddMarkdown?: string;
    projectId?: string;
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
      | "dbgaContent"
      | "complexity"
      | "projectType"
      | "hasUxTeam"
      | "approach"
    >;
    stage?: Pick<Stage, "brdContent" | "mddContent"> | null;
    conformance?: ConformanceService;
    deliverableSource?: ProjectDeliverableSource;
  },
): CompositeSemaphoreEvaluation {
  const complexity = input.complexity ?? input.project?.complexity ?? ComplexityLevel.HIGH;
  const mdd = (input.mddMarkdown ?? "").trim();
  const source =
    input.deliverableSource ??
    (input.project
      ? buildProjectDeliverableSource(input.project as Project, (input.stage as Stage) ?? null)
      : { mddContent: mdd });

  const profile = resolveReadinessProfile(complexity);
  const cx =
    complexity === ComplexityLevel.LOW ? "LOW" : complexity === ComplexityLevel.MEDIUM ? "MEDIUM" : "HIGH";

  const built = buildSemaphoreInputsFromLoaded(conformance, {
    projectId: input.projectId ?? "composite",
    content: mdd,
    source: "persisted",
    complexity: cx,
    project: input.project as BuildSemaphoreInputsParams["project"],
    stage: input.stage as BuildSemaphoreInputsParams["stage"],
    documents: {
      mddContent: mdd,
      brdContent: source.brdContent ?? undefined,
      specContent: source.specContent ?? undefined,
    },
  });

  const composite = verdictToCompositeReadiness(built.verdict);

  let crossArtifactGapCount = 0;
  let humanRequiredGapCount = 0;
  let conformanceOk = built.evaluateInput.conformanceOk ?? true;
  let consistencyScore = computeConsistencyScoreForProject(mdd, source, complexity);

  if (mdd) {
    const allGaps = collectFullCrossArtifactGaps(conformance, mdd, source, complexity);
    crossArtifactGapCount = new Set(allGaps.map((g) => g.trim()).filter(Boolean)).size;
    humanRequiredGapCount = allGaps.filter((g) => classifyGap(g).kind === "human").length;
    if (profile === "high_mdd" && hasCanonicalMdd(source)) {
      const summary = buildConformanceSummary(conformance, mdd, source);
      conformanceOk = summary.ok;
    } else if (profile === "low" || profile === "medium") {
      const lm = profile === "low" ? ComplexityLevel.LOW : ComplexityLevel.MEDIUM;
      const summary = buildLowMediumConformanceSummary(lm, source);
      conformanceOk = summary.ok;
    }
  }

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
