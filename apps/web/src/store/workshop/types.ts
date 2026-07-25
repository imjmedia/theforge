/**
 * @fileoverview Tipos compartidos del store Workshop: {@link Status} (semáforo), {@link ChatMessage}, tipos de agentes, etc.
 */
import type { ChatImagePart, MddDeliveryGateResult } from "@theforge/shared-types";

export type Status = "ROJO" | "AMARILLO" | "VERDE";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tab?: string;
  /** Etapa en foco al enviar (el historial del chat sigue siendo global). */
  stageId?: string;
  images?: ChatImagePart[];
}

export interface Estimation {
  id: string;
  projectId: string;
  totalHours: number;
  totalMxn: number;
  teamStructure: Record<string, number>;
}

/** Métricas en vivo del EstimationService (Semáforo + nómina interna y precio mercado). */
export interface LiveMetricsResult {
  precision: number;
  totalMXN: number;
  totalMXNMarket: number;
  /** Costo estimado de generación con IA (USD → MXN). */
  totalMXNIA: number;
  totalHours: number;
  roles: Record<string, number>;
  rolesHours: Record<string, number>;
  status: "red" | "yellow" | "green";
  /** @deprecated Usar mddReadinessHints */
  readinessHints?: string[];
  mddReadinessHints?: string[];
  traceabilityHints?: string[];
  consistencyScore?: number;
  /** Completitud por documento (30% del total integral). */
  completeness?: DocumentCompleteness;
  /** Calidad MDD usada en la fórmula integral (45% del total). */
  mddQualityScore?: number;
  crossDocumentGaps?: CrossDocumentGap[];
  /** Gate bloqueante de entrega MDD (≥9/10). */
  deliveryGate?: MddDeliveryGateResult;
  /** Conformidad heurística MDD ↔ cascada. */
  conformanceSummary?: {
    ok: boolean;
    api: { ok: boolean; missingCount: number; extraCount: number; aliasWarnings: string[] };
    infra: { ok: boolean; gapCount: number; gaps: string[] };
    blueprint: { ok: boolean };
    logicFlows: { ok: boolean };
  };
}
/** Calificación por sección/agente (0–100) en el evento done del stream MDD. */
export interface PrecisionBreakdown {
  contexto: number;
  modeloDatos: number;
  apiContracts: number;
  frontend: number;
  seguridad: number;
  integracion: number;
  /** Motivo de la calificación por sección (por qué se obtuvo ese %). */
  sectionReasons?: Partial<Record<"contexto" | "modeloDatos" | "apiContracts" | "frontend" | "seguridad" | "integracion", string>>;
}

/** Breakdown de completitud por documento (0-100). Coincide con backend PlanningDocumentFields. */
export interface DocumentCompleteness {
  brdContent: number;
  asIsManualContent: number;
  specContent: number;
  architectureContent: number;
  useCasesContent: number;
  userStoriesContent: number;
  blueprintContent: number;
  apiContractsContent: number;
  logicFlowsContent: number;
  infraContent: number;
  tasksContent: number;
  overall: number;
}

/** Gap de consistencia entre dos documentos. */
export interface CrossDocumentGap {
  from: string;
  to: string;
  concept: string;
  severity: "missing" | "partial" | "contradiction";
  brdSection?: string;
  brdSubsection?: string;
  kind?: "capability" | "rule" | "entity" | "formula" | "uat" | "permission" | "flow";
  missingTerms?: string[];
  hint?: string;
}

/** Resultado de conformance (Blueprint/Infra vs MDD). */
export interface ConformanceResult {
  ok: boolean;
  gaps: string[];
}

/** Resultado de conformance API vs MDD. */
export interface ApiConformanceResult {
  ok: boolean;
  missingInApi: string[];
  extraInApi: string[];
}

/** Paso de la cascada legacy de entregables (respuesta `POST …/legacy/generate-deliverables`). */
export interface LegacyDeliverablesDebugStep {
  kind: string;
  at: string;
  durationMs: number;
  ok: boolean;
  outChars?: number;
  detail?: string;
  error?: string;
}

/** Grupo de ventanas MDD en section-merge (API `lastDeliverablesDebug`). */
export interface LegacySectionMergeTraceGroup {
  id: string;
  sections: number[];
  durationMs: number;
  outChars: number;
  ok: boolean;
}

export interface LegacySectionMergeTrace {
  kind: string;
  groups: LegacySectionMergeTraceGroup[];
  mechanicalOk: boolean;
  conformanceOk?: boolean;
  gaps: string[];
  repaired?: boolean;
  finalChars: number;
}

/** Cobertura heurística servicios §5 vs flujos (legacy etapa 1). */
export interface LogicFlowsSection5CoverageReport {
  totalServices: number;
  coveredServices: number;
  coveragePercent: number;
  missingServices: string[];
  targetPercent: number;
  metTarget: boolean;
  batchCount?: number;
  gapPassApplied?: boolean;
}

/** Trazabilidad de la última generación de entregables legacy (API + `legacyFlowState`). */
export interface LegacyDeliverablesDebugReport {
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  deliverablesWithBody?: number;
  mddSource: string;
  mddChars: number;
  codebaseDocChars: number;
  mddContentChars: number;
  theforgeContextChars: number;
  theforgeConfigured: boolean;
  complexityEffective: string;
  deliverablesOrder: string[];
  steps: LegacyDeliverablesDebugStep[];
  fatalError?: { message: string; stack?: string };
  upstreamRateLimited?: boolean;
  retryAfterSeconds?: number;
  mddCharsSentToLlm?: number;
  mddClippedForLlm?: boolean;
  mddLlmStrategy?: "full" | "truncate" | "rollup";
  mddRollupWindows?: number;
  mddRollupFailed?: boolean;
  sectionMergeTraces?: LegacySectionMergeTrace[];
  legacyBaselineStage?: boolean;
  logicFlowsSection5Coverage?: LogicFlowsSection5CoverageReport;
}

/** Estado del flujo legacy (archivos, preguntas, respuestas sugeridas por AriadneSpecs). */
export interface LegacyFlowState {
  description?: string;
  /** Paths o { path, repoId } (multi-repo, SPEC-MCP-001). */
  filesToModify?: (string | { path: string; repoId?: string })[];
  questions?: string[];
  /** Respuestas sugeridas por AriadneSpecs desde el codebase; se muestran pre-rellenadas */
  suggestedAnswers?: Record<string, string>;
  answers?: Record<string, string>;
  /** Documentación de partida del codebase (opcional, generada vía MCP). */
  codebaseDoc?: string;
  /** Última traza de `generate-deliverables` (persistida en el servidor). */
  lastDeliverablesDebug?: LegacyDeliverablesDebugReport;
}

/** Fila `Stage` en `GET /projects/:id` (MDD/semáforo por etapa). */
export interface WorkshopStage {
  id: string;
  ordinal: number;
  key: string | null;
  name: string | null;
  workflowStatus: string;
  mddContent?: string | null;
  brdContent?: string | null;
  brdApprovedAt?: string | null;
  status: Status;
  precisionScore: number;
  estimation: Estimation | null;
  /** Entregables por etapa (columnas Stage; fallback a Project en el store). */
  specContent?: string | null;
  architectureContent?: string | null;
  useCasesContent?: string | null;
  userStoriesContent?: string | null;
  blueprintContent?: string | null;
  tasksContent?: string | null;
  apiContractsContent?: string | null;
  logicFlowsContent?: string | null;
  infraContent?: string | null;
  agentGovernanceContent?: string | null;
  uxUiGuideContent?: string | null;
  uiScreensContent?: string | null;
  phase0SummaryContent?: string | null;
  aemContent?: string | null;
  /** Estado del flujo legacy para esta etapa (cambio) */
  legacyChangeState?: LegacyFlowState | null;
  /** STM agéntica: gate MDD, snapshot calidad Tasks, etc. */
  shortTermContext?: Record<string, unknown> | null;
  handoffImportedAt?: string | null;
  handoffSnapshot?: { items?: unknown[] | null } | null;
  linkedNewProjectId?: string | null;
}

/** Propuesta HITL hasta confirmación en chat o `POST .../confirm-complexity`. */
export interface ComplexityPending {
  level: "LOW" | "MEDIUM" | "HIGH";
  planSummary: string;
  reason?: string;
}

export interface Project {
  id: string;
  name: string;
  /** Política SDD: gobierna semáforo y entregables (API: `Project.complexity`). */
  complexity?: "LOW" | "MEDIUM" | "HIGH";
  /** Inferencia / plan propuesto; no aplica a `complexity` hasta confirmación explícita. */
  complexityPending?: ComplexityPending | null;
  projectType?: "NEW" | "LEGACY";
  /** Privado (solo owner) o compartido (todos los usuarios). */
  visibility?: "PRIVATE" | "SHARED";
  /** Si true, el API bloquea MDD técnico hasta BRD + To-Be aprobados (configurable en el panel). */
  requireBrdTobeGate?: boolean;
  theforgeProjectId?: string | null;
  status: Status;
  precisionScore: number;
  hasUxTeam: boolean;
  dbgaContent: string | null;
  specContent: string | null;
  mddContent: string | null;
  phase0SummaryContent: string | null;
  uxUiGuideContent: string | null;
  /** Referencia visual para Design System: slug del catálogo o `auto`. */
  uxGuideDesignRef?: string | null;
  blueprintContent: string | null;
  tasksContent: string | null;
  apiContractsContent: string | null;
  logicFlowsContent: string | null;
  architectureContent: string | null;
  useCasesContent: string | null;
  userStoriesContent: string | null;
  infraContent: string | null;
  aemContent: string | null;

  uiScreensContent: string | null;
  agentGovernanceContent: string | null;
  /** Mapa pluginId → payload (motor de plugins). */
  pluginData?: Record<string, unknown> | null;
  convergeWebhookUrl?: string | null;
  linkedLegacyProjectId?: string | null;
  linkedNewProjectId?: string | null;
  estimation: Estimation | null;
  /** Presente en respuesta API completa; el front usa `activeStageId` para foco MDD. */
  stages?: WorkshopStage[];
}
/** Trazas MCP (Ariadne) devueltas cuando el API tiene `LEGACY_CODEBASE_DOC_MCP_DEBUG_UI=1`. */
export interface LegacyMcpDebugEntry {
  at: string;
  rpcMethod: string;
  toolName?: string;
  requestJson: string;
  responseHttpStatus: number;
  responseBodyPreview: string;
  durationMs: number;
}

export interface Session {
  id: string;
  projectId: string;
  chatLog: ChatMessage[];
  contextStep: string;
  updatedAt: string;
}
