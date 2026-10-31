/**
 * @fileoverview Orquestación del eval de MDDs. Ejecuta cada caso (proyecto temporal → generación
 * con el pipeline real → rúbrica → registro de métricas) con dependencias inyectadas: el mismo
 * código sirve al CLI (Nest + Prisma) y a los tests (fakes). Nunca lanza: los errores de un caso
 * van a `record.error` con `passed = false`.
 */

import { execFileSync } from "node:child_process";
import type {
  MddEvalAggregates,
  MddEvalCase,
  MddEvalRunRecord,
  MddEvalScore,
  MddEvalSummary,
} from "./mdd-eval.types.js";

/** Subconjunto estructural de `StreamProgressEvent` (ai-analysis.service.ts) que usa el runner. */
export type EvalDeliveryGate = {
  ok: boolean;
  score?: number;
  blockers?: string[];
  warnings?: string[];
};

export type EvalStreamEvent =
  | { type: "progress"; agent: string; message: string; phase?: "active" | "done" }
  | { type: "draft"; markdown: string; deliveryGate?: EvalDeliveryGate }
  | { type: "blocked"; code: string; message: string }
  | {
      type: "done";
      markdown: string;
      /** Porcentaje del juez (Auditor). Es la métrica `auditorScore` del registro cuando el Auditor corrió. */
      precision?: number;
      status?: "red" | "yellow" | "green";
      deliveryGate?: EvalDeliveryGate;
      auditorFeedback?: string;
      auditTrail?: string[];
      failedStep?: { node: string; error: string };
    }
  | { type: "error"; message: string; code?: string; replanning?: boolean };

export type EvalTokenUsage = {
  llmCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
};

export interface MddEvalRunnerDeps {
  createTempProject(evalCase: MddEvalCase): Promise<{ projectId: string; stageId: string }>;
  deleteTempProject(projectId: string): Promise<void>;
  generate(
    dbgaContent: string,
    projectId: string,
    stageId: string,
    signal: AbortSignal,
  ): AsyncIterable<EvalStreamEvent>;
  getTokenUsage(projectId: string): Promise<EvalTokenUsage>;
  score(markdown: string, evalCase: MddEvalCase): MddEvalScore;
  now(): number;
}

export interface MddEvalRunOptions {
  /** Tiempo máximo por caso; al agotarse se aborta la generación y el caso falla. */
  timeoutMs: number;
  /** true: no borrar el proyecto temporal (queda anotado en `auditTrail`). */
  keep?: boolean;
}

export interface MddEvalSuiteOptions extends MddEvalRunOptions {
  /** Casos en vuelo a la vez (se acota a 1..MAX_EVAL_CONCURRENCY). */
  concurrency: number;
  runId: string;
  args?: MddEvalSummary["args"];
  /** Si se omite, se lee de `git rev-parse --short HEAD` (undefined si no hay repo). */
  gitSha?: string;
}

export interface MddEvalCaseResult {
  record: MddEvalRunRecord;
  /** Markdown final (`done`), o último borrador si el caso no llegó a `done`; "" si no hubo nada. */
  markdown: string;
}

export const DEFAULT_EVAL_TIMEOUT_MS = 1_800_000;
export const MAX_EVAL_CONCURRENCY = 3;
/** Umbral del Auditor cuando el caso no lo define (coincide con el default del schema). */
const DEFAULT_MIN_AUDITOR = 85;

/** DBGA que recibe el pipeline: el benchmark del caso o, si falta, el brief como idea del usuario. */
export function buildEvalDbgaContent(evalCase: MddEvalCase): string {
  return evalCase.dbga ?? `Idea del usuario:\n${evalCase.brief}`;
}

/** Puntuación de relleno para casos sin markdown o con fallo de rúbrica. */
export function emptyEvalScore(reason: string): MddEvalScore {
  return {
    total: 0,
    passed: false,
    dimensions: [],
    forbiddenHits: [],
    forbiddenPenalty: 0,
    failures: [reason],
  };
}

/** Cierra un iterador sin esperar: un generador colgado no debe bloquear el caso. */
function closeQuietly(iterator: AsyncIterator<unknown> | undefined): void {
  if (!iterator?.return) return;
  try {
    Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // ignorado: el cierre es best effort
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_EVAL_CONCURRENCY, Math.max(1, Math.floor(value)));
}

async function readTokenUsage(
  deps: MddEvalRunnerDeps,
  projectId: string,
  auditTrail: string[],
): Promise<EvalTokenUsage> {
  try {
    return await deps.getTokenUsage(projectId);
  } catch (error) {
    auditTrail.push(`harness: sin uso de tokens: ${errorMessage(error)}`);
    return {};
  }
}

/**
 * Ejecuta un caso y devuelve el registro junto con el markdown producido.
 * El CLI usa el markdown para escribir `<caso>.md`; `runEvalCase` lo descarta.
 */
export async function runEvalCaseWithMarkdown(
  deps: MddEvalRunnerDeps,
  evalCase: MddEvalCase,
  opts: MddEvalRunOptions,
): Promise<MddEvalCaseResult> {
  const startMs = deps.now();
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_EVAL_TIMEOUT_MS;
  const auditTrail: string[] = [];
  const controller = new AbortController();
  let projectId: string | undefined;
  let error: string | undefined;
  let draft = "";
  let done: Extract<EvalStreamEvent, { type: "done" }> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let iterator: AsyncIterator<EvalStreamEvent> | undefined;

  // Rechaza al abortar (timeout). Sin esto, un next() colgado bloquearía el caso para siempre.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error(`timeout tras ${timeoutMs} ms`)),
      { once: true },
    );
  });
  aborted.catch(() => undefined);

  try {
    const temp = await deps.createTempProject(evalCase);
    projectId = temp.projectId;
    timer = setTimeout(() => controller.abort(), timeoutMs);
    iterator = deps
      .generate(buildEvalDbgaContent(evalCase), temp.projectId, temp.stageId, controller.signal)
      [Symbol.asyncIterator]();

    let terminal = false;
    while (!terminal) {
      const step = await Promise.race([iterator.next(), aborted]);
      if (step.done) break;
      const event = step.value;
      switch (event.type) {
        case "draft":
          draft = event.markdown;
          break;
        case "done":
          done = event;
          terminal = true;
          break;
        case "error":
          error = event.message;
          terminal = true;
          break;
        case "blocked":
          error = `${event.code}: ${event.message}`;
          terminal = true;
          break;
        default:
          break;
      }
    }
    if (!done && !error) error = "el generador terminó sin evento done";
    if (done && !done.markdown.trim()) error = error ?? "done sin markdown";
  } catch (caught) {
    error = errorMessage(caught);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    closeQuietly(iterator);
  }

  const endMs = deps.now();
  const markdown = done ? done.markdown : draft;

  const tokens = projectId ? await readTokenUsage(deps, projectId, auditTrail) : {};
  if (projectId && opts.keep) {
    auditTrail.push(`harness: proyecto temporal conservado ${projectId}`);
  } else if (projectId) {
    try {
      await deps.deleteTempProject(projectId);
    } catch (caught) {
      auditTrail.push(
        `harness: no se pudo borrar el proyecto temporal ${projectId}: ${errorMessage(caught)}`,
      );
    }
  }

  let rubric: MddEvalScore;
  if (markdown.trim()) {
    try {
      rubric = deps.score(markdown, evalCase);
    } catch (caught) {
      error = error ?? `rúbrica: ${errorMessage(caught)}`;
      rubric = emptyEvalScore(`rúbrica no disponible: ${errorMessage(caught)}`);
    }
  } else {
    rubric = emptyEvalScore(error ?? "sin markdown generado");
  }

  const failedStep = done?.failedStep;
  // Si el último nodo escritor falló, el Auditor no corrió: no hay score que comparar.
  const auditorScore =
    done && !failedStep && typeof done.precision === "number" ? done.precision : undefined;
  const minAuditor = evalCase.thresholds?.minAuditor ?? DEFAULT_MIN_AUDITOR;
  const gateOk = done?.deliveryGate?.ok;
  const passed =
    !error &&
    rubric.passed &&
    (auditorScore == null || auditorScore >= minAuditor) &&
    gateOk !== false;

  const record: MddEvalRunRecord = {
    caseId: evalCase.id,
    complexity: evalCase.complexity,
    startedAt: new Date(startMs).toISOString(),
    durationMs: Math.max(0, endMs - startMs),
    markdownLen: markdown.length,
    auditorScore,
    precision: done?.precision,
    status: done?.status,
    gateOk,
    gateBlockers: done?.deliveryGate?.blockers ?? [],
    gateWarnings: done?.deliveryGate?.warnings ?? [],
    failedStep,
    auditTrail: [...(done?.auditTrail ?? []), ...auditTrail],
    llmCalls: tokens.llmCalls,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    costUsd: tokens.costUsd,
    rubric,
    passed,
    error,
  };
  return { record, markdown };
}

/** Ejecuta un caso y devuelve solo su registro (nunca lanza). */
export async function runEvalCase(
  deps: MddEvalRunnerDeps,
  evalCase: MddEvalCase,
  opts: MddEvalRunOptions,
): Promise<MddEvalRunRecord> {
  return (await runEvalCaseWithMarkdown(deps, evalCase, opts)).record;
}

export function readGitSha(cwd: string = process.cwd()): string | undefined {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Agregados del resumen. `passRate` es una fracción (0-1). */
export function computeEvalAggregates(records: readonly MddEvalRunRecord[]): MddEvalAggregates {
  const cases = records.length;
  const passed = records.filter((record) => record.passed).length;
  const auditors = records
    .map((record) => record.auditorScore)
    .filter((value): value is number => typeof value === "number");
  const costs = records
    .map((record) => record.costUsd)
    .filter((value): value is number => typeof value === "number");
  const llmCalls = records
    .map((record) => record.llmCalls)
    .filter((value): value is number => typeof value === "number");
  return {
    cases,
    passed,
    passRate: cases === 0 ? 0 : roundTo(passed / cases, 4),
    avgRubric: roundTo(mean(records.map((record) => record.rubric.total)), 1),
    avgAuditor: auditors.length === 0 ? null : roundTo(mean(auditors), 1),
    avgDurationMs: Math.round(mean(records.map((record) => record.durationMs))),
    totalCostUsd: costs.length === 0 ? null : roundTo(costs.reduce((a, b) => a + b, 0), 6),
    totalLlmCalls: llmCalls.length === 0 ? null : llmCalls.reduce((a, b) => a + b, 0),
  };
}

/** Ensambla el resumen: registros ordenados por `caseId` (orden estable) y agregados calculados. */
export function buildEvalSummary(input: {
  runId: string;
  startedAt: string;
  finishedAt: string;
  gitSha?: string;
  args?: MddEvalSummary["args"];
  records: readonly MddEvalRunRecord[];
}): MddEvalSummary {
  const cases = [...input.records].sort((a, b) =>
    a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0,
  );
  return {
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    ...(input.gitSha ? { gitSha: input.gitSha } : {}),
    args: input.args ?? {},
    cases,
    aggregates: computeEvalAggregates(cases),
  };
}

/**
 * Ejecuta varios casos con concurrencia acotada y devuelve el resumen.
 * `onCaseDone` se invoca al terminar cada caso (orden de finalización), con el markdown producido.
 */
export async function runEvalSuite(
  deps: MddEvalRunnerDeps,
  cases: readonly MddEvalCase[],
  opts: MddEvalSuiteOptions,
  onCaseDone?: (record: MddEvalRunRecord, markdown: string, evalCase: MddEvalCase) => void,
): Promise<MddEvalSummary> {
  const startedAt = new Date(deps.now()).toISOString();
  const concurrency = clampConcurrency(opts.concurrency);
  const results: MddEvalRunRecord[] = new Array(cases.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < cases.length) {
      const index = cursor;
      cursor += 1;
      const evalCase = cases[index];
      const { record, markdown } = await runEvalCaseWithMarkdown(deps, evalCase, opts);
      results[index] = record;
      onCaseDone?.(record, markdown, evalCase);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, () => worker()),
  );

  return buildEvalSummary({
    runId: opts.runId,
    startedAt,
    finishedAt: new Date(deps.now()).toISOString(),
    gitSha: opts.gitSha ?? readGitSha(),
    args: opts.args,
    records: results,
  });
}
