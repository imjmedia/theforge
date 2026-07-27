import { Injectable, NotFoundException } from "@nestjs/common";
import { ComplexityLevel, StageStatus } from "@theforge/database";
import type { Estimation, Project, Stage } from "@theforge/database";
import { getRequestUserId } from "../../common/request-user.store.js";
import {
  cloneProjectBodySchema,
  createProjectSchema,
  type CreateProjectDto,
} from "@theforge/shared-types";
import { TheForgeService } from "../theforge/theforge.service.js";
import { PluginDocumentPipelineService } from "../../plugins/plugin-document-pipeline.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { loadAccessibleProjectWithStages } from "./project-access.util.js";
import {
  buildProjectCloneCreateInput,
  resolveCloneProjectOptions,
  type ProjectCloneSource,
} from "./project-clone.util.js";
import { ProjectGroupsService } from "../project-groups/project-groups.service.js";
import { toApiProject } from "./project-api.util.js";

type StageWithEst = Stage & { estimation: Estimation | null };

@Injectable()
export class ProjectLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly theforge: TheForgeService,
    private readonly pluginPipeline: PluginDocumentPipelineService,
    private readonly projectGroups: ProjectGroupsService,
  ) {}

  async create(data: CreateProjectDto) {
    const parsed = createProjectSchema.parse(data);
    const isLegacy = parsed.projectType === "LEGACY";
    const userId = getRequestUserId();
    const defaultGroupId = await this.projectGroups.getDefaultGroupId();
    let groupId = defaultGroupId;
    if (parsed.groupId) {
      const targetGroup = await this.prisma.projectGroup.findUnique({
        where: { id: parsed.groupId },
        select: { id: true },
      });
      if (!targetGroup) throw new NotFoundException("Grupo no encontrado");
      groupId = parsed.groupId;
    }
    const created = await this.prisma.project.create({
      data: {
        userId,
        groupId,
        name: parsed.name,
        visibility: parsed.visibility ?? "PRIVATE",
        hasUxTeam: parsed.hasUxTeam ?? false,
        complexity: parsed.complexity as ComplexityLevel,
        projectType: parsed.projectType,
        theforgeProjectId: parsed.theforgeProjectId ?? undefined,
        stages: {
          create: {
            ordinal: 1,
            key: "main",
            name: "Etapa principal",
            workflowStatus: StageStatus.ACTIVE,
            isLegacy,
            theforgeProjectId: parsed.theforgeProjectId ?? null,
          },
        },
      },
      include: {
        stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } },
        group: { select: { name: true } },
      },
    });

    const apiProject = toApiProject(created);

    void this.pluginPipeline.runOnProjectCreate({
      projectId: created.id,
      projectName: created.name,
      userId,
      timestamp: new Date(),
    });

    if (isLegacy && parsed.theforgeProjectId?.trim()) {
      const stage = created.stages[0];
      this.theforge.scheduleAriadneBrownfieldWire(
        {
          ariadneSourceId: parsed.theforgeProjectId.trim(),
          workshopProjectId: created.id,
          workshopStageId: stage?.id ?? "",
        },
        "Projects",
      );
    }

    return apiProject;
  }

  /**
   * Deep-clones project documents and all stages into a new project owned by the current user.
   * Does not copy sessions, chat, favorites, integration links, webhooks, or suite lineage.
   */
  async cloneProject(sourceId: string, body: unknown) {
    const parsed = cloneProjectBodySchema.parse(body ?? {});
    const source = (await loadAccessibleProjectWithStages(this.prisma, sourceId)) as ProjectCloneSource &
      Project & { stages: StageWithEst[] };
    const userId = getRequestUserId();
    const options = resolveCloneProjectOptions(source, parsed);

    const created = await this.prisma.project.create({
      data: buildProjectCloneCreateInput(source, { userId, ...options }),
      include: {
        stages: { orderBy: { ordinal: "asc" }, include: { estimation: true } },
        group: { select: { name: true } },
      },
    });

    return {
      ...toApiProject(created),
      clonedFromProjectId: sourceId,
    };
  }
}
