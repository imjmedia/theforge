import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import type { AffectedArtifact } from "@theforge/shared-types";
import { tasksPipelineProgressPercent } from "@theforge/shared-types";
import { getRequestUserId, runWithRequestUserAsync } from "../../common/request-user.store.js";
import {
  resolveDeliverablesWorkerConcurrency,
  resolveRedisUrlOrThrow,
  shouldStartBullmqWorkers,
} from "../../common/bullmq-runtime.config.js";
import { longRunningBullmqWorkerOptions } from "../../common/bullmq-long-job.worker-options.js";
import {
  BULLMQ_DELIVERABLES_ORPHAN_REASON,
  forceFailBullMqActiveJob,
  reconcileOrphanBullMqActiveJob,
  recoverBullMqJobsAfterWorkerRestart,
} from "../../common/bullmq-orphan-recovery.util.js";
import { DocReconcileService } from "../documentation-gap/doc-reconcile.service.js";
import { ProjectGenerationGuardService } from "./project-generation-guard.service.js";
import { ProjectsService } from "./projects.service.js";
import { PluginArtifactService } from "../../plugins/plugin-artifact.service.js";
import {
  toDeliverablesJobError,
} from "./deliverables-job-error.util.js";

/** Entregables no deben reintentar tras stall: cascada a medias es peor que fallar y verificar entregables. */
const DELIVERABLES_MAX_STALLED_COUNT = 0;

const DELIVERABLES_JOB_STALLED_REASON =
  "Job de entregables bloqueado tras caída del worker; recarga el proyecto y verifica los documentos";

export const DELIVERABLES_QUEUE_NAME = "theforge-deliverables";

/** Clave Redis compartida API ↔ worker para cancelar jobs activos en BullMQ. */
const DELIVERABLES_CANCEL_KEY_PREFIX = "theforge:deliverables-cancel:";

/** Tipos de job soportados por la cola. */
export type GenerateJobType =
  | "cascade"
  | "cascade-delta"
  | "repair-sdd-gaps"
  | "spec"
  | "blueprint"
  | "api-contracts"
  | "logic-flows"
  | "tasks"
  | "agent-governance"
  | "infra"
  | "architecture"
  | "use-cases"
  | "user-stories"
  | "doc-reconcile-partial"
  | "plugin-artifact"
  | "upstream-propagate";

export interface GenerateJobData {
  type: GenerateJobType;
  projectId: string;
  userId?: string;
  preview?: boolean;
  gapsFeedback?: string | null;
  target?: string;
  forceRegenerate?: boolean;
  gapId?: string;
  stageId?: string;
  affectedArtifacts?: AffectedArtifact[];
  /** Si true, permite generar aunque el gate MDD tenga blockers (soft gate). */
  acknowledgeGaps?: boolean;
  /** Solo type=plugin-artifact */
  pluginId?: string;
  /** Solo type=plugin-artifact */
  artifactId?: string;
}

/** Estado público de un job para polling del frontend. */
export interface GenerateJobStatus {
  jobId: string;
  projectId?: string;
  type: GenerateJobType | null;
  status: "queued" | "active" | "completed" | "failed" | "retrying" | "unknown";
  progress: unknown;
  result?: unknown;
  error?: string;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: number;
  finishedAt?: number;
}

type InMemoryJobRecord = {
  data: GenerateJobData;
  status: GenerateJobStatus["status"];
  progress: unknown;
  result?: unknown;
  error?: string;
  createdAt: number;
  finishedAt?: number;
};

/**
 * Determina si un error es transitorio para loggear apropiadamente.
 * BullMQ ya maneja el retry via `backoff` en defaultJobOptions.
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("ehostunreach") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("api connection error")
  );
}

type DeliverablesActiveJobRef = {
  jobId: string;
  type: GenerateJobType;
  status: "queued" | "active" | "retrying";
};

@Injectable()
export class DeliverablesQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliverablesQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly inMemoryJobs = new Map<string, InMemoryJobRecord>();
  /** Un job in-memory activo por proyecto (cola secuencial sin Redis). */
  private readonly inMemoryRunningProjects = new Set<string>();
  private readonly inMemoryPendingByProject = new Map<string, string[]>();
  private readonly jobAbortControllers = new Map<string, AbortController>();
  /** Cancelación solicitada de jobs in-memory (mismo proceso; BullMQ usa Redis). */
  private readonly cancelRequestedJobIds = new Set<string>();

  /** Intentos máximos por job (BullMQ reintenta automáticamente con backoff). */
  private readonly MAX_ATTEMPTS = 4;

  constructor(
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    @Inject(forwardRef(() => ProjectGenerationGuardService))
    private readonly generationGuard: ProjectGenerationGuardService,
    @Optional()
    @Inject(forwardRef(() => DocReconcileService))
    private readonly docReconcile: DocReconcileService | null,
    private readonly pluginArtifact: PluginArtifactService,
  ) {}

  /** Cola disponible (BullMQ con Redis o fallback in-memory en dev). */
  isEnabled(): boolean {
    return true;
  }

  usesRedis(): boolean {
    return !!resolveRedisUrlOrThrow();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("[DeliverablesQueueService] onModuleInit start");
    const url = resolveRedisUrlOrThrow();
    if (!url) {
      this.logger.log(
        "BullMQ: sin REDIS_URL — cascada de entregables usa cola in-memory (solo desarrollo)",
      );
      this.logger.log("[DeliverablesQueueService] onModuleInit end");
      return;
    }
    this.queue = new Queue(DELIVERABLES_QUEUE_NAME, {
      connection: { url },
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86_400, count: 40 },
        attempts: this.MAX_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: 4_000,
        },
      },
    });
    const recovered = shouldStartBullmqWorkers()
      ? await recoverBullMqJobsAfterWorkerRestart(this.queue, {
          reason: BULLMQ_DELIVERABLES_ORPHAN_REASON,
          logger: this.logger,
        })
      : { failedActive: 0, removedQueued: 0, skippedLocked: 0 };
    if (recovered.failedActive > 0 || recovered.removedQueued > 0) {
      this.logger.warn(
        `BullMQ deliverables: recuperados tras reinicio — active→failed=${recovered.failedActive}, cola eliminada=${recovered.removedQueued}, omitidos con lock=${recovered.skippedLocked}`,
      );
    }
    const concurrency = resolveDeliverablesWorkerConcurrency();
    if (shouldStartBullmqWorkers()) {
      this.worker = new Worker(
        DELIVERABLES_QUEUE_NAME,
        async (job: Job<GenerateJobData>) => {
          const { userId } = job.data;
          return runWithRequestUserAsync(userId ?? "system", async () => {
            this.logger.log(
              `BullMQ worker: iniciando job ${job.id} type=${job.data.type} projectId=${job.data.projectId} attempt=${job.attemptsMade + 1}/${this.MAX_ATTEMPTS}`,
            );
            job.updateProgress(0);
            return this.executeJob(String(job.id), job.data, (p) =>
              job.updateProgress(p as Job["progress"]),
            );
          });
        },
        {
          connection: { url },
          ...longRunningBullmqWorkerOptions({
            concurrency,
            maxStalledCount: DELIVERABLES_MAX_STALLED_COUNT,
          }),
        },
      );
      this.worker.on("stalled", (jobId) => {
        void this.handleStalledDeliverablesJob(String(jobId));
      });
      this.worker.on("failed", (job, err) => {
        const data = job?.data as GenerateJobData | undefined;
        const transient = isTransientError(err);
        this.logger.error(
          `BullMQ job ${job?.id} (${data?.type ?? "?"} projectId=${data?.projectId ?? "?"}) ` +
            `${transient ? "falló (transitorio, reintentando...)" : "falló definitivamente"}: ${err instanceof Error ? err.message : err}`,
        );
      });
      this.worker.on("completed", (job) => {
        const data = job.data as GenerateJobData | undefined;
        const elapsed = job.finishedOn && job.processedOn ? Math.round((job.finishedOn - job.processedOn) / 1000) : 0;
        this.logger.log(`BullMQ job ${job.id} (${data?.type ?? "?"}) completado en ${elapsed}s`);
      });
      this.logger.log(
        `BullMQ worker activo (${DELIVERABLES_QUEUE_NAME}), maxAttempts=${this.MAX_ATTEMPTS}, maxStalledCount=${DELIVERABLES_MAX_STALLED_COUNT}, concurrency=${concurrency}, backoff=exponential/4s`,
      );
    } else {
      this.logger.log(
        `[DeliverablesQueueService] Cola Redis conectada; workers desactivados (THEFORGE_RUNTIME_ROLE=http)`,
      );
    }
    this.logger.log("[DeliverablesQueueService] onModuleInit end");
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Stall BullMQ → no reencolar cascada; fallar/eliminar para liberar UI. */
  private async handleStalledDeliverablesJob(jobId: string): Promise<void> {
    if (!this.queue) return;
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state === "active") {
      const failed = await forceFailBullMqActiveJob(
        this.queue,
        job,
        DELIVERABLES_JOB_STALLED_REASON,
      );
      if (failed) {
        this.logger.warn(`BullMQ deliverables job ${jobId} fallido tras stall`);
        return;
      }
    }
    try {
      await job.discard();
      await job.remove();
      this.logger.warn(`BullMQ deliverables job ${jobId} eliminado tras stall (${state})`);
    } catch (err) {
      this.logger.warn(
        `BullMQ deliverables job ${jobId} no pudo limpiarse tras stall: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Job BullMQ `active` sin lock ni worker local → huérfano; libera busy en generation-status. */
  private async reconcileOrphanDeliverablesJob(job: Job): Promise<boolean> {
    if (!this.queue) return false;
    const result = await reconcileOrphanBullMqActiveJob(this.queue, job, {
      reason: BULLMQ_DELIVERABLES_ORPHAN_REASON,
      isLocallyRunning: (jobId) => this.jobAbortControllers.has(jobId),
    });
    if (result === "reconciled") {
      this.logger.warn(`BullMQ deliverables job ${job.id} reconciliado (huérfano activo)`);
      return true;
    }
    return false;
  }

  private async resolveBullMqJobRef(
    job: Job,
    state: "waiting" | "active" | "delayed",
  ): Promise<DeliverablesActiveJobRef | null> {
    const data = job.data as GenerateJobData | undefined;
    if (!data?.projectId) return null;
    if (state === "active") {
      const reconciled = await this.reconcileOrphanDeliverablesJob(job);
      if (reconciled) return null;
    }
    const status =
      state === "active" ? "active" : state === "delayed" ? "retrying" : ("queued" as const);
    return { jobId: String(job.id), type: data.type, status };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Cancelado por el usuario");
    }
  }

  /** True si el usuario pidió cancelar y el worker aún no terminó de abortar. */
  async isCancelRequested(jobId: string): Promise<boolean> {
    if (this.cancelRequestedJobIds.has(jobId)) return true;
    if (!this.queue) return false;
    try {
      const client = await this.queue.client;
      const val = await client.get(`${DELIVERABLES_CANCEL_KEY_PREFIX}${jobId}`);
      return Boolean(val);
    } catch {
      return false;
    }
  }

  private async markCancelRequested(jobId: string): Promise<void> {
    if (!this.queue) return;
    const client = await this.queue.client;
    await client.set(`${DELIVERABLES_CANCEL_KEY_PREFIX}${jobId}`, "1");
  }

  private async clearCancelRequested(jobId: string): Promise<void> {
    this.cancelRequestedJobIds.delete(jobId);
    if (!this.queue) return;
    const client = await this.queue.client;
    await client.del(`${DELIVERABLES_CANCEL_KEY_PREFIX}${jobId}`);
  }

  private startCancelPoll(jobId: string, abortController: AbortController): () => void {
    if (!this.queue) return () => undefined;
    const interval = setInterval(() => {
      void (async () => {
        const client = await this.queue!.client;
        const val = await client.get(`${DELIVERABLES_CANCEL_KEY_PREFIX}${jobId}`);
        if (val) abortController.abort();
      })().catch(() => undefined);
    }, 1500);
    return () => clearInterval(interval);
  }

  /**
   * Cancela un job de entregables encolado o solicita abort del job activo.
   * Cola: remove inmediato. Activo: flag Redis + AbortController en worker.
   */
  async cancelJob(
    jobId: string,
    projectId: string,
  ): Promise<{ cancelled: boolean; status: string }> {
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
        this.generationGuard.finishBackgroundJob(jobId);
        this.logger.log(`In-memory deliverables job ${jobId} cancelado (queued)`);
        return { cancelled: true, status: "cancelled" };
      }
      if (mem.status === "active") {
        this.cancelRequestedJobIds.add(jobId);
        this.jobAbortControllers.get(jobId)?.abort();
        this.logger.log(`In-memory deliverables job ${jobId} cancelación solicitada (active)`);
        return { cancelled: true, status: "cancelling" };
      }
      return { cancelled: false, status: mem.status };
    }

    if (!this.queue) {
      throw new NotFoundException("Job no encontrado");
    }

    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException("Job no encontrado");
    }
    const data = job.data as GenerateJobData | undefined;
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
      this.logger.log(`BullMQ deliverables job ${jobId} cancelado (queued)`);
      return { cancelled: true, status: "cancelled" };
    }
    if (state === "active") {
      await this.markCancelRequested(jobId);
      this.jobAbortControllers.get(jobId)?.abort();
      this.logger.log(`BullMQ deliverables job ${jobId} cancelación solicitada (active)`);
      return { cancelled: true, status: "cancelling" };
    }
    return { cancelled: false, status: state };
  }

  private async executeJob(
    jobId: string,
    data: GenerateJobData,
    onProgress: (p: unknown) => void,
  ): Promise<unknown> {
    const abortController = new AbortController();
    this.jobAbortControllers.set(jobId, abortController);
    const stopCancelPoll = this.startCancelPoll(jobId, abortController);
    const JOB_TIMEOUT_MS = 45 * 60 * 1000;
    try {
      if (await this.isCancelRequested(jobId)) {
        abortController.abort();
      }
      return await Promise.race([
        this.runJob(data, onProgress, abortController.signal),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            abortController.abort();
            reject(new Error(`Job ${jobId} excedió timeout de ${JOB_TIMEOUT_MS / 60_000}min`));
          }, JOB_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      throw toDeliverablesJobError(err);
    } finally {
      stopCancelPoll();
      this.jobAbortControllers.delete(jobId);
      await this.clearCancelRequested(jobId);
    }
  }

  private async runJob(
    data: GenerateJobData,
    onProgress: (p: unknown) => void,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.throwIfAborted(signal);
    const {
      type,
      projectId,
      preview,
      gapsFeedback,
      target,
      forceRegenerate,
      gapId,
      stageId,
      affectedArtifacts,
      acknowledgeGaps,
    } = data;

    if (!preview && type !== "doc-reconcile-partial") {
      await this.projects.assertDeliverablesAllowed(projectId, { acknowledgeGaps });
    }

    let result: unknown;
    switch (type) {
      case "cascade":
        result = await this.projects.generateDeliverablesCascade(
          projectId,
          (p) => {
            this.throwIfAborted(signal);
            onProgress(p);
          },
          { acknowledgeGaps, signal },
        );
        break;
      case "cascade-delta":
        result = await this.projects.generateDeliverablesDelta(
          projectId,
          (p) => {
            this.throwIfAborted(signal);
            onProgress(p);
          },
          { acknowledgeGaps, signal },
        );
        break;
      case "repair-sdd-gaps":
        this.throwIfAborted(signal);
        result = await this.projects.repairReadinessGaps(projectId, { signal });
        break;
      case "blueprint":
        if (preview) {
          result = await this.projects.generateBlueprintPreview(projectId, gapsFeedback);
        } else {
          result = await this.projects.generateBlueprint(projectId, gapsFeedback);
        }
        break;
      case "api-contracts":
        if (preview) {
          result = await this.projects.generateApiContractsPreview(projectId, gapsFeedback);
        } else {
          result = await this.projects.generateApiContracts(projectId, gapsFeedback);
        }
        break;
      case "logic-flows":
        result = await this.projects.generateLogicFlows(projectId, gapsFeedback);
        break;
      case "tasks":
        result = await this.projects.generateTasks(
          projectId,
          (data.gapsFeedback as string | null) ?? undefined,
          {
            acknowledgeGaps: data.acknowledgeGaps === true,
            onProgress: (progress) => {
              onProgress({ ...progress, percent: tasksPipelineProgressPercent(progress) });
            },
          },
        );
        break;
      case "agent-governance":
        if (preview) {
          result = await this.projects.generateAgentGovernancePreview(projectId, target, {
            forceRegenerate: forceRegenerate !== false,
          });
        } else {
          result = await this.projects.generateAgentGovernance(projectId, target, {
            forceRegenerate: forceRegenerate !== false,
          });
        }
        break;
      case "infra":
        if (preview) {
          result = await this.projects.generateInfraPreview(projectId, gapsFeedback);
        } else {
          result = await this.projects.generateInfra(projectId, gapsFeedback);
        }
        break;
      case "architecture":
        if (preview) {
          result = await this.projects.generateArchitecturePreview(projectId);
        } else {
          result = await this.projects.generateArchitecture(projectId);
        }
        break;
      case "spec":
        result = await this.projects.generateSpec(projectId);
        break;
      case "use-cases":
        if (preview) {
          result = await this.projects.generateUseCasesPreview(projectId);
        } else {
          result = await this.projects.generateUseCases(projectId);
        }
        break;
      case "user-stories":
        if (preview) {
          result = await this.projects.generateUserStoriesPreview(projectId);
        } else {
          result = await this.projects.generateUserStories(projectId);
        }
        break;
      case "doc-reconcile-partial": {
        if (!this.docReconcile || !gapId || !stageId || !affectedArtifacts?.length) {
          throw new Error("doc-reconcile-partial requiere DocReconcileService, gapId, stageId y affectedArtifacts");
        }
        result = await this.docReconcile.executeReconcile({
          projectId,
          stageId,
          gapId,
          affectedArtifacts,
          gapsFeedback: gapsFeedback ?? "",
        });
        break;
      }
      case "plugin-artifact": {
        this.throwIfAborted(signal);
        const pluginId = data.pluginId?.trim();
        const artifactId = data.artifactId?.trim();
        if (!pluginId || !artifactId) {
          throw new Error("plugin-artifact requiere pluginId y artifactId");
        }
        result = await this.pluginArtifact.generate(projectId, pluginId, artifactId, {
          stageId: stageId ?? null,
        });
        break;
      }
      default:
        throw new Error(`Tipo de job desconocido: ${type}`);
    }

    if (
      type !== "cascade" &&
      type !== "cascade-delta" &&
      type !== "repair-sdd-gaps" &&
      type !== "doc-reconcile-partial" &&
      type !== "agent-governance" &&
      !preview
    ) {
      await this.projects.runPostRegenSddConflictSurfacing(projectId).catch((err) => {
        this.logger.warn(
          `[deliverables-queue] sddConflictSurfacing (${type}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return result;
  }

  private startInMemoryJob(jobId: string, data: GenerateJobData): void {
    const record = this.inMemoryJobs.get(jobId);
    if (!record) return;
    record.status = "active";
    this.generationGuard.markBackgroundJobActive(jobId);

    void runWithRequestUserAsync(data.userId ?? "system", async () => {
      const started = Date.now();
      try {
        const result = await this.executeJob(jobId, data, (p) => {
          record.progress = p;
        });
        record.status = "completed";
        record.result = result;
        record.finishedAt = Date.now();
        const elapsed = Math.round((Date.now() - started) / 1000);
        this.logger.log(
          `In-memory job ${jobId} (${data.type} projectId=${data.projectId}) completado en ${elapsed}s`,
        );
      } catch (err) {
        record.status = "failed";
        record.error = err instanceof Error ? err.message : String(err);
        record.finishedAt = Date.now();
        this.logger.error(
          `In-memory job ${jobId} (${data.type} projectId=${data.projectId}) falló: ${record.error}`,
        );
      } finally {
        this.generationGuard.finishBackgroundJob(jobId);
        this.inMemoryRunningProjects.delete(data.projectId);
        this.pumpInMemoryQueue(data.projectId);
      }
    });
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

  private enqueueInMemory(data: GenerateJobData): string {
    const jobId = randomUUID();
    this.inMemoryJobs.set(jobId, {
      data,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
    });
    this.generationGuard.registerBackgroundJob(jobId, data.projectId, data.type);

    const pending = this.inMemoryPendingByProject.get(data.projectId) ?? [];
    pending.push(jobId);
    this.inMemoryPendingByProject.set(data.projectId, pending);

    this.logger.log(`In-memory job ${jobId} encolado type=${data.type} projectId=${data.projectId}`);
    setImmediate(() => this.pumpInMemoryQueue(data.projectId));
    return jobId;
  }

  /** Escaneo único de cola (dashboard / resumen batch). */
  async listActiveJobsGroupedByProject(): Promise<Map<string, DeliverablesActiveJobRef[]>> {
    const map = new Map<string, DeliverablesActiveJobRef[]>();
    const push = (projectId: string, entry: DeliverablesActiveJobRef) => {
      const list = map.get(projectId) ?? [];
      list.push(entry);
      map.set(projectId, list);
    };

    for (const [jobId, mem] of this.inMemoryJobs) {
      if (mem.status !== "queued" && mem.status !== "active") continue;
      push(mem.data.projectId, { jobId, type: mem.data.type, status: mem.status });
    }

    if (!this.queue) return map;

    const states = ["waiting", "active", "delayed"] as const;
    for (const state of states) {
      const jobs = await this.queue.getJobs([state], 0, 200);
      for (const job of jobs) {
        const entry = await this.resolveBullMqJobRef(job, state);
        if (!entry) continue;
        const data = job.data as GenerateJobData;
        push(data.projectId, entry);
      }
    }
    return map;
  }

  /** Jobs activos o en cola para un proyecto (BullMQ + in-memory). */
  async listActiveJobsForProject(projectId: string): Promise<DeliverablesActiveJobRef[]> {
    const out: DeliverablesActiveJobRef[] = [];

    for (const [jobId, mem] of this.inMemoryJobs) {
      if (mem.data.projectId !== projectId) continue;
      if (mem.status === "queued" || mem.status === "active") {
        out.push({ jobId, type: mem.data.type, status: mem.status });
      }
    }

    if (!this.queue) return out;

    const states = ["waiting", "active", "delayed"] as const;
    for (const state of states) {
      const jobs = await this.queue.getJobs([state], 0, 200);
      for (const job of jobs) {
        const data = job.data as GenerateJobData | undefined;
        if (data?.projectId !== projectId) continue;
        const entry = await this.resolveBullMqJobRef(job, state);
        if (entry) out.push(entry);
      }
    }
    return out;
  }

  /** Encola cualquier tipo de job de generación. Retorna jobId. */
  async enqueue(data: GenerateJobData): Promise<string> {
    await this.generationGuard.assertCanEnqueue(data.projectId, data.type);

    const userId = data.userId ?? getRequestUserId();
    const payload: GenerateJobData = { ...data, userId };

    if (this.queue) {
      const job = await this.queue.add(data.type, payload, {
        jobId: undefined,
      });
      return String(job.id);
    }

    return this.enqueueInMemory(payload);
  }

  /** Devuelve el estado público de un job para polling del frontend. */
  async getJobStatus(jobId: string): Promise<GenerateJobStatus> {
    const mem = this.inMemoryJobs.get(jobId);
    if (mem) {
      return {
        jobId,
        projectId: mem.data.projectId,
        type: mem.data.type,
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
      return { jobId, type: null, status: "unknown", progress: 0, attemptsMade: 0, maxAttempts: this.MAX_ATTEMPTS, createdAt: 0 };
    }
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return { jobId, type: null, status: "unknown", progress: 0, attemptsMade: 0, maxAttempts: this.MAX_ATTEMPTS, createdAt: 0 };
    }

    const data = job.data as GenerateJobData | undefined;
    const state = await job.getState();

    let status: GenerateJobStatus["status"];
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
      type: data?.type ?? null,
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
}
