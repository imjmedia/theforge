/**
 * Contrato API ↔ web del conjunto de evaluación de MDDs (pestaña "Evaluación MDD" en Ajustes).
 *
 * El API ejecuta las corridas en el worker BullMQ (cola `mdd-eval`) y guarda los resultados en
 * `apps/api/eval/mdd/results/<runId>/summary.json`; estos DTOs son la vista serializable de ese
 * estado. Los tipos internos del eval (`MddEvalSummary`, `MddEvalRunRecord`) viven en
 * `apps/api/src/modules/ai-analysis/eval/mdd-eval.types.ts`; el API los mapea a estos.
 */

import { z } from "zod";

export const MDD_EVAL_API_PREFIX = "ai-analysis/eval/mdd";

export const mddEvalRunStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type MddEvalRunStatus = z.infer<typeof mddEvalRunStatusSchema>;

export const mddEvalComplexityDtoSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type MddEvalComplexityDto = z.infer<typeof mddEvalComplexityDtoSchema>;

/** Resumen de un caso para la lista (sin el brief completo). */
export interface MddEvalCaseSummaryDto {
  id: string;
  title: string;
  domain: string;
  complexity: MddEvalComplexityDto;
  minRubric: number;
  minAuditor: number;
  hasDbga: boolean;
  hasBrd: boolean;
  /** Primeros ~200 caracteres del brief. */
  briefPreview: string;
}

/** Caso completo (para el panel de detalle). */
export interface MddEvalCaseDetailDto extends MddEvalCaseSummaryDto {
  brief: string;
  dbga?: string;
  brd?: string;
  expect: {
    entities: string[];
    capabilities: Array<{ name: string; endpointHints: string[] }>;
    security: string[];
    infra: string[];
    forbidden: string[];
    mustMentionInContext: string[];
  };
}

export const mddEvalStartRunSchema = z.object({
  /** Vacío o ausente = todos los casos. */
  caseIds: z.array(z.string().min(1)).optional(),
  concurrency: z.number().int().min(1).max(3).default(1),
  /** Grupo donde se crean los proyectos temporales; por defecto el grupo "Proyectos". */
  groupId: z.string().uuid().optional(),
  /** Conservar los proyectos generados para inspección en el taller. */
  keepProjects: z.boolean().default(false),
  /** Tope por caso en ms (default 30 min). */
  timeoutMs: z.number().int().min(60_000).max(7_200_000).optional(),
});
export type MddEvalStartRunDto = z.input<typeof mddEvalStartRunSchema>;

export interface MddEvalDimensionDto {
  key: string;
  score: number;
  weight: number;
  details: string[];
}

export interface MddEvalScoreDto {
  total: number;
  passed: boolean;
  dimensions: MddEvalDimensionDto[];
  forbiddenHits: string[];
  forbiddenPenalty: number;
  failures: string[];
}

export interface MddEvalRunRecordDto {
  caseId: string;
  complexity: MddEvalComplexityDto;
  startedAt: string;
  durationMs: number;
  markdownLen: number;
  /** true cuando `GET runs/:runId/cases/:caseId/markdown` tiene contenido. */
  hasMarkdown: boolean;
  /** Proyecto temporal conservado (solo con keepProjects). */
  projectId?: string;
  auditorScore?: number;
  precision?: number;
  status?: "red" | "yellow" | "green";
  gateOk?: boolean;
  gateBlockers: string[];
  gateWarnings: string[];
  failedStep?: { node: string; error: string };
  auditTrail: string[];
  llmCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  rubric: MddEvalScoreDto;
  passed: boolean;
  error?: string;
}

export interface MddEvalAggregatesDto {
  cases: number;
  passed: number;
  /** 0-1 */
  passRate: number;
  avgRubric: number;
  avgAuditor: number | null;
  avgDurationMs: number;
  totalCostUsd: number | null;
  totalLlmCalls: number | null;
}

export interface MddEvalRunProgressDto {
  total: number;
  done: number;
  /** Casos en ejecución ahora mismo. */
  running: string[];
  /** Último evento de progreso legible (p. ej. "clinica-citas-historial: Definiendo schema SQL…"). */
  lastMessage?: string;
}

export interface MddEvalRunDto {
  runId: string;
  status: MddEvalRunStatus;
  startedAt: string;
  finishedAt?: string;
  requestedByUserId: string;
  groupId: string;
  caseIds: string[];
  concurrency: number;
  keepProjects: boolean;
  gitSha?: string;
  progress: MddEvalRunProgressDto;
  /** Presente cuando status es completed (o failed con resultados parciales). */
  records: MddEvalRunRecordDto[];
  aggregates?: MddEvalAggregatesDto;
  error?: string;
}

export interface MddEvalCompareRowDto {
  caseId: string;
  rubricBefore?: number;
  rubricAfter?: number;
  rubricDelta?: number;
  auditorBefore?: number;
  auditorAfter?: number;
  auditorDelta?: number;
  durationBeforeMs?: number;
  durationAfterMs?: number;
  passedBefore?: boolean;
  passedAfter?: boolean;
}

export interface MddEvalCompareDto {
  baseRunId: string;
  targetRunId: string;
  rows: MddEvalCompareRowDto[];
  aggregatesBefore?: MddEvalAggregatesDto;
  aggregatesAfter?: MddEvalAggregatesDto;
}

/** Rutas relativas a `MDD_EVAL_API_PREFIX` (documentación; el controller debe coincidir). */
export const MDD_EVAL_API_ROUTES = {
  cases: "cases",
  caseDetail: "cases/:id",
  runs: "runs",
  run: "runs/:runId",
  runCancel: "runs/:runId/cancel",
  runCaseMarkdown: "runs/:runId/cases/:caseId/markdown",
  compare: "runs/compare",
} as const;
