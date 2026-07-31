import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { getRequestUserId, runWithRequestUserAsync } from "../../common/request-user.store.js";
import {
  resolveLegacyDeliverablesWorkerConcurrency,
  resolveRedisUrlOrThrow,
  shouldStartBullmqWorkers,
} from "../../common/bullmq-runtime.config.js";
import { longRunningBullmqWorkerOptions } from "../../common/bullmq-long-job.worker-options.js";
import { forceFailBullMqActiveJob, isBullMqJobLockHeld } from "../../common/bullmq-orphan-recovery.util.js";
import { ProjectsService } from "../projects/projects.service.js";
import { LegacyCoordinatorService } from "./legacy-coordinator.service.js";

export const LEGACY_DELIVERABLES_QUEUE_NAME = "theforge-legacy-deliverables";

export interface LegacyDeliverablesJobData {
  projectId: string;
  stageId?: string;
  userId?: string;
}

export interface LegacyDeliverablesJobStatus {
  jobId: string;
  projectId?: string;
  status: "queued" | "active" | "completed" | "failed" | "retrying" | "unknown";
  progress: unknown;
  result?: unknown;
  error?: string;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: number;
  finishedAt?: number;
}

type InMemoryLegacyJobRecord = {
  data: LegacyDeliverablesJobData;
  status: LegacyDeliverablesJobStatus["status"];
  progress: unknown;
  result?: unknown;
  error?: string;
  createdAt: number;
  finishedAt?: number;
};

@Injectable()
export class LegacyDeliverablesQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LegacyDeliverablesQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly inMemoryJobs = new Map<string, InMemoryLegacyJobRecord>();
  private readonly MAX_ATTEMPTS = 4;

  constructor(
    @Inject(forwardRef(() => LegacyCoordinatorService))
    private readonly coordinator: LegacyCoordinatorService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
  ) {}

  isEnabled(): boolean {
    return true;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("[LegacyDeliverablesQueueService] onModuleInit start");
    const url = resolveRedisUrlOrThrow();
    if (!url) {
      this.logger.log(
        "BullMQ legacy: sin REDIS_URL — cascada legacy usa cola in-memory (solo desarrollo)",
      );
      this.logger.log("[LegacyDeliverablesQueueService] onModuleInit end");
      return;
    }

    this.queue = new Queue(LEGACY_DELIVERABLES_QUEUE_NAME, {
      connection: { url },
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86_400, count: 40 },
        attempts: this.MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 4_000 },
      },
    });

    const concurrency = resolveLegacyDeliverablesWorkerConcurrency();
    if (shouldStartBullmqWorkers()) {
      this.worker = new Worker(
        LEGACY_DELIVERABLES_QUEUE_NAME,
        async (job: Job<LegacyDeliverablesJobData>) => {
          const { projectId, stageId, userId } = job.data;
          return runWithRequestUserAsync(userId ?? "system", async () => {
            this.logger.log(
              `BullMQ legacy worker: job ${job.id} projectId=${projectId} attempt=${job.attemptsMade + 1}/${this.MAX_ATTEMPTS}`,
            );
            job.updateProgress({ phase: "legacy_deliverables", step: "preflight", index: 0, total: 1 });
            await this.projects.assertMddDeliveryGateForDeliverables(projectId);
            return this.coordinator.generateDeliverables(projectId, stageId, {
              onProgress: (p) => job.updateProgress({ phase: "legacy_deliverables", ...p }),
            });
          });
        },
        { connection: { url }, ...longRunningBullmqWorkerOptions({ concurrency }) },
      );

      this.worker.on("failed", (job, err) => {
        const data = job?.data as LegacyDeliverablesJobData | undefined;
        this.logger.error(
          `BullMQ legacy job ${job?.id} (projectId=${data?.projectId ?? "?"}) falló: ${err instanceof Error ? err.message : err}`,
        );
      });
      this.worker.on("completed", (job) => {
        const elapsed =
          job.finishedOn && job.processedOn ? Math.round((job.finishedOn - job.processedOn) / 1000) : 0;
        this.logger.log(`BullMQ legacy job ${job.id} completado en ${elapsed}s`);
      });
      this.logger.log(
        `BullMQ legacy worker activo (${LEGACY_DELIVERABLES_QUEUE_NAME}), concurrency=${concurrency}`,
      );
    } else {
      this.logger.log(
        "[LegacyDeliverablesQueueService] Cola Redis conectada; workers desactivados (THEFORGE_RUNTIME_ROLE=http)",
      );
    }
    this.logger.log("[LegacyDeliverablesQueueService] onModuleInit end");
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private startInMemoryJob(jobId: string, data: LegacyDeliverablesJobData): void {
    const record = this.inMemoryJobs.get(jobId);
    if (!record) return;
    record.status = "active";

    void runWithRequestUserAsync(data.userId ?? "system", async () => {
      const started = Date.now();
      try {
        record.progress = { phase: "legacy_deliverables", step: "preflight", index: 0, total: 1 };
        await this.projects.assertMddDeliveryGateForDeliverables(data.projectId);
        const result = await this.coordinator.generateDeliverables(data.projectId, data.stageId, {
          onProgress: (p) => {
            record.progress = { phase: "legacy_deliverables", ...p };
          },
        });
        record.status = "completed";
        record.result = result;
        record.finishedAt = Date.now();
        const elapsed = Math.round((Date.now() - started) / 1000);
        this.logger.log(
          `In-memory legacy job ${jobId} (projectId=${data.projectId}) completado en ${elapsed}s`,
        );
      } catch (err) {
        record.status = "failed";
        record.error = err instanceof Error ? err.message : String(err);
        record.finishedAt = Date.now();
        this.logger.error(
          `In-memory legacy job ${jobId} (projectId=${data.projectId}) falló: ${record.error}`,
        );
      }
    });
  }

  async enqueue(data: LegacyDeliverablesJobData): Promise<string> {
    const userId = data.userId ?? getRequestUserId();
    const payload: LegacyDeliverablesJobData = { ...data, userId };

    if (this.queue) {
      const job = await this.queue.add("legacy-cascade", payload);
      return String(job.id);
    }

    const jobId = randomUUID();
    this.inMemoryJobs.set(jobId, {
      data: payload,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
    });
    this.logger.log(`In-memory legacy job ${jobId} encolado projectId=${data.projectId}`);
    setImmediate(() => this.startInMemoryJob(jobId, payload));
    return jobId;
  }

  async getJobStatus(jobId: string): Promise<LegacyDeliverablesJobStatus> {
    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      return {
        jobId,
        projectId: mem.data.projectId,
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
        status: "unknown",
        progress: 0,
        attemptsMade: 0,
        maxAttempts: this.MAX_ATTEMPTS,
        createdAt: 0,
      };
    }

    const data = job.data as LegacyDeliverablesJobData | undefined;
    const state = await job.getState();
    let status: LegacyDeliverablesJobStatus["status"];
    if (state === "completed") status = "completed";
    else if (state === "failed") {
      status = job.attemptsMade < (job.opts?.attempts ?? 1) ? "retrying" : "failed";
    } else if (state === "active") status = "active";
    else if (state === "delayed") status = "retrying";
    else if (state === "waiting" || state === "waiting-children") status = "queued";
    else status = "unknown";

    return {
      jobId,
      projectId: data?.projectId,
      status,
      progress: job.progress ?? 0,
      result: job.returnvalue ?? undefined,
      error: job.failedReason ?? undefined,
      attemptsMade: job.attemptsMade,
      maxAttempts: this.MAX_ATTEMPTS,
      createdAt: job.timestamp ?? Date.now(),
      finishedAt: job.finishedOn ?? undefined,
    };
  }

  /** Escaneo único de cola (panel admin / dashboard). */
  async listActiveJobsGroupedByProject(): Promise<Map<string, Array<{ jobId: string; status: "queued" | "active" | "retrying" }>>> {
    const map = new Map<string, Array<{ jobId: string; status: "queued" | "active" | "retrying" }>>();
    const push = (projectId: string, entry: { jobId: string; status: "queued" | "active" | "retrying" }) => {
      const list = map.get(projectId) ?? [];
      list.push(entry);
      map.set(projectId, list);
    };

    for (const [jobId, mem] of this.inMemoryJobs) {
      if (mem.status !== "queued" && mem.status !== "active") continue;
      push(mem.data.projectId, { jobId, status: mem.status });
    }

    if (!this.queue) return map;

    const states = ["waiting", "active", "delayed"] as const;
    for (const state of states) {
      const jobs = await this.queue.getJobs([state], 0, 200);
      for (const job of jobs) {
        const data = job.data as LegacyDeliverablesJobData | undefined;
        if (!data?.projectId) continue;
        push(data.projectId, {
          jobId: String(job.id),
          status: state === "active" ? "active" : state === "delayed" ? "retrying" : "queued",
        });
      }
    }
    return map;
  }

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
        mem.status = "failed";
        mem.error = "Cancelado por el administrador";
        mem.finishedAt = Date.now();
        this.logger.log(`In-memory legacy job ${jobId} cancelado (queued) projectId=${projectId}`);
        return { cancelled: true, status: "cancelled" };
      }
      if (mem.status === "active") {
        mem.status = "failed";
        mem.error = "Cancelado por el administrador";
        mem.finishedAt = Date.now();
        this.logger.warn(
          `In-memory legacy job ${jobId} marcado cancelado (active; el hilo puede seguir un instante) projectId=${projectId}`,
        );
        return { cancelled: true, status: "cancelled" };
      }
      return { cancelled: false, status: mem.status };
    }

    if (!this.queue) {
      throw new NotFoundException("Job legacy no encontrado");
    }

    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException("Job legacy no encontrado");
    }
    const data = job.data as LegacyDeliverablesJobData | undefined;
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
      this.logger.log(`BullMQ legacy job ${jobId} cancelado (queued) projectId=${projectId}`);
      return { cancelled: true, status: "cancelled" };
    }
    if (state === "active") {
      if (!(await isBullMqJobLockHeld(this.queue, jobId))) {
        const failed = await forceFailBullMqActiveJob(
          this.queue,
          job,
          "Cancelado por el administrador (worker no activo)",
        );
        if (failed) {
          this.logger.log(`BullMQ legacy job ${jobId} fallido (huérfano activo) projectId=${projectId}`);
          return { cancelled: true, status: "cancelled" };
        }
      }
      this.logger.warn(
        `BullMQ legacy job ${jobId} activo con lock; solicita reinicio worker si persiste projectId=${projectId}`,
      );
      return { cancelled: true, status: "cancelling" };
    }
    return { cancelled: false, status: state };
  }

  async describeAdminRuntime(): Promise<import("@theforge/shared-types").AdminQueueRuntime> {
    const { describeBullmqAdminRuntime } = await import("../../common/bullmq-admin-runtime.util.js");
    return describeBullmqAdminRuntime({
      queueKey: "legacy-deliverables",
      queueName: LEGACY_DELIVERABLES_QUEUE_NAME,
      queue: this.queue,
      localWorkerRunning: this.worker !== null,
      inMemoryActiveCount: () => {
        let count = 0;
        for (const mem of this.inMemoryJobs.values()) {
          if (mem.status === "queued" || mem.status === "active") count += 1;
        }
        return count;
      },
    });
  }

  usesInMemoryBackend(): boolean {
    return this.queue === null;
  }
}
