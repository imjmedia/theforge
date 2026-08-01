/**
 * Contrato de empaquetado `.tfplugin` (ZIP + manifest) para instalación desde UI.
 */

/** Versión del schema del manifest — incrementar en breaking changes. */
export const THEFORGE_PLUGIN_MANIFEST_VERSION = "1" as const;

/** Nombre del archivo manifest dentro del ZIP. */
export const THEFORGE_PLUGIN_MANIFEST_FILENAME = "theforge-plugin.manifest.json";

/** Extensión recomendada para paquetes de plugin. */
export const THEFORGE_PLUGIN_PACKAGE_EXT = ".tfplugin";

/** Tamaño máximo de upload por defecto (50 MB). */
export const THEFORGE_PLUGIN_DEFAULT_MAX_BYTES = 52_428_800;

/** Manifest embebido en cada paquete `.tfplugin`. */
export interface TheForgePluginManifest {
  manifestVersion: typeof THEFORGE_PLUGIN_MANIFEST_VERSION | string;
  /** Identificador reverse-DNS, debe coincidir con `ITheForgePlugin.id`. */
  id: string;
  version: string;
  name: string;
  description?: string;
  /** Ruta relativa al entry (default: index.js). */
  entry?: string;
  /** Versión mínima del core The Forge (semver). */
  minCoreVersion?: string;
  builtAt?: string;
  publisher?: string;
  /** SHA-256 hex del payload (todos los archivos excepto el manifest). */
  payloadSha256?: string;
  /** IDs de artifacts declarados (informativo). */
  artifacts?: string[];
  /** Variables de entorno opcionales que el plugin puede usar. */
  envSchema?: { optional?: string[]; required?: string[] };
  /** HMAC-SHA256 hex del JSON canonical sin este campo (opcional). */
  signature?: string;
  /**
   * Ruta relativa al cwd del servidor para ajustes de instancia (licencia, etc.).
   * Permite editar vía API aunque el plugin no haya cargado.
   */
  instanceSettingsPath?: string;
}

/** Plugin detectado en disco (instalado pero no necesariamente cargado). */
export interface InstalledPluginRecord {
  id: string;
  version: string;
  name: string;
  description?: string;
  installedAt?: string;
  loaded: boolean;
  /** Init falló pero el plugin expone ajustes (recargar tras corregir config). */
  degraded?: boolean;
  path: string;
  manifest?: TheForgePluginManifest;
}

/** Respuesta de GET /plugins/installed */
export interface PluginInstalledListResponse {
  coreVersion: string;
  pluginsDirectory: string;
  installed: InstalledPluginRecord[];
  health: {
    loaded: number;
    pluginIds: string[];
    artifactCount: number;
  };
}

/** Body JSON para POST /plugins/install (alternativa a multipart). */
export interface PluginInstallRequestBody {
  /** URL firmada del portal de licencias o CDN. */
  downloadUrl?: string;
  /** Clave de licencia — el core solicita el ZIP al portal. */
  licenseKey?: string;
  /** Id del plugin cuando se usa licenseKey sin URL. */
  pluginId?: string;
}

/**
 * Body JSON para POST /plugins/provision — install + licencia en un paso.
 * Usado por portal de licencias, ForgeOps o aprovisionadores que leen DBGA.
 */
export interface PluginProvisionRequestBody {
  /** Identificador reverse-DNS del plugin (obligatorio). */
  pluginId: string;
  /** URL HTTPS del `.tfplugin` (CDN, GitHub Release). Si se omite, el core descarga del portal con licenseKey. */
  downloadUrl?: string;
  /** Clave comercial (`tk_…`). Registra licencia en el plugin vía registerLicense(). */
  licenseKey?: string;
  /** Override de LICENSE_PORTAL_URL para validación/registro. */
  licensePortalUrl?: string;
}

/** Respuesta de instalación exitosa. */
export interface PluginInstallResult {
  ok: true;
  pluginId: string;
  version: string;
  name: string;
  reloaded: boolean;
  message?: string;
  /** Presente cuando el install propagó licencia vía registerLicense(). */
  licenseRegistered?: boolean;
}

/** Respuesta de POST /plugins/provision */
export interface PluginProvisionResult extends PluginInstallResult {
  /** Origen del paquete instalado. */
  installSource: "portal" | "url";
  /** Si registerLicense() se ejecutó con éxito en el plugin. */
  licenseRegistered: boolean;
}

/** Respuesta de desinstalación. */
export interface PluginUninstallResult {
  ok: true;
  pluginId: string;
  removed: boolean;
}

/** Respuesta de reload. */
export interface PluginReloadResult {
  ok: true;
  loaded: number;
  pluginIds: string[];
}
