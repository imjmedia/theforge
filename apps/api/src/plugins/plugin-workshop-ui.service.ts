import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import { PluginInstallService } from "./plugin-install.service.js";
import { THEFORGE_PLUGIN_MANIFEST_FILENAME } from "@theforge/shared-types";
import { parsePluginManifest } from "./plugin-packaging.util.js";

@Injectable()
export class PluginWorkshopUiService {
  constructor(private readonly pluginInstall: PluginInstallService) {}

  readAsset(pluginId: string, filename: string): Buffer {
    const safeName = basename(filename);
    if (!safeName || safeName !== filename || safeName.includes("..")) {
      throw new ForbiddenException("Nombre de archivo inválido");
    }

    const pluginDir = join(
      this.pluginInstall.getPluginsDirectory(),
      this.folderNameForPlugin(pluginId),
    );
    const manifestPath = join(pluginDir, THEFORGE_PLUGIN_MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      throw new NotFoundException(`Plugin '${pluginId}' no instalado`);
    }

    const manifest = parsePluginManifest(
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    );
    const entry = manifest.workshopUi?.entry?.trim();
    if (!entry) {
      throw new NotFoundException(
        `Plugin '${pluginId}' no declara workshopUi en el manifest`,
      );
    }

    const entryName = basename(normalize(entry));
    if (safeName !== entryName) {
      throw new NotFoundException(
        `Archivo workshop UI no permitido: ${safeName}`,
      );
    }

    const assetPath = join(pluginDir, entry);
    if (!existsSync(assetPath)) {
      throw new NotFoundException(
        `Bundle workshop UI no encontrado para '${pluginId}'`,
      );
    }

    return readFileSync(assetPath);
  }

  private folderNameForPlugin(pluginId: string): string {
    return pluginId.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
}
