import {
  computeCompletenessScore,
  computeIntegralScore,
  derivativesState,
  resolveCompletenessPhase,
  type DerivativesInput,
  type PlanningDocuments,
  type SemaphoreProfile,
} from "./completeness-phase.js";
import { evaluateDeliverablesGate, type DeliverablesGateInput } from "./deliverables-gate.js";
import { statusFromScore } from "./scale.js";
import type {
  MddSemaphoreVerdict,
  SemaphoreHeadlineSource,
  SemaphoreSource,
  SemaphoreStatus,
} from "./verdict.schema.js";

export const CROSS_GAP_GREEN_TOLERANCE = 5;
export const CONFORMITY_MISSING_ENDPOINTS_YELLOW = 3;
export const CONSISTENCY_GREEN_MIN = 90;
export const DESIGN_FIRST_HEADLINE_CAP = 40;

export type DesignFirstPhaseInput = {
  phase1Ok: boolean;
  phase2Ok: boolean;
  phase3Ok: boolean;
};

export type MddSemaphoreEvaluateInput = {
  profile: SemaphoreProfile;
  source: SemaphoreSource;
  documents: PlanningDocuments;
  mddQuality: number;
  consistencyScore: number | null;
  derivatives: DerivativesInput;
  deliveryGateBlockers?: string[];
  conformanceOk?: boolean;
  conformanceMissingEndpoints?: number;
  crossArtifactGapsDeduplicated?: number;
  auditorActive?: boolean;
  auditorScore?: number | null;
  auditorCriticalGaps?: number;
  auditorInfrastructureReady?: boolean;
  figmaGateOk?: boolean;
  constitutionBlockersOpen?: boolean;
  designFirstPhases?: DesignFirstPhaseInput;
  deliverablesGate: Omit<DeliverablesGateInput, "verdict" | "profile">;
};

const STATUS_RANK: Record<SemaphoreStatus, number> = { red: 0, yellow: 1, green: 2 };

function capToYellow(status: SemaphoreStatus): SemaphoreStatus {
  return status === "green" ? "yellow" : status;
}

export function evaluateMddSemaphore(input: MddSemaphoreEvaluateInput): MddSemaphoreVerdict {
  const derivState = derivativesState(input.profile, input.derivatives);
  const phase = resolveCompletenessPhase(derivState);
  const completeness = computeCompletenessScore(input.documents, phase, input.profile);
  const { integral, consistency } = computeIntegralScore({
    completeness,
    consistency: input.consistencyScore,
    mddQuality: input.mddQuality,
  });

  let headline: number;
  let headlineSource: SemaphoreHeadlineSource = "integral";

  const useAuditor =
    input.auditorActive === true &&
    typeof input.auditorScore === "number" &&
    Number.isFinite(input.auditorScore);
  if (useAuditor) {
    headline = Math.min(100, Math.max(0, Math.round(input.auditorScore!)));
    headlineSource = "auditor";
  } else if (input.profile === "DESIGN_FIRST" && input.designFirstPhases) {
    headlineSource = "design_first_phases";
    headline = integral;
  } else {
    headline = integral;
  }

  const reasons: string[] = [];
  let status: SemaphoreStatus = statusFromScore(headline);

  const blockers = input.deliveryGateBlockers ?? [];
  if (blockers.length >= 1) {
    status = "red";
    for (const b of blockers) reasons.push(b);
  }

  if (consistency != null && consistency < CONSISTENCY_GREEN_MIN) {
    status = capToYellow(status);
    reasons.push(`Trazabilidad BRD→MDD ${consistency}% (< ${CONSISTENCY_GREEN_MIN}%).`);
  }

  if (phase === "post_cascade") {
    const gaps = input.crossArtifactGapsDeduplicated ?? 0;
    if (gaps > CROSS_GAP_GREEN_TOLERANCE) {
      status = capToYellow(status);
      reasons.push(`Conformidad: ${gaps} brechas cruzadas (> ${CROSS_GAP_GREEN_TOLERANCE}).`);
    }

    const confOk = input.conformanceOk ?? true;
    const missing = input.conformanceMissingEndpoints ?? 0;
    if (!confOk || missing > CONFORMITY_MISSING_ENDPOINTS_YELLOW) {
      status = capToYellow(status);
      if (!confOk) reasons.push("Conformidad MDD↔derivados incompleta.");
      if (missing > CONFORMITY_MISSING_ENDPOINTS_YELLOW) {
        reasons.push(`${missing} endpoints faltantes en conformidad (> ${CONFORMITY_MISSING_ENDPOINTS_YELLOW}).`);
      }
    }
  }

  if (input.auditorActive) {
    const critical = input.auditorCriticalGaps ?? 0;
    const strictInfra = input.profile === "HIGH";
    const infraOk = input.auditorInfrastructureReady !== false;
    if (critical > 0 || (strictInfra && !infraOk)) {
      status = capToYellow(status);
      if (critical > 0) reasons.push("Auditor: gaps críticos pendientes.");
      if (strictInfra && !infraOk) reasons.push("Auditor: infraestructura no lista.");
    }
  }

  if (input.figmaGateOk === false) {
    status = capToYellow(status);
    reasons.push("Integración Figma/UX pendiente.");
  }
  if (input.constitutionBlockersOpen === true) {
    status = capToYellow(status);
    reasons.push("Bloqueantes de Constitución abiertos.");
  }

  if (input.profile === "DESIGN_FIRST" && input.designFirstPhases) {
    const df = input.designFirstPhases;
    if (!df.phase1Ok) {
      status = "red";
      reasons.push("Design-First: fase 1 no completada.");
    } else if (!df.phase2Ok || !df.phase3Ok) {
      headline = Math.min(headline, DESIGN_FIRST_HEADLINE_CAP);
      status = capToYellow(statusFromScore(headline));
      reasons.push("Design-First: fases 2 o 3 pendientes (tope 40).");
    }
  }

  const notes: string[] = [];
  if (derivState === "none") {
    notes.push("MDD listo; genera entregables");
  } else if (derivState === "partial") {
    notes.push("cascada incompleta");
  }

  const partialVerdict = { status, reasons };
  const gate = evaluateDeliverablesGate({
    profile: input.profile,
    verdict: partialVerdict,
    ...input.deliverablesGate,
  });

  return {
    version: 1,
    status,
    headline,
    headlineSource,
    integral,
    components: {
      completeness,
      consistency,
      mddQuality: input.mddQuality,
    },
    phase,
    derivativesState: derivState,
    reasons,
    notes,
    source: input.source,
    deliverablesGate: gate,
  };
}

/** Para tests de propiedad: el color nunca supera el del titular base (salvo reglas que fuerzan rojo). */
export function statusRank(status: SemaphoreStatus): number {
  return STATUS_RANK[status];
}

export function statusFromHeadlineOnly(headline: number): SemaphoreStatus {
  return statusFromScore(headline);
}
