import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  THEFORGE_PLUGIN_MANIFEST_FILENAME,
  THEFORGE_PLUGIN_MANIFEST_VERSION,
  type TheForgePluginManifest,
} from "@theforge/shared-types";

const REVERSE_DNS_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

/** Compara semver simple major.minor.patch. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function satisfiesMinCoreVersion(
  minCore: string,
  currentCore: string,
): boolean {
  return compareSemver(currentCore, minCore) >= 0;
}

export function isValidPluginId(id: string): boolean {
  return REVERSE_DNS_ID.test(id);
}

export function parsePluginManifest(raw: unknown): TheForgePluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Manifest inválido: no es un objeto JSON");
  }
  const m = raw as Record<string, unknown>;
  if (m.manifestVersion !== THEFORGE_PLUGIN_MANIFEST_VERSION) {
    throw new Error(
      `Manifest manifestVersion no soportada: ${String(m.manifestVersion)} (esperado ${THEFORGE_PLUGIN_MANIFEST_VERSION})`,
    );
  }
  if (typeof m.id !== "string" || !isValidPluginId(m.id)) {
    throw new Error(
      `Manifest id inválido (reverse-DNS requerido): ${String(m.id)}`,
    );
  }
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) {
    throw new Error(`Manifest version inválida: ${String(m.version)}`);
  }
  if (typeof m.name !== "string" || !m.name.trim()) {
    throw new Error("Manifest name es obligatorio");
  }
  return {
    manifestVersion: THEFORGE_PLUGIN_MANIFEST_VERSION,
    id: m.id as string,
    version: m.version as string,
    name: m.name as string,
    description: typeof m.description === "string" ? m.description : undefined,
    entry: typeof m.entry === "string" ? m.entry : undefined,
    minCoreVersion:
      typeof m.minCoreVersion === "string" ? m.minCoreVersion : undefined,
    builtAt: typeof m.builtAt === "string" ? m.builtAt : undefined,
    publisher: typeof m.publisher === "string" ? m.publisher : undefined,
    payloadSha256:
      typeof m.payloadSha256 === "string" ? m.payloadSha256 : undefined,
    artifacts: Array.isArray(m.artifacts)
      ? (m.artifacts as string[])
      : undefined,
    envSchema:
      m.envSchema && typeof m.envSchema === "object"
        ? (m.envSchema as TheForgePluginManifest["envSchema"])
        : undefined,
    signature: typeof m.signature === "string" ? m.signature : undefined,
    instanceSettingsPath:
      typeof m.instanceSettingsPath === "string"
        ? m.instanceSettingsPath
        : undefined,
    workshopUi:
      m.workshopUi &&
      typeof m.workshopUi === "object" &&
      typeof (m.workshopUi as Record<string, unknown>).entry === "string"
        ? {
            entry: (m.workshopUi as Record<string, unknown>).entry as string,
            hostApiVersion:
              typeof (m.workshopUi as Record<string, unknown>).hostApiVersion ===
              "string"
                ? ((m.workshopUi as Record<string, unknown>)
                    .hostApiVersion as string)
                : undefined,
          }
        : undefined,
  };
}

export interface PluginZipFileEntry {
  relativePath: string;
  content: Buffer;
}

/** Normaliza rutas del ZIP y elimina un prefijo raíz único si existe. */
export function normalizeZipEntries(
  entries: PluginZipFileEntry[],
): PluginZipFileEntry[] {
  const fileEntries = entries.filter((e) => !e.relativePath.endsWith("/"));
  if (fileEntries.length === 0) {
    throw new Error("El ZIP está vacío");
  }

  const segments = fileEntries.map((e) => e.relativePath.split("/")[0] ?? "");
  const uniqueRoots = new Set(segments);
  const stripPrefix =
    uniqueRoots.size === 1 &&
    fileEntries.every((e) => e.relativePath.includes("/"))
      ? `${segments[0]}/`
      : "";

  return fileEntries.map((e) => ({
    relativePath: stripPrefix
      ? e.relativePath.slice(stripPrefix.length)
      : e.relativePath,
    content: e.content,
  }));
}

/** SHA-256 hex del payload (todos los archivos excepto manifest, ordenados por ruta). */
export function computePayloadSha256(entries: PluginZipFileEntry[]): string {
  const hash = createHash("sha256");
  const sorted = [...entries]
    .filter((e) => e.relativePath !== THEFORGE_PLUGIN_MANIFEST_FILENAME)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const entry of sorted) {
    hash.update(entry.relativePath);
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function verifyManifestSignature(
  manifest: TheForgePluginManifest,
  secret: string,
): boolean {
  if (!manifest.signature?.trim()) return false;
  if (!secret) return false;

  const { signature, ...unsigned } = manifest;
  void signature;
  const canonical = JSON.stringify(unsigned, Object.keys(unsigned).sort());
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");

  try {
    const a = Buffer.from(manifest.signature, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface ValidatePluginPackageOptions {
  coreVersion: string;
  requireSignature: boolean;
  signingSecret: string;
}

export interface ValidatedPluginPackage {
  manifest: TheForgePluginManifest;
  entries: PluginZipFileEntry[];
  entryPath: string;
}

/** Valida manifest, checksum y compatibilidad de core. */
export function validatePluginPackage(
  entries: PluginZipFileEntry[],
  opts: ValidatePluginPackageOptions,
): ValidatedPluginPackage {
  const normalized = normalizeZipEntries(entries);

  const manifestEntry = normalized.find(
    (e) => e.relativePath === THEFORGE_PLUGIN_MANIFEST_FILENAME,
  );
  if (!manifestEntry) {
    throw new Error(
      `Falta ${THEFORGE_PLUGIN_MANIFEST_FILENAME} en la raíz del ZIP`,
    );
  }

  let manifest: TheForgePluginManifest;
  try {
    manifest = parsePluginManifest(
      JSON.parse(manifestEntry.content.toString("utf8")) as unknown,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Manifest JSON inválido: ${msg}`);
  }

  if (manifest.minCoreVersion && !satisfiesMinCoreVersion(manifest.minCoreVersion, opts.coreVersion)) {
    throw new Error(
      `Plugin requiere core >= ${manifest.minCoreVersion}; actual ${opts.coreVersion}`,
    );
  }

  if (manifest.payloadSha256) {
    const computed = computePayloadSha256(normalized);
    if (computed !== manifest.payloadSha256.toLowerCase()) {
      throw new Error("Checksum payloadSha256 no coincide");
    }
  }

  if (opts.requireSignature || manifest.signature) {
    if (!verifyManifestSignature(manifest, opts.signingSecret)) {
      throw new Error("Firma del manifest inválida o PLUGINS_SIGNING_SECRET no configurado");
    }
  }

  const entryRel = manifest.entry?.trim() || "index.js";
  const entryPath = normalized.find((e) => e.relativePath === entryRel);
  if (!entryPath) {
    throw new Error(`Entry '${entryRel}' no encontrado en el ZIP`);
  }

  return { manifest, entries: normalized, entryPath: entryRel };
}
