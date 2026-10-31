/**
 * @fileoverview Mapeo puro de los tipos internos del eval (`MddEvalCase`, `MddEvalSummary`,
 * `MddEvalRunMeta`) a los DTOs del contrato web (`@theforge/shared-types/mdd-eval-api`) y derivación
 * del estado de una corrida a partir de la cola y del disco. Sin I/O.
 */

import type {
  MddEvalAggregatesDto,
  MddEvalCaseDetailDto,
  MddEvalCaseSummaryDto,
  MddEvalCompareDto,
  MddEvalRunDto,
  MddEvalRunProgressDto,
  MddEvalRunRecordDto,
  MddEvalRunStatus,
} from "@theforge/shared-types";
import { compareSummaries, evalFileKeys } from "./mdd-eval-report.util.js";
import type { MddEvalRunMeta } from "./mdd-eval-run-store.util.js";
import type { MddEvalCase, MddEvalRunRecord, MddEvalSummary } from "./mdd-eval.types.js";

const BRIEF_PREVIEW_CHARS = 200;
const DEFAULT_MIN_RUBRIC = 80;
const DEFAULT_MIN_AUDITOR = 85;

export function toCaseSummaryDto(evalCase: MddEvalCase): MddEvalCaseSummaryDto {
  const brief = evalCase.brief.trim();
  return {
    id: evalCase.id,
    title: evalCase.title,
    domain: evalCase.domain,
    complexity: evalCase.complexity,
    minRubric: evalCase.thresholds?.minRubric ?? DEFAULT_MIN_RUBRIC,
    minAuditor: evalCase.thresholds?.minAuditor ?? DEFAULT_MIN_AUDITOR,
    hasDbga: Boolean(evalCase.dbga?.trim()),
    hasBrd: Boolean(evalCase.brd?.trim()),
    briefPreview: brief.length > BRIEF_PREVIEW_CHARS ? `${brief.slice(0, BRIEF_PREVIEW_CHARS)}…` : brief,
  };
}

export function toCaseDetailDto(evalCase: MddEvalCase): MddEvalCaseDetailDto {
  return {
    ...toCaseSummaryDto(evalCase),
    brief: evalCase.brief,
    ...(evalCase.dbga ? { dbga: evalCase.dbga } : {}),
    ...(evalCase.brd ? { brd: evalCase.brd } : {}),
    expect: {
      entities: evalCase.expect.entities,
      capabilities: evalCase.expect.capabilities.map((c) => ({
        name: c.name,
        endpointHints: c.endpointHints,
      })),
      security: evalCase.expect.security,
      infra: evalCase.expect.infra,
      forbidden: evalCase.expect.forbidden,
      mustMentionInContext: evalCase.expect.mustMentionInContext,
    },
  };
}

const KEPT_PROJECT_RE = /proyecto temporal conservado (\S+)/;

/** Id del proyecto temporal conservado (`--keep` / keepProjects), anotado por el runner en `auditTrail`. */
export function extractKeptProjectId(record: MddEvalRunRecord): string | undefined {
  for (const line of record.auditTrail) {
    const match = KEPT_PROJECT_RE.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export function toRunRecordDto(
  record: MddEvalRunRecord,
  opts: { hasMarkdown: boolean; keepProjects: boolean },
): MddEvalRunRecordDto {
  const projectId = opts.keepProjects ? extractKeptProjectId(record) : undefined;
  return {
    caseId: record.caseId,
    complexity: record.complexity,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    markdownLen: record.markdownLen,
    hasMarkdown: opts.hasMarkdown,
    ...(projectId ? { projectId } : {}),
    ...(record.auditorScore !== undefined ? { auditorScore: record.auditorScore } : {}),
    ...(record.precision !== undefined ? { precision: record.precision } : {}),
    ...(record.status ? { status: record.status } : {}),
    ...(record.gateOk !== undefined ? { gateOk: record.gateOk } : {}),
    gateBlockers: record.gateBlockers,
    gateWarnings: record.gateWarnings,
    ...(record.failedStep ? { failedStep: record.failedStep } : {}),
    auditTrail: record.auditTrail,
    ...(record.llmCalls !== undefined ? { llmCalls: record.llmCalls } : {}),
    ...(record.promptTokens !== undefined ? { promptTokens: record.promptTokens } : {}),
    ...(record.completionTokens !== undefined ? { completionTokens: record.completionTokens } : {}),
    ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
    rubric: {
      total: record.rubric.total,
      passed: record.rubric.passed,
      dimensions: record.rubric.dimensions.map((d) => ({
        key: d.key,
        score: d.score,
        weight: d.weight,
        details: d.details,
      })),
      forbiddenHits: record.rubric.forbiddenHits,
      forbiddenPenalty: record.rubric.forbiddenPenalty,
      failures: record.rubric.failures,
    },
    passed: record.passed,
    ...(record.error ? { error: record.error } : {}),
  };
}

export function toAggregatesDto(summary: MddEvalSummary): MddEvalAggregatesDto {
  const a = summary.aggregates;
  return {
    cases: a.cases,
    passed: a.passed,
    passRate: a.passRate,
    avgRubric: a.avgRubric,
    avgAuditor: a.avgAuditor,
    avgDurationMs: a.avgDurationMs,
    totalCostUsd: a.totalCostUsd,
    totalLlmCalls: a.totalLlmCalls,
  };
}

/** Estado vivo de la corrida según la cola BullMQ o el mapa en memoria (modo sin Redis). */
export interface MddEvalLiveState {
  state: "waiting" | "active" | "completed" | "failed";
  progress?: MddEvalRunProgressDto;
  /** Motivo del fallo (job failed). */
  error?: string;
  /** Cancelación pedida o ya efectuada (clave Redis, flag en memoria o returnvalue del job). */
  cancelled?: boolean;
  /** Metadatos embebidos en el job (corridas cuya carpeta no es visible para este proceso). */
  meta?: MddEvalRunMeta;
  /** Summary devuelto por el worker al completar (respaldo si `summary.json` no es visible). */
  summary?: MddEvalSummary;
}

export const MDD_EVAL_INTERRUPTED_ERROR =
  "La corrida se interrumpió: no hay ningún proceso ejecutándola (el worker se reinició o se detuvo).";

/**
 * Estado de la corrida.
 *
 *  - cancelada (flag vivo o `run.json`) gana siempre;
 *  - con job vivo: waiting/delayed → queued, active → running, completed → completed, failed → failed;
 *  - sin job: manda `run.json`; una corrida `queued`/`running` sin proceso se considera `completed`
 *    si existe el summary y `failed` (interrumpida) si no;
 *  - `liveUnavailable` (Redis no respondió): se confía en `run.json` tal cual.
 */
export function deriveMddEvalRunStatus(input: {
  metaStatus: MddEvalRunStatus;
  live?: MddEvalLiveState | null;
  hasSummary: boolean;
  liveUnavailable?: boolean;
  metaError?: string;
}): { status: MddEvalRunStatus; error?: string } {
  const { metaStatus, live, hasSummary } = input;
  if (live?.cancelled || metaStatus === "cancelled") return { status: "cancelled" };
  if (live) {
    switch (live.state) {
      case "waiting":
        return { status: "queued" };
      case "active":
        return { status: "running" };
      case "completed":
        return { status: "completed" };
      case "failed":
        return { status: "failed", error: input.metaError ?? live.error ?? "La corrida falló" };
      default:
        break;
    }
  }
  if (metaStatus === "queued" || metaStatus === "running") {
    if (input.liveUnavailable) return { status: metaStatus };
    return hasSummary ? { status: "completed" } : { status: "failed", error: MDD_EVAL_INTERRUPTED_ERROR };
  }
  if (metaStatus === "failed") return { status: "failed", error: input.metaError ?? "La corrida falló" };
  return { status: metaStatus };
}

/** Ensambla el DTO de una corrida. `hasMarkdown(record, key)` consulta el disco. */
export function buildMddEvalRunDto(input: {
  meta: MddEvalRunMeta;
  status: MddEvalRunStatus;
  error?: string;
  summary?: MddEvalSummary;
  progress?: MddEvalRunProgressDto;
  hasMarkdown: (record: MddEvalRunRecord, key: string) => boolean;
}): MddEvalRunDto {
  const { meta, summary, status } = input;
  const keys = summary ? evalFileKeys(summary.cases) : [];
  const records =
    summary?.cases.map((record, index) =>
      toRunRecordDto(record, {
        hasMarkdown: input.hasMarkdown(record, keys[index]),
        keepProjects: meta.keepProjects,
      }),
    ) ?? [];
  const caseIds = meta.caseIds.length > 0 ? meta.caseIds : (summary?.cases.map((c) => c.caseId) ?? []);
  const total = caseIds.length;
  const lastMessage = input.progress?.lastMessage ?? meta.progress?.lastMessage;
  const progress: MddEvalRunProgressDto =
    status === "completed"
      ? {
          total: summary?.cases.length ?? total,
          done: summary?.cases.length ?? total,
          running: [],
          ...(lastMessage ? { lastMessage } : {}),
        }
      : (input.progress ?? meta.progress ?? { total, done: 0, running: [] });
  const finishedAt = summary?.finishedAt ?? meta.finishedAt;
  const gitSha = summary?.gitSha ?? meta.gitSha;
  return {
    runId: meta.runId,
    status,
    startedAt: meta.startedAt,
    ...(finishedAt && (status === "completed" || status === "failed" || status === "cancelled")
      ? { finishedAt }
      : {}),
    requestedByUserId: meta.requestedByUserId,
    groupId: meta.groupId,
    caseIds,
    concurrency: meta.concurrency,
    keepProjects: meta.keepProjects,
    ...(gitSha ? { gitSha } : {}),
    progress,
    records,
    ...(summary ? { aggregates: toAggregatesDto(summary) } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

function definedNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function buildMddEvalCompareDto(base: MddEvalSummary, target: MddEvalSummary): MddEvalCompareDto {
  const comparison = compareSummaries(base, target);
  return {
    baseRunId: base.runId,
    targetRunId: target.runId,
    rows: comparison.cases.map((row) => ({
      caseId: row.caseId,
      ...(definedNumber(row.rubric.prev) !== undefined ? { rubricBefore: row.rubric.prev! } : {}),
      ...(definedNumber(row.rubric.next) !== undefined ? { rubricAfter: row.rubric.next! } : {}),
      ...(definedNumber(row.rubric.delta) !== undefined ? { rubricDelta: row.rubric.delta! } : {}),
      ...(definedNumber(row.auditor.prev) !== undefined ? { auditorBefore: row.auditor.prev! } : {}),
      ...(definedNumber(row.auditor.next) !== undefined ? { auditorAfter: row.auditor.next! } : {}),
      ...(definedNumber(row.auditor.delta) !== undefined ? { auditorDelta: row.auditor.delta! } : {}),
      ...(definedNumber(row.durationMs.prev) !== undefined ? { durationBeforeMs: row.durationMs.prev! } : {}),
      ...(definedNumber(row.durationMs.next) !== undefined ? { durationAfterMs: row.durationMs.next! } : {}),
      ...(row.passed.prev !== null ? { passedBefore: row.passed.prev } : {}),
      ...(row.passed.next !== null ? { passedAfter: row.passed.next } : {}),
    })),
    aggregatesBefore: toAggregatesDto(base),
    aggregatesAfter: toAggregatesDto(target),
  };
}
