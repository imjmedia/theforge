import { ComplexityLevel, type Project, type Stage } from "@theforge/database";
import type { PrismaService } from "../../../prisma/prisma.service.js";
import {
  derivativesState,
  evaluateMddSemaphore,
  isDesignFirst,
  isLegacy,
  type MddSemaphoreEvaluateInput,
  type MddSemaphoreVerdict,
  type PlanningDocuments,
  type ProjectType,
  type SemaphoreProfile,
  type SemaphoreSource,
} from "@theforge/shared-types";
import { ConformanceService } from "../../engine/conformance.service.js";
import {
  buildConformanceSummary,
  type ProjectDeliverableSource,
} from "../../engine/conformance-gaps.util.js";
import { buildProjectDeliverableSource, collectFullCrossArtifactGaps } from "../../projects/project-semaphore-composite.util.js";
import { computeCrossDocumentConsistency } from "./consistency.util.js";
import type {
  AuditorGaps,
  EstimationComplexity,
  PlanningDocumentFields,
} from "./estimation.types.js";
import { resolveMddQualityScore } from "./mdd-quality-score.util.js";
import { resolveDeliveryGateContext } from "../utils/mdd-delivery-gate-context.util.js";
import { validateMddForDelivery } from "../utils/mdd-delivery-gate.util.js";
import { hashMddDraft } from "./mdd-draft-hash.util.js";
import {
  evaluateConstitutionBlockersOpen,
  evaluateFigmaGateOk,
} from "../../engine/semaphore.service.js";
import { mddJsonStringForSemaphore } from "../../projects/project-semaphore.util.js";
import { loadDesignFirstGatesFromStage } from "./estimation-design-first.util.js";

export type BuildSemaphoreInputsParams = {
  projectId: string;
  stageId?: string | null;
  content: string;
  source: SemaphoreSource;
  complexity?: EstimationComplexity;
  projectType?: ProjectType;
  auditorGaps?: AuditorGaps;
  /** Documentos ya cargados (evita doble lectura en fachada). */
  documents?: PlanningDocumentFields;
  stage?: Pick<
    Stage,
    | "brdContent"
    | "mddContent"
    | "domainInventory"
    | "designSpec"
    | "architectureGraph"
    | "architectureGraphSourceHash"
    | "shortTermContext"
  > | null;
  project?: Pick<
    Project,
    | "complexity"
    | "projectType"
    | "specContent"
    | "dbgaContent"
    | "architectureContent"
    | "useCasesContent"
    | "userStoriesContent"
    | "blueprintContent"
    | "apiContractsContent"
    | "logicFlowsContent"
    | "infraContent"
    | "tasksContent"
    | "uxUiGuideContent"
    | "hasUxTeam"
    | "approach"
  > | null;
  legacyCodebaseDoc?: string | null;
};

export type BuiltSemaphoreInputs = {
  evaluateInput: MddSemaphoreEvaluateInput;
  verdict: MddSemaphoreVerdict;
  deliverableSource: ProjectDeliverableSource;
  deliveryGateResult: ReturnType<typeof validateMddForDelivery>;
  inputsHash: string;
};

function estimationComplexityToDb(cx: EstimationComplexity): ComplexityLevel {
  if (cx === "LOW") return ComplexityLevel.LOW;
  if (cx === "MEDIUM") return ComplexityLevel.MEDIUM;
  return ComplexityLevel.HIGH;
}

export function resolveSemaphoreProfile(
  projectType: ProjectType | undefined,
  complexity: EstimationComplexity,
): SemaphoreProfile {
  if (projectType && isDesignFirst(projectType)) return "DESIGN_FIRST";
  if (projectType && isLegacy(projectType)) return "LEGACY";
  if (complexity === "LOW") return "LOW";
  if (complexity === "MEDIUM") return "MEDIUM";
  return "HIGH";
}

function mapToPlanningDocuments(
  mdd: string,
  fields: PlanningDocumentFields | undefined,
  source: ProjectDeliverableSource,
): PlanningDocuments {
  return {
    mddContent: mdd,
    brdContent: fields?.brdContent ?? source.brdContent,
    specContent: fields?.specContent ?? source.specContent,
    architectureContent: fields?.architectureContent ?? source.architectureContent,
    useCasesContent: fields?.useCasesContent ?? source.useCasesContent,
    userStoriesContent: fields?.userStoriesContent ?? source.userStoriesContent,
    blueprintContent: fields?.blueprintContent ?? source.blueprintContent,
    apiContractsContent: fields?.apiContractsContent ?? source.apiContractsContent,
    logicFlowsContent: fields?.logicFlowsContent ?? source.logicFlowsContent,
    infraContent: fields?.infraContent ?? source.infraContent,
    tasksContent: fields?.tasksContent ?? source.tasksContent,
  };
}

function deduplicateGapCount(gaps: string[]): number {
  return new Set(gaps.map((g) => g.trim()).filter(Boolean)).size;
}

/** Construye entradas del núcleo (solo lectura; sin Prisma en el núcleo). */
export function buildSemaphoreInputsFromLoaded(
  conformance: ConformanceService,
  params: BuildSemaphoreInputsParams,
): BuiltSemaphoreInputs {
  const mdd = (params.content ?? "").trim();
  const cx = params.complexity ?? (params.project?.complexity as EstimationComplexity) ?? "HIGH";
  const projectType = params.projectType ?? params.project?.projectType;
  const profile = resolveSemaphoreProfile(projectType, cx);

  const deliverableSource: ProjectDeliverableSource = params.project
  && "id" in params.project
    ? buildProjectDeliverableSource(params.project as Project, (params.stage as Stage | null) ?? null)
    : {
        mddContent: mdd,
        brdContent: params.documents?.brdContent,
        specContent: params.documents?.specContent,
        blueprintContent: params.documents?.blueprintContent,
        apiContractsContent: params.documents?.apiContractsContent,
        logicFlowsContent: params.documents?.logicFlowsContent,
        infraContent: params.documents?.infraContent,
        architectureContent: params.documents?.architectureContent,
        useCasesContent: params.documents?.useCasesContent,
        userStoriesContent: params.documents?.userStoriesContent,
        tasksContent: params.documents?.tasksContent,
        uxUiGuideContent: params.project?.uxUiGuideContent,
        dbgaContent: params.project?.dbgaContent,
      };

  if (mdd) deliverableSource.mddContent = mdd;

  const planningDocs = mapToPlanningDocuments(mdd, params.documents, deliverableSource);
  const consistency = computeCrossDocumentConsistency({
    brdContent: planningDocs.brdContent ?? undefined,
    mddContent: planningDocs.mddContent ?? undefined,
    specContent: planningDocs.specContent ?? undefined,
    architectureContent: planningDocs.architectureContent ?? undefined,
    blueprintContent: planningDocs.blueprintContent ?? undefined,
    useCasesContent: planningDocs.useCasesContent ?? undefined,
    userStoriesContent: planningDocs.userStoriesContent ?? undefined,
    apiContractsContent: planningDocs.apiContractsContent ?? undefined,
    logicFlowsContent: planningDocs.logicFlowsContent ?? undefined,
    infraContent: planningDocs.infraContent ?? undefined,
    tasksContent: planningDocs.tasksContent ?? undefined,
  });

  const quality = resolveMddQualityScore(mdd, cx, params.auditorGaps);
  const derivState = derivativesState(profile, {
    specContent: deliverableSource.specContent,
    useCasesContent: deliverableSource.useCasesContent,
    userStoriesContent: deliverableSource.userStoriesContent,
    tasksContent: deliverableSource.tasksContent,
    blueprintContent: deliverableSource.blueprintContent,
    apiContractsContent: deliverableSource.apiContractsContent,
    logicFlowsContent: deliverableSource.logicFlowsContent,
    infraContent: deliverableSource.infraContent,
    uxUiGuideContent: deliverableSource.uxUiGuideContent,
  });

  const dbComplexity = estimationComplexityToDb(cx);
  let crossGaps: string[] = [];
  let conformanceOk = true;
  let conformanceMissingEndpoints = 0;

  if (derivState !== "none" && mdd.length > 0) {
    crossGaps = collectFullCrossArtifactGaps(conformance, mdd, deliverableSource, dbComplexity);
    if (derivState === "complete") {
      const summary = buildConformanceSummary(conformance, mdd, deliverableSource);
      conformanceOk = summary.ok;
      conformanceMissingEndpoints = summary.api.missingCount;
    } else if (derivState === "partial") {
      const summary = buildConformanceSummary(conformance, mdd, deliverableSource);
      conformanceOk = summary.ok;
      conformanceMissingEndpoints = summary.api.missingCount;
    }
  }

  const gateCtx = resolveDeliveryGateContext({
    mddMarkdown: mdd,
    brdMarkdown: deliverableSource.brdContent,
    dbgaMarkdown: deliverableSource.dbgaContent,
    specMarkdown: deliverableSource.specContent,
    mddComplexity: cx,
  });
  const deliveryGateResult = validateMddForDelivery(mdd, gateCtx.options);
  const skipLiveGate = params.projectId === "synthetic" || params.source === "stream";
  const deliveryGateBlockers =
    skipLiveGate || deliveryGateResult.ok ? [] : deliveryGateResult.blockers;

  const hasSpec = (deliverableSource.specContent ?? "").trim().length >= 80;
  const hasBootstrap =
    (deliverableSource.dbgaContent ?? "").trim().length >= 80 || mdd.length >= 120;
  const legacyHasDoc = (params.legacyCodebaseDoc ?? "").trim().length >= 80;

  let designFirstPhases: import("@theforge/shared-types").DesignFirstPhaseInput | undefined;
  let designFirstGateOk = true;
  if (profile === "DESIGN_FIRST" && params.stage) {
    const { designSpec, gates, pag, designSpecHash } = loadDesignFirstGatesFromStage(params.stage);
    designFirstPhases = {
      phase1Ok: gates.phase1.ok,
      phase2Ok: gates.phase2.ok,
      phase3Ok: gates.phase3.ok,
    };
    const stale =
      params.stage.architectureGraphSourceHash != null &&
      params.stage.architectureGraphSourceHash !== designSpecHash;
    designFirstGateOk =
      (designSpec.screens.length > 0 || designSpec.entities.length > 0) &&
      pag != null &&
      gates.phase3.ok &&
      !stale;
  }

  const evaluateInput: MddSemaphoreEvaluateInput = {
    profile,
    source: params.source,
    documents: planningDocs,
    mddQuality: quality.score,
    consistencyScore: consistency.score,
    derivatives: {
      specContent: deliverableSource.specContent,
      useCasesContent: deliverableSource.useCasesContent,
      userStoriesContent: deliverableSource.userStoriesContent,
      tasksContent: deliverableSource.tasksContent,
      blueprintContent: deliverableSource.blueprintContent,
      apiContractsContent: deliverableSource.apiContractsContent,
      logicFlowsContent: deliverableSource.logicFlowsContent,
      infraContent: deliverableSource.infraContent,
      uxUiGuideContent: deliverableSource.uxUiGuideContent,
    },
    deliveryGateBlockers,
    conformanceOk,
    conformanceMissingEndpoints,
    crossArtifactGapsDeduplicated: deduplicateGapCount(crossGaps),
    auditorActive: quality.auditorActive,
    auditorScore: quality.auditorScore ?? null,
    auditorCriticalGaps: params.auditorGaps?.critical_gaps?.length ?? 0,
    auditorInfrastructureReady: params.auditorGaps?.infrastructure_ready !== false,
    figmaGateOk: evaluateFigmaGateOk(
      params.project?.hasUxTeam ?? false,
      undefined,
      params.project?.approach,
      params.project?.uxUiGuideContent ?? deliverableSource.uxUiGuideContent,
    ),
    constitutionBlockersOpen: evaluateConstitutionBlockersOpen(mddJsonStringForSemaphore(mdd)),
    ...(designFirstPhases ? { designFirstPhases } : {}),
    deliverablesGate: {
      hasSpec,
      hasBootstrap,
      legacyHasDoc,
      designFirstGateOk,
    },
  };

  const verdict = evaluateMddSemaphore(evaluateInput);
  const inputsHash = hashMddDraft(
    JSON.stringify({
      mdd: mdd.slice(0, 2000),
      brd: (planningDocs.brdContent ?? "").slice(0, 500),
      spec: (planningDocs.specContent ?? "").slice(0, 500),
      profile,
      source: params.source,
    }),
  );

  return {
    evaluateInput,
    verdict,
    deliverableSource,
    deliveryGateResult,
    inputsHash,
  };
}

const PROJECT_SELECT = {
  complexity: true,
  projectType: true,
  specContent: true,
  dbgaContent: true,
  architectureContent: true,
  useCasesContent: true,
  userStoriesContent: true,
  blueprintContent: true,
  apiContractsContent: true,
  logicFlowsContent: true,
  infraContent: true,
  tasksContent: true,
  uxUiGuideContent: true,
  hasUxTeam: true,
  approach: true,
} as const;

const STAGE_SELECT = {
  id: true,
  updatedAt: true,
  brdContent: true,
  mddContent: true,
  domainInventory: true,
  designSpec: true,
  architectureGraph: true,
  architectureGraphSourceHash: true,
  shortTermContext: true,
} as const;

/** Carga proyecto y etapa una vez y delega en `buildSemaphoreInputsFromLoaded`. */
export async function buildSemaphoreInputs(
  prisma: PrismaService,
  conformance: ConformanceService,
  params: {
    projectId: string;
    stageId: string;
    content?: string;
    source: SemaphoreSource;
    auditorGaps?: AuditorGaps;
    complexity?: EstimationComplexity;
  },
): Promise<BuiltSemaphoreInputs & { stageUpdatedAt: Date | null }> {
  const [project, stage] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId.trim() },
      select: PROJECT_SELECT,
    }),
    prisma.stage.findUnique({
      where: { id: params.stageId.trim() },
      select: STAGE_SELECT,
    }),
  ]);
  const content = (params.content ?? stage?.mddContent ?? "").trim();
  const built = buildSemaphoreInputsFromLoaded(conformance, {
    projectId: params.projectId,
    stageId: params.stageId,
    content,
    source: params.source,
    auditorGaps: params.auditorGaps,
    complexity: params.complexity,
    project: project ?? undefined,
    stage: stage ?? undefined,
  });
  return { ...built, stageUpdatedAt: stage?.updatedAt ?? null };
}
