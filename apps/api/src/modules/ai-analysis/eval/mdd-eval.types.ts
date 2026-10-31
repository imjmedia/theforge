/**
 * @fileoverview Contrato del conjunto de evaluación de MDDs (eval harness).
 *
 * Un *caso* describe lo que pediría un usuario real (brief en español) y lo que un MDD
 * correcto debe contener, expresado como expectativas verificables sin LLM: tablas en §3,
 * endpoints por capacidad en §4, decisiones de seguridad en §6, infraestructura en §7,
 * tokens prohibidos (fugas de otros dominios o de prompts) y menciones en §1.
 *
 * La rúbrica (`mdd-eval-rubric.ts`) puntúa un markdown contra un caso y devuelve
 * `MddEvalScore`. El runner (`scripts/eval-mdd.ts`) genera el MDD con el pipeline real,
 * lo puntúa, agrega métricas de harness (score del Auditor, gate, tokens, tiempo) y
 * escribe `MddEvalSummary`. Todo lo que hay aquí es puro y estable: los tres módulos
 * dependen de este archivo y de nada más entre sí.
 */

import { z } from "zod";

export const mddEvalComplexitySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type MddEvalComplexity = z.infer<typeof mddEvalComplexitySchema>;

/** Capacidad de negocio y pistas de ruta que deben aparecer en §4 (substrings en minúsculas, p. ej. "/orders", "/auth/login"). */
export const mddEvalCapabilitySchema = z.object({
  name: z.string().min(3),
  /** Al menos una pista debe aparecer en alguna ruta de §4 para dar la capacidad por cubierta. */
  endpointHints: z.array(z.string().min(2)).min(1),
});

export const mddEvalExpectationsSchema = z.object({
  /** Nombres de tabla esperados en §3 (snake_case, singular o plural; la rúbrica normaliza). */
  entities: z.array(z.string().min(2)).min(3),
  /** Sinónimos aceptados por entidad (clave = nombre en `entities`). */
  entitySynonyms: z.record(z.array(z.string().min(2))).default({}),
  capabilities: z.array(mddEvalCapabilitySchema).min(2),
  /** Tokens que deben aparecer en §6 (minúsculas, p. ej. "jwt", "rbac", "mfa", "argon2|bcrypt" admite alternativas con |). */
  security: z.array(z.string().min(2)).min(1),
  /** Tokens que deben aparecer en §7 (p. ej. "docker", "postgres", "redis", "backup"). */
  infra: z.array(z.string().min(2)).min(1),
  /** Tokens que NO deben aparecer en todo el documento (fugas: whatsapp, wasender, denue, bitrix, "pendiente: arquitecto"…). */
  forbidden: z.array(z.string().min(2)).default([]),
  /** Conceptos que §1 Contexto debe mencionar (minúsculas). */
  mustMentionInContext: z.array(z.string().min(2)).default([]),
});

export const mddEvalThresholdsSchema = z.object({
  /** Mínimo de la rúbrica determinista (0-100) para dar el caso por aprobado. */
  minRubric: z.number().min(0).max(100).default(80),
  /** Mínimo del score del Auditor LLM (0-100); solo se evalúa si el runner lo obtuvo. */
  minAuditor: z.number().min(0).max(100).default(85),
});

export const mddEvalCaseSchema = z.object({
  /** Identificador estable, kebab-case; también es el nombre del archivo `cases/<id>.json`. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  title: z.string().min(5),
  /** Dominio de negocio en una palabra o dos (ecommerce, salud, logística…). */
  domain: z.string().min(3),
  complexity: mddEvalComplexitySchema,
  /** Lo que escribiría el usuario en el chat: en español, 200-2000 caracteres, sin jerga interna del harness. */
  brief: z.string().min(200).max(4000),
  /** Benchmark (DBGA) opcional para el pipeline; si falta, el runner usa el brief como contexto. */
  dbga: z.string().optional(),
  /** BRD opcional (documento de requisitos de negocio) para los jueces de trazabilidad. */
  brd: z.string().optional(),
  expect: mddEvalExpectationsSchema,
  thresholds: mddEvalThresholdsSchema.default({}),
});

export type MddEvalCase = z.infer<typeof mddEvalCaseSchema>;
export type MddEvalCaseInput = z.input<typeof mddEvalCaseSchema>;

/** Claves de dimensión de la rúbrica y su peso (suman 100). `forbidden` resta: es penalización. */
export const MDD_EVAL_DIMENSION_WEIGHTS = {
  structure: 15,
  entities: 25,
  capabilities: 25,
  security: 10,
  infra: 10,
  context: 5,
  language: 5,
  diagrams: 5,
} as const;
export type MddEvalDimensionKey = keyof typeof MDD_EVAL_DIMENSION_WEIGHTS;

/** Penalización máxima por tokens prohibidos (se resta del total, floor 0). */
export const MDD_EVAL_FORBIDDEN_PENALTY_MAX = 20;

export type MddEvalDimension = {
  key: MddEvalDimensionKey;
  /** 0-100 dentro de la dimensión. */
  score: number;
  weight: number;
  /** Explicaciones legibles: qué se encontró y qué faltó. */
  details: string[];
};

export type MddEvalScore = {
  /** 0-100 ponderado, tras penalización por prohibidos. */
  total: number;
  /** total >= thresholds.minRubric. */
  passed: boolean;
  dimensions: MddEvalDimension[];
  /** Tokens prohibidos encontrados y penalización aplicada. */
  forbiddenHits: string[];
  forbiddenPenalty: number;
  /** Resumen de fallos para el informe (una línea por hueco). */
  failures: string[];
};

/** Métricas del harness para una corrida de un caso; todo opcional salvo lo que el runner siempre conoce. */
export type MddEvalRunRecord = {
  caseId: string;
  complexity: MddEvalComplexity;
  startedAt: string;
  durationMs: number;
  markdownLen: number;
  /** Ruta del markdown generado guardado en disco. */
  markdownPath?: string;
  auditorScore?: number;
  /** Porcentaje mostrado al usuario (métrica en vivo). */
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
  rubric: MddEvalScore;
  /** passed = rubric.passed && (auditorScore == null || auditorScore >= minAuditor) && gateOk !== false. */
  passed: boolean;
  error?: string;
};

export type MddEvalAggregates = {
  cases: number;
  passed: number;
  passRate: number;
  avgRubric: number;
  avgAuditor: number | null;
  avgDurationMs: number;
  totalCostUsd: number | null;
  totalLlmCalls: number | null;
};

export type MddEvalSummary = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  gitSha?: string;
  /** Argumentos relevantes de la corrida (casos, concurrencia, dry-run, modelo si se conoce). */
  args: Record<string, string | number | boolean | undefined>;
  cases: MddEvalRunRecord[];
  aggregates: MddEvalAggregates;
};

/** Directorio por defecto de casos y resultados, relativo a `apps/api`. */
export const MDD_EVAL_CASES_DIR = "eval/mdd/cases";
export const MDD_EVAL_FIXTURES_DIR = "eval/mdd/fixtures";
export const MDD_EVAL_RESULTS_DIR = "eval/mdd/results";
