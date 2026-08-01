import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@theforge/database";
import type { ArtifactTypeDefinition, PluginArtifactContext, PluginArtifactProgress, PluginExportContext, PluginLlmRuntime } from "@theforge/shared-types";
import { getRequestUserId } from "../common/request-user.store.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PluginDocumentPipelineService } from "./plugin-document-pipeline.service.js";
import { PluginLoaderService } from "./plugin-loader.service.js";
import {
  buildProjectHookContextFromStages,
  projectMeetsArtifactRequirements,
} from "./plugin-project-context.util.js";
import { PluginUserSettingsService } from "./plugin-user-settings.service.js";
import { UserProvidersService } from "../modules/user-providers/user-providers.service.js";

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
    private readonly userProviders: UserProvidersService,
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
    const llmRuntime = await this.resolvePluginLlmRuntime(userId);
    const started = Date.now();

    const ctx: PluginArtifactContext = {
      pluginId,
      artifactId,
      projectId,
      userId,
      stageId: options?.stageId ?? null,
      deliverables,
      userSettings,
      llmRuntime,
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

  async export(
    projectId: string,
    pluginId: string,
    artifactId: string,
    format: "pptx" | "pdf",
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    this.resolveArtifactDefinition(pluginId, artifactId);
    const plugin = this.pluginLoader.getPlugin(pluginId);
    if (!plugin?.exportArtifact) {
      throw new BadRequestException(
        `El plugin '${pluginId}' no implementa exportArtifact`,
      );
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { pluginData: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    const pluginData = (project.pluginData as Record<string, unknown>) ?? {};
    const data = pluginData[pluginId];
    if (data == null) {
      throw new NotFoundException(
        `No hay datos persistidos para el plugin '${pluginId}' en este proyecto`,
      );
    }

    const userId = getRequestUserId();
    const userSettings = await this.pluginUserSettings.getForPlugin(userId, pluginId);

    const ctx: PluginExportContext = {
      pluginId,
      artifactId,
      projectId,
      userId,
      data,
      format,
      userSettings,
    };

    const result = await plugin.exportArtifact(ctx);
    const raw = result.data ?? (result as { buffer?: Buffer }).buffer;
    if (!raw) {
      throw new BadRequestException("El plugin no devolvió datos de exportación");
    }
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    return {
      data: buffer,
      filename: result.filename,
      mimeType: result.mimeType,
    };
  }

  /** Runtime BYOK/tenant del usuario — plugins lo usan si no tienen claves en env. */
  private async resolvePluginLlmRuntime(userId: string): Promise<PluginLlmRuntime | undefined> {
    if (!userId?.trim()) return undefined;
    try {
      const runtime = await this.userProviders.resolveRuntime(userId.trim());
      const imageRuntime = await this.userProviders.resolveImageRuntime(userId.trim());
      return {
        providerId: runtime.providerId,
        model: runtime.chatModel,
        apiKey: runtime.apiKey,
        baseURL: runtime.baseURL,
        imageModel: imageRuntime?.imageModel ?? runtime.imageModel ?? null,
      };
    } catch {
      return undefined;
    }
  }
}
