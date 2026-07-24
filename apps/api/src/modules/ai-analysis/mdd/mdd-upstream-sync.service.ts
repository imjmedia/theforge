import { Injectable, Logger, NotFoundException, forwardRef, Inject } from "@nestjs/common";
import {
  analyzeMddUpstreamChanges,
  buildMddUpstreamBaseline,
} from "@theforge/shared-types/mdd-upstream-sync-node";
import {
  buildUpstreamChangeSummaryForPipeline,
  expandMddSectionsForSync,
  toMddUpstreamSyncStatus,
  type MddUpstreamBaseline,
  type MddUpstreamSyncAnalysis,
} from "@theforge/shared-types";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { pickPrimaryStage } from "../../projects/stage-helpers.js";
import { ProjectsService } from "../../projects/projects.service.js";

function parseBaseline(raw: unknown): MddUpstreamBaseline | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.capturedAt !== "string" || typeof o.dbgaContentHash !== "string") return null;
  return raw as MddUpstreamBaseline;
}

@Injectable()
export class MddUpstreamSyncService {
  private readonly logger = new Logger(MddUpstreamSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
  ) {}

  async loadUpstreamDocuments(projectId: string, stageId?: string | null): Promise<{
    stageId: string;
    dbgaContent: string;
    brdContent: string;
    benchmarkContent: string;
    mddContent: string;
    baseline: MddUpstreamBaseline | null;
  }> {
    const project = await this.projects.findOne(projectId);
    const stages = (project as { stages?: Array<Record<string, unknown>> }).stages ?? [];
    const stageRaw =
      (stageId?.trim() && stages.find((s) => String(s.id ?? "") === stageId.trim())) ||
      pickPrimaryStage(stages as Parameters<typeof pickPrimaryStage>[0]);
    const stage = stageRaw as {
      id?: string;
      brdContent?: string | null;
      phase0SummaryContent?: string | null;
      mddContent?: string | null;
      mddUpstreamBaseline?: unknown;
    } | null | undefined;
    if (!stage?.id) throw new NotFoundException("Etapa no encontrada");

    const dbgaContent = String((project as { dbgaContent?: string }).dbgaContent ?? "");
    const brdContent = String(stage.brdContent ?? "");
    const benchmarkContent = String(
      stage.phase0SummaryContent ?? (project as { phase0SummaryContent?: string }).phase0SummaryContent ?? "",
    );
    const mddContent = String(stage.mddContent ?? "");
    const baseline = parseBaseline(stage.mddUpstreamBaseline);

    return {
      stageId: String(stage.id),
      dbgaContent,
      brdContent,
      benchmarkContent,
      mddContent,
      baseline,
    };
  }

  async tryRestoreFromUpstreamCache(
    projectId: string,
    stageId?: string | null,
  ): Promise<{
    canRestore: boolean;
    analysis: MddUpstreamSyncAnalysis;
    mddContent: string;
    stageId: string;
  }> {
    const docs = await this.loadUpstreamDocuments(projectId, stageId);
    const analysis = this.analyzeFromDocs(docs);
    const canRestore = analysis.hasMdd && analysis.hasBaseline && !analysis.pendingSync;
    return {
      canRestore,
      analysis,
      mddContent: docs.mddContent,
      stageId: docs.stageId,
    };
  }

  private analyzeFromDocs(docs: Awaited<ReturnType<MddUpstreamSyncService["loadUpstreamDocuments"]>>): MddUpstreamSyncAnalysis {
    return analyzeMddUpstreamChanges({
      baseline: docs.baseline,
      dbgaContent: docs.dbgaContent,
      brdContent: docs.brdContent,
      benchmarkContent: docs.benchmarkContent,
      mddContent: docs.mddContent,
    });
  }

  async analyze(projectId: string, stageId?: string | null): Promise<MddUpstreamSyncAnalysis> {
    const docs = await this.loadUpstreamDocuments(projectId, stageId);
    return this.analyzeFromDocs(docs);
  }

  async captureBaseline(
    projectId: string,
    stageId: string,
  ): Promise<MddUpstreamBaseline> {
    const docs = await this.loadUpstreamDocuments(projectId, stageId);
    const baseline = buildMddUpstreamBaseline({
      dbgaContent: docs.dbgaContent,
      brdContent: docs.brdContent,
      benchmarkContent: docs.benchmarkContent,
      mddContent: docs.mddContent,
    });
    await this.prisma.stage.update({
      where: { id: stageId },
      data: { mddUpstreamBaseline: baseline as object },
    });
    this.logger.log(`Baseline upstream MDD capturado stageId=${stageId} projectId=${projectId}`);
    return baseline;
  }

  /** Captura baseline tras job MDD y devuelve análisis actualizado para la UI. */
  async captureBaselineAndAnalyze(
    projectId: string,
    stageId: string,
  ): Promise<{ baseline: MddUpstreamBaseline; analysis: MddUpstreamSyncAnalysis; syncStatus: ReturnType<typeof toMddUpstreamSyncStatus> }> {
    const baseline = await this.captureBaseline(projectId, stageId);
    const analysis = await this.analyze(projectId, stageId);
    return { baseline, analysis, syncStatus: toMddUpstreamSyncStatus(analysis) };
  }

  buildSyncSummary(analysis: MddUpstreamSyncAnalysis): string {
    return buildUpstreamChangeSummaryForPipeline(analysis);
  }

  normalizeSections(requested: number[] | undefined, analysis: MddUpstreamSyncAnalysis): number[] {
    const base =
      requested?.length && requested.every((n) => n >= 1 && n <= 7)
        ? expandMddSectionsForSync(requested)
        : analysis.expandedSections;
    return base.length ? base : expandMddSectionsForSync(analysis.recommendedSections);
  }
}
