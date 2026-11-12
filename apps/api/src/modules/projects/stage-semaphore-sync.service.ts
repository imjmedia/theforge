import { Injectable, Logger } from "@nestjs/common";
import { ConformanceService } from "../engine/conformance.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { buildSemaphoreInputs } from "../ai-analysis/estimation/semaphore-inputs.factory.js";
import { liveSemaphoreToDbStatus } from "../ai-analysis/estimation/live-semaphore-status.util.js";
import type { SemaphoreStatusLive } from "../ai-analysis/estimation/estimation.types.js";
import { ProjectEstimationRecalcService } from "./project-estimation-recalc.service.js";
import { EstimationService } from "../ai-analysis/estimation/estimation.service.js";

export type StageSemaphoreSyncResult = {
  status: SemaphoreStatusLive;
  precisionScore: number;
  changed: boolean;
} | null;

@Injectable()
export class StageSemaphoreSyncService {
  private readonly logger = new Logger(StageSemaphoreSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conformance: ConformanceService,
    private readonly estimation: EstimationService,
    private readonly estimationRecalc: ProjectEstimationRecalcService,
  ) {}

  /**
   * Único escritor de `Stage.status` / `precisionScore` desde contenido persistido (CAS por `updatedAt`).
   */
  async syncFromPersisted(
    projectId: string,
    stageId: string,
    opts?: { reason?: string; content?: string; auditorGaps?: import("../ai-analysis/estimation/estimation.types.js").AuditorGaps },
  ): Promise<StageSemaphoreSyncResult> {
    const started = Date.now();
    const pid = projectId.trim();
    const sid = stageId.trim();
    if (!pid || !sid) return null;

    const content =
      opts?.content ??
      (await this.prisma.stage.findUnique({ where: { id: sid }, select: { mddContent: true } }))?.mddContent ??
      "";
    const auditorGaps =
      opts?.auditorGaps ??
      (await this.estimation.resolveAuditorGapsForPersisted(pid, sid, content));

    const run = async (): Promise<StageSemaphoreSyncResult | null> => {
      const built = await buildSemaphoreInputs(this.prisma, this.conformance, {
        projectId: pid,
        stageId: sid,
        content,
        source: "persisted",
        auditorGaps,
      });
      const { verdict, inputsHash } = built;
      const liveStatus = verdict.status as SemaphoreStatusLive;
      const precisionScore = Math.min(100, Math.max(0, Math.round(verdict.headline)));
      const dbStatus = liveSemaphoreToDbStatus(liveStatus);

      const stageRow = await this.prisma.stage.findUnique({
        where: { id: sid },
        select: { status: true, precisionScore: true, updatedAt: true, shortTermContext: true },
      });
      if (!stageRow) return null;

      const unchanged =
        stageRow.status === dbStatus && stageRow.precisionScore === precisionScore;
      if (unchanged) {
        return { status: liveStatus, precisionScore, changed: false };
      }

      const shortTermContext = (stageRow.shortTermContext ?? {}) as Record<string, unknown>;
      const nextContext = {
        ...shortTermContext,
        semaphoreSync: {
          version: 1,
          inputsHash,
          computedAt: new Date().toISOString(),
        },
      };

      const updated = await this.prisma.stage.updateMany({
        where: { id: sid, updatedAt: stageRow.updatedAt },
        data: {
          status: dbStatus,
          precisionScore,
          shortTermContext: nextContext as object,
        },
      });

      if (updated.count === 0) {
        this.logger.warn(
          `[Semaphore] cas-miss projectId=${pid} stageId=${sid} reason=${opts?.reason ?? "sync"}`,
        );
        return null;
      }

      const project = await this.prisma.project.findUnique({
        where: { id: pid },
        select: { infraContent: true },
      });
      await this.estimationRecalc.recalcAndUpsert(sid, {
        mddContent: content || null,
        infraContent: project?.infraContent ?? null,
        status: dbStatus,
      });

      this.logger.log(
        `[Semaphore] projectId=${pid} stageId=${sid} source=persisted status=${liveStatus} headline=${verdict.headline} headlineSource=${verdict.headlineSource} phase=${verdict.phase} derivativesState=${verdict.derivativesState} reasons=${verdict.reasons.length} changed=true durationMs=${Date.now() - started} reason=${opts?.reason ?? "sync"}`,
      );

      return { status: liveStatus, precisionScore, changed: true };
    };

    const first = await run();
    if (first !== null) return first;
    return (await run()) ?? null;
  }
}
