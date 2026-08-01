/**
 * Tipos del sistema de plugins compartidos entre API y frontend.
 */

/** Definición de un artifact type que un plugin puede registrar */
export interface ArtifactTypeDefinition {
  /** Identificador único del artifact (ej: "report", "ppt-export") */
  id: string;
  /** Plugin dueño (reverse-DNS). Lo rellena el core al registrar. */
  pluginId: string;
  /** Label legible para humanos (ej: "Executive Visual Deck") */
  label: string;
  /** Nombre del ícono Lucide (ej: "Presentation", "FileText") */
  icon?: string;
  /** Si true, aparece en el sidebar de documentos del Workshop */
  showInSidebar?: boolean;
  /** Si true, el Workshop muestra acción Generar */
  generatable?: boolean;
  /** Cómo mostrar en Workshop: markdown (MddViewer), json (editor), html */
  contentType?: "markdown" | "json" | "html";
  /**
   * Vista preview del plugin en Workshop — resuelta por el registry UI del frontend.
   * Formato recomendado: `{pluginId}/{artifactId}` o `{pluginId}/{previewKind}`.
   * El paquete npm del plugin registra el componente con el mismo id.
   */
  workshopPreview?: string;
  /** Campos de entregables core requeridos (ej. specContent, mddContent) */
  requires?: string[];
}

/** Props que el core pasa al componente preview registrado por un plugin. */
export interface PluginWorkshopPreviewProps {
  data: unknown;
  pluginId: string;
  artifactId: string;
  projectId: string;
}

/** Metadatos de registro UI — el paquete npm del plugin exporta esto; el core no hardcodea plugins. */
export interface PluginWorkshopPreviewRegistration {
  id: string;
  defaultViewMode?: "preview" | "source";
  sourceReadOnly?: boolean;
  previewLabel?: string;
  sourceLabel?: string;
  /** Etiqueta del botón al aplicar cambios en modo fuente (default: "Guardar"). */
  sourceApplyLabel?: string;
}

/** Progreso reportado por el plugin durante `generateArtifact`. */
export interface PluginArtifactProgress {
  /** 0–100 */
  percent: number;
  /** Identificador de fase (p. ej. "license", "deck", "images", "finalize"). */
  step: string;
  /** Detalle legible para la UI (p. ej. "Slide 4/12"). */
  detail?: string;
}

/** Runtime LLM resuelto por el core (BYOK / instancia activa del usuario). */
export interface PluginLlmRuntime {
  providerId: string;
  model: string;
  apiKey: string;
  baseURL: string;
  imageModel?: string | null;
}

/** Contexto que el core pasa a `generateArtifact` del plugin */
export interface PluginArtifactContext {
  pluginId: string;
  artifactId: string;
  projectId: string;
  userId: string;
  stageId?: string | null;
  deliverables: Record<string, string | null | undefined>;
  userSettings: Record<string, unknown>;
  timestamp: Date;
  /** LLM del usuario/tenant — el plugin puede usarlo si no hay claves en env. */
  llmRuntime?: PluginLlmRuntime;
  /** Callback opcional — el core lo reenvía al job de cola / polling del frontend. */
  reportProgress?: (update: PluginArtifactProgress) => void;
}

/** Resultado de generación de artifact propio del plugin */
export interface PluginArtifactResult {
  data: unknown;
  metadata?: {
    durationMs?: number;
    tokensUsed?: number;
    provider?: string;
    model?: string;
  };
}

/** Declaración parcial que devuelve el plugin (sin pluginId — lo añade el loader) */
export type PluginArtifactTypeDeclaration = Omit<ArtifactTypeDefinition, "pluginId">;

/** Datos de un plugin por proyecto: { [pluginId]: any } */
export type PluginDataMap = Record<string, unknown>;

/** Tipo de campo en un panel de ajustes de plugin */
export type PluginSettingsFieldType =
  | "text"
  | "password"
  | "select"
  | "url"
  | "textarea";

/** Campo de formulario declarado por un plugin para Ajustes */
export interface PluginSettingsFieldDefinition {
  key: string;
  label: string;
  type: PluginSettingsFieldType;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** Solo para type === "select" */
  options?: Array<{ value: string; label: string }>;
  /** Campo informativo — no editable en Ajustes */
  readOnly?: boolean;
  /** Filas visibles para type === "textarea" */
  rows?: number;
}

/**
 * Panel de ajustes que un plugin expone en la UI de Ajustes del core.
 * El core lo monta como tarjeta «enganchada» sin conocer la lógica del plugin.
 */
export interface PluginSettingsPanelDefinition {
  /** Identificador reverse-DNS del plugin dueño */
  pluginId: string;
  /** Id único del panel dentro del plugin */
  id: string;
  /** Título visible en Ajustes */
  label: string;
  description?: string;
  /** Sección de Ajustes donde se monta (hoy solo plugins) */
  mountPoint?: "settings.plugins";
  /** Orden relativo dentro de la sección (menor = arriba) */
  order?: number;
  /** Agrupa paneles bajo una pestaña cuando layout del plugin es "tabs". */
  tab?: string;
  /** Etiqueta legible de la pestaña (usar en el primer panel de cada grupo). */
  tabLabel?: string;
  fields: PluginSettingsFieldDefinition[];
}

/** Layout de ajustes declarado por un plugin. */
export interface PluginSettingsLayout {
  mode: "tabs" | "stack";
}

/** Respuesta de GET /plugins/settings-panels */
export interface PluginSettingsPanelsResponse {
  panels: PluginSettingsPanelDefinition[];
  layouts: Record<string, PluginSettingsLayout>;
}

/** Contexto para exportación de artifacts (PPTX, PDF, …). */
export interface PluginExportContext {
  pluginId: string;
  artifactId: string;
  projectId: string;
  userId: string;
  data: unknown;
  format: "pptx" | "pdf";
  userSettings: Record<string, unknown>;
}

export interface PluginExportResult {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

/** Mapa userId → ajustes por pluginId */
export type PluginUserSettingsMap = Record<string, Record<string, unknown>>;

/** Payload para registrar licencia en un plugin (p. ej. tras install desde portal). */
export interface PluginLicenseRegistration {
  licenseKey?: string;
  licensePortalUrl?: string;
  /** Origen del registro — informativo para logs/auditoría. */
  source?: "portal" | "manual" | "env";
}
