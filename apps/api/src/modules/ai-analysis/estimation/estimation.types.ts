/**
 * Interfaz de referencia para evaluar completitud del MDD (Semáforo).
 * El EstimationService compara el documento contra estas secciones.
 */
import {
  READINESS_CONSISTENCY_GREEN_MIN,
  READINESS_CROSS_GAP_GREEN_TOLERANCE,
  type MddDeliveryGateResult,
} from "@theforge/shared-types";
export interface MDDReference {
  /** Modelo de datos / entidades */
  db?: boolean;
  /** Contratos de API / endpoints */
  endpoints?: boolean;
  /** Seguridad */
  security?: boolean;
  /** Integración / Infraestructura */
  infra?: boolean;
}

/** Contexto parcial del MDD (markdown o secciones detectadas) para cálculo en vivo. */
export type MDDContext = string | { mddContent?: string; infraContent?: string };

/**
 * Gaps críticos generados por el Auditor (LLM). Textos en español.
 * Sustituye al reporte por regex cuando el Auditor ya ha evaluado el MDD.
 */
export interface AuditorCriticalGap {
  /** Secciones afectadas (ej. "Sección 3", "Sección 6"). */
  sections: string[];
  /** Descripción del problema en español. */
  issue: string;
  /** Acción concreta para corregir (ej. "Añadir tabla mfa_methods con user_id y secret_key"). */
  fix: string;
}

export interface AuditorGaps {
  /** Puntuación 0-100 (coherente con auditorScore). */
  score: number;
  /** APROBADO si score >= 85 y sin gaps críticos bloqueantes; RECHAZADO en caso contrario. */
  status: "APROBADO" | "RECHAZADO";
  /** Gaps críticos de consistencia/trazabilidad (secciones, problema, corrección). */
  critical_gaps: AuditorCriticalGap[];
  /** Errores de sintaxis o formato (ej. Mermaid, JSON). */
  syntax_errors: string[];
  /** true si §7 Infraestructura refleja el stack de §2 (Docker/Node, etc.). */
  infrastructure_ready: boolean;
}

/** Contrato mínimo para que el Manager muestre la misma precisión que el semáforo. */
export interface LivePrecisionCalculator {
  calculateLiveMetrics(
    ctx: MDDContext,
    options?: {
      auditorGaps?: AuditorGaps;
      /** Si no viene, se usa caché por `projectId`+`stageId` cuando existan. */
      complexity?: EstimationComplexity;
      projectId?: string;
      stageId?: string | null;
      /** Documentos expandidos del proyecto (BRD, To-Be, etc.) para cálculo integral. */
      documents?: PlanningDocumentFields;
    },
  ): LiveMetricsResult;
  /** Opcional: reporte de gaps en lenguaje natural. Si se pasan auditorGaps, se usan en lugar de regex. */
  getGapsReport?(md: string, auditorGaps?: AuditorGaps): string[];
}

export type SemaphoreStatusLive = "red" | "yellow" | "green";

/** Alineado con `Project.complexity` (Prisma). Goberna relajación del desglose en vivo y prompts MDD. */
export type EstimationComplexity = "LOW" | "MEDIUM" | "HIGH";

/** Estado por sección: inconsistente cuando la entidad no recorre las 7 secciones (matriz de trazabilidad). */
export type SectionStatus = "ok" | "inconsistente";

/** Calificación por sección/agente (0–100) para mostrar en la tabla del chat tras auditar. */
export interface PrecisionBreakdown {
  contexto: number;
  modeloDatos: number;
  apiContracts: number;
  frontend: number;
  /** §5 Lógica y Edge Cases. */
  logicaEdgeCases: number;
  seguridad: number;
  integracion: number;
  /** Si una sección está en "Estado Inconsistente" por trazabilidad, aparece aquí. */
  sectionStatus?: Partial<Record<"contexto" | "modeloDatos" | "apiContracts" | "seguridad" | "integracion", SectionStatus>>;
  /** Motivo de la calificación por sección (por qué se obtuvo ese %). */
  sectionReasons?: Partial<
    Record<
      | "contexto"
      | "modeloDatos"
      | "apiContracts"
      | "frontend"
      | "logicaEdgeCases"
      | "seguridad"
      | "integracion",
      string
    >
  >;
}

/** Salida exacta para la UI: Semáforo + Estimación (nómina interna y precio mercado). */
export interface LiveMetricsResult {
  precision: number;
  /** Nómina interna ponderada (Σ horas rol × tarifa rol × riskFactor). */
  totalMXN: number;
  /** Referencia mercado (horas × tarifa mercado × riskFactor). */
  totalMXNMarket: number;
  totalHours: number;
  /** Personas por rol (conteo). */
  roles: Record<string, number>;
  /** Horas por rol (reparto delivery). */
  rolesHours: Record<string, number>;
  status: SemaphoreStatusLive;
  /** Costo estimado de generación con IA (USD → MXN ~ $20/USD). */
  totalMXNIA: number;
  /** Pistas breves para preparar el MDD (calidad técnica). */
  readinessHints: string[];
  /** Igual que readinessHints — calidad del MDD / Constitución. */
  mddReadinessHints: string[];
  /** Brechas BRD (negocio) → MDD/Spec sin reflejo técnico. */
  traceabilityHints: string[];
  /** Score 0–100 de trazabilidad BRD→MDD. */
  consistencyScore?: number;
  /** Completitud por documento (30% del total integral). */
  completeness?: DocumentCompleteness;
  /** Calidad MDD usada en la fórmula integral (45% del total). */
  mddQualityScore?: number;
  /** Gaps estructurados BRD→MDD. */
  crossDocumentGaps?: CrossDocumentGap[];
  /** Gate bloqueante de entrega MDD (≥9/10); si ok=false, el semáforo no puede ser verde. */
  deliveryGate?: MddDeliveryGateResult;
  /** Conformidad heurística MDD ↔ cascada (API, Infra, Blueprint, Flujos). */
  conformanceSummary?: import("../../engine/mdd-quality-audit.util.js").ConformanceSummary;
}

/** Origen de una mutación registrada en el edit log del MDD. */
export type MddAgentEditKind = "llm" | "merge" | "deterministic";

/** Entrada del log mínimo de modificaciones de agentes al MDD (§1–§7). */
export type MddAgentEditLogEntry = {
  ts: string;
  node: string;
  kind: MddAgentEditKind;
  /** Secciones canónicas tocadas: "1" … "7". */
  sectionsTouched: string[];
  /** goal / acceptedProposalDirective / auditorFeedback (truncado). */
  why?: string;
  directivesIn?: Array<{ from: string; to: string; message: string }>;
  directivesOut?: Array<{ from: string; to: string; message: string }>;
  beforeLen?: number;
  afterLen?: number;
  sectionLens?: Partial<Record<string, { before: number; after: number }>>;
};

/** Snapshot persistido del último pipeline MDD (audit trail + auditor LLM). */
export type MddAuditSnapshot = {
  auditTrail?: string[];
  /** Log estructurado de mutaciones por nodo/sección (últimas ~100 entradas). */
  mddAgentEditLog?: MddAgentEditLogEntry[];
  precisionBreakdown?: PrecisionBreakdown;
  auditorGaps?: AuditorGaps;
  updatedAt?: string;
};

/** Tasa interna (Costo Empresa 2026): $21k netos × 1.4 carga social ÷ 160 h/mes ≈ $29,400/mes → $185 MXN/hr. */
export const BASE_SALARY_NET_MONTH = 21_000;
export const SOCIAL_LOAD_FACTOR = 1.4;
export const HOURS_PER_MONTH = 160;
export const INTERNAL_HOUR_RATE = 185;

/** Tokens de salida estimados por entidad para generación IA (input + output total del pipeline). */
export const AI_TOKENS_PER_ENTITY = 50_000;
/** Tokens estimados por pantalla (cubre múltiples agentes: UI, API, flujos). */
export const AI_TOKENS_PER_SCREEN = 80_000;
/** Tokens estimados por endpoint extra (análisis + contratos + lógica). */
export const AI_TOKENS_PER_ENDPOINT = 20_000;
/** Tokens base (overhead) del pipeline MDD + cascada de documentos. */
export const AI_BASE_OVERHEAD_TOKENS = 200_000;
/** Costo por token IA en USD blended (~$3/M incluyendo input+output del pipeline completo). */
export const AI_COST_PER_TOKEN_USD = 0.000003;
/** Tipo de cambio USD → MXN para mostrar costo IA en MXN. */
export const MXN_PER_USD = 20;

/** Tarifa hora a precio de mercado (consultoría / venta), MXN/hr. */
export const MARKET_HOUR_RATE = 1_050;

/**
 * Umbrales de precisión del semáforo en vivo (alineados con READINESS_CONSISTENCY_GREEN_MIN):
 * - Rojo: < 85% — Documentación insuficiente para que la IA trabaje. El costo es una "suposición".
 * - Amarillo: 85%–89% — Documentación aceptable (meta mínima 85%). IA puede trabajar, pero hay detalles pendientes.
 * - Verde: ≥ 90% — Con trazabilidad BRD→MDD ≥ 90% y ≤ 5 brechas transversales (misma tolerancia que cascade/readiness).
 */
export const PRECISION_RED_MAX = 85;
export const PRECISION_GREEN_MIN = READINESS_CONSISTENCY_GREEN_MIN;

/** Criterio verde para métrica integral multi-documento (panel Semáforo). */
export function meetsIntegralLiveGreenCriteria(input: {
  precision: number;
  consistencyScore?: number;
  crossDocumentGapCount: number;
}): boolean {
  return (
    input.precision >= PRECISION_GREEN_MIN &&
    (input.consistencyScore ?? 100) >= READINESS_CONSISTENCY_GREEN_MIN &&
    input.crossDocumentGapCount <= READINESS_CROSS_GAP_GREEN_TOLERANCE
  );
}

/** Factor de riesgo dinámico: < 85% → 1.25; ≥ 90% → 1.0. */
export const RISK_FACTOR_LOW_PRECISION = 1.25;
export const RISK_PRECISION_THRESHOLD = 85;

// ──────────────────────────────────────────────
// Tipos para Semáforo Integral Multi-Documento
// ──────────────────────────────────────────────

/** Campos de contenido de documento para el planificador integral. */
export type PlanningDocumentFields = {
  /** MDD de la etapa — destino principal de trazabilidad desde BRD. */
  mddContent?: string;
  brdContent?: string;
  specContent?: string;
  architectureContent?: string;
  useCasesContent?: string;
  userStoriesContent?: string;
  blueprintContent?: string;
  apiContractsContent?: string;
  logicFlowsContent?: string;
  infraContent?: string;
  tasksContent?: string;
};

/** Breakdown de completitud por documento (0-100). */
export type DocumentCompleteness = {
  [K in keyof PlanningDocumentFields]: number;
} & { overall: number };

/** Ítem trazable extraído del BRD (capacidad, regla, entidad, UAT…). */
export type BrdTraceabilityItem = {
  label: string;
  brdSection: string;
  brdSubsection?: string;
  kind: "capability" | "rule" | "entity" | "formula" | "uat" | "permission" | "flow";
};

/** Gap de consistencia entre dos documentos. */
export type CrossDocumentGap = {
  from: string;
  to: string;
  /** Texto del ítem de negocio en el BRD. */
  concept: string;
  severity: "missing" | "partial" | "contradiction";
  /** Sección H2 del BRD (ej. «5. Reglas de Negocio…»). */
  brdSection?: string;
  /** Subsección H3 (ej. «Fórmulas y umbrales»). */
  brdSubsection?: string;
  /** Tipo de ítem de negocio. */
  kind?: BrdTraceabilityItem["kind"];
  /** Palabras clave del BRD no encontradas en §1/§4/§5 del MDD. */
  missingTerms?: string[];
  /** Mensaje explícito para UI (qué falta y dónde revisar). */
  hint?: string;
};

/** Longitud mínima para considerar un documento "completo" (caracteres). */
export const DOC_COMPLETE_MIN_LENGTH = 300;
/** Longitud mínima para "parcial". */
export const DOC_PARTIAL_MIN_LENGTH = 80;

/** Peso de completitud en la nota final (%). */
export const COMPLETENESS_WEIGHT = 0.3;
/** Peso de consistencia transversal en la nota final (%). */
export const CROSS_CONSISTENCY_WEIGHT = 0.25;
/** Peso de la calidad MDD-regex (actual) en la nota final (%). */
export const MDD_QUALITY_WEIGHT = 0.45;


