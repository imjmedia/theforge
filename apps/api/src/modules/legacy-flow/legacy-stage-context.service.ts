import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
} from "@nestjs/common";
import { getLegacyChangeState } from "@theforge/shared-types";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ProjectsService } from "../projects/projects.service.js";
import { TheForgeService } from "../theforge/theforge.service.js";
import {
  gatherLegacyIndexSignals,
  legacyIndexHasUsableGraphEvidence,
  type LegacyIndexSignalsGathered,
} from "../theforge/theforge-evidence-context.util.js";
import { buildSddStageSnapshotFromMdd } from "../engine/mdd-coherence/mdd-coherence.util.js";
import { evaluateLegacyIndexSddGate } from "./legacy-index-sdd-alignment.util.js";
import { isLegacyBaselineStage, pickPrimaryStage } from "../projects/stage-helpers.js";
import { isLegacySddIndexGateEnabled } from "./legacy-coordinator.util.js";
import type { LegacyFlowState } from "./legacy-coordinator.types.js";

@Injectable()
export class LegacyStageContextService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
    private readonly theforge: TheForgeService,
  ) {}

  async getLegacyProject(projectId: string) {
    const project = await this.projects.findOne(projectId);
    const pt = (project as { projectType?: string }).projectType;
    if (pt !== "LEGACY") {
      throw new BadRequestException("El flujo legacy solo aplica a proyectos con projectType LEGACY.");
    }
    const theforgeId = (project as { theforgeProjectId?: string | null }).theforgeProjectId;
    if (!theforgeId?.trim()) {
      throw new BadRequestException("El proyecto legacy debe tener theforgeProjectId configurado.");
    }
    return { project, theforgeId };
  }

  async resolveLegacyGateStage(projectId: string) {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!row?.stages?.length) return null;
    const legacyMarked = row.stages.filter((s) => s.isLegacy);
    const pool = legacyMarked.length > 0 ? legacyMarked : row.stages;
    const picked = pickPrimaryStage(pool);
    if (!picked?.id) return null;
    return this.prisma.stage.findUnique({ where: { id: picked.id } });
  }

  readLegacyChangeState(stage: { legacyChangeState?: unknown } | null): LegacyFlowState {
    return getLegacyChangeState(stage) as LegacyFlowState;
  }

  async persistLegacyChangeState(_projectId: string, stageId: string, state: LegacyFlowState): Promise<void> {
    await this.prisma.stage.update({
      where: { id: stageId },
      data: { legacyChangeState: state as object },
    });
  }

  /** No-op: FalkorDB legacy stage sync retirado. */
  async syncCurrentLegacyStageToGraph(_projectId: string, _stageId: string): Promise<void> {
    return;
  }

  async assertLegacyIndexSddGate(
    projectId: string,
    theforgeId: string,
    legacyState: LegacyFlowState,
    options?: { semanticQueries?: readonly string[] },
  ): Promise<LegacyIndexSignalsGathered | null> {
    if (!isLegacySddIndexGateEnabled()) return null;
    if (this.hasLegacyIndexSddResolution(legacyState)) return null;

    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    const stage = row?.stages?.length ? pickPrimaryStage(row.stages) : undefined;
    const stageId = stage?.id;
    if (!stageId?.trim()) return null;

    const mddMarkdown = stage?.mddContent?.trim() ?? "";
    if (!mddMarkdown) return null;

    const snapshot = buildSddStageSnapshotFromMdd(mddMarkdown);

    const gathered = await gatherLegacyIndexSignals(this.theforge, theforgeId, {
      semanticQueries: options?.semanticQueries,
    });
    const hasUsable = legacyIndexHasUsableGraphEvidence(gathered.semanticChunks, gathered.chosenPaths);
    const indexBlobLower = [gathered.mergedSemantic, ...gathered.chosenPaths, ...gathered.semanticChunks]
      .join("\n")
      .toLowerCase();

    const gate = evaluateLegacyIndexSddGate(
      {
        semanticChunks: gathered.semanticChunks,
        chosenPaths: gathered.chosenPaths,
        indexBlobLower,
      },
      snapshot,
      hasUsable,
    );

    if (!gate.blocking) return gathered;

    throw new ConflictException({
      code: "LEGACY_INDEX_SDD_MISMATCH",
      message: gate.summary,
      gate,
    });
  }

  private hasLegacyIndexSddResolution(state: LegacyFlowState): boolean {
    const r = state.legacyIndexSddResolution;
    return typeof r?.choice === "string" && typeof r?.resolvedAt === "string" && r.resolvedAt.length > 0;
  }
}

export { isLegacyBaselineStage };
