/**
 * @fileoverview Ejecución de UNA corrida del eval lanzada desde la web: corre `runEvalSuite` con
 * dependencias inyectadas, reporta progreso, escribe los resultados (`writeEvalResults`) y mantiene
 * `run.json`. Soporta cancelación cooperativa por `AbortSignal`. Nunca lanza: devuelve el resultado.
 * Lo usan el worker BullMQ y el fallback en proceso (sin Redis); los tests inyectan fakes.
 */

import type { MddEvalRunProgressDto } from "@theforge/shared-types";
import { evalFileKeys, writeEvalResults } from "./mdd-eval-report.util.js";
import type { MddEvalRunMeta, MddEvalRunStore } from "./mdd-eval-run-store.util.js";
import {
  DEFAULT_EVAL_TIMEOUT_MS,
  runEvalSuite,
  type EvalStreamEvent,
  type MddEvalRunnerDeps,
} from "./mdd-eval-runner.js";
import type { MddEvalCase, MddEvalRunRecord, MddEvalSummary } from "./mdd-eval.types.js";

export const MDD_EVAL_CANCELLED_MESSAGE = "Corrida cancelada por el usuario";

/** Mínimo entre emisiones de progreso por mensajes del pipeline (los cambios de caso siempre se emiten). */
const PROGRESS_THROTTLE_MS = 1000;

export type MddEvalRunOutcome =
  | { status: "completed"; summary: MddEvalSummary }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

export interface ExecuteMddEvalRunInput {
  meta: MddEvalRunMeta;
  cases: readonly MddEvalCase[];
  store: MddEvalRunStore;
  deps: MddEvalRunnerDeps;
  signal: AbortSignal;
  /** Sustituible en tests. */
  runSuite?: typeof runEvalSuite;
  onProgress?: (progress: MddEvalRunProgressDto) => void | Promise<void>;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Envuelve las dependencias para (a) llevar el progreso (casos en curso, último mensaje del pipeline)
 * y (b) abortar cuando se cancela la corrida: los casos en vuelo reciben un `error` y los pendientes
 * fallan al crear su proyecto, así que el runner termina enseguida y limpia los proyectos temporales.
 */
function instrumentDeps(
  deps: MddEvalRunnerDeps,
  state: { running: Map<string, string>; lastMessage?: string },
  emit: (force: boolean) => void,
  runSignal: AbortSignal,
): MddEvalRunnerDeps {
  const cancelled = new Promise<"cancelled">((resolve) => {
    if (runSignal.aborted) resolve("cancelled");
    else runSignal.addEventListener("abort", () => resolve("cancelled"), { once: true });
  });
  return {
    ...deps,
    async createTempProject(evalCase) {
      if (runSignal.aborted) throw new Error(MDD_EVAL_CANCELLED_MESSAGE);
      const temp = await deps.createTempProject(evalCase);
      state.running.set(temp.projectId, evalCase.id);
      state.lastMessage = `${evalCase.id}: iniciando`;
      emit(true);
      return temp;
    },
    async deleteTempProject(projectId) {
      state.running.delete(projectId);
      await deps.deleteTempProject(projectId);
    },
    generate(dbgaContent, projectId, stageId, signal): AsyncIterable<EvalStreamEvent> {
      return (async function* () {
        const combined = AbortSignal.any([signal, runSignal]);
        const inner = deps.generate(dbgaContent, projectId, stageId, combined)[Symbol.asyncIterator]();
        try {
          while (true) {
            const step = await Promise.race([inner.next(), cancelled]);
            if (step === "cancelled") {
              yield { type: "error", message: MDD_EVAL_CANCELLED_MESSAGE };
              return;
            }
            if (step.done) return;
            const event = step.value;
            if (event.type === "progress" && event.message) {
              const caseId = state.running.get(projectId) ?? projectId;
              state.lastMessage = `${caseId}: ${event.message}`;
              emit(false);
            }
            yield event;
          }
        } finally {
          void Promise.resolve(inner.return?.(undefined)).catch(() => undefined);
        }
      })();
    },
  };
}

export async function executeMddEvalRun(input: ExecuteMddEvalRunInput): Promise<MddEvalRunOutcome> {
  const { store, cases, signal } = input;
  const now = input.now ?? (() => Date.now());
  const runSuite = input.runSuite ?? runEvalSuite;
  const meta: MddEvalRunMeta = { ...input.meta };
  const total = cases.length;
  let done = 0;
  const state: { running: Map<string, string>; lastMessage?: string } = { running: new Map() };
  let lastEmit = 0;

  const snapshot = (): MddEvalRunProgressDto => ({
    total,
    done,
    running: [...new Set(state.running.values())],
    ...(state.lastMessage ? { lastMessage: state.lastMessage } : {}),
  });
  const emit = (force: boolean): void => {
    const at = now();
    if (!force && at - lastEmit < PROGRESS_THROTTLE_MS) return;
    lastEmit = at;
    meta.progress = snapshot();
    try {
      void Promise.resolve(input.onProgress?.(meta.progress)).catch(() => undefined);
    } catch {
      // el progreso es informativo: nunca debe tumbar la corrida
    }
  };

  const finish = async (
    patch: Partial<MddEvalRunMeta> & Pick<MddEvalRunMeta, "status">,
  ): Promise<void> => {
    Object.assign(meta, patch, { finishedAt: new Date(now()).toISOString(), progress: snapshot() });
    state.running.clear();
    meta.progress = snapshot();
    try {
      await store.writeMeta(meta);
    } catch {
      // sin disco no hay run.json; el estado vivo (cola/memoria) sigue disponible
    }
  };

  try {
    meta.status = "running";
    meta.startedAt = new Date(now()).toISOString();
    meta.progress = snapshot();
    await store.writeMeta(meta);
    await input.onProgress?.(meta.progress);

    if (signal.aborted) {
      await finish({ status: "cancelled" });
      return { status: "cancelled" };
    }

    const markdownByRecord = new Map<MddEvalRunRecord, string>();
    const instrumented = instrumentDeps(input.deps, state, emit, signal);
    const timeoutMs = meta.timeoutMs && meta.timeoutMs > 0 ? meta.timeoutMs : DEFAULT_EVAL_TIMEOUT_MS;
    const summary = await runSuite(
      instrumented,
      cases,
      {
        concurrency: meta.concurrency,
        timeoutMs,
        keep: meta.keepProjects,
        runId: meta.runId,
        args: {
          mode: "real",
          source: "web",
          cases: cases.map((c) => c.id).join(","),
          concurrency: meta.concurrency,
          timeoutMs,
          keep: meta.keepProjects,
        },
      },
      (record, markdown) => {
        markdownByRecord.set(record, markdown);
        done += 1;
        state.lastMessage = `${record.caseId}: ${record.passed ? "aprobado" : "fallido"}`;
        emit(true);
      },
    );

    if (signal.aborted) {
      await finish({ status: "cancelled" });
      return { status: "cancelled" };
    }

    const keys = evalFileKeys(summary.cases);
    const markdownByKey = new Map<string, string>();
    summary.cases.forEach((record, index) => {
      const markdown = markdownByRecord.get(record);
      if (markdown !== undefined) markdownByKey.set(keys[index], markdown);
    });
    const written = await writeEvalResults(summary, store.runDir(meta.runId), markdownByKey);
    done = total;
    await finish({
      status: "completed",
      ...(written.summary.gitSha ? { gitSha: written.summary.gitSha } : {}),
    });
    return { status: "completed", summary: written.summary };
  } catch (error) {
    if (signal.aborted) {
      await finish({ status: "cancelled" });
      return { status: "cancelled" };
    }
    const message = errorMessage(error);
    await finish({ status: "failed", error: message });
    return { status: "failed", error: message };
  }
}
