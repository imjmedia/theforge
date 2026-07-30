import { ConflictException, Inject, Injectable, forwardRef } from "@nestjs/common";
import type { ComplexityLevel } from "@theforge/shared-types";
import {
  buildDeliverableReadiness,
  buildGenerationGates,
  effectiveMddUpstreamSyncStatus,
  evaluateGenerationGate,
  toMddUpstreamSyncStatus,
  activeGenerationLabel,
  type GenerationJobSnapshot,
  type GenerationJobType,
  type ProjectGenerationDashboardSummary,
  type ProjectGenerationStatus,
} from "@theforge/shared-types";
import { ProjectsService } from "./projects.service.js";
import { DeliverablesQueueService } from "./deliverables-queue.service.js";
import { MddQueueService } from "../ai-analysis/mdd/mdd-queue.service.js";
import { MddUpstreamSyncService } from "../ai-analysis/mdd/mdd-upstream-sync.service.js";
import { MddCoherenceService } from "../engine/mdd-coherence/mdd-coherence.service.js";
import { pickPrimaryStage } from "./stage-helpers.js";

type TrackedBgJob = {
  projectId: string;
  type: GenerationJobType;
  status: "queued" | "active" | "retrying";
};

/**
 * Orquesta un job activo por proyecto, bloqueo durante stream MDD y gates de dependencias upstream.
 */
@Injectable()
export class ProjectGenerationGuardService {
  private readonly mddStreams = new Set<string>();
  private readonly bgJobs = new Map<string, TrackedBgJob>();

  constructor(
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    @Inject(forwardRef(() => DeliverablesQueueService))
    private readonly deliverablesQueue: DeliverablesQueueService,
    @Inject(forwardRef(() => MddQueueService))
    private readonly mddQueue: MddQueueService,
    @Inject(forwardRef(() => MddUpstreamSyncService))
    private readonly mddUpstreamSync: MddUpstreamSyncService,
    private readonly mddCoherence: MddCoherenceService,
  ) {}

  registerMddStream(projectId: string): void {
    this.mddStreams.add(projectId);
  }

  unregisterMddStream(projectId: string): void {
    this.mddStreams.delete(projectId);
  }

  isMddStreamActive(projectId: string): boolean {
    return this.mddStreams.has(projectId);
  }

  registerBackgroundJob(jobId: string, projectId: string, type: GenerationJobType): void {
    this.bgJobs.set(jobId, { projectId, type, status: "queued" });
  }

  markBackgroundJobActive(jobId: string): void {
    const job = this.bgJobs.get(jobId);
    if (job) job.status = "active";
  }

  finishBackgroundJob(jobId: string): void {
    this.bgJobs.delete(jobId);
  }

  async assertCanEnqueue(projectId: string, type: GenerationJobType): Promise<void> {
    const status = await this.getStatus(projectId);
    const gate = evaluateGenerationGate({
      complexity: status.complexity,
      contentReady: status.contentReady,
      mddStreamActive: status.mddStreamActive,
      activeJobs: [...status.queuedJobs, ...(status.activeJob ? [status.activeJob] : [])],
      requestedType: type,
    });
    if (!gate.allowed) {
      throw new ConflictException(gate.reason ?? "Generación bloqueada por dependencias u otro job en curso.");
    }
  }

  async getStatus(projectId: string, stageId?: string | null): Promise<
    ProjectGenerationStatus & {
      complexity: ComplexityLevel;
      contentReady: ReturnType<typeof buildDeliverableReadiness>;
    }
  > {
    const project = await this.projects.findOne(projectId);
    const complexity = ((project as { complexity?: ComplexityLevel }).complexity ?? "HIGH") as ComplexityLevel;
    const contentReady = buildDeliverableReadiness(project as Record<string, unknown>);
    const light = await this.buildLightStatus(projectId);
    const activeJobsForGates = [...light.queueJobs, ...light.bgSnapshots].filter(
      (j) => j.status === "queued" || j.status === "active" || j.status === "retrying",
    );

    const gates = buildGenerationGates({
      complexity,
      contentReady,
      mddStreamActive: light.mddStreamActive,
      activeJobs: activeJobsForGates,
    });

    let mddUpstreamSync = null;
    try {
      const analysis = await this.mddUpstreamSync.analyze(projectId, stageId);
      mddUpstreamSync = effectiveMddUpstreamSyncStatus(toMddUpstreamSyncStatus(analysis), {
        mddJobs: light.mddJobs,
      });
    } catch {
      mddUpstreamSync = null;
    }

    let sddGraph = null;
    try {
      const stages = (project as { stages?: Array<Record<string, unknown>> }).stages ?? [];
      const stageRaw =
        (stageId?.trim() && stages.find((s) => String(s.id ?? "") === stageId.trim())) ||
        pickPrimaryStage(stages as Parameters<typeof pickPrimaryStage>[0]);
      const stage = stageRaw as
        | { id?: string; mddContent?: string | null; shortTermContext?: unknown }
        | null
        | undefined;
      if (stage?.id) {
        const mdd = String(stage.mddContent ?? (project as { mddContent?: string }).mddContent ?? "");
        sddGraph = await this.mddCoherence.evaluateFromMdd(projectId, String(stage.id), mdd);
      }
    } catch {
      sddGraph = null;
    }

    return {
      busy: light.busy,
      mddStreamActive: light.mddStreamActive,
      mddJobs: light.mddJobs,
      activeJob: light.activeJob,
      queuedJobs: light.queuedJobs,
      gates,
      complexity,
      contentReady,
      mddUpstreamSync,
      sddGraph,
    };
  }

  /** Estado de jobs sin gates ni upstream sync (panel de proyectos). */
  async getLightStatus(projectId: string): Promise<ProjectGenerationStatus> {
    const light = await this.buildLightStatus(projectId, { skipCancelProbe: true });
    return {
      busy: light.busy,
      mddStreamActive: light.mddStreamActive,
      mddJobs: light.mddJobs,
      activeJob: light.activeJob,
      queuedJobs: light.queuedJobs,
      gates: {},
    };
  }

  async getDashboardSummaries(projectIds: string[]): Promise<Record<string, ProjectGenerationDashboardSummary>> {
    const unique = [...new Set(projectIds.map((id) => id.trim()).filter(Boolean))];
    const requested = new Set(unique);
    const result: Record<string, ProjectGenerationDashboardSummary> = Object.fromEntries(
      unique.map((id) => [id, { busy: false, label: null }]),
    );
    if (unique.length === 0) return result;

    const [mddByProject, deliverablesByProject] = await Promise.all([
      this.mddQueue.listActiveJobsGroupedByProject(),
      this.deliverablesQueue.listActiveJobsGroupedByProject(),
    ]);

    const candidateIds = new Set<string>();
    for (const pid of mddByProject.keys()) {
      if (requested.has(pid)) candidateIds.add(pid);
    }
    for (const pid of deliverablesByProject.keys()) {
      if (requested.has(pid)) candidateIds.add(pid);
    }
    for (const [, job] of this.bgJobs) {
      if (
        requested.has(job.projectId) &&
        (job.status === "queued" || job.status === "active" || job.status === "retrying")
      ) {
        candidateIds.add(job.projectId);
      }
    }
    for (const pid of unique) {
      if (this.isMddStreamActive(pid) || this.mddQueue.isProjectBusy(pid)) {
        candidateIds.add(pid);
      }
    }

    await Promise.all(
      [...candidateIds].map(async (projectId) => {
        result[projectId] = await this.summarizeDashboardProject(projectId);
      }),
    );
    return result;
  }

  private async summarizeDashboardProject(
    projectId: string,
  ): Promise<ProjectGenerationDashboardSummary> {
    const status = await this.getLightStatus(projectId);
    return { busy: status.busy, label: activeGenerationLabel(status) };
  }

  private async buildLightStatus(
    projectId: string,
    options?: { skipCancelProbe?: boolean },
  ): Promise<{
    busy: boolean;
    mddStreamActive: boolean;
    mddJobs: ProjectGenerationStatus["mddJobs"];
    activeJob: GenerationJobSnapshot | null;
    queuedJobs: GenerationJobSnapshot[];
    queueJobs: GenerationJobSnapshot[];
    bgSnapshots: GenerationJobSnapshot[];
  }> {
    const mddJobs = await this.mddQueue.listJobsForProject(projectId);
    const mddStreamActive =
      (await this.mddQueue.isProjectBlocking(projectId)) ||
      mddJobs.some((job) => job.status === "active" || job.status === "queued");

    const queueJobsRaw = await this.deliverablesQueue.listActiveJobsForProject(projectId);
    const queueJobs = await this.deliverablesQueue.filterVerifiedActiveJobRefs(queueJobsRaw);
    const bgSnapshots: GenerationJobSnapshot[] = [];
    for (const [jobId, job] of this.bgJobs) {
      if (job.projectId !== projectId) continue;
      if (job.status === "queued" || job.status === "active" || job.status === "retrying") {
        bgSnapshots.push({ jobId, type: job.type, status: job.status });
      }
    }

    const merged = [...queueJobs, ...bgSnapshots];
    const cancellingIds = new Set<string>();
    if (!options?.skipCancelProbe) {
      await Promise.all(
        merged.map(async (j) => {
          if (await this.deliverablesQueue.isCancelRequested(j.jobId)) {
            cancellingIds.add(j.jobId);
          }
        }),
      );
    }
    const visibleJobs = merged.filter((j) => !cancellingIds.has(j.jobId));
    const activeJob =
      visibleJobs.find((j) => j.status === "active") ??
      visibleJobs.find((j) => j.status === "retrying") ??
      null;
    const queuedJobs = visibleJobs.filter((j) => j.status === "queued");
    const busy = mddStreamActive || visibleJobs.length > 0;

    return {
      busy,
      mddStreamActive,
      mddJobs,
      activeJob,
      queuedJobs,
      queueJobs,
      bgSnapshots,
    };
  }
}
