import type { Response } from "express";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
  forwardRef,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PluginLoaderService } from "../../plugins/plugin-loader.service.js";
import { PluginArtifactService } from "../../plugins/plugin-artifact.service.js";
import { PluginUserSettingsService } from "../../plugins/plugin-user-settings.service.js";
import { PluginInstallService } from "../../plugins/plugin-install.service.js";
import { DeliverablesQueueService } from "../projects/deliverables-queue.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { getRequestUserId } from "../../common/request-user.store.js";
import { requireAdmin } from "../../common/guards/role.helpers.js";
import type {
  PluginInstallRequestBody,
  PluginProvisionRequestBody,
} from "@theforge/shared-types";
import type { Prisma } from "@theforge/database";

@Controller("plugins")
export class PluginsController {
  constructor(
    private readonly pluginLoader: PluginLoaderService,
    private readonly pluginArtifact: PluginArtifactService,
    private readonly pluginUserSettings: PluginUserSettingsService,
    private readonly pluginInstall: PluginInstallService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DeliverablesQueueService))
    private readonly deliverablesQueue: DeliverablesQueueService,
  ) {}

  @Get("artifacts")
  getArtifacts() {
    return this.pluginLoader.getArtifactTypes();
  }

  @Get("health")
  getHealth() {
    return this.pluginLoader.getHealthSnapshot();
  }

  @Get("installed")
  getInstalled() {
    return this.pluginInstall.listInstalled();
  }

  @Get("settings-panels")
  getSettingsPanels() {
    return this.pluginLoader.getSettingsPanels();
  }

  @Post("install")
  @UseInterceptors(FileInterceptor("file"))
  async installPlugin(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: PluginInstallRequestBody,
  ) {
    requireAdmin();

    if (file?.buffer?.length) {
      return this.pluginInstall.installFromBuffer(file.buffer);
    }

    if (body?.downloadUrl?.trim()) {
      return this.pluginInstall.installFromUrl(body.downloadUrl.trim());
    }

    if (body?.licenseKey?.trim()) {
      return this.pluginInstall.installFromLicensePortal(
        body.licenseKey.trim(),
        body.pluginId?.trim(),
      );
    }

    throw new BadRequestException(
      "Envía un archivo .tfplugin (multipart field 'file') o downloadUrl / licenseKey en JSON",
    );
  }

  @Post("provision")
  async provisionPlugin(@Body() body: PluginProvisionRequestBody) {
    requireAdmin();
    return this.pluginInstall.provision(body);
  }

  @Delete("installed/:pluginId")
  async uninstallPlugin(@Param("pluginId") pluginId: string) {
    requireAdmin();
    return this.pluginInstall.uninstall(decodeURIComponent(pluginId));
  }

  @Post("reload")
  async reloadPlugins() {
    requireAdmin();
    return this.pluginInstall.reloadAll();
  }

  @Get("user-settings")
  async getAllUserSettings() {
    return this.pluginUserSettings.getAllForUser(getRequestUserId());
  }

  @Get("projects/:id/plugin-data/:pluginId")
  async getPluginData(
    @Param("id") id: string,
    @Param("pluginId") pluginId: string,
    @Res() res: Response,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { pluginData: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    const data = project.pluginData as Record<string, unknown> | null;
    return res.status(200).json(data?.[pluginId] ?? null);
  }

  @Put("projects/:id/plugin-data/:pluginId")
  async setPluginData(
    @Param("id") id: string,
    @Param("pluginId") pluginId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { pluginData: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    const current = (project.pluginData as Record<string, unknown>) ?? {};
    current[pluginId] = body;

    await this.prisma.project.update({
      where: { id },
      data: { pluginData: current as Prisma.InputJsonValue },
    });
    return body;
  }

  @Post("projects/:id/generate/:pluginId/:artifactId")
  async generatePluginArtifact(
    @Param("id") projectId: string,
    @Param("pluginId") pluginId: string,
    @Param("artifactId") artifactId: string,
    @Body() body: { queue?: boolean; stageId?: string | null },
  ) {
    this.pluginArtifact.resolveArtifactDefinition(pluginId, artifactId);

    if (body?.queue !== false && this.deliverablesQueue.isEnabled()) {
      const jobId = await this.deliverablesQueue.enqueue({
        type: "plugin-artifact",
        projectId,
        userId: getRequestUserId(),
        pluginId,
        artifactId,
        stageId: body?.stageId ?? undefined,
      });
      return { queued: true, jobId };
    }

    const result = await this.pluginArtifact.generate(projectId, pluginId, artifactId, {
      stageId: body?.stageId ?? null,
    });
    return { queued: false, ...result };
  }

  @Get(":pluginId/user-settings")
  async getUserSettings(@Param("pluginId") pluginId: string) {
    const plugin = this.ensurePluginLoaded(pluginId);
    const stored = await this.pluginUserSettings.getForPlugin(
      getRequestUserId(),
      pluginId,
    );
    if (plugin.hydrateUserSettings) {
      return plugin.hydrateUserSettings(stored);
    }
    return stored;
  }

  @Put(":pluginId/user-settings")
  async saveUserSettings(
    @Param("pluginId") pluginId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const plugin = this.ensurePluginLoaded(pluginId);
    const userId = getRequestUserId();

    const stored = await this.pluginUserSettings.getForPlugin(userId, pluginId);
    const merged = { ...stored, ...(body ?? {}) };

    let normalized = merged;
    if (plugin.validateUserSettings) {
      try {
        normalized = await plugin.validateUserSettings(merged);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(msg);
      }
    }

    if ("licenseKey" in normalized) {
      delete normalized.licenseKey;
    }

    const saved = await this.pluginUserSettings.saveForPlugin(userId, pluginId, normalized);

    if (plugin.onUserSettingsSaved) {
      await plugin.onUserSettingsSaved(merged, { userId });
    }

    if (plugin.hydrateUserSettings) {
      return plugin.hydrateUserSettings(saved);
    }
    return saved;
  }

  private ensurePluginLoaded(pluginId: string) {
    const plugin = this.pluginLoader.getPluginForSettings(pluginId);
    if (!plugin) {
      throw new NotFoundException(`Plugin '${pluginId}' is not loaded`);
    }
    const panels = this.pluginLoader.getSettingsPanels();
    if (!panels.some((p) => p.pluginId === pluginId)) {
      throw new BadRequestException(`Plugin '${pluginId}' does not expose user settings`);
    }
    return plugin;
  }
}
