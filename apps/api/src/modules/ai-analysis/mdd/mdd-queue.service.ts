import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import type { MddJobSnapshot, MddUpstreamSyncStatus } from "@theforge/shared-types";
import {
  applyMddJobProgress,
  createEmptyMddJobProgressState,
  normalizeMddJobProgressState,
  type MddJobProgressState,
} from "@theforge/shared-types";
import {
  BULLMQ_WORKER_RESTARTED_REASON,
  forceFailBullMqActiveJob,
  recoverBullMqJobsAfterWorkerRestart,
} from "../../../common/bullmq-orphan-recovery.util.js";
import {
  LONG_JOB_LOCK_DURATION_MS,
  longRunningBullmqWorkerOptions,
} from "../../../common/bullmq-long-job.worker-options.js";
import {
  resolveMddWorkerConcurrency,
  resolveRedisUrlOrThrow,
  shouldStartBullmqWorkers,
} from "../../../common/bullmq-runtime.config.js";
import { getRequestUserId, runWithRequestUserAsync } from "../../../common/request-user.store.js";
import { ProjectGenerationGuardService } from "../../projects/project-generation-guard.service.js";
import { LegacyCoordinatorService } from "../../legacy-flow/legacy-coordinator.service.js";
import { AiAnalysisService } from "../ai-analysis.service.js";
import { runWithTokenUsageContext } from "../token-usage/token-usage.context.js";

export const MDD_QUEUE_NAME = "theforge-mdd";

/** Clave Redis compartida API ↔ worker para cancelar jobs MDD activos en BullMQ. */
const MDD_CANCEL_KEY_PREFIX = "theforge:mdd-cancel:";

/** Intervalo de poll Redis para abort cooperativo (ms). */
const MDD_CANCEL_POLL_MS = 500;

/** MDD no debe reintentar tras stall: pipeline a medias es peor que fallar y regenerar. */
const MDD_MAX_STALLED_COUNT = 0;

const MDD_JOB_STALLED_REASON =
  "Job MDD bloqueado tras caída del worker; vuelve a generar";

export type MddJobMode = "pipeline" | "manager" | "section" | "legacy" | "upstream-sync";

export interface MddJobData {
  mode: MddJobMode;
  projectId: string;
  stageId?: string;
  userId?: string;
  dbgaContent?: string;
  initialMessage?: string;
  mddContent?: string;
  section?: number;
  gapReasons?: string[];
  /** Secciones MDD 1–7 para mode upstream-sync. */
  upstreamSections?: number[];
  upstreamChangeSummary?: string;
  /** Si true, omite caché upstream y ejecuta siempre el pipeline LLM (Regenerar MDD completo). */
  forceFullPipeline?: boolean;
}

export type MddJobProgress = {
  agent?: string;
  message?: string;
  phase?: string;
  mddLength?: number;
  section?: number;
  phaseGroup?: { current: number; total: number; label: string };
};

function pushMddJobProgress(
  record: InMemoryMddJobRecord,
  patch: MddJobProgress,
): void {
  const prev = normalizeMddJobProgressState(record.progress);
  record.progress = applyMddJobProgress(prev, patch);
}

function snapshotFromProgressState(state: MddJobProgressState): Pick<
  MddJobSnapshot,
  | "progressAgent"
  | "progressMessage"
  | "progressPhase"
  | "progressSteps"
  | "progressActive"
  | "progressPhaseGroup"
> {
  const active = state.active;
  const latest = state.latest;
  return {
    progressAgent: active?.agent ?? latest?.agent,
    progressMessage: active?.message ?? latest?.message,
    progressPhase: active ? "active" : latest?.phase,
    progressSteps: state.steps,
    progressActive: state.active,
    progressPhaseGroup: state.phaseGroup ?? latest?.phaseGroup ?? null,
  };
}

export type MddJobResult = {
  ok: boolean;
  mode: MddJobMode;
  projectId: string;
  stageId?: string;
  mddLength?: number;
  outcome?: "done" | "interrupt";
  threadId?: string;
  interrupt?: {
    reply?: string;
    questions?: string[];
    planMessage?: string;
  };
  /** Estado upstream tras capturar baseline (jobs section / upstream-sync). */
  mddUpstreamSync?: MddUpstreamSyncStatus;
};

export interface MddJobStatus {
  jobId: string;
  projectId?: string;
  mode: MddJobMode | null;
  status: "queued" | "active" | "completed" | "failed" | "retrying" | "unknown";
  progress: unknown;
  result?: MddJobResult;
  error?: string;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: number;
  finishedAt?: number;
}

type InMemoryMddJobRecord = {
  data: MddJobData;
  status: MddJobStatus["status"];
  progress: unknown;
  result?: MddJobResult;
  error?: string;
  createdAt: number;
  finishedAt?: number;
};

type MddActiveJobRef = { jobId: string; mode: MddJobMode; status: "queued" | "active" };

@Injectable()
export class MddQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MddQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly inMemoryJobs = new Map<string, InMemoryMddJobRecord>();
  private readonly inMemoryRunningProjects = new Set<string>();
  private readonly inMemoryPendingByProject = new Map<string, string[]>();
  private readonly jobAbortControllers = new Map<string, AbortController>();
  private readonly cancelRequestedJobIds = new Set<string>();
  private readonly projectExecutionChains = new Map<string, Promise<void>>();
  private readonly MAX_ATTEMPTS = 3;

  constructor(
    @Inject(forwardRef(() => AiAnalysisService))
    private readonly aiAnalysis: AiAnalysisService,
    @Inject(forwardRef(() => LegacyCoordinatorService))
    private readonly legacyCoordinator: LegacyCoordinatorService,
    @Inject(forwardRef(() => ProjectGenerationGuardService))
    private readonly generationGuard: ProjectGenerationGuardService,
  ) {}

  isEnabled(): boolean {
    return true;
  }

  usesRedis(): boolean {
    return !!resolveRedisUrlOrThrow();
  }

  /** True si hay job MDD activo (excluye cancelación cooperativa). Cola waiting no bloquea. */
  async isProjectActive(projectId: string): Promise<boolean> {
    for (const [jobId, mem] of this.inMemoryJobs) {
      if (mem.data.projectId !== projectId || mem.status !== "active") continue;
      if (!(await this.isCancelRequested(jobId))) return true;
    }
    if (!this.queue) return false;
    const jobs = await this.queue.getJobs(["active"], 0, 100);
    for (const job of jobs) {
      const data = job.data as MddJobData | undefined;
      if (data?.projectId !== projectId) continue;
      if (!(await this.isCancelRequested(String(job.id)))) return true;
    }
    return false;
  }

  /** True si hay job MDD en cola o ejecutándose (excluye jobs en cancelación cooperativa). */
  isProjectBusy(projectId: string): boolean {
    if (this.generationGuard.isMddStreamActive(projectId)) {
      for (const [jobId, mem] of this.inMemoryJobs) {
        if (mem.data.projectId !== projectId || mem.status !== "active") continue;
        if (!this.cancelRequestedJobIds.has(jobId)) return true;
      }
    }
    if (this.inMemoryRunningProjects.has(projectId)) {
      for (const [jobId, mem] of this.inMemoryJobs) {
        if (mem.data.projectId === projectId && mem.status === "active") {
          if (!this.cancelRequestedJobIds.has(jobId)) return true;
        }
      }
    }
    const pending = this.inMemoryPendingByProject.get(projectId);
    if (pending?.length) return true;
    return false;
  }

  /** True si el usuario pidió cancelar y el worker aún no terminó de abortar. */
  async isCancelRequested(jobId: string): Promise<boolean> {
    if (this.cancelRequestedJobIds.has(jobId)) return true;
    if (!this.queue) return false;
    try {
      const client = await this.queue.client;
      const val = await client.get(`${MDD_CANCEL_KEY_PREFIX}${jobId}`);
      return Boolean(val);
    } catch {
      return false;
    }
  }

  private async markCancelRequested(jobId: string): Promise<void> {
    this.cancelRequestedJobIds.add(jobId);
    if (!this.queue) return;
    const client = await this.queue.client;
    await client.set(`${MDD_CANCEL_KEY_PREFIX}${jobId}`, "1");
  }

  private async clearCancelRequested(jobId: string): Promise<void> {
    this.cancelRequestedJobIds.delete(jobId);
    if (!this.queue) return;
    const client = await this.queue.client;
    await client.del(`${MDD_CANCEL_KEY_PREFIX}${jobId}`);
  }

  private startCancelPoll(jobId: string, abortController: AbortController): () => void {
    if (!this.queue) return () => undefined;
    const interval = setInterval(() => {
      void (async () => {
        if (await this.isCancelRequested(jobId)) abortController.abort();
      })().catch(() => undefined);
    }, MDD_CANCEL_POLL_MS);
    return () => clearInterval(interval);
  }

  /** True si hay job MDD bloqueante activo (excluye cancelación cooperativa). */
  async isProjectBlocking(projectId: string): Promise<boolean> {
    return this.isProjectActive(projectId);
  }

  /** Escaneo único de cola (dashboard / resumen batch). */
  async listActiveJobsGroupedByProject(): Promise<Map<string, MddActiveJobRef[]>> {
    const map = new Map<string, MddActiveJobRef[]>();
    const push = (projectId: string, entry: MddActiveJobRef) => {
      const list = map.get(projectId) ?? [];
      list.push(entry);
      map.set(projectId, list);
    };
    for (const [jobId, mem] of this.inMemoryJobs) {
      if (mem.status !== "queued" && mem.status !== "active") continue;
      push(mem.data.projectId, { jobId, mode: mem.data.mode, status: mem.status });
    }
    if (!this.queue) return map;
    const states = ["waiting", "active", "delayed"] as const;
    for (const state of states) {
      const jobs = await this.queue.getJobs([state], 0, 100);
      for (const job of jobs) {
        const data = job.data as MddJobData | undefined;
        if (!data?.projectId) continue;
        push(data.projectId, {
          jobId: String(job.id),
          mode: data.mode,
          status: state === "active" ? "active" : "queued",
        });
      }
    }
    return map;
  }

  async listActiveJobsForProject(projectId: string): Promise<MddActiveJobRef[]> {
    const out: MddActiveJobRef[] = [];
    for (const [jobId, mem] of this.inMemoryJobs) {
      if (mem.data.projectId !== projectId) continue;
      if (mem.status === "queued" || mem.status === "active") {
        out.push({ jobId, mode: mem.data.mode, status: mem.status });
      }
    }
    if (!this.queue) return out;
    const states = ["waiting", "active", "delayed"] as const;
    for (const state of states) {
      const jobs = await this.queue.getJobs([state], 0, 100);
      for (const job of jobs) {
        const data = job.data as MddJobData | undefined;
        if (data?.projectId !== projectId) continue;
        out.push({
          jobId: String(job.id),
          mode: data.mode,
          status: state === "active" ? "active" : "queued",
        });
      }
    }
    return out;
  }

  /** Jobs MDD activos o en cola con progreso (para generation-status / UI). */
  async listJobsForProject(projectId: string): Promise<MddJobSnapshot[]> {
    const active = await this.listActiveJobsForProject(projectId);
    const visible = (
      await Promise.all(
        active.map(async (ref) => ({
          ref,
          cancelling: await this.isCancelRequested(ref.jobId),
        })),
      )
    )
      .filter((entry) => !entry.cancelling)
      .map((entry) => entry.ref);
    return this.buildJobSnapshotsForLabel(visible);
  }

  /** Solo el job primario consulta progreso completo (dashboard / etiquetas). */
  async buildJobSnapshotsForLabel(refs: MddActiveJobRef[]): Promise<MddJobSnapshot[]> {
    if (refs.length === 0) return [];
    const primary = refs.find((r) => r.status === "active") ?? refs[0]!;
    const snapshots: MddJobSnapshot[] = refs.map((ref) => ({
      jobId: ref.jobId,
      mode: ref.mode,
      status: ref.status,
    }));
    const full = await this.getJobStatus(primary.jobId);
    const progress = snapshotFromProgressState(normalizeMddJobProgressState(full.progress));
    const idx = snapshots.findIndex((s) => s.jobId === primary.jobId);
    if (idx >= 0) {
      snapshots[idx] = { ...snapshots[idx]!, ...progress };
    }
    return snapshots;
  }

  /**
   * Cancela un job MDD encolado o solicita abort del pipeline activo.
   * Cola in-memory: abort inmediato entre nodos LangGraph. BullMQ: quita waiting; active abort entre eventos.
   */
  async cancelJob(jobId: string, projectId: string): Promise<{ cancelled: boolean; status: string }> {
    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      if (mem.data.projectId !== projectId) {
        throw new ForbiddenException();
      }
      if (mem.status === "completed") {
        return { cancelled: false, status: "completed" };
      }
      if (mem.status === "failed") {
        return { cancelled: false, status: "failed" };
      }
      if (mem.status === "queued") {
        const pending = this.inMemoryPendingByProject.get(projectId) ?? [];
        const filtered = pending.filter((id) => id !== jobId);
        if (filtered.length === 0) {
          this.inMemoryPendingByProject.delete(projectId);
        } else {
          this.inMemoryPendingByProject.set(projectId, filtered);
        }
        mem.status = "failed";
        mem.error = "Cancelado por el usuario";
        mem.finishedAt = Date.now();
        this.logger.log(`In-memory MDD job ${jobId} cancelado (queued) projectId=${projectId}`);
        return { cancelled: true, status: "cancelled" };
      }
      if (mem.status === "active") {
        await this.markCancelRequested(jobId);
        this.jobAbortControllers.get(jobId)?.abort();
        this.generationGuard.unregisterMddStream(projectId);
        this.logger.log(`In-memory MDD job ${jobId} cancelación solicitada (active) projectId=${projectId}`);
        return { cancelled: true, status: "cancelling" };
      }
      return { cancelled: false, status: mem.status };
    }

    if (!this.queue) {
      throw new NotFoundException("Job MDD no encontrado");
    }

    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException("Job MDD no encontrado");
    }
    const data = job.data as MddJobData | undefined;
    if (data?.projectId !== projectId) {
      throw new ForbiddenException();
    }
    const state = await job.getState();
    if (state === "completed") {
      return { cancelled: false, status: "completed" };
    }
    if (state === "failed") {
      return { cancelled: false, status: "failed" };
    }
    if (state === "waiting" || state === "delayed" || state === "waiting-children") {
      await job.remove();
      await this.clearCancelRequested(jobId);
      this.logger.log(`BullMQ MDD job ${jobId} cancelado (queued) projectId=${projectId}`);
      return { cancelled: true, status: "cancelled" };
    }
    if (state === "active") {
      const localAbort = this.jobAbortControllers.get(jobId);
      if (localAbort) {
        await this.markCancelRequested(jobId);
        localAbort.abort();
        this.generationGuard.unregisterMddStream(projectId);
        this.logger.log(
          `BullMQ MDD job ${jobId} cancelación solicitada (active) projectId=${projectId}`,
        );
        return { cancelled: true, status: "cancelling" };
      }
      const failed = await forceFailBullMqActiveJob(
        this.queue,
        job,
        "Cancelado por el usuario (worker no activo)",
      );
      if (failed) {
        await this.clearCancelRequested(jobId);
        this.generationGuard.unregisterMddStream(projectId);
        this.logger.log(
          `BullMQ MDD job ${jobId} fallido (huérfano activo) projectId=${projectId}`,
        );
        return { cancelled: true, status: "cancelled" };
      }
      await this.markCancelRequested(jobId);
      this.generationGuard.unregisterMddStream(projectId);
      return { cancelled: true, status: "cancelling" };
    }
    return { cancelled: false, status: state };
  }

  async onModuleInit(): Promise<void> {
    const url = resolveRedisUrlOrThrow();
    if (!url) {
      this.logger.log("BullMQ MDD: sin REDIS_URL — cola in-memory (solo desarrollo)");
      return;
    }
    this.queue = new Queue(MDD_QUEUE_NAME, {
      connection: { url },
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 80 },
        removeOnFail: { age: 86_400, count: 30 },
        attempts: this.MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 5_000 },
      },
    });
    const recovered = await recoverBullMqJobsAfterWorkerRestart(this.queue, {
      reason: BULLMQ_WORKER_RESTARTED_REASON,
      logger: this.logger,
    });
    if (recovered.failedActive > 0 || recovered.removedQueued > 0) {
      this.logger.warn(
        `BullMQ MDD: recuperados tras reinicio — active→failed=${recovered.failedActive}, cola eliminada=${recovered.removedQueued}`,
      );
    }
    const concurrency = resolveMddWorkerConcurrency();
    if (shouldStartBullmqWorkers()) {
      const workerOpts = longRunningBullmqWorkerOptions({
        concurrency,
        maxStalledCount: MDD_MAX_STALLED_COUNT,
      });
      this.worker = new Worker(
        MDD_QUEUE_NAME,
        async (job: Job<MddJobData>, token?: string) => {
          const { userId } = job.data;
          return runWithRequestUserAsync(userId ?? "system", async () => {
            this.logger.log(
              `BullMQ MDD job ${job.id} mode=${job.data.mode} projectId=${job.data.projectId}`,
            );
            let progressState = createEmptyMddJobProgressState();
            const onProgress = async (p: MddJobProgress) => {
              progressState = applyMddJobProgress(progressState, p);
              await job.updateProgress(progressState);
              if (!token) return;
              try {
                await job.extendLock(token, LONG_JOB_LOCK_DURATION_MS);
              } catch {
                // Worker timer still renews; ignore if lock already lost (logged by BullMQ).
              }
            };
            return this.runWithProjectExecutionLock(job.data.projectId, () =>
              this.executeJob(String(job.id), job.data, onProgress),
            );
          });
        },
        { connection: { url }, ...workerOpts },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.error(
          `BullMQ MDD job ${job?.id} falló: ${err instanceof Error ? err.message : err}`,
        );
      });
      this.worker.on("stalled", (jobId) => {
        void this.handleStalledMddJob(String(jobId));
      });
      this.logger.log(
        `BullMQ MDD worker activo (${MDD_QUEUE_NAME}), lockDuration=${workerOpts.lockDuration}ms, maxStalledCount=${MDD_MAX_STALLED_COUNT}, concurrency=${concurrency}`,
      );
    } else {
      this.logger.log(
        "BullMQ MDD: cola Redis conectada; workers desactivados (THEFORGE_RUNTIME_ROLE=http)",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Stall BullMQ → no reencolar pipeline MDD; eliminar para liberar UI. */
  private async handleStalledMddJob(jobId: string): Promise<void> {
    if (!this.queue) return;
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    const data = job.data as MddJobData | undefined;
    const state = await job.getState();
    if (state === "active") {
      const failed = await forceFailBullMqActiveJob(this.queue, job, MDD_JOB_STALLED_REASON);
      if (failed) {
        this.logger.warn(`BullMQ MDD job ${jobId} fallido tras stall`);
        if (data?.projectId) {
          this.generationGuard.unregisterMddStream(data.projectId);
          this.logger.log(`BullMQ MDD job ${jobId} stream lock liberado projectId=${data.projectId}`);
        }
        return;
      }
    }
    try {
      await job.discard();
      await job.remove();
      this.logger.warn(`BullMQ MDD job ${jobId} eliminado tras stall (${state})`);
    } catch (err) {
      this.logger.warn(
        `BullMQ MDD job ${jobId} no pudo limpiarse tras stall: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (data?.projectId) {
      this.generationGuard.unregisterMddStream(data.projectId);
      this.logger.log(`BullMQ MDD job ${jobId} stream lock liberado projectId=${data.projectId}`);
    }
  }

  private async assertCanEnqueue(projectId: string): Promise<void> {
    if (await this.isProjectActive(projectId)) {
      throw new ConflictException(
        "Ya hay una generación de MDD en curso para este proyecto. Espera a que termine o recarga el estado.",
      );
    }
  }

  private cancelInMemoryQueuedForProject(projectId: string): number {
    const pending = [...(this.inMemoryPendingByProject.get(projectId) ?? [])];
    if (pending.length === 0) return 0;
    let cancelled = 0;
    for (const jobId of pending) {
      const mem = this.inMemoryJobs.get(jobId);
      if (!mem || mem.status !== "queued") continue;
      mem.status = "failed";
      mem.error = "Reemplazado por un job MDD más reciente";
      mem.finishedAt = Date.now();
      cancelled += 1;
    }
    this.inMemoryPendingByProject.delete(projectId);
    if (cancelled > 0) {
      this.logger.log(`In-memory MDD: cancelados ${cancelled} job(s) en cola projectId=${projectId}`);
    }
    return cancelled;
  }

  private async cancelQueuedBullMqJobsForProject(projectId: string): Promise<number> {
    if (!this.queue) return 0;
    let cancelled = 0;
    for (const state of ["waiting", "delayed", "waiting-children"] as const) {
      const jobs = await this.queue.getJobs([state], 0, 200);
      for (const job of jobs) {
        const data = job.data as MddJobData | undefined;
        if (data?.projectId !== projectId) continue;
        await job.remove();
        cancelled += 1;
      }
    }
    if (cancelled > 0) {
      this.logger.log(`BullMQ MDD: cancelados ${cancelled} job(s) en cola projectId=${projectId}`);
    }
    return cancelled;
  }

  private async cancelQueuedSiblingsForProject(projectId: string): Promise<void> {
    this.cancelInMemoryQueuedForProject(projectId);
    await this.cancelQueuedBullMqJobsForProject(projectId);
  }

  private async runWithProjectExecutionLock<T>(
    projectId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.projectExecutionChains.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => gate);
    this.projectExecutionChains.set(projectId, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.projectExecutionChains.get(projectId) === chain) {
        this.projectExecutionChains.delete(projectId);
      }
    }
  }

  async enqueue(data: MddJobData): Promise<string> {
    await this.assertCanEnqueue(data.projectId);
    await this.cancelQueuedSiblingsForProject(data.projectId);
    const userId = data.userId ?? getRequestUserId();
    const payload: MddJobData = { ...data, userId };

    if (this.queue) {
      const job = await this.queue.add(payload.mode, payload);
      return String(job.id);
    }
    return this.enqueueInMemory(payload);
  }

  private enqueueInMemory(data: MddJobData): string {
    const jobId = randomUUID();
    this.inMemoryJobs.set(jobId, {
      data,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
    });
    const pending = this.inMemoryPendingByProject.get(data.projectId) ?? [];
    pending.push(jobId);
    this.inMemoryPendingByProject.set(data.projectId, pending);
    this.logger.log(`In-memory MDD job ${jobId} encolado mode=${data.mode} projectId=${data.projectId}`);
    setImmediate(() => this.pumpInMemoryQueue(data.projectId));
    return jobId;
  }

  private pumpInMemoryQueue(projectId: string): void {
    if (this.inMemoryRunningProjects.has(projectId)) return;
    const pending = this.inMemoryPendingByProject.get(projectId);
    if (!pending?.length) return;
    const nextJobId = pending.shift();
    if (!nextJobId) return;
    if (pending.length === 0) this.inMemoryPendingByProject.delete(projectId);
    const record = this.inMemoryJobs.get(nextJobId);
    if (!record || record.status !== "queued") {
      this.pumpInMemoryQueue(projectId);
      return;
    }
    this.inMemoryRunningProjects.add(projectId);
    this.startInMemoryJob(nextJobId, record.data);
  }

  private startInMemoryJob(jobId: string, data: MddJobData): void {
    const record = this.inMemoryJobs.get(jobId);
    if (!record) return;
    record.status = "active";

    void runWithRequestUserAsync(data.userId ?? "system", async () => {
      try {
        const result = await this.runWithProjectExecutionLock(data.projectId, () =>
          this.executeJob(jobId, data, (p) => {
            pushMddJobProgress(record, p);
          }),
        );
        record.status = "completed";
        record.result = result;
        record.finishedAt = Date.now();
      } catch (err) {
        record.status = "failed";
        record.error = err instanceof Error ? err.message : String(err);
        record.finishedAt = Date.now();
      } finally {
        this.inMemoryRunningProjects.delete(data.projectId);
        this.pumpInMemoryQueue(data.projectId);
      }
    });
  }

  private async executeJob(
    jobId: string,
    data: MddJobData,
    onProgress: (p: MddJobProgress) => void | Promise<void>,
  ): Promise<MddJobResult> {
    const { projectId } = data;
    const abortController = new AbortController();
    this.jobAbortControllers.set(jobId, abortController);
    const stopCancelPoll = this.startCancelPoll(jobId, abortController);
    this.generationGuard.registerMddStream(projectId);
    try {
      if (await this.isCancelRequested(jobId)) {
        abortController.abort();
      }
      if (data.mode === "legacy") {
        onProgress({ phase: "legacy", message: "Generando MDD desde codebase…" });
        if (abortController.signal.aborted) {
          throw new Error("Cancelado por el usuario");
        }
        const res = await runWithTokenUsageContext(
          {
            projectId,
            stageId: data.stageId ?? null,
            documentField: "mddContent",
            context: data.mddContent || data.initialMessage ? "regenerate" : "initial",
            jobId,
          },
          () =>
            this.legacyCoordinator.generateMdd(projectId, data.stageId, {
              includeContent: false,
            }),
        );
        return {
          ok: res.ok,
          mode: "legacy",
          projectId,
          stageId: res.stageId,
          mddLength: res.mddLength,
          outcome: "done",
        };
      }
      return await runWithTokenUsageContext(
        {
          projectId,
          stageId: data.stageId ?? null,
          documentField: "mddContent",
          context: data.mddContent || data.initialMessage ? "regenerate" : "initial",
          jobId,
        },
        () =>
          this.aiAnalysis.runMddGenerationJob(data, onProgress, {
            signal: abortController.signal,
          }),
      );
    } finally {
      stopCancelPoll();
      this.jobAbortControllers.delete(jobId);
      this.generationGuard.unregisterMddStream(projectId);
      await this.clearCancelRequested(jobId);
    }
  }

  async getJobStatus(jobId: string): Promise<MddJobStatus> {
    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      return {
        jobId,
        projectId: mem.data.projectId,
        mode: mem.data.mode,
        status: mem.status,
        progress: mem.progress,
        result: mem.result,
        error: mem.error,
        attemptsMade: mem.status === "failed" ? 1 : 0,
        maxAttempts: this.MAX_ATTEMPTS,
        createdAt: mem.createdAt,
        finishedAt: mem.finishedAt,
      };
    }
    if (!this.queue) {
      return {
        jobId,
        mode: null,
        status: "unknown",
        progress: 0,
        attemptsMade: 0,
        maxAttempts: this.MAX_ATTEMPTS,
        createdAt: 0,
      };
    }
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return {
        jobId,
        mode: null,
        status: "unknown",
        progress: 0,
        attemptsMade: 0,
        maxAttempts: this.MAX_ATTEMPTS,
        createdAt: 0,
      };
    }
    const jobData = job.data as MddJobData | undefined;
    const state = await job.getState();
    let status: MddJobStatus["status"];
    if (state === "completed") status = "completed";
    else if (state === "failed") {
      status = job.attemptsMade < (job.opts?.attempts ?? 1) ? "retrying" : "failed";
    } else if (state === "active") status = "active";
    else if (state === "delayed") status = "retrying";
    else if (state === "waiting" || state === "waiting-children") status = "queued";
    else status = "unknown";

    return {
      jobId,
      projectId: jobData?.projectId,
      mode: jobData?.mode ?? null,
      status,
      progress: job.progress ?? 0,
      result: (job.returnvalue as MddJobResult | undefined) ?? undefined,
      error: job.failedReason ?? undefined,
      attemptsMade: job.attemptsMade,
      maxAttempts: this.MAX_ATTEMPTS,
      createdAt: job.timestamp ?? Date.now(),
      finishedAt: job.finishedOn ?? undefined,
    };
  }
}
