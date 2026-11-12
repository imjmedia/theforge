import type { CompletenessPhase, DerivativesState } from "./verdict.schema.js";

export const MIN_DERIVATIVE_DOC_LENGTH = 80;
export const DOC_COMPLETE_MIN_LENGTH = 300;
export const DOC_PARTIAL_MIN_LENGTH = 80;

export type SemaphoreProfile = "HIGH" | "MEDIUM" | "LOW" | "DESIGN_FIRST" | "LEGACY";

export type PlanningDocuments = {
  mddContent?: string | null;
  brdContent?: string | null;
  specContent?: string | null;
  architectureContent?: string | null;
  useCasesContent?: string | null;
  userStoriesContent?: string | null;
  blueprintContent?: string | null;
  apiContractsContent?: string | null;
  logicFlowsContent?: string | null;
  infraContent?: string | null;
  tasksContent?: string | null;
};

export type DerivativesInput = {
  specContent?: string | null;
  useCasesContent?: string | null;
  userStoriesContent?: string | null;
  tasksContent?: string | null;
  blueprintContent?: string | null;
  apiContractsContent?: string | null;
  logicFlowsContent?: string | null;
  infraContent?: string | null;
  uxUiGuideContent?: string | null;
};

/** Pesos pre-cascada (MDD + BRD + Spec). */
export const PRE_CASCADE_DOC_WEIGHTS = {
  mddContent: 0.5,
  brdContent: 0.3,
  specContent: 0.2,
} as const;

/** Pesos post-cascada (alineados con `completeness.util.ts` en API). */
const OTHER_DOC_BASE_WEIGHTS: Record<Exclude<keyof PlanningDocuments, "mddContent">, number> = {
  brdContent: 0.22,
  specContent: 0.14,
  architectureContent: 0.14,
  blueprintContent: 0.12,
  useCasesContent: 0.1,
  userStoriesContent: 0.05,
  apiContractsContent: 0.08,
  logicFlowsContent: 0.05,
  infraContent: 0.05,
  tasksContent: 0.05,
};

const MDD_COMPLETENESS_WEIGHT = 0.3;

function buildPostCascadeWeights(): Record<keyof PlanningDocuments, number> {
  const baseSum = Object.values(OTHER_DOC_BASE_WEIGHTS).reduce((a, b) => a + b, 0);
  const scale = (1 - MDD_COMPLETENESS_WEIGHT) / baseSum;
  const out = { mddContent: MDD_COMPLETENESS_WEIGHT } as Record<keyof PlanningDocuments, number>;
  for (const [k, w] of Object.entries(OTHER_DOC_BASE_WEIGHTS)) {
    out[k as keyof PlanningDocuments] = w * scale;
  }
  return out;
}

export const DOC_WEIGHTS_BY_PHASE: {
  pre_cascade: typeof PRE_CASCADE_DOC_WEIGHTS;
  post_cascade: Record<keyof PlanningDocuments, number>;
} = {
  pre_cascade: PRE_CASCADE_DOC_WEIGHTS,
  post_cascade: buildPostCascadeWeights(),
};

function derivativePresent(value: string | null | undefined): boolean {
  return (value ?? "").trim().length >= MIN_DERIVATIVE_DOC_LENGTH;
}

/**
 * Estado de derivados según perfil (J1, J10).
 * DESIGN_FIRST: mismos derivados que HIGH tras fase 3 (en 1a se evalúa como HIGH).
 */
export function derivativesState(profile: SemaphoreProfile, input: DerivativesInput): DerivativesState {
  const highLike = profile === "HIGH" || profile === "DESIGN_FIRST" || profile === "LEGACY";
  if (highLike) {
    const required = [
      derivativePresent(input.blueprintContent),
      derivativePresent(input.apiContractsContent),
      derivativePresent(input.logicFlowsContent),
      derivativePresent(input.infraContent),
    ];
    const present = required.filter(Boolean).length;
    if (present === 0) return "none";
    if (present === required.length) return "complete";
    return "partial";
  }
  if (profile === "LOW") {
    const required = [derivativePresent(input.userStoriesContent), derivativePresent(input.tasksContent)];
    const present = required.filter(Boolean).length;
    if (present === 0) return "none";
    if (present === required.length) return "complete";
    return "partial";
  }
  // MEDIUM
  const groups = [
    derivativePresent(input.specContent) || derivativePresent(input.useCasesContent),
    derivativePresent(input.apiContractsContent),
    derivativePresent(input.uxUiGuideContent) || derivativePresent(input.logicFlowsContent),
    derivativePresent(input.userStoriesContent),
    derivativePresent(input.tasksContent),
  ];
  const present = groups.filter(Boolean).length;
  if (present === 0) return "none";
  if (present === groups.length) return "complete";
  return "partial";
}

export function resolveCompletenessPhase(state: DerivativesState): CompletenessPhase {
  return state === "complete" ? "post_cascade" : "pre_cascade";
}

export function scoreDocumentContent(content: string | null | undefined): number {
  const trimmed = (content ?? "").trim();
  if (trimmed.length >= DOC_COMPLETE_MIN_LENGTH) return 100;
  if (trimmed.length >= DOC_PARTIAL_MIN_LENGTH) return 50;
  if (trimmed.length > 0) return 10;
  return 0;
}

type WeightEntry = { key: keyof PlanningDocuments; weight: number };

function preCascadeWeights(profile: SemaphoreProfile, docs: PlanningDocuments): WeightEntry[] {
  const keys: (keyof typeof PRE_CASCADE_DOC_WEIGHTS)[] = ["mddContent", "brdContent", "specContent"];
  if (profile === "HIGH" || profile === "DESIGN_FIRST" || profile === "LEGACY") {
    return keys.map((key) => ({ key, weight: PRE_CASCADE_DOC_WEIGHTS[key] }));
  }
  // LOW / MEDIUM: renormalizar solo sobre documentos con contenido (J10, CL-33)
  const present = keys.filter((key) => (docs[key] ?? "").trim().length > 0);
  const useKeys = present.length > 0 ? present : (["mddContent"] as const);
  const weightSum = useKeys.reduce((s, key) => s + PRE_CASCADE_DOC_WEIGHTS[key], 0);
  return useKeys.map((key) => ({ key, weight: PRE_CASCADE_DOC_WEIGHTS[key] / weightSum }));
}

/**
 * Completitud ponderada C (0–100) para la fase dada.
 */
export function computeCompletenessScore(
  docs: PlanningDocuments,
  phase: CompletenessPhase,
  profile: SemaphoreProfile,
): number {
  let entries: WeightEntry[];
  if (phase === "pre_cascade") {
    entries = preCascadeWeights(profile, docs);
  } else {
    entries = Object.entries(DOC_WEIGHTS_BY_PHASE.post_cascade).map(([key, weight]) => ({
      key: key as keyof PlanningDocuments,
      weight,
    }));
  }
  const weightSum = entries.reduce((s, e) => s + e.weight, 0);
  if (weightSum <= 0) return 0;
  let weighted = 0;
  for (const { key, weight } of entries) {
    weighted += weight * scoreDocumentContent(docs[key]);
  }
  return Math.round(weighted / weightSum);
}

/**
 * Integral multi-documento: 0.30·C + 0.25·T + 0.45·Q; sin BRD → (0.30·C + 0.45·Q) / 0.75.
 */
export function computeIntegralScore(input: {
  completeness: number;
  consistency: number | null;
  mddQuality: number;
}): { integral: number; consistency: number | null } {
  const C = input.completeness;
  const Q = input.mddQuality;
  const T = input.consistency;
  if (T == null) {
    const integral = Math.round((0.3 * C + 0.45 * Q) / 0.75);
    return { integral, consistency: null };
  }
  const integral = Math.round(0.3 * C + 0.25 * T + 0.45 * Q);
  return { integral, consistency: T };
}
