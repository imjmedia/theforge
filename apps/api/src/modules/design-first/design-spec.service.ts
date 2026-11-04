import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Project, Stage } from "@theforge/database";
import {
  assertDesignSpecWithinLimits,
  EMPTY_DESIGN_SPEC,
  evaluateDesignFirstPhaseGates,
  parseDesignSpec,
  projectArchitectureGraphSchema,
  validateDesignSpecI1,
  validateDesignSpecI2,
  validateDesignSpecI3,
  type DesignSpec,
  type PutDesignDataNeedsBody,
  type PutDesignScreensBody,
  type ProjectArchitectureGraph,
} from "@theforge/shared-types";
import { hashDesignSpec } from "@theforge/shared-types/design-spec-hash.node";
import { isDesignFirst } from "@theforge/shared-types";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "../projects/project-access.util.js";
import { pickPrimaryStage } from "../projects/stage-helpers.js";
import {
  designFirstMaxSpecBytes,
  isDesignFirstEnabled,
} from "./design-first.config.js";
import {
  throwDesignFirstNotAllowed,
  throwDesignFirstWritesDisabled,
  throwDesignInvariantIssues,
  throwDesignRevisionConflict,
  throwDesignScreenReferences,
  throwDesignSpecTooLarge,
} from "./design-first.errors.js";
import { deriveDomainInventoryFromDesignSpec } from "./derive-domain-inventory.util.js";

type StageRow = Stage & {
  designSpec: unknown;
  designSpecRevision: number;
  architectureGraph: unknown;
  architectureGraphSourceHash: string | null;
  mddUpstreamBaseline: unknown;
};

@Injectable()
export class DesignSpecReader {
  constructor(private readonly prisma: PrismaService) {}

  async loadPrimaryStage(projectId: string, stageId?: string | null): Promise<{
    project: Project;
    stage: StageRow;
  }> {
    const project = await loadAccessibleProjectWithStages(this.prisma, projectId);
    if (!isDesignFirst(project.projectType)) {
      throwDesignFirstNotAllowed();
    }
    const stage = (stageId
      ? project.stages.find((s) => s.id === stageId)
      : pickPrimaryStage(project.stages)) as StageRow | undefined;
    if (!stage) {
      throw new Error("Etapa no encontrada");
    }
    return { project, stage };
  }
}

@Injectable()
export class DesignSpecService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reader: DesignSpecReader,
  ) {}

  private parseStageSpec(stage: StageRow): DesignSpec {
    const raw = stage.designSpec ?? EMPTY_DESIGN_SPEC;
    return parseDesignSpec(raw);
  }

  private parsePag(stage: StageRow): ProjectArchitectureGraph | undefined {
    if (!stage.architectureGraph) return undefined;
    const parsed = projectArchitectureGraphSchema.safeParse(stage.architectureGraph);
    return parsed.success ? parsed.data : undefined;
  }

  computeStale(spec: DesignSpec, stage: StageRow): boolean {
    const currentHash = hashDesignSpec(spec);
    if (!stage.architectureGraphSourceHash) return false;
    return stage.architectureGraphSourceHash !== currentHash;
  }

  buildReadResponse(projectId: string, stageId?: string | null) {
    return this.reader.loadPrimaryStage(projectId, stageId).then(({ stage }) => {
      const designSpec = this.parseStageSpec(stage);
      const designSpecHash = hashDesignSpec(designSpec);
      const pag = this.parsePag(stage);
      const gates = evaluateDesignFirstPhaseGates({
        designSpec,
        pag,
        designSpecHash,
        architectureGraphSourceHash: stage.architectureGraphSourceHash,
      });
      return {
        designSpec,
        revision: stage.designSpecRevision,
        gates,
        designSpecHash,
        architectureGraphSourceHash: stage.architectureGraphSourceHash,
        stale: this.computeStale(designSpec, stage),
      };
    });
  }

  private assertWritesAllowed(): void {
    if (!isDesignFirstEnabled(this.config)) {
      throwDesignFirstWritesDisabled();
    }
  }

  private assertSpecLimits(spec: DesignSpec): void {
    const maxBytes = designFirstMaxSpecBytes(this.config);
    try {
      assertDesignSpecWithinLimits(spec, maxBytes);
    } catch (e) {
      const actual = e instanceof Error && "actualBytes" in e ? Number((e as { actualBytes: number }).actualBytes) : 0;
      throwDesignSpecTooLarge(maxBytes, actual);
    }
  }

  private collectScreenReferences(spec: DesignSpec, screenId: string): string[] {
    const refs: string[] = [];
    for (const edge of spec.navigation) {
      if (edge.from === screenId) refs.push(`navigation:${edge.id}:from`);
      if (edge.to === screenId) refs.push(`navigation:${edge.id}:to`);
    }
    for (const entry of spec.dataNeeds) {
      if (entry.screenId === screenId) refs.push(`dataNeeds:screenId=${screenId}`);
    }
    return refs;
  }

  private applyCascadeRemoveScreen(spec: DesignSpec, removedIds: Set<string>): DesignSpec {
    return {
      ...spec,
      screens: spec.screens.filter((s) => !removedIds.has(s.id)),
      navigation: spec.navigation.filter((n) => !removedIds.has(n.from) && !removedIds.has(n.to)),
      dataNeeds: spec.dataNeeds.filter((d) => !removedIds.has(d.screenId)),
    };
  }

  async updateScreens(projectId: string, body: PutDesignScreensBody, stageId?: string | null) {
    this.assertWritesAllowed();
    const { stage } = await this.reader.loadPrimaryStage(projectId, stageId);
    if (body.revision !== stage.designSpecRevision) {
      throwDesignRevisionConflict(stage.designSpecRevision);
    }

    const current = this.parseStageSpec(stage);
    const removed = current.screens.filter((s) => !body.screens.some((n) => n.id === s.id));
    let nextSpec: DesignSpec = {
      ...current,
      screens: body.screens,
      navigation: body.navigation,
    };

    if (removed.length > 0 && !body.cascade) {
      for (const screen of removed) {
        const refs = this.collectScreenReferences(current, screen.id);
        if (refs.length) throwDesignScreenReferences(screen.id, refs, false);
      }
    }
    if (removed.length > 0 && body.cascade) {
      nextSpec = this.applyCascadeRemoveScreen(nextSpec, new Set(removed.map((s) => s.id)));
    }

    const i1 = validateDesignSpecI1(nextSpec);
    if (i1.length) throwDesignInvariantIssues(i1);

    this.assertSpecLimits(nextSpec);

    const updateData: Record<string, unknown> = {
      designSpec: nextSpec,
      designSpecRevision: { increment: 1 },
    };
    const gates = evaluateDesignFirstPhaseGates({ designSpec: nextSpec });
    if (gates.phase2.ok) {
      updateData.domainInventory = deriveDomainInventoryFromDesignSpec(nextSpec);
    }

    const result = await this.prisma.stage.updateMany({
      where: { id: stage.id, designSpecRevision: body.revision },
      data: updateData,
    });
    if (result.count === 0) {
      const fresh = await this.prisma.stage.findUnique({
        where: { id: stage.id },
        select: { designSpecRevision: true },
      });
      throwDesignRevisionConflict(fresh?.designSpecRevision ?? body.revision);
    }

    return this.buildReadResponse(projectId, stage.id);
  }

  async updateDataNeeds(projectId: string, body: PutDesignDataNeedsBody, stageId?: string | null) {
    this.assertWritesAllowed();
    const { stage } = await this.reader.loadPrimaryStage(projectId, stageId);
    if (body.revision !== stage.designSpecRevision) {
      throwDesignRevisionConflict(stage.designSpecRevision);
    }

    const current = this.parseStageSpec(stage);
    const nextSpec: DesignSpec = {
      ...current,
      entities: body.entities,
      dataNeeds: body.dataNeeds,
    };

    const issues = [...validateDesignSpecI2(nextSpec), ...validateDesignSpecI3(nextSpec)];
    if (issues.length) throwDesignInvariantIssues(issues);

    this.assertSpecLimits(nextSpec);

    const updateData: Record<string, unknown> = {
      designSpec: nextSpec,
      designSpecRevision: { increment: 1 },
    };
    const gates = evaluateDesignFirstPhaseGates({ designSpec: nextSpec });
    if (gates.phase2.ok) {
      updateData.domainInventory = deriveDomainInventoryFromDesignSpec(nextSpec);
    }

    const result = await this.prisma.stage.updateMany({
      where: { id: stage.id, designSpecRevision: body.revision },
      data: updateData,
    });
    if (result.count === 0) {
      const fresh = await this.prisma.stage.findUnique({
        where: { id: stage.id },
        select: { designSpecRevision: true },
      });
      throwDesignRevisionConflict(fresh?.designSpecRevision ?? body.revision);
    }

    return this.buildReadResponse(projectId, stage.id);
  }
}
