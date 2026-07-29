/**
 * Auditoría unificada de readiness SDD: clasificación de gaps, semáforo compuesto y plan de convergencia.
 */

export type GapResolutionKind = "auto" | "llm" | "human";

export type ClassifiedGap = {
  message: string;
  kind: GapResolutionKind;
  prefix: string;
  targetDeliverable?: string;
};

export type ReadinessGapSummary = {
  total: number;
  auto: number;
  llm: number;
  human: number;
  truncated: boolean;
  items: ClassifiedGap[];
};

export type CompositeReadinessInput = {
  baseStatus: "ROJO" | "AMARILLO" | "VERDE";
  basePrecisionScore: number;
  conformanceOk?: boolean;
  crossArtifactGapCount?: number;
  consistencyScore?: number;
  humanRequiredGapCount?: number;
  conformanceReason?: string;
  traceReason?: string;
};

export type CompositeReadinessResult = {
  status: "ROJO" | "AMARILLO" | "VERDE";
  precisionScore: number;
  reasons: string[];
};

export const READINESS_CONSISTENCY_GREEN_MIN = 90;
export const READINESS_CROSS_GAP_GREEN_TOLERANCE = 5;
export const READINESS_HUMAN_GAP_GREEN_TOLERANCE = 3;
export const READINESS_CROSS_GAP_AMARILLO_CAP = 82;
export const READINESS_HUMAN_GAP_AMARILLO_CAP = 78;
export const READINESS_CONSISTENCY_AMARILLO_CAP = 85;
export const UNIFIED_AUDIT_GAP_LIMIT = 100;

const AUTO_PREFIXES = [
  "[MDD §3]",
  "[MDD §4]",
  "[UAT]",
  "[Inventario]",
  "[Entity→API]",
  "[Trazabilidad]",
] as const;

const HUMAN_PREFIXES = [
  "[BRD decision log]",
  "Por validar",
  "Montos exactos",
  "Definición de periodos",
  "decision log",
] as const;

const LLM_PREFIX_TO_DELIVERABLE: Array<{ re: RegExp; deliverable: string }> = [
  { re: /^\[Blueprint\]/i, deliverable: "blueprint" },
  { re: /^\[API/i, deliverable: "api_contracts" },
  { re: /^\[Flujos\]/i, deliverable: "logic_flows" },
  { re: /^\[Infra\]/i, deliverable: "infra" },
  { re: /^\[Architecture\]/i, deliverable: "architecture" },
  { re: /^\[Tasks\]/i, deliverable: "tasks" },
  { re: /^\[Scheduler\]/i, deliverable: "logic_flows" },
  { re: /^\[Events\]/i, deliverable: "tasks" },
  { re: /^\[Research→Tasks\]/i, deliverable: "tasks" },
  { re: /^\[Research M\*\]/i, deliverable: "api_contracts" },
  { re: /^\[Integración/i, deliverable: "api_contracts" },
  { re: /^\[LLM JSON\]/i, deliverable: "use_cases" },
  { re: /^\[Pantallas\]/i, deliverable: "ui_screens_sync" },
  { re: /^\[Spec↔MDD\]/i, deliverable: "spec" },
  { re: /^\[Spec↔API\]/i, deliverable: "api_contracts" },
  { re: /^\[Spec↔UX\]/i, deliverable: "ux_ui_guide" },
  { re: /^\[HU↔UC\]/i, deliverable: "user_stories" },
  { re: /^\[HU↔Tasks\]/i, deliverable: "tasks" },
  { re: /^\[Entregables\]/i, deliverable: "tasks" },
  { re: /^\[Phase0/i, deliverable: "spec" },
];

function extractGapPrefix(message: string): string {
  const m = message.match(/^\[[^\]]+\]/);
  return m?.[0] ?? message.slice(0, 40);
}

function isHumanGap(message: string): boolean {
  const lower = message.toLowerCase();
  return HUMAN_PREFIXES.some((p) => lower.includes(p.toLowerCase()));
}

function isAutoGap(message: string): boolean {
  return AUTO_PREFIXES.some((p) => message.startsWith(p));
}

function resolveDeliverable(message: string): string | undefined {
  if (/^\[Entregables\]/i.test(message)) {
    if (/Historias de usuario/i.test(message)) return "user_stories";
    if (/Spec/i.test(message)) return "spec";
    if (/Contratos API/i.test(message)) return "api_contracts";
    if (/Guía UX|UX/i.test(message)) return "ux_ui_guide";
    if (/Flujos/i.test(message)) return "logic_flows";
    if (/Tasks/i.test(message)) return "tasks";
    return "tasks";
  }
  for (const { re, deliverable } of LLM_PREFIX_TO_DELIVERABLE) {
    if (re.test(message)) return deliverable;
  }
  if (/entidad inventario|tabla §3 sin endpoint/i.test(message)) return "mdd_canonical";
  if (/BRD→MDD|trazabilidad/i.test(message)) return "mdd_canonical";
  return undefined;
}

/** Clasifica un gap en auto-fixable (determinista), LLM (regeneración) o humano (HITL). */
export function classifyGap(message: string): ClassifiedGap {
  const prefix = extractGapPrefix(message);
  if (isHumanGap(message)) {
    return { message, kind: "human", prefix, targetDeliverable: undefined };
  }
  if (isAutoGap(message)) {
    return { message, kind: "auto", prefix, targetDeliverable: "mdd_canonical" };
  }
  return {
    message,
    kind: "llm",
    prefix,
    targetDeliverable: resolveDeliverable(message),
  };
}

/** Resume gaps clasificados para UI y MCP. */
export function summarizeClassifiedGaps(
  gaps: string[],
  limit = UNIFIED_AUDIT_GAP_LIMIT,
): ReadinessGapSummary {
  const classified = gaps.map(classifyGap);
  const truncated = gaps.length > limit;
  const items = classified.slice(0, limit);
  return {
    total: gaps.length,
    auto: classified.filter((g) => g.kind === "auto").length,
    llm: classified.filter((g) => g.kind === "llm").length,
    human: classified.filter((g) => g.kind === "human").length,
    truncated,
    items,
  };
}

/**
 * Aplica puertas compuestas sobre el semáforo base: conformance, gaps transversales,
 * consistencia BRD→MDD y gaps que requieren intervención humana.
 */
export function applyCompositeReadinessGates(
  input: CompositeReadinessInput,
): CompositeReadinessResult {
  let status = input.baseStatus;
  let precisionScore = input.basePrecisionScore;
  const reasons: string[] = [];

  if (status === "ROJO") {
    return { status, precisionScore, reasons };
  }

  const crossGaps = input.crossArtifactGapCount ?? 0;
  const humanGaps = input.humanRequiredGapCount ?? 0;
  const conformanceOk = input.conformanceOk !== false;
  const consistency = input.consistencyScore;

  if (humanGaps > READINESS_HUMAN_GAP_GREEN_TOLERANCE) {
    status = "AMARILLO";
    precisionScore = Math.min(precisionScore, READINESS_HUMAN_GAP_AMARILLO_CAP);
    reasons.push(`${humanGaps} gap(s) requieren decisión humana (BRD/decision log)`);
  }

  if (!conformanceOk || crossGaps > READINESS_CROSS_GAP_GREEN_TOLERANCE) {
    status = "AMARILLO";
    precisionScore = Math.min(precisionScore, READINESS_CROSS_GAP_AMARILLO_CAP);
    if (!conformanceOk) {
      reasons.push(input.conformanceReason ?? "Conformidad MDD↔derivados incompleta");
    }
    if (crossGaps > READINESS_CROSS_GAP_GREEN_TOLERANCE) reasons.push(`${crossGaps} brecha(s) transversal(es) SDD`);
  }

  if (consistency != null && consistency < READINESS_CONSISTENCY_GREEN_MIN) {
    status = "AMARILLO";
    precisionScore = Math.min(precisionScore, READINESS_CONSISTENCY_AMARILLO_CAP);
    reasons.push(
      `${input.traceReason ?? "Trazabilidad BRD→MDD"} ${consistency}% (< ${READINESS_CONSISTENCY_GREEN_MIN}%)`,
    );
  }

  if (
    status === "VERDE" &&
    (crossGaps > READINESS_CROSS_GAP_GREEN_TOLERANCE || humanGaps > READINESS_HUMAN_GAP_GREEN_TOLERANCE || !conformanceOk || (consistency != null && consistency < READINESS_CONSISTENCY_GREEN_MIN))
  ) {
    status = "AMARILLO";
  }

  return { status, precisionScore, reasons };
}

export type ConvergenceRetryPlan = {
  deliverables: string[];
  feedback: string;
  autoRepairMdd: boolean;
};

const CONVERGENCE_DELIVERABLE_ORDER = [
  "api_contracts",
  "blueprint",
  "logic_flows",
  "architecture",
  "spec",
  "use_cases",
  "user_stories",
  "ux_ui_guide",
  "tasks",
  "infra",
  "agent_governance",
] as const;

/** Feedback acotado por artefacto para regeneración dirigida en cascada. */
export function buildConvergenceFeedbackForDeliverable(
  gaps: string[],
  deliverable: string,
  limit = 48,
): string {
  const classified = gaps.map(classifyGap);
  const auto = classified.filter((g) => g.kind === "auto").map((g) => g.message);
  const llm = classified
    .filter((g) => g.kind === "llm" && g.targetDeliverable === deliverable)
    .map((g) => g.message);
  return [...auto.slice(0, 8), ...llm.slice(0, limit)].join("\n");
}

/** Orden estable de regeneración (API antes que Blueprint, etc.). */
export function orderConvergenceDeliverables(deliverables: string[]): string[] {
  const set = new Set(deliverables);
  const ordered: string[] = CONVERGENCE_DELIVERABLE_ORDER.filter((d) => set.has(d));
  for (const d of deliverables) {
    if (!ordered.includes(d)) ordered.push(d);
  }
  return ordered;
}

/** Plan de reintentos dirigidos a partir de gaps clasificados (ciclo de convergencia post-cascada). */
export function buildConvergenceRetryPlan(gaps: string[]): ConvergenceRetryPlan {
  const classified = gaps.map(classifyGap);
  const deliverables = new Set<string>();
  let autoRepairMdd = false;

  for (const g of classified) {
    if (g.kind === "auto") {
      autoRepairMdd = true;
      continue;
    }
    if (g.kind === "human") continue;
    if (g.targetDeliverable) deliverables.add(g.targetDeliverable);
  }

  const llmMessages = classified.filter((g) => g.kind === "llm").map((g) => g.message);
  const autoMessages = classified.filter((g) => g.kind === "auto").map((g) => g.message);

  const feedbackParts = [
    ...autoMessages.slice(0, 12),
    ...llmMessages.slice(0, 40),
  ];

  return {
    deliverables: [...deliverables],
    feedback: feedbackParts.join("\n"),
    autoRepairMdd,
  };
}
