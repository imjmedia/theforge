import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@theforge/database";
import type { ArtifactTypeDefinition, PluginArtifactContext, PluginArtifactProgress } from "@theforge/shared-types";
import { getRequestUserId } from "../common/request-user.store.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PluginDocumentPipelineService } from "./plugin-document-pipeline.service.js";
import { PluginLoaderService } from "./plugin-loader.service.js";
import {
  buildProjectHookContextFromStages,
  projectMeetsArtifactRequirements,
} from "./plugin-project-context.util.js";
import { PluginUserSettingsService } from "./plugin-user-settings.service.js";

export interface GeneratePluginArtifactOptions {
  stageId?: string | null;
  onProgress?: (update: PluginArtifactProgress) => void;
}

export interface GeneratePluginArtifactResult {
  pluginId: string;
  artifactId: string;
  data: unknown;
  metadata?: {
    durationMs?: number;
    tokensUsed?: number;
    provider?: string;
    model?: string;
  };
}

@Injectable()
export class PluginArtifactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginLoader: PluginLoaderService,
    private readonly pluginPipeline: PluginDocumentPipelineService,
    private readonly pluginUserSettings: PluginUserSettingsService,
  ) {}

  resolveArtifactDefinition(
    pluginId: string,
    artifactId: string,
  ): ArtifactTypeDefinition {
    const artifact = this.pluginLoader
      .getArtifactTypes()
      .find((a) => a.pluginId === pluginId && a.id === artifactId);
    if (!artifact) {
      throw new NotFoundException(
        `Artifact '${artifactId}' no registrado para plugin '${pluginId}'`,
      );
    }
    return artifact;
  }

  async generate(
    projectId: string,
    pluginId: string,
    artifactId: string,
    options?: GeneratePluginArtifactOptions,
  ): Promise<GeneratePluginArtifactResult> {
    const artifact = this.resolveArtifactDefinition(pluginId, artifactId);
    const plugin = this.pluginLoader.getPlugin(pluginId);
    if (!plugin?.generateArtifact) {
      throw new BadRequestException(
        `El plugin '${pluginId}' no implementa generateArtifact`,
      );
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    if (!project) throw new NotFoundException("Project not found");

    const deliverables = buildProjectHookContextFromStages(project, project.stages);
    const reqCheck = projectMeetsArtifactRequirements(deliverables, artifact.requires);
    if (!reqCheck.ok) {
      throw new BadRequestException(
        `Faltan entregables requeridos: ${reqCheck.missing.join(", ")}`,
      );
    }

    const userId = getRequestUserId();
    const userSettings = await this.pluginUserSettings.getForPlugin(userId, pluginId);
    const started = Date.now();

    const ctx: PluginArtifactContext = {
      pluginId,
      artifactId,
      projectId,
      userId,
      stageId: options?.stageId ?? null,
      deliverables,
      userSettings,
      timestamp: new Date(),
      reportProgress: options?.onProgress
        ? (update) => {
            try {
              options.onProgress?.(update);
            } catch {
              /* progress must never abort generation */
            }
          }
        : undefined,
    };

    const result = await plugin.generateArtifact(ctx);
    const durationMs = Date.now() - started;
    const metadata = {
      durationMs,
      ...result.metadata,
    };

    const current = (project.pluginData as Record<string, unknown>) ?? {};
    current[pluginId] = result.data;

    await this.prisma.project.update({
      where: { id: projectId },
      data: { pluginData: current as Prisma.InputJsonValue },
    });

    const finalContent =
      typeof result.data === "string" ? result.data : JSON.stringify(result.data);

    await this.pluginPipeline.runAfterDocumentPersist({
      documentType: artifactId,
      projectId,
      finalContent,
      metadata: {
        durationMs: metadata.durationMs ?? durationMs,
        tokensUsed: metadata.tokensUsed,
        provider: metadata.provider ?? "plugin",
        model: metadata.model ?? pluginId,
      },
    });

    return {
      pluginId,
      artifactId,
      data: result.data,
      metadata,
    };
  }
}
