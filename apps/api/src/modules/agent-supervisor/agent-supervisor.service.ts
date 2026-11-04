import { Injectable, NotFoundException } from "@nestjs/common";
import {
  EpisodicMemoryKind,
  Prisma,
  StageStatus,
  type EpisodicMemory,
  type Project,
  type Stage,
} from "@theforge/database";
import { PrismaService } from "../../prisma/prisma.service.js";
import { isLegacy, ProjectTypeEnum, type ProjectType } from "@theforge/shared-types";
import { pickPrimaryStage } from "../projects/stage-helpers.js";
import type {
  AgentDelegate,
  AgentToolsProfile,
  SupervisorFlow,
  SupervisorRouteResult,
} from "./agent-supervisor.types.js";

const DEFAULT_STAGE_KEY = "main";

type ProjectWithStages = Project & { stages: Stage[] };

@Injectable()
export class AgentSupervisorService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Resuelve el camino agéntico: proyectos nuevos → arquitecto MDD / Grafo SDD;
   * legacy → coordinador con herramientas TheForge + SDD.
   * Garantiza una `Stage` activa (crea la default si faltara en proyectos antiguos).
   */
  async resolveRoute(projectId: string): Promise<SupervisorRouteResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        stages: { orderBy: { ordinal: "asc" } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");
    return this.buildRoute(project);
  }

  /**
   * Misma lógica que `resolveRoute` sin query extra (proyecto ya cargado con `stages`).
   * @param preferredStageId — si coincide con una etapa del proyecto, se usa como foco (chat / tools).
   */
  async resolveRouteFromProject(
    project: ProjectWithStages,
    preferredStageId?: string | null,
  ): Promise<SupervisorRouteResult> {
    return this.buildRoute(project, preferredStageId);
  }

  private async buildRoute(
    project: ProjectWithStages,
    preferredStageId?: string | null,
  ): Promise<SupervisorRouteResult> {
    let stage: Stage | undefined;
    if (preferredStageId?.trim()) {
      stage = project.stages.find((s) => s.id === preferredStageId.trim());
    }
    if (!stage) {
      stage = await this.ensurePrimaryStage(project);
    }

    const isLegacy = stage.isLegacy;
    const theforgeProjectId = stage.theforgeProjectId ?? project.theforgeProjectId ?? null;

    const flow: SupervisorFlow = isLegacy
      ? ProjectTypeEnum.enum.LEGACY
      : ProjectTypeEnum.enum.NEW;
    const delegate: AgentDelegate = isLegacy ? "legacy_coordinator" : "software_architect";
    const toolsProfile: AgentToolsProfile = isLegacy ? "sdd_and_theforge" : "sdd_only";

    return {
      projectId: project.id,
      flow,
      stageId: stage.id,
      isLegacy,
      theforgeProjectId,
      delegate,
      toolsProfile,
    };
  }

  private async ensurePrimaryStage(project: ProjectWithStages) {
    if (project.stages.length > 0) {
      return pickPrimaryStage(project.stages) ?? project.stages[0];
    }
    return this.prisma.stage.create({
      data: {
        projectId: project.id,
        ordinal: 1,
        key: DEFAULT_STAGE_KEY,
        name: "Etapa principal",
        workflowStatus: StageStatus.ACTIVE,
        isLegacy: isLegacy(project.projectType as ProjectType),
        theforgeProjectId: project.theforgeProjectId,
      },
    });
  }

  /** Memoria de trabajo (STM) por etapa — sobrescribe el scratch del agente. */
  async setShortTermContext(
    stageId: string,
    context: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.stage.update({
      where: { id: stageId },
      data: { shortTermContext: context },
    });
  }

  /** Añade un episodio a la memoria larga (Reflexion, ADRs, rechazos del Evaluator). */
  async appendEpisodicMemory(
    stageId: string,
    kind: EpisodicMemoryKind,
    content: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<EpisodicMemory> {
    return this.prisma.episodicMemory.create({
      data: {
        stageId,
        kind,
        content,
        metadata: metadata ?? undefined,
      },
    });
  }

  /** Últimos episodios para inyectar en el prompt (orden cronológico). */
  async getRecentEpisodicMemory(stageId: string, take = 20): Promise<EpisodicMemory[]> {
    return this.prisma.episodicMemory.findMany({
      where: { stageId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }
}
