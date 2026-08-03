import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ADMIN_WORKER_JOB_QUEUE_LABELS,
  GENERATION_JOB_TYPE_LABELS,
  MDD_JOB_MODE_LABELS,
  type AdminQueueRuntime,
  type AdminStopWorkerJobBody,
  type AdminStopWorkerJobResult,
  type AdminWorkerJobQueue,
  type AdminWorkerJobRow,
  type AdminWorkerJobsSnapshot,
  type GenerationJobType,
  type MddJobMode,
} from "@theforge/shared-types";
import {
  resolveRedisUrlOrThrow,
  resolveTheForgeRuntimeRole,
} from "../../common/bullmq-runtime.config.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { MddQueueService } from "../ai-analysis/mdd/mdd-queue.service.js";
import { LegacyDeliverablesQueueService } from "../legacy-flow/legacy-deliverables-queue.service.js";
import { DeliverablesQueueService } from "../projects/deliverables-queue.service.js";
import { ProjectGenerationGuardService } from "../projects/project-generation-guard.service.js";

const MDD_CANCEL_REDIS_PREFIX = "theforge:mdd-cancel:";
const DELIVERABLES_CANCEL_REDIS_PREFIX = "theforge:deliverables-cancel:";

function summarizeProgress(progress: unknown): string | null {
  if (progress == null) return null;
  if (typeof progress === "string") return progress.slice(0, 160);
  if (typeof progress !== "object") return String(progress);
  const record = progress as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["phase", "step", "message", "agent", "percent"]) {
    const value = record[key];
    if (value == null || value === "") continue;
    parts.push(`${key}: ${String(value)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(record).slice(0, 160);
}

@Injectable()
export class AdminWorkerJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mddQueue: MddQueueService,
    private readonly deliverablesQueue: DeliverablesQueueService,
    private readonly legacyDeliverablesQueue: LegacyDeliverablesQueueService,
    private readonly generationGuard: ProjectGenerationGuardService,
  ) {}

  async listActiveJobs(): Promise<AdminWorkerJobsSnapshot> {
    const [queues, mddByProject, deliverablesByProject, legacyByProject] = await Promise.all([
      this.describeQueues(),
      this.mddQueue.listActiveJobsGroupedByProject(),
      this.deliverablesQueue.listActiveJobsGroupedByProject(),
      this.legacyDeliverablesQueue.listActiveJobsGroupedByProject(),
    ]);

    const projectIds = new Set<string>();
    for (const map of [mddByProject, deliverablesByProject, legacyByProject]) {
      for (const projectId of map.keys()) projectIds.add(projectId);
    }

    const projectNames = await this.loadProjectNames([...projectIds]);
    const jobs: AdminWorkerJobRow[] = [];

    for (const [projectId, refs] of mddByProject) {
      for (const ref of refs) {
        jobs.push(
          await this.buildMddRow({
            projectId,
            projectName: projectNames.get(projectId) ?? null,
            ref,
          }),
        );
      }
    }

    for (const [projectId, refs] of deliverablesByProject) {
      for (const ref of refs) {
        jobs.push(
          await this.buildDeliverablesRow({
            projectId,
            projectName: projectNames.get(projectId) ?? null,
            ref,
          }),
        );
      }
    }

    for (const [projectId, refs] of legacyByProject) {
      for (const ref of refs) {
        jobs.push(
          await this.buildLegacyRow({
            projectId,
            projectName: projectNames.get(projectId) ?? null,
            ref,
          }),
        );
      }
    }

    jobs.sort((a, b) => {
      const rank = (status: AdminWorkerJobRow["status"]) =>
        status === "active" ? 0 : status === "cancelling" ? 1 : status === "retrying" ? 2 : 3;
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus !== 0) return byStatus;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });

    return {
      runtimeRole: resolveTheForgeRuntimeRole(),
      redisConfigured: Boolean(resolveRedisUrlOrThrow()),
      queues,
      mddStreamProjectIds: this.generationGuard.listActiveMddStreamProjectIds(),
      jobs,
    };
  }

  async stopJob(jobId: string, body: AdminStopWorkerJobBody): Promise<AdminStopWorkerJobResult> {
    const queue = body.queue;
    const projectId = body.projectId?.trim();
    if (!projectId) {
      throw new BadRequestException("projectId es requerido");
    }
    if (!ADMIN_WORKER_JOB_QUEUE_LABELS[queue]) {
      throw new BadRequestException("Cola inválida");
    }

    const beforeCancelKeyPresent =
      queue === "mdd"
        ? await this.mddQueue.isCancelRequested(jobId)
        : queue === "deliverables"
          ? await this.deliverablesQueue.isCancelRequested(jobId)
          : false;

    const result =
      queue === "mdd"
        ? await this.mddQueue.cancelJob(jobId, projectId)
        : queue === "deliverables"
          ? await this.deliverablesQueue.cancelJob(jobId, projectId)
          : await this.legacyDeliverablesQueue.cancelJob(jobId, projectId);

    const afterCancelKeyPresent =
      queue === "mdd"
        ? await this.mddQueue.isCancelRequested(jobId)
        : queue === "deliverables"
          ? await this.deliverablesQueue.isCancelRequested(jobId)
          : false;

    return {
      jobId,
      queue,
      cancelled: result.cancelled,
      status: result.status,
      cleaned: {
        redisCancelKey: beforeCancelKeyPresent || afterCancelKeyPresent,
        bullmqRemoved: result.status === "cancelled" && queue !== "mdd",
        inMemoryCleared:
          result.status === "cancelled" &&
          ((queue === "mdd" && this.mddQueue.usesInMemoryBackend()) ||
            (queue === "deliverables" && this.deliverablesQueue.usesInMemoryBackend()) ||
            (queue === "legacy-deliverables" && this.legacyDeliverablesQueue.usesInMemoryBackend())),
      },
    };
  }

  async resolveJobQueue(jobId: string, projectId?: string): Promise<AdminWorkerJobQueue> {
    const mddStatus = await this.mddQueue.getJobStatus(jobId);
    if (mddStatus.status !== "unknown") {
      if (projectId && mddStatus.projectId && mddStatus.projectId !== projectId) {
        throw new NotFoundException("Job no encontrado para ese proyecto");
      }
      return "mdd";
    }
    const deliverablesStatus = await this.deliverablesQueue.getJobStatus(jobId);
    if (deliverablesStatus.status !== "unknown") {
      if (projectId && deliverablesStatus.projectId && deliverablesStatus.projectId !== projectId) {
        throw new NotFoundException("Job no encontrado para ese proyecto");
      }
      return "deliverables";
    }
    const legacyStatus = await this.legacyDeliverablesQueue.getJobStatus(jobId);
    if (legacyStatus.status !== "unknown") {
      if (projectId && legacyStatus.projectId && legacyStatus.projectId !== projectId) {
        throw new NotFoundException("Job no encontrado para ese proyecto");
      }
      return "legacy-deliverables";
    }
    throw new NotFoundException("Job no encontrado");
  }

  private async describeQueues(): Promise<AdminQueueRuntime[]> {
    return Promise.all([
      this.mddQueue.describeAdminRuntime(),
      this.deliverablesQueue.describeAdminRuntime(),
      this.legacyDeliverablesQueue.describeAdminRuntime(),
    ]);
  }

  private async loadProjectNames(projectIds: string[]): Promise<Map<string, string>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async buildMddRow(params: {
    projectId: string;
    projectName: string | null;
    ref: { jobId: string; mode: MddJobMode; status: "queued" | "active" };
  }): Promise<AdminWorkerJobRow> {
    const { projectId, projectName, ref } = params;
    const storage = this.mddQueue.usesInMemoryBackend() ? "in-memory" : "bullmq";
    const cancelRequested = await this.mddQueue.isCancelRequested(ref.jobId);
    const status = cancelRequested ? "cancelling" : ref.status;
    const full = await this.mddQueue.getJobStatus(ref.jobId);
    const lockHeld =
      storage === "bullmq" && ref.status === "active"
        ? await this.mddQueue.isActiveJobLockHeld(ref.jobId)
        : null;

    return {
      jobId: ref.jobId,
      queue: "mdd",
      projectId,
      projectName,
      actionLabel: MDD_JOB_MODE_LABELS[ref.mode] ?? ref.mode,
      status,
      inProgress: status === "active" || status === "cancelling",
      storage,
      redisCancelKey: `${MDD_CANCEL_REDIS_PREFIX}${ref.jobId}`,
      redisCancelKeyPresent: cancelRequested,
      bullmqLockHeld: lockHeld,
      progressSummary: summarizeProgress(full.progress),
      createdAt: full.createdAt > 0 ? full.createdAt : null,
    };
  }

  private async buildDeliverablesRow(params: {
    projectId: string;
    projectName: string | null;
    ref: { jobId: string; type: GenerationJobType; status: "queued" | "active" | "retrying" };
  }): Promise<AdminWorkerJobRow> {
    const { projectId, projectName, ref } = params;
    const storage = this.deliverablesQueue.usesInMemoryBackend() ? "in-memory" : "bullmq";
    const cancelRequested = await this.deliverablesQueue.isCancelRequested(ref.jobId);
    const status = cancelRequested ? "cancelling" : ref.status;
    const full = await this.deliverablesQueue.getJobStatus(ref.jobId);
    const lockHeld =
      storage === "bullmq" && ref.status === "active"
        ? await this.deliverablesQueue.isActiveJobLockHeld(ref.jobId)
        : null;

    return {
      jobId: ref.jobId,
      queue: "deliverables",
      projectId,
      projectName,
      actionLabel: GENERATION_JOB_TYPE_LABELS[ref.type] ?? ref.type,
      status,
      inProgress: status === "active" || status === "cancelling" || status === "retrying",
      storage,
      redisCancelKey: `${DELIVERABLES_CANCEL_REDIS_PREFIX}${ref.jobId}`,
      redisCancelKeyPresent: cancelRequested,
      bullmqLockHeld: lockHeld,
      progressSummary: summarizeProgress(full.progress),
      createdAt: full.createdAt > 0 ? full.createdAt : null,
    };
  }

  private async buildLegacyRow(params: {
    projectId: string;
    projectName: string | null;
    ref: { jobId: string; status: "queued" | "active" | "retrying" };
  }): Promise<AdminWorkerJobRow> {
    const { projectId, projectName, ref } = params;
    const storage = this.legacyDeliverablesQueue.usesInMemoryBackend() ? "in-memory" : "bullmq";
    const full = await this.legacyDeliverablesQueue.getJobStatus(ref.jobId);

    return {
      jobId: ref.jobId,
      queue: "legacy-deliverables",
      projectId,
      projectName,
      actionLabel: "Cascada legacy de entregables",
      status: ref.status,
      inProgress: ref.status === "active" || ref.status === "retrying",
      storage,
      redisCancelKey: null,
      redisCancelKeyPresent: false,
      bullmqLockHeld: null,
      progressSummary: summarizeProgress(full.progress),
      createdAt: full.createdAt > 0 ? full.createdAt : null,
    };
  }
}
