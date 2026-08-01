import { existsSync, readFileSync, renameSync, readdirSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import JSZip from "jszip";
import {
  THEFORGE_PLUGIN_MANIFEST_FILENAME,
  type InstalledPluginRecord,
  type PluginInstallResult,
  type PluginInstalledListResponse,
  type PluginProvisionRequestBody,
  type PluginProvisionResult,
  type PluginReloadResult,
  type PluginUninstallResult,
  type TheForgePluginManifest,
} from "@theforge/shared-types";
import { PluginLoaderService } from "./plugin-loader.service.js";
import {
  parsePluginManifest,
  type PluginZipFileEntry,
  validatePluginPackage,
} from "./plugin-packaging.util.js";

@Injectable()
export class PluginInstallService {
  private readonly logger = new Logger(PluginInstallService.name);
  private readonly coreVersion: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly pluginLoader: PluginLoaderService,
  ) {
    this.coreVersion = this.resolveCoreVersion();
  }

  getCoreVersion(): string {
    return this.coreVersion;
  }

  getPluginsDirectory(): string {
    return this.pluginLoader.getPrimaryPluginDirectory();
  }

  async listInstalled(): Promise<PluginInstalledListResponse> {
    const pluginsDirectory = this.getPluginsDirectory();
    const loadedIds = new Set(this.pluginLoader.getPluginIds());
    const installed: InstalledPluginRecord[] = [];

    if (existsSync(pluginsDirectory)) {
      for (const name of readdirSync(pluginsDirectory)) {
        if (name.startsWith(".")) continue;
        const pluginPath = join(pluginsDirectory, name);
        if (!statSync(pluginPath).isDirectory()) continue;

        const manifest = this.readManifestFromDir(pluginPath);
        const id = manifest?.id ?? name;
        installed.push({
          id,
          version: manifest?.version ?? "unknown",
          name: manifest?.name ?? name,
          description: manifest?.description,
          installedAt: manifest?.builtAt,
          loaded: loadedIds.has(id),
          degraded: this.pluginLoader.isPluginDegraded(id),
          path: pluginPath,
          manifest,
        });
      }
    }

    installed.sort((a, b) => a.name.localeCompare(b.name));
    const health = this.pluginLoader.getHealthSnapshot();

    return {
      coreVersion: this.coreVersion,
      pluginsDirectory,
      installed,
      health: {
        loaded: health.loaded,
        pluginIds: health.pluginIds,
        artifactCount: health.artifactCount,
      },
    };
  }

  async installFromBuffer(buffer: Buffer): Promise<PluginInstallResult> {
    const maxBytes = this.configService.get<number>(
      "plugins.maxUploadBytes",
      52_428_800,
    );
    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        `El paquete excede el límite de ${maxBytes} bytes`,
      );
    }

    const entries = await this.extractZipEntries(buffer);
    const validated = validatePluginPackage(entries, {
      coreVersion: this.coreVersion,
      requireSignature: this.configService.get<boolean>(
        "plugins.requireSignature",
        false,
      ),
      signingSecret: this.configService.get<string>("plugins.signingSecret", ""),
    });

    const targetDir = join(
      this.getPluginsDirectory(),
      this.folderNameForPlugin(validated.manifest.id),
    );

    await this.writeEntriesToDir(validated.entries, targetDir);
    const reloaded = await this.pluginLoader.reloadPlugin(validated.manifest.id);

    this.logger.log(
      `Plugin installed: ${validated.manifest.id} v${validated.manifest.version}`,
    );

    return {
      ok: true,
      pluginId: validated.manifest.id,
      version: validated.manifest.version,
      name: validated.manifest.name,
      reloaded,
      message: reloaded
        ? "Plugin instalado y cargado"
        : "Plugin instalado; reinicia API/worker si no aparece cargado",
    };
  }

  async installFromLicensePortal(
    licenseKey: string,
    pluginId?: string,
  ): Promise<PluginInstallResult> {
    const key = licenseKey.trim();
    if (!key) {
      throw new BadRequestException("licenseKey es obligatorio");
    }

    const portalUrl = this.getLicensePortalUrl();
    const url = `${portalUrl}/plugins/download`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
        ...(pluginId ? { "X-Plugin-Id": pluginId } : {}),
      },
      body: JSON.stringify({ pluginId, coreVersion: this.coreVersion }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(
        `Portal de licencias rechazó la descarga (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    const result = await this.installFromBuffer(
      Buffer.from(await res.arrayBuffer()),
    );

    const licenseRegistered = result.reloaded
      ? await this.tryRegisterPluginLicense(result.pluginId, key, portalUrl)
      : false;

    if (!result.reloaded) {
      this.logger.warn(
        `Plugin ${result.pluginId} instalado pero no cargado; registerLicense omitido hasta recargar`,
      );
    }

    return {
      ...result,
      licenseRegistered,
      message: result.reloaded
        ? licenseRegistered
          ? "Plugin instalado, cargado y licencia registrada"
          : "Plugin instalado y cargado; el plugin no expone registerLicense()"
        : result.message,
    };
  }

  /**
   * Aprovisionamiento compuesto: instala `.tfplugin` (URL o portal) y registra licencia.
   * Pensado para portal de licencias, ForgeOps y bloques DBGA de aprovisionamiento.
   */
  async provision(
    body: PluginProvisionRequestBody,
  ): Promise<PluginProvisionResult> {
    const pluginId = body.pluginId?.trim();
    const licenseKey = body.licenseKey?.trim();
    const downloadUrl = body.downloadUrl?.trim();
    const licensePortalUrl = body.licensePortalUrl?.trim() || this.getLicensePortalUrl();

    if (!pluginId) {
      throw new BadRequestException("pluginId es obligatorio");
    }
    if (!licenseKey && !downloadUrl) {
      throw new BadRequestException(
        "Indica downloadUrl (CDN) y/o licenseKey (portal)",
      );
    }

    if (downloadUrl) {
      const result = await this.installFromUrl(downloadUrl);
      this.assertPluginIdMatches(result.pluginId, pluginId);

      let licenseRegistered = false;
      if (licenseKey && result.reloaded) {
        licenseRegistered = await this.tryRegisterPluginLicense(
          result.pluginId,
          licenseKey,
          licensePortalUrl,
        );
      } else if (licenseKey && !result.reloaded) {
        this.logger.warn(
          `Plugin ${result.pluginId} en disco sin cargar; registerLicense omitido`,
        );
      }

      return {
        ...result,
        installSource: "url",
        licenseRegistered,
        message: this.buildProvisionMessage(result.reloaded, licenseRegistered, "url"),
      };
    }

    const result = await this.installFromLicensePortal(licenseKey!, pluginId);
    this.assertPluginIdMatches(result.pluginId, pluginId);

    return {
      ...result,
      installSource: "portal",
      licenseRegistered: result.licenseRegistered ?? false,
    };
  }

  private assertPluginIdMatches(installedId: string, expectedId: string): void {
    if (installedId !== expectedId) {
      throw new BadRequestException(
        `El manifest instalado (${installedId}) no coincide con pluginId (${expectedId})`,
      );
    }
  }

  private buildProvisionMessage(
    reloaded: boolean,
    licenseRegistered: boolean,
    source: "portal" | "url",
  ): string {
    if (!reloaded) {
      return "Plugin instalado en disco; reinicia o recarga para completar licencia";
    }
    if (licenseRegistered) {
      return source === "portal"
        ? "Plugin aprovisionado desde portal con licencia registrada"
        : "Plugin instalado desde URL con licencia registrada";
    }
    return source === "url"
      ? "Plugin instalado desde URL; licencia no registrada (sin clave o sin registerLicense)"
      : "Plugin instalado; licencia pendiente de registro en el plugin";
  }

  private getLicensePortalUrl(): string {
    return (
      this.configService
        .get<string>("plugins.licensePortalUrl", "https://licenses.theforge.dev/api/v1")
        ?.replace(/\/$/, "") ?? "https://licenses.theforge.dev/api/v1"
    );
  }

  private async tryRegisterPluginLicense(
    pluginId: string,
    licenseKey: string,
    licensePortalUrl: string,
  ): Promise<boolean> {
    const plugin = this.pluginLoader.getPlugin(pluginId);
    if (!plugin?.registerLicense) {
      this.logger.debug(
        `Plugin ${pluginId} no implementa registerLicense(); licencia no propagada al plugin`,
      );
      return false;
    }

    try {
      await plugin.registerLicense({
        licenseKey,
        licensePortalUrl,
        source: "portal",
      });
      this.logger.log(`Licencia registrada en plugin ${pluginId}`);
      return true;
    } catch (err) {
      this.logger.warn(
        `registerLicense falló para ${pluginId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async installFromUrl(downloadUrl: string): Promise<PluginInstallResult> {
    const url = downloadUrl.trim();
    if (!url.startsWith("https://")) {
      throw new BadRequestException("downloadUrl debe ser HTTPS");
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new BadRequestException(
        `No se pudo descargar el paquete (${res.status})`,
      );
    }

    return this.installFromBuffer(Buffer.from(await res.arrayBuffer()));
  }

  async uninstall(pluginId: string): Promise<PluginUninstallResult> {
    if (!pluginId.trim()) {
      throw new BadRequestException("pluginId es obligatorio");
    }

    await this.pluginLoader.unloadPlugin(pluginId);

    const dir = join(
      this.getPluginsDirectory(),
      this.folderNameForPlugin(pluginId),
    );
    let removed = false;
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      removed = true;
    }

    return { ok: true, pluginId, removed };
  }

  async reloadAll(): Promise<PluginReloadResult> {
    await this.pluginLoader.reloadAll();
    const health = this.pluginLoader.getHealthSnapshot();
    const loadErrors = this.pluginLoader.getLastLoadErrors();
    return {
      ok: true,
      loaded: health.loaded,
      pluginIds: health.pluginIds,
      ...(Object.keys(loadErrors).length > 0 ? { loadErrors } : {}),
    };
  }

  private folderNameForPlugin(pluginId: string): string {
    return pluginId.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private readManifestFromDir(
    pluginPath: string,
  ): TheForgePluginManifest | undefined {
    const manifestPath = join(pluginPath, THEFORGE_PLUGIN_MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) return undefined;
    try {
      return parsePluginManifest(
        JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
      );
    } catch {
      return undefined;
    }
  }

  private async extractZipEntries(buffer: Buffer): Promise<PluginZipFileEntry[]> {
    const zip = await JSZip.loadAsync(buffer);
    const entries: PluginZipFileEntry[] = [];
    for (const [relativePath, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      entries.push({
        relativePath,
        content: Buffer.from(await file.async("arraybuffer")),
      });
    }
    return entries;
  }

  private async writeEntriesToDir(
    entries: PluginZipFileEntry[],
    targetDir: string,
  ): Promise<void> {
    await mkdir(dirname(targetDir), { recursive: true });
    const staging = `${targetDir}.staging-${Date.now()}`;
    await mkdir(staging, { recursive: true });

    try {
      for (const entry of entries) {
        const dest = join(staging, entry.relativePath);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, entry.content);
      }

      if (existsSync(targetDir)) {
        const backup = `${targetDir}.backup-${Date.now()}`;
        renameSync(targetDir, backup);
        try {
          renameSync(staging, targetDir);
          await rm(backup, { recursive: true, force: true });
        } catch (err) {
          if (existsSync(backup)) renameSync(backup, targetDir);
          throw err;
        }
      } else {
        renameSync(staging, targetDir);
      }
    } catch (err) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(
        `Error al escribir plugin en disco: ${msg}`,
      );
    }
  }

  private resolveCoreVersion(): string {
    const candidates = [
      join(__dirname, "../../package.json"),
      join(process.cwd(), "package.json"),
      join(process.cwd(), "../../package.json"),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        /* next */
      }
    }
    return "0.0.0";
  }
}
