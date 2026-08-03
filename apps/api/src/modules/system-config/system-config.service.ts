/**
 * @fileoverview Servicio de configuración del sistema: gestión de llaves de plataforma con defaults del catálogo.
 * Resuelve valores en orden: BD (AppConfig) → variable de entorno → default del catálogo ({@link SYSTEM_CONFIG_CATEGORIES}).
 * Expone {@link getConfigSnapshot} para lectura y {@link patchConfig} para escritura (solo super_admin).
 */
import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  SYSTEM_CONFIG_CATEGORIES,
  SYSTEM_CONFIG_DEFINITIONS,
  SYSTEM_CONFIG_SECRET_MASK,
  getSystemConfigDefinition,
  normalizePlatformBooleanInput,
  type SystemConfigDefinition,
  type SystemConfigSnapshot,
  type SystemConfigSource,
} from "@theforge/shared-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  resolvePlatformConfigSource,
  resolvePlatformConfigValue,
  setPlatformConfigOverrides,
} from "./platform-config.runtime.js";
import { FxRateService } from "../fx-rate/fx-rate.service.js";

const SECRET_MASK = SYSTEM_CONFIG_SECRET_MASK;
const FX_CONFIG_KEY = "mxn_per_usd";

export type PatchSystemConfigDto = {
  settings?: Record<string, unknown>;
};

@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);
  private readonly appVersion = this.readAppVersion();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fxRate: FxRateService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadRuntimeOverrides();
  }

  async getSnapshot(): Promise<SystemConfigSnapshot> {
    const dbRows = await this.loadDbMap();
    return {
      version: this.appVersion,
      categories: SYSTEM_CONFIG_CATEGORIES,
      settings: SYSTEM_CONFIG_DEFINITIONS.map((def) =>
        this.toSettingView(def, dbRows.get(def.key)),
      ),
    };
  }

  /** Devuelve el valor efectivo de un campo secret (super_admin). */
  revealSecret(key: string): { key: string; value: string; configured: boolean } {
    const def = getSystemConfigDefinition(key);
    if (!def) {
      throw new BadRequestException(`Clave desconocida: ${key}`);
    }
    if (!def.secret && def.type !== "secret") {
      throw new BadRequestException(`${key} no es un campo secreto`);
    }
    const value = resolvePlatformConfigValue(def);
    return { key, value, configured: value.trim() !== "" };
  }

  async patchSettings(dto: PatchSystemConfigDto): Promise<SystemConfigSnapshot> {
    const incoming = dto.settings ?? {};
    const unknown = Object.keys(incoming).filter((k) => !getSystemConfigDefinition(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`Claves desconocidas: ${unknown.join(", ")}`);
    }

    const dbMap = await this.loadDbMap();
    let fxRateChanged = false;

    for (const def of SYSTEM_CONFIG_DEFINITIONS) {
      if (!(def.key in incoming)) continue;
      const raw = incoming[def.key];
      if (raw === null || raw === "") {
        if (dbMap.has(def.key)) {
          await this.prisma.appConfig.delete({ where: { key: def.key } }).catch(() => {});
          if (def.key === FX_CONFIG_KEY) fxRateChanged = true;
        }
        continue;
      }

      if (def.secret && typeof raw === "string" && raw.trim() === SECRET_MASK) {
        continue;
      }

      const normalized = this.normalizeIncomingValue(def, raw);
      const existing = dbMap.get(def.key);
      if (existing === normalized) continue;

      await this.prisma.appConfig.upsert({
        where: { key: def.key },
        create: { key: def.key, value: normalized },
        update: { value: normalized },
      });
      if (def.key === FX_CONFIG_KEY) fxRateChanged = true;
    }

    if (fxRateChanged) {
      this.fxRate.invalidate();
    }

    await this.reloadRuntimeOverrides();
    return this.getSnapshot();
  }

  private async reloadRuntimeOverrides(): Promise<void> {
    try {
      const rows = await this.prisma.appConfig.findMany({
        where: { key: { in: SYSTEM_CONFIG_DEFINITIONS.map((d) => d.key) } },
      });
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      setPlatformConfigOverrides(map);
      this.logger.log(`Platform config loaded (${rows.length} overrides in AppConfig)`);
    } catch (err) {
      this.logger.warn(
        `Platform config load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setPlatformConfigOverrides({});
    }
  }

  private async loadDbMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.appConfig.findMany({
      where: { key: { in: SYSTEM_CONFIG_DEFINITIONS.map((d) => d.key) } },
    });
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  private toSettingView(def: SystemConfigDefinition, dbValue?: string) {
    const source = this.resolveSource(def, dbValue);
    const effective = resolvePlatformConfigValue(def);
    const secret = def.secret === true || def.type === "secret";
    const displayValue =
      secret && (source === "database" || source === "env") && effective !== ""
        ? SECRET_MASK
        : effective;

    return {
      key: def.key,
      envKey: def.envKey,
      label: def.label,
      description: def.description,
      type: def.type,
      category: def.category,
      value: displayValue,
      defaultValue: def.defaultValue,
      source,
      secret,
      restartRequired: def.restartRequired === true,
      min: def.min,
      max: def.max,
    };
  }

  private resolveSource(def: SystemConfigDefinition, dbValue?: string): SystemConfigSource {
    if (dbValue?.trim()) return "database";
    return resolvePlatformConfigSource(def);
  }

  private normalizeIncomingValue(def: SystemConfigDefinition, raw: unknown): string {
    if (def.type === "boolean") {
      return normalizePlatformBooleanInput(raw);
    }
    if (def.type === "number") {
      const n =
        typeof raw === "number"
          ? raw
          : Number.parseInt(String(raw ?? "").trim(), 10);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(`Valor numérico inválido para ${def.key}`);
      }
      const min = def.min ?? Number.NEGATIVE_INFINITY;
      const max = def.max ?? Number.POSITIVE_INFINITY;
      if (n < min || n > max) {
        throw new BadRequestException(
          `${def.key} debe estar entre ${min} y ${max}`,
        );
      }
      return String(Math.floor(n));
    }
    return String(raw ?? "").trim();
  }

  private readAppVersion(): string {
    try {
      const pkg = JSON.parse(
        readFileSync(join(process.cwd(), "package.json"), "utf8"),
      ) as { version?: string };
      return pkg.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}
