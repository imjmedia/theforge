/**
 * @fileoverview Ejecución de las corridas del eval de MDDs lanzadas desde la web.
 *
 * Con `REDIS_URL`: cola BullMQ dedicada `mdd-eval` (job id = runId, un intento) con un worker de
 * concurrencia 1 que solo arranca si el rol de runtime lo permite (`shouldStartBullmqWorkers`).
 * Sin Redis (desarrollo): la corrida se ejecuta en este mismo proceso, en serie, con el estado en
 * memoria y `run.json` en disco. La cancelación usa un AbortController local más una clave Redis
 * sondeada cada 500 ms para el caso en que el worker sea otro proceso (mismo patrón que `MddQueueService`).
 */

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { MddEvalRunProgressDto } from "@theforge/shared-types";
import {
  BULLMQ_WORKER_RESTARTED_REASON,
  BULLMQ_WORKER_SHUTDOWN_REASON,
  forceFailBullMqActiveJob,
  isBullMqLockRenewalError,
  recoverBullMqJobsAfterWorkerRestart,
} from "../../../common/bullmq-orphan-recovery.util.js";
import { longRunningBullmqWorkerOptions } from "../../../common/bullmq-long-job.worker-options.js";
import { resolveRedisUrlOrThrow, shouldStartBullmqWorkers } from "../../../common/bullmq-runtime.config.js";
import { runWithRequestUserAsync } from "../../../common/request-user.store.js";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { AiAnalysisService } from "../ai-analysis.service.js";
import { TokenUsageService } from "../token-usage/token-usage.service.js";
import type { MddEvalLiveState } from "./mdd-eval-dto.util.js";
import { loadMddEvalCases } from "./mdd-eval-cases.util.js";
import { buildMddEvalDeps } from "./mdd-eval-nest-deps.js";
import { executeMddEvalRun, type MddEvalRunOutcome } from "./mdd-eval-run.executor.js";
import { MddEvalRunStore, type MddEvalRunMeta } from "./mdd-eval-run-store.util.js";
import type { MddEvalRunnerDeps, runEvalSuite } from "./mdd-eval-runner.js";
import type { MddEvalCase, MddEvalSummary } from "./mdd-eval.types.js";

export const MDD_EVAL_QUEUE_NAME = "mdd-eval";

/** Clave Redis compartida API ↔ worker para cancelar corridas activas. */
const MDD_EVAL_CANCEL_KEY_PREFIX = "theforge:mdd-eval-cancel:";
const MDD_EVAL_CANCEL_KEY_TTL_SEC = 3600;
const MDD_EVAL_CANCEL_POLL_MS = 500;
/** Un caso real tarda minutos y una corrida horas: un stall NO debe reintentar (re-gastaría tokens). */
const MDD_EVAL_MAX_STALLED_COUNT = 0;
const MAX_MEMORY_RUNS = 100;

/** Valor devuelto por el worker; el summary permite servir la corrida si el disco del worker no es visible. */
export type MddEvalJobResult = { status: "completed"; summary: MddEvalSummary } | { status: "cancelled" };

export type MddEvalCancelResult = "cancelled" | "cancelling" | "not-active";

interface MemoryRun {
  meta: MddEvalRunMeta;
  state: MddEvalLiveState["state"];
  controller: AbortController;
  cancelled: boolean;
  progress?: MddEvalRunProgressDto;
  error?: string;
}

@Injectable()
export class MddEvalQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MddEvalQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly memory = new Map<string, MemoryRun>();
  private chain: Promise<void> = Promise.resolve();

  /** Sustituibles en tests. */
  store = new MddEvalRunStore();
  depsFactory?: (meta: MddEvalRunMeta) => MddEvalRunnerDeps;
  runSuiteFn?: typeof runEvalSuite;
  casesDir?: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AiAnalysisService))
    private readonly aiAnalysis: AiAnalysisService,
    private readonly tokenUsage: TokenUsageService,
  ) {}

  /** true si las corridas pasan por BullMQ; false = en proceso (sin Redis). */
  usesRedis(): boolean {
    return this.queue !== null;
  }

  private readonly onWorkerError = (err: Error): void => {
    if (isBullMqLockRenewalError(err)) {
      this.logger.warn(`mdd-eval: lock renewal lost (${err.message})`);
      return;
    }
    this.logger.error(`mdd-eval worker error: ${err.message}`);
  };

  async onModuleInit(): Promise<void> {
    const url = resolveRedisUrlOrThrow();
    if (!url) {
      this.logger.log("mdd-eval: sin REDIS_URL — las corridas se ejecutan en proceso (solo desarrollo)");
      return;
    }
    this.queue = new Queue(MDD_EVAL_QUEUE_NAME, {
      connection: { url },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 86_400, count: 50 },
        removeOnFail: { age: 604_800, count: 50 },
      },
    });
    if (!shouldStartBullmqWorkers()) {
      this.logger.log("mdd-eval: cola Redis conectada; worker desactivado (THEFORGE_RUNTIME_ROLE=http)");
      return;
    }
    const recovered = await recoverBullMqJobsAfterWorkerRestart(this.queue, {
      reason: BULLMQ_WORKER_RESTARTED_REASON,
      logger: this.logger,
    });
    if (recovered.failedActive > 0) {
      this.logger.warn(`mdd-eval: ${recovered.failedActive} corrida(s) activa(s) huérfana(s) marcadas como failed`);
    }
    const workerOpts = longRunningBullmqWorkerOptions({
      concurrency: 1,
      maxStalledCount: MDD_EVAL_MAX_STALLED_COUNT,
    });
    this.worker = new Worker(
      MDD_EVAL_QUEUE_NAME,
      (job: Job<MddEvalRunMeta>) => this.processJob(job),
      { connection: { url }, ...workerOpts },
    );
    this.worker.on("failed", (job, err) => {
      if (isBullMqLockRenewalError(err)) return;
      this.logger.error(`mdd-eval job ${job?.id} falló: ${err instanceof Error ? err.message : err}`);
    });
    this.worker.on("error", this.onWorkerError);
    this.logger.log(`mdd-eval worker activo (${MDD_EVAL_QUEUE_NAME}), concurrency=1`);
  }

  async onModuleDestroy(): Promise<void> {
    for (const [runId, controller] of this.abortControllers) {
      controller.abort();
      if (this.queue) {
        const job = await this.queue.getJob(runId).catch(() => undefined);
        if (job) await forceFailBullMqActiveJob(this.queue, job, BULLMQ_WORKER_SHUTDOWN_REASON).catch(() => false);
      }
    }
    if (this.worker) {
      this.worker.off("error", this.onWorkerError);
      await this.worker.close(true);
      this.worker = null;
    }
    await this.queue?.close();
    this.queue = null;
  }

  // ── Encolado ────────────────────────────────────────────────────────────

  /** Encola la corrida (el `run.json` queued ya fue escrito por el servicio). */
  async enqueue(meta: MddEvalRunMeta): Promise<void> {
    if (this.queue) {
      await this.queue.add("run", meta, { jobId: meta.runId });
      return;
    }
    const run: MemoryRun = {
      meta,
      state: "waiting",
      controller: new AbortController(),
      cancelled: false,
      progress: meta.progress,
    };
    this.memory.set(meta.runId, run);
    this.pruneMemory();
    this.chain = this.chain.then(() => this.runInProcess(run)).catch(() => undefined);
  }

  private pruneMemory(): void {
    if (this.memory.size <= MAX_MEMORY_RUNS) return;
    for (const [runId, run] of this.memory) {
      if (this.memory.size <= MAX_MEMORY_RUNS) break;
      if (run.state === "completed" || run.state === "failed") this.memory.delete(runId);
    }
  }

  private async runInProcess(run: MemoryRun): Promise<void> {
    if (run.cancelled) {
      run.state = "completed";
      return;
    }
    run.state = "active";
    const outcome = await runWithRequestUserAsync(run.meta.requestedByUserId, () =>
      this.executeRun(run.meta, run.controller.signal, (progress) => {
        run.progress = progress;
      }),
    );
    this.applyOutcomeToMemory(run, outcome);
  }

  private applyOutcomeToMemory(run: MemoryRun, outcome: MddEvalRunOutcome): void {
    if (outcome.status === "failed") {
      run.state = "failed";
      run.error = outcome.error;
      return;
    }
    if (outcome.status === "cancelled") run.cancelled = true;
    run.state = "completed";
  }

  // ── Worker BullMQ ───────────────────────────────────────────────────────

  private async processJob(job: Job<MddEvalRunMeta>): Promise<MddEvalJobResult> {
    const meta = job.data;
    const runId = meta.runId;
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    const stopPoll = this.startCancelPoll(runId, controller);
    try {
      this.logger.log(`mdd-eval job ${runId}: ${meta.caseIds.length || "todos los"} caso(s), concurrency=${meta.concurrency}`);
      const outcome = await runWithRequestUserAsync(meta.requestedByUserId, () =>
        this.executeRun(meta, controller.signal, async (progress) => {
          await job.updateProgress(progress).catch(() => undefined);
        }),
      );
      if (outcome.status === "failed") throw new Error(outcome.error);
      if (outcome.status === "cancelled") return { status: "cancelled" };
      return { status: "completed", summary: outcome.summary };
    } finally {
      stopPoll();
      this.abortControllers.delete(runId);
      await this.clearCancelKey(runId).catch(() => undefined);
    }
  }

  /** Núcleo común (worker y en proceso): resuelve casos, arma dependencias y ejecuta la corrida. */
  private executeRun(
    meta: MddEvalRunMeta,
    signal: AbortSignal,
    onProgress: (progress: MddEvalRunProgressDto) => void | Promise<void>,
  ): Promise<MddEvalRunOutcome> {
    let cases: MddEvalCase[];
    try {
      cases = this.resolveCases(meta.caseIds);
    } catch (error) {
      return Promise.resolve({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
    const deps =
      this.depsFactory?.(meta) ??
      buildMddEvalDeps({
        prisma: this.prisma,
        aiService: this.aiAnalysis,
        tokenUsage: this.tokenUsage,
        userId: meta.requestedByUserId,
        groupId: meta.groupId,
        keepProjects: meta.keepProjects,
      });
    return executeMddEvalRun({
      meta,
      cases,
      store: this.store,
      deps,
      signal,
      runSuite: this.runSuiteFn,
      onProgress,
    });
  }

  private resolveCases(caseIds: readonly string[]): MddEvalCase[] {
    const all = loadMddEvalCases(this.casesDir);
    if (caseIds.length === 0) return all;
    const byId = new Map(all.map((c) => [c.id, c] as const));
    return caseIds.map((id) => {
      const found = byId.get(id);
      if (!found) throw new Error(`caso desconocido: ${id}`);
      return found;
    });
  }

  // ── Cancelación ─────────────────────────────────────────────────────────

  private startCancelPoll(runId: string, controller: AbortController): () => void {
    const check = async (): Promise<void> => {
      if (controller.signal.aborted) return;
      if (await this.isCancelRequested(runId)) controller.abort();
    };
    void check().catch(() => undefined);
    const interval = setInterval(() => void check().catch(() => undefined), MDD_EVAL_CANCEL_POLL_MS);
    return () => clearInterval(interval);
  }

  private async isCancelRequested(runId: string): Promise<boolean> {
    if (!this.queue) return false;
    const client = await this.queue.client;
    return Boolean(await client.get(`${MDD_EVAL_CANCEL_KEY_PREFIX}${runId}`));
  }

  private async setCancelKey(runId: string): Promise<void> {
    if (!this.queue) return;
    const client = await this.queue.client;
    // ioredis: firma posicional `SET key val EX ttl` (ver MddQueueService.markCancelRequested).
    await (client as unknown as { set: (...args: unknown[]) => Promise<unknown> }).set(
      `${MDD_EVAL_CANCEL_KEY_PREFIX}${runId}`,
      "1",
      "EX",
      MDD_EVAL_CANCEL_KEY_TTL_SEC,
    );
  }

  private async clearCancelKey(runId: string): Promise<void> {
    if (!this.queue) return;
    const client = await this.queue.client;
    await client.del(`${MDD_EVAL_CANCEL_KEY_PREFIX}${runId}`);
  }

  /**
   * Cancela una corrida: en espera se elimina de la cola; activa se aborta (local) y se publica la
   * clave Redis para que el worker dueño, si es otro proceso, la vea en ≤500 ms.
   */
  async cancel(runId: string): Promise<MddEvalCancelResult> {
    if (this.queue) {
      const job = await this.queue.getJob(runId);
      if (!job) return "not-active";
      const state = await job.getState();
      if (state === "waiting" || state === "delayed" || state === "prioritized") {
        try {
          await job.remove();
          return "cancelled";
        } catch {
          // el worker lo tomó entre medias: se trata como activo
        }
      } else if (state !== "active") {
        return "not-active";
      }
      await this.setCancelKey(runId);
      this.abortControllers.get(runId)?.abort();
      return "cancelling";
    }
    const run = this.memory.get(runId);
    if (!run || run.state === "completed" || run.state === "failed") return "not-active";
    run.cancelled = true;
    run.controller.abort();
    return run.state === "waiting" ? "cancelled" : "cancelling";
  }

  // ── Estado vivo ─────────────────────────────────────────────────────────

  /** Estado vivo de la corrida (cola o memoria); null si no hay job. Lanza si Redis no responde. */
  async getLiveState(runId: string): Promise<MddEvalLiveState | null> {
    if (this.queue) {
      const job = await this.queue.getJob(runId);
      return job ? this.liveFromJob(job) : null;
    }
    const run = this.memory.get(runId);
    if (!run) return null;
    return {
      state: run.state,
      progress: run.progress,
      error: run.error,
      cancelled: run.cancelled,
      meta: run.meta,
    };
  }

  /** Corridas conocidas por la cola o por memoria (para el listado). */
  async listLive(limit = 50): Promise<Array<{ runId: string; live: MddEvalLiveState }>> {
    if (this.queue) {
      const jobs = await this.queue.getJobs(
        ["active", "waiting", "prioritized", "delayed", "completed", "failed"],
        0,
        limit - 1,
      );
      const out: Array<{ runId: string; live: MddEvalLiveState }> = [];
      for (const job of jobs) {
        if (!job?.id) continue;
        const live = await this.liveFromJob(job);
        if (live) out.push({ runId: String(job.id), live });
      }
      return out;
    }
    return [...this.memory.entries()].map(([runId, run]) => ({
      runId,
      live: {
        state: run.state,
        progress: run.progress,
        error: run.error,
        cancelled: run.cancelled,
        meta: run.meta,
      },
    }));
  }

  private async liveFromJob(job: Job): Promise<MddEvalLiveState | null> {
    const raw = await job.getState();
    const state: MddEvalLiveState["state"] | undefined =
      raw === "active"
        ? "active"
        : raw === "completed"
          ? "completed"
          : raw === "failed"
            ? "failed"
            : raw === "waiting" || raw === "delayed" || raw === "prioritized" || raw === "waiting-children"
              ? "waiting"
              : undefined;
    if (!state) return null;
    const result = (job.returnvalue ?? undefined) as Partial<MddEvalJobResult> | undefined;
    let cancelled = result?.status === "cancelled";
    if (!cancelled && state === "active") cancelled = await this.isCancelRequested(String(job.id)).catch(() => false);
    const progress =
      job.progress && typeof job.progress === "object" ? (job.progress as MddEvalRunProgressDto) : undefined;
    return {
      state,
      progress,
      error: state === "failed" ? job.failedReason : undefined,
      cancelled,
      meta: job.data as MddEvalRunMeta,
      summary: result?.status === "completed" ? result.summary : undefined,
    };
  }
}
