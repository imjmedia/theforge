import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { ITheForgePlugin } from "./interfaces/the-forge-plugin.interface.js";
import type { ArtifactTypeDefinition, PluginSettingsPanelDefinition } from "@theforge/shared-types";
import { THEFORGE_PLUGIN_MANIFEST_FILENAME } from "@theforge/shared-types";
import type {
  BeforeDocumentRenderPayload,
  AfterDocumentRenderPayload,
  AfterDocumentPersistPayload,
  ProjectLifecyclePayload,
} from "./types/plugin-payloads.js";
import { parsePluginManifest } from "./plugin-packaging.util.js";

/** Token DI para exponer PluginLoaderService */
export const PLUGIN_LOADER_SERVICE = Symbol("PLUGIN_LOADER_SERVICE");

/**
 * Estado de un hook: plugin + handler compilado.
 */
interface HookEntry<H> {
  pluginId: string;
  handler: H;
}

/**
 * Carga dinámica de plugins en runtime.
 *
 * Busca directorios en rutas configuradas, carga cada plugin vía `await import()`,
 * valida que implementa `ITheForgePlugin`, inicializa, y registra sus hooks.
 *
 * Si un plugin falla al cargar, se loguea el error y el core continúa (YAGNI).
 */
@Injectable()
export class PluginLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PluginLoaderService.name);

  /** Mapa de plugins cargados: id → instancia */
  private readonly plugins = new Map<string, ITheForgePlugin>();

  /** Mapa pluginId → ruta en disco */
  private readonly pluginPaths = new Map<string, string>();

  /** Registro de hooks por tipo */
  private readonly beforeDocumentRenderHooks: HookEntry<
    NonNullable<ITheForgePlugin["beforeDocumentRender"]>
  >[] = [];
  private readonly afterDocumentRenderHooks: HookEntry<
    NonNullable<ITheForgePlugin["afterDocumentRender"]>
  >[] = [];
  private readonly afterDocumentPersistHooks: HookEntry<
    NonNullable<ITheForgePlugin["afterDocumentPersist"]>
  >[] = [];
  private readonly onProjectCreateHooks: HookEntry<
    NonNullable<ITheForgePlugin["onProjectCreate"]>
  >[] = [];
  private readonly onProjectUpdateHooks: HookEntry<
    NonNullable<ITheForgePlugin["onProjectUpdate"]>
  >[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Ciclo de vida de NestJS: cargar plugins al arrancar */
  async onModuleInit(): Promise<void> {
    this.logger.log("[PluginLoaderService] onModuleInit start");
    const directories = this.getPluginScanDirectories();

    for (const dir of directories) {
      if (!existsSync(dir)) {
        this.logger.debug(`Plugin directory not found: ${dir}`);
        continue;
      }

      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => join(dir, e.name));

      for (const pluginPath of entries) {
        await this.tryLoadPlugin(pluginPath);
      }
    }

    if (this.plugins.size === 0) {
      this.logger.log("No plugins loaded — core running standalone (YAGNI)");
    } else {
      this.logger.log(
        `${this.plugins.size} plugin(s) loaded: ${[...this.plugins.keys()].join(", ")}`,
      );
    }
    this.logger.log("[PluginLoaderService] onModuleInit end");
  }

  /**
   * Intenta cargar un plugin desde un directorio.
   * Si falla, loguea el error y continúa (graceful degradation).
   */
  private async tryLoadPlugin(pluginPath: string): Promise<void> {
    const entryPoint = this.resolvePluginEntryPoint(pluginPath);

    if (!entryPoint) {
      this.logger.verbose(
        `No entry point found in plugin directory ${pluginPath} — skipping`,
      );
      return;
    }

    try {
      // Dynamic import — bust Node ESM cache so reload picks up replaced files on disk.
      const importHref = `${pathToFileURL(entryPoint).href}?tfreload=${Date.now()}`;
      const module = (await import(importHref)) as Record<string, unknown>;

      const PluginClass = this.resolvePluginExportClass(module);

      if (!PluginClass) {
        this.logger.warn(
          `Plugin at ${pluginPath} does not export a class — skipping (entry=${entryPoint}, exports=${Object.keys(module).join(", ") || "none"})`,
        );
        return;
      }

      const instance = new PluginClass() as ITheForgePlugin;

      // Validación mínima del contrato
      if (!instance.id || typeof instance.id !== "string") {
        this.logger.warn(`Plugin at ${pluginPath} missing 'id' — skipping`);
        return;
      }
      if (!instance.version || typeof instance.version !== "string") {
        this.logger.warn(
          `Plugin at ${pluginPath} missing 'version' — skipping`,
        );
        return;
      }
      if (typeof instance.onPluginInit !== "function") {
        this.logger.warn(
          `Plugin at ${pluginPath} missing 'onPluginInit' — skipping`,
        );
        return;
      }

      // Evitar duplicados — el directorio primario (instalación) gana sobre copias embebidas en la imagen
      if (this.plugins.has(instance.id)) {
        const existingPath = this.pluginPaths.get(instance.id);
        const primary = this.getPrimaryPluginDirectory();
        const isPrimaryPath = (p: string) =>
          resolve(p).startsWith(resolve(primary));
        if (
          isPrimaryPath(pluginPath) &&
          existingPath &&
          !isPrimaryPath(existingPath)
        ) {
          this.logger.warn(
            `Plugin '${instance.id}' reemplazado: ${existingPath} → ${pluginPath} (directorio primario)`,
          );
          await this.unloadPlugin(instance.id);
        } else {
          this.logger.warn(
            `Plugin '${instance.id}' already loaded — skipping duplicate at ${pluginPath}`,
          );
          return;
        }
      }

      // Contexto de inyección limitado
      const context = this.buildPluginContext(instance.id);

      // Inicialización del plugin
      await instance.onPluginInit(context);

      // Registro en el sistema
      this.plugins.set(instance.id, instance);
      this.pluginPaths.set(instance.id, pluginPath);
      this.registerHooks(instance);

      this.logger.log(
        `✅ Plugin loaded: ${instance.name} v${instance.version} (${instance.id}) from ${pluginPath}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ Failed to load plugin ${pluginPath}: ${msg}`);

      const failOnError = this.configService.get<boolean>(
        "plugins.failOnPluginError",
        false,
      );
      if (failOnError) {
        throw new Error(
          `Plugin loading failed and failOnPluginError=true: ${msg}`,
        );
      }
      // FALLA GRACEFUL: el core continúa sin este plugin
    }
  }

  /** Resuelve el entry point del plugin (manifest.entry o heurística). */
  private resolvePluginEntryPoint(pluginPath: string): string | undefined {
    const manifestPath = join(pluginPath, THEFORGE_PLUGIN_MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      try {
        const manifest = parsePluginManifest(
          JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
        );
        const entry = manifest.entry?.trim() || "index.js";
        const fromManifest = join(pluginPath, entry);
        if (existsSync(fromManifest)) return fromManifest;
        this.logger.debug(
          `Manifest entry not found for ${pluginPath}: ${fromManifest}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(`Invalid manifest in ${pluginPath}: ${msg}`);
      }
    }

    const candidates = [
      join(pluginPath, "index.ts"),
      join(pluginPath, "index.js"),
      join(pluginPath, "src", "index.ts"),
      join(pluginPath, "src", "index.js"),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }

    return undefined;
  }

  /** Soporta export default, TheForgePlugin y default anidado (interop). */
  private resolvePluginExportClass(
    module: Record<string, unknown>,
  ): (new () => ITheForgePlugin) | undefined {
    const candidates = [
      module.default,
      module.TheForgePlugin,
      (module.default as Record<string, unknown> | undefined)?.default,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "function") {
        return candidate as new () => ITheForgePlugin;
      }
    }

    return undefined;
  }

  private buildPluginContext(pluginId: string): {
    getService: <T>(
      token: string | symbol | (new (...args: unknown[]) => T),
    ) => T;
    logger: Logger;
    config: Record<string, unknown>;
  } {
    return {
      getService: <T>(
        token: string | symbol | (new (...args: unknown[]) => T),
      ): T => {
        try {
          return this.moduleRef.get<T>(token as never, { strict: false });
        } catch {
          throw new Error(
            `Service '${String(token)}' not found or not exposed to plugins`,
          );
        }
      },
      logger: new Logger(`Plugin:${pluginId}`),
      config: this.configService.get<Record<string, unknown>>("plugins", {}),
    };
  }

  /** Registra los hooks de un plugin en los arrays correspondientes */
  private registerHooks(plugin: ITheForgePlugin): void {
    if (plugin.beforeDocumentRender) {
      this.beforeDocumentRenderHooks.push({
        pluginId: plugin.id,
        handler: plugin.beforeDocumentRender.bind(plugin),
      });
    }
    if (plugin.afterDocumentRender) {
      this.afterDocumentRenderHooks.push({
        pluginId: plugin.id,
        handler: plugin.afterDocumentRender.bind(plugin),
      });
    }
    if (plugin.afterDocumentPersist) {
      this.afterDocumentPersistHooks.push({
        pluginId: plugin.id,
        handler: plugin.afterDocumentPersist.bind(plugin),
      });
    }
    if (plugin.onProjectCreate) {
      this.onProjectCreateHooks.push({
        pluginId: plugin.id,
        handler: plugin.onProjectCreate.bind(plugin),
      });
    }
    if (plugin.onProjectUpdate) {
      this.onProjectUpdateHooks.push({
        pluginId: plugin.id,
        handler: plugin.onProjectUpdate.bind(plugin),
      });
    }
  }

  // ────────────────────────
  // API Pública — Hooks
  // ────────────────────────

  /** Ejecuta hooks beforeDocumentRender */
  async executeBeforeDocumentRender(
    payload: BeforeDocumentRenderPayload,
  ): Promise<BeforeDocumentRenderPayload> {
    let current = payload;
    for (const entry of this.beforeDocumentRenderHooks) {
      try {
        const result = await entry.handler(current);
        if (result !== undefined) current = result;
      } catch (err) {
        this.logHookError("beforeDocumentRender", entry.pluginId, err);
      }
    }
    return current;
  }

  /** Ejecuta hooks afterDocumentRender */
  async executeAfterDocumentRender(
    payload: AfterDocumentRenderPayload,
  ): Promise<AfterDocumentRenderPayload> {
    let current = payload;
    for (const entry of this.afterDocumentRenderHooks) {
      try {
        const result = await entry.handler(current);
        if (result !== undefined) current = result;
      } catch (err) {
        this.logHookError("afterDocumentRender", entry.pluginId, err);
      }
    }
    return current;
  }

  /** Ejecuta hooks afterDocumentPersist (fire-and-forget, no retorna nada) */
  async executeAfterDocumentPersist(
    payload: AfterDocumentPersistPayload,
  ): Promise<void> {
    for (const entry of this.afterDocumentPersistHooks) {
      try {
        await entry.handler(payload);
      } catch (err) {
        this.logHookError("afterDocumentPersist", entry.pluginId, err);
      }
    }
  }

  /** Ejecuta hooks onProjectCreate */
  async executeOnProjectCreate(
    payload: ProjectLifecyclePayload,
  ): Promise<void> {
    for (const entry of this.onProjectCreateHooks) {
      try {
        await entry.handler(payload);
      } catch (err) {
        this.logHookError("onProjectCreate", entry.pluginId, err);
      }
    }
  }

  /** Ejecuta hooks onProjectUpdate */
  async executeOnProjectUpdate(
    payload: ProjectLifecyclePayload,
  ): Promise<void> {
    for (const entry of this.onProjectUpdateHooks) {
      try {
        await entry.handler(payload);
      } catch (err) {
        this.logHookError("onProjectUpdate", entry.pluginId, err);
      }
    }
  }

  private logHookError(
    hookName: string,
    pluginId: string,
    err: unknown,
  ): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Hook '${hookName}' failed in plugin '${pluginId}': ${msg}`);
  }

  /** Directorios a escanear al cargar/recargar (primario primero; en prod solo el primario). */
  getPluginScanDirectories(): string[] {
    const primary = this.getPrimaryPluginDirectory();
    if (this.configService.get<string>("NODE_ENV") === "production") {
      return [primary];
    }
    const all = this.resolvePluginDirectories();
    return [
      primary,
      ...all.filter((dir) => resolve(dir) !== resolve(primary)),
    ];
  }

  /** Obtiene la lista de directorios donde escanear plugins */
  resolvePluginDirectories(): string[] {
    const fromEnv = this.configService.get<string>("plugins.directory");
    const dirs: string[] = [];
    if (fromEnv?.trim()) dirs.push(resolve(fromEnv.trim()));

    const candidates = [
      resolve(process.cwd(), "plugins-enabled"),
      resolve(process.cwd(), "../../plugins-enabled"),
    ];
    for (const candidate of candidates) {
      if (!dirs.includes(candidate)) dirs.push(candidate);
    }

    return dirs;
  }

  /** Directorio principal para instalación (configurado o heurística). */
  getPrimaryPluginDirectory(): string {
    const dirs = this.resolvePluginDirectories();
    const configured = this.configService.get<string>("plugins.directory")?.trim();
    if (configured) {
      if (!existsSync(configured)) {
        mkdirSync(configured, { recursive: true });
      }
      return resolve(configured);
    }

    for (const dir of dirs) {
      if (existsSync(dir)) return dir;
    }

    const fallback = resolve(process.cwd(), "../../plugins-enabled");
    if (!existsSync(fallback)) {
      mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  }

  /** Descarga un plugin del runtime (hooks + mapa). */
  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.onPluginDestroy) {
      try {
        await plugin.onPluginDestroy();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`onPluginDestroy failed for ${pluginId}: ${msg}`);
      }
    }

    this.plugins.delete(pluginId);
    this.pluginPaths.delete(pluginId);
    this.removeHooksForPlugin(pluginId);
    this.logger.log(`Plugin unloaded: ${pluginId}`);
  }

  /** Recarga un plugin ya instalado en disco. */
  async reloadPlugin(pluginId: string): Promise<boolean> {
    const folderName = pluginId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const primary = this.getPrimaryPluginDirectory();
    const pluginPath = join(primary, folderName);

    await this.unloadPlugin(pluginId);

    if (!existsSync(pluginPath)) {
      return false;
    }

    await this.tryLoadPlugin(pluginPath);
    return this.plugins.has(pluginId);
  }

  /** Re-escanea todos los directorios de plugins. */
  async reloadAll(): Promise<void> {
    const ids = [...this.plugins.keys()];
    for (const id of ids) {
      await this.unloadPlugin(id);
    }

    const directories = this.getPluginScanDirectories();
    for (const dir of directories) {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => join(dir, e.name));

      for (const pluginPath of entries) {
        await this.tryLoadPlugin(pluginPath);
      }
    }
  }

  private removeHooksForPlugin(pluginId: string): void {
    const filter = <H>(arr: HookEntry<H>[]) =>
      arr.filter((e) => e.pluginId !== pluginId);

    this.beforeDocumentRenderHooks.splice(
      0,
      this.beforeDocumentRenderHooks.length,
      ...filter(this.beforeDocumentRenderHooks),
    );
    this.afterDocumentRenderHooks.splice(
      0,
      this.afterDocumentRenderHooks.length,
      ...filter(this.afterDocumentRenderHooks),
    );
    this.afterDocumentPersistHooks.splice(
      0,
      this.afterDocumentPersistHooks.length,
      ...filter(this.afterDocumentPersistHooks),
    );
    this.onProjectCreateHooks.splice(
      0,
      this.onProjectCreateHooks.length,
      ...filter(this.onProjectCreateHooks),
    );
    this.onProjectUpdateHooks.splice(
      0,
      this.onProjectUpdateHooks.length,
      ...filter(this.onProjectUpdateHooks),
    );
  }

  // ────────────────────────
  // API Pública — Queries
  // ────────────────────────

  /** Número de plugins cargados */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /** Obtiene un plugin por su ID */
  getPlugin(id: string): ITheForgePlugin | undefined {
    return this.plugins.get(id);
  }

  /** Lista de IDs de plugins cargados */
  getPluginIds(): string[] {
    return [...this.plugins.keys()];
  }

  /** Obtiene los artifact types registrados por todos los plugins */
  getArtifactTypes(): ArtifactTypeDefinition[] {
    const types: ArtifactTypeDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.getArtifactTypes) {
        const pluginTypes = plugin.getArtifactTypes();
        if (Array.isArray(pluginTypes)) {
          for (const decl of pluginTypes) {
            types.push({ ...decl, pluginId: plugin.id });
          }
        }
      }
    }
    return types;
  }

  /** Resuelve artifact + plugin cargado */
  resolveArtifact(
    pluginId: string,
    artifactId: string,
  ): { plugin: ITheForgePlugin; artifact: ArtifactTypeDefinition } | undefined {
    const artifact = this.getArtifactTypes().find(
      (a) => a.pluginId === pluginId && a.id === artifactId,
    );
    if (!artifact) return undefined;
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;
    return { plugin, artifact };
  }

  /** Paneles de ajustes declarados por plugins cargados */
  getSettingsPanels(): PluginSettingsPanelDefinition[] {
    const panels: PluginSettingsPanelDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.getSettingsPanels) continue;
      const declared = plugin.getSettingsPanels();
      if (!Array.isArray(declared)) continue;
      for (const panel of declared) {
        const label =
          typeof panel.label === "string"
            ? panel.label.replace(/\s·\sv[\d.]+$/, "") + ` · v${plugin.version}`
            : panel.label;
        panels.push({
          ...panel,
          label,
          pluginId: plugin.id,
          mountPoint: panel.mountPoint ?? "settings.plugins",
        });
      }
    }
    return panels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** Plugin cargado por id (para validación de ajustes) */
  getPluginForSettings(pluginId: string): ITheForgePlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /** Verifica si al menos un hook de un tipo está registrado */
  hasHooks(hookName: "beforeDocumentRender" | "afterDocumentRender" | "afterDocumentPersist" | "onProjectCreate" | "onProjectUpdate"): boolean {
    switch (hookName) {
      case "beforeDocumentRender":
        return this.beforeDocumentRenderHooks.length > 0;
      case "afterDocumentRender":
        return this.afterDocumentRenderHooks.length > 0;
      case "afterDocumentPersist":
        return this.afterDocumentPersistHooks.length > 0;
      case "onProjectCreate":
        return this.onProjectCreateHooks.length > 0;
      case "onProjectUpdate":
        return this.onProjectUpdateHooks.length > 0;
      default:
        return false;
    }
  }

  /** Snapshot para GET /plugins/health (métricas de boot). */
  getHealthSnapshot(): {
    loaded: number;
    pluginIds: string[];
    artifactCount: number;
    hooks: Record<string, number>;
  } {
    return {
      loaded: this.plugins.size,
      pluginIds: [...this.plugins.keys()],
      artifactCount: this.getArtifactTypes().length,
      hooks: {
        beforeDocumentRender: this.beforeDocumentRenderHooks.length,
        afterDocumentRender: this.afterDocumentRenderHooks.length,
        afterDocumentPersist: this.afterDocumentPersistHooks.length,
        onProjectCreate: this.onProjectCreateHooks.length,
        onProjectUpdate: this.onProjectUpdateHooks.length,
      },
    };
  }
}
