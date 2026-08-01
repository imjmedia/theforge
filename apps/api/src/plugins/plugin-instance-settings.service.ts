import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { THEFORGE_PLUGIN_MANIFEST_FILENAME } from "@theforge/shared-types";
import { parsePluginManifest } from "./plugin-packaging.util.js";
import { PluginInstallService } from "./plugin-install.service.js";

const SECRET_KEYS = new Set([
  "licenseKey",
  "signingSecret",
  "apiKey",
  "secret",
]);

const LEGACY_INSTANCE_SETTINGS_PATHS: Record<string, string> = {
  "com.kreodevs.evd": "data/evd-instance-settings.json",
};

/** Ajustes de instancia en disco — editable aunque el plugin no cargue. */
@Injectable()
export class PluginInstanceSettingsService {
  private readonly logger = new Logger(PluginInstanceSettingsService.name);

  constructor(private readonly pluginInstall: PluginInstallService) {}

  resolveRelativePath(pluginId: string): string | null {
    const pluginPath = join(
      this.pluginInstall.getPluginsDirectory(),
      pluginId.replace(/[^a-zA-Z0-9._-]/g, "_"),
    );
    const manifestPath = join(pluginPath, THEFORGE_PLUGIN_MANIFEST_FILENAME);
    if (!existsSync(pluginPath)) return null;

    if (!existsSync(manifestPath)) {
      return LEGACY_INSTANCE_SETTINGS_PATHS[pluginId] ?? null;
    }

    try {
      const manifest = parsePluginManifest(
        JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
      );
      const rel = manifest.instanceSettingsPath?.trim();
      if (rel) return rel;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Manifest inválido para ${pluginId}: ${msg}`);
    }

    return LEGACY_INSTANCE_SETTINGS_PATHS[pluginId] ?? null;
  }

  private resolveAbsolutePath(pluginId: string): string {
    const rel = this.resolveRelativePath(pluginId);
    if (!rel) {
      throw new NotFoundException(
        `Plugin '${pluginId}' no declara instanceSettingsPath en el manifest`,
      );
    }
    return resolve(process.cwd(), rel);
  }

  readPublic(pluginId: string): Record<string, unknown> {
    const abs = this.resolveAbsolutePath(pluginId);
    const data = this.readRaw(abs);
    return this.redactForApi(data);
  }

  patch(pluginId: string, patch: Record<string, unknown>): Record<string, unknown> {
    const abs = this.resolveAbsolutePath(pluginId);
    const current = this.readRaw(abs);
    const next = { ...current };

    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
    }

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    this.logger.log(`Instance settings updated for ${pluginId} (${abs})`);
    return this.redactForApi(next);
  }

  private readRaw(absPath: string): Record<string, unknown> {
    if (!existsSync(absPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(absPath, "utf8")) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private redactForApi(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const key of Object.keys(out)) {
      if (SECRET_KEYS.has(key)) {
        delete out[key];
      }
    }
    if (typeof data.licenseKey === "string" && data.licenseKey.trim()) {
      const k = data.licenseKey.trim();
      out.licenseKeyHint = `${k.slice(0, 6)}${"•".repeat(Math.min(8, k.length - 6))}`;
    }
    out.signingSecretConfigured = Boolean(
      typeof data.signingSecret === "string" && data.signingSecret.trim(),
    );
    return out;
  }
}
