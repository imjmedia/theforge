import type {
  PluginContext,
  BeforeDocumentRenderPayload,
  AfterDocumentRenderPayload,
  AfterDocumentPersistPayload,
  ProjectLifecyclePayload,
} from "../types/plugin-payloads.js";
import type {
  PluginArtifactContext,
  PluginArtifactResult,
  PluginArtifactTypeDeclaration,
  PluginExportContext,
  PluginExportResult,
  PluginLicenseRegistration,
  PluginSettingsLayout,
  PluginSettingsPanelDefinition,
} from "@theforge/shared-types";

/**
 * Ciclo de vida completo de un plugin The Forge.
 *
 * Cada plugin es una clase que implementa esta interfaz.
 * El core nunca depende de implementaciones concretas,
 * solo de esta abstracción (Inversión de Dependencias).
 *
 * Todas las funciones de hook son opcionales (?).
 * Un plugin solo implementa los que necesita.
 *
 * @example
 * ```typescript
 * export default class MyPlugin implements ITheForgePlugin {
 *   readonly id = 'my-company/my-plugin';
 *   readonly version = '1.0.0';
 *   readonly name = 'Mi Plugin';
 *   readonly description = 'Extiende The Forge con X';
 *
 *   async onPluginInit(ctx: PluginContext) {
 *     ctx.logger.log('Plugin inicializado');
 *   }
 *
 *   async afterDocumentRender(payload: AfterDocumentRenderPayload) {
 *     if (payload.documentType !== 'evd') return payload;
 *     // ... post-procesar EVD
 *     return payload;
 *   }
 * }
 * ```
 */
export interface ITheForgePlugin {
  /** Identificador único del plugin. Usar formato reverse-DNS: "com.miempresa.plugin" */
  readonly id: string;

  /** Versión semántica del plugin. Ej: "2.1.0" */
  readonly version: string;

  /** Nombre legible para humanos. Ej: "Executive Visual Deck" */
  readonly name: string;

  /** Descripción de la funcionalidad que proporciona */
  readonly description: string;

  // ────────────────────────
  // Ciclo de Vida del Plugin
  // ────────────────────────

  /**
   * Invocado una única vez cuando el PluginLoaderService detecta y carga el plugin.
   *
   * Útil para:
   * - Resolver servicios del core vía PluginContext.getService()
   * - Validar configuración (API keys, rutas, etc.)
   * - Inicializar recursos (conexiones, directorios, caché)
   *
   * @param context Contexto de inyección de dependencias limitado
   * @throws Si el plugin no puede inicializarse. El loader ejecuta try/catch y skip.
   */
  onPluginInit(context: PluginContext): Promise<void> | void;

  /**
   * Invocado cuando el plugin va a ser descargado o reemplazado.
   *
   * Útil para limpiar recursos: cerrar conexiones, liberar locks, flush buffers.
   *
   * @optional
   */
  onPluginDestroy?(): Promise<void> | void;

  // ────────────────────────
  // Hooks del Pipeline de Documentos
  // ────────────────────────

  /**
   * Hook: ANTES de que el LLM genere un documento/entregable.
   *
   * Permite:
   * - Modificar el prompt (pre-pend/append instrucciones)
   * - Cambiar el system prompt
   * - Anexar contexto adicional al payload
   * - Rechazar la generación lanzando Error
   *
   * @param payload Contexto completo de la generación
   * @returns Payload modificado (inmutable)
   * @optional
   */
  beforeDocumentRender?(
    payload: BeforeDocumentRenderPayload
  ): Promise<BeforeDocumentRenderPayload> | BeforeDocumentRenderPayload;

  /**
   * Hook: DESPUÉS de que el LLM devuelve un documento/entregable.
   *
   * Permite:
   * - Post-procesar el output (parsear, validar, enriquecer)
   * - Generar recursos adicionales (imágenes, diagramas)
   * - Transformar formato (JSON → enriched JSON)
   * - Lanzar Error si el output no cumple criterios del plugin
   *
   * @param payload Documento generado + contexto original
   * @returns Documento modificado (inmutable)
   * @optional
   */
  afterDocumentRender?(
    payload: AfterDocumentRenderPayload
  ): Promise<AfterDocumentRenderPayload> | AfterDocumentRenderPayload;

  /**
   * Hook: DESPUÉS de que un entregable se persiste en DB.
   *
   * Útil para side-effects: export, notificación, analytics, indexing.
   * NO modifica el payload (void). Si falla, se loguea pero no bloquea.
   *
   * @param payload Documento persistido + metadatos de generación
   * @optional
   */
  afterDocumentPersist?(
    payload: AfterDocumentPersistPayload
  ): Promise<void> | void;

  // ────────────────────────
  // Hooks de Ciclo de Vida del Proyecto
  // ────────────────────────

  /**
   * Hook: Cuando se crea un nuevo proyecto.
   *
   * Permite inicializar recursos específicos del plugin para el proyecto.
   *
   * @param payload Datos del proyecto creado
   * @optional
   */
  onProjectCreate?(
    payload: ProjectLifecyclePayload
  ): Promise<void> | void;

  /**
   * Hook: Cuando un proyecto es actualizado (post-save).
   *
   * @param payload Datos del proyecto actualizado
   * @optional
   */
  onProjectUpdate?(
    payload: ProjectLifecyclePayload
  ): Promise<void> | void;

  // ────────────────────────
  // Registro de Artifacts
  // ────────────────────────

  /**
   * Genera un artifact propio del plugin (Modo B). El core persiste el resultado en
   * `project.pluginData[pluginId]`.
   *
   * @optional
   */
  generateArtifact?(
    context: PluginArtifactContext,
  ): Promise<PluginArtifactResult> | PluginArtifactResult;

  /**
   * Exporta un artifact persistido (PPTX, PDF, …).
   * El core expone GET /api/plugins/projects/:id/export/:pluginId/:artifactId?format=…
   *
   * @optional
   */
  exportArtifact?(
    context: PluginExportContext,
  ): Promise<PluginExportResult> | PluginExportResult;

  /**
   * Registra los tipos de documento/artifact que este plugin genera.
   *
   * El core expone esta información vía GET /api/plugins/artifacts
   * para que el frontend muestre paneles dinámicos en el sidebar
   * y workshop.
   *
   * Cada artifact con showInSidebar=true aparecerá como pestaña
   * en el Workshop, con contenido accesible via
   * GET/PUT /api/projects/:id/plugin-data/:pluginId
   *
   * @returns Lista de definiciones de artifact (vacío si no aplica)
   * @optional
   */
  getArtifactTypes?(): PluginArtifactTypeDeclaration[];

  // ────────────────────────
  // Ajustes de usuario (UI enganchada en Ajustes)
  // ────────────────────────

  /**
   * Declara paneles de configuración que el core monta en Ajustes → Plugins.
   * El plugin define campos; el core persiste valores en `UserAISettings.pluginUserSettings`.
   *
   * @optional
   * @example
   * ```typescript
   * getSettingsPanels() {
   *   return [{
   *     id: "image-generation",
   *     label: "Generación de imágenes",
   *     description: "Modelo OpenRouter para slides visuales",
   *     fields: [{
   *       key: "imageModel",
   *       label: "Modelo de imagen",
   *       type: "text",
   *       placeholder: "black-forest-labs/flux.2-pro",
   *     }],
   *   }];
   * }
   * ```
   */
  getSettingsPanels?(): Array<Omit<PluginSettingsPanelDefinition, "pluginId">>;

  /**
   * Layout de los paneles de ajustes (p. ej. pestañas por panel.tab).
   *
   * @optional
   */
  getSettingsLayout?(): PluginSettingsLayout;

  /**
   * Normaliza o valida ajustes antes de persistir (opcional).
   * Si lanza Error, el core responde 400.
   *
   * @optional
   */
  validateUserSettings?(
    settings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;

  /**
   * Enriquece ajustes al leer (p. ej. metadatos de licencia en disco no guardados en DB).
   *
   * @optional
   */
  hydrateUserSettings?(
    stored: Record<string, unknown>,
  ): Record<string, unknown>;

  /**
   * Hook post-guardado (side-effects: invalidar caché, revalidar licencia, etc.).
   *
   * @optional
   */
  onUserSettingsSaved?(
    settings: Record<string, unknown>,
    context: { userId: string },
  ): Promise<void> | void;

  /**
   * Registra licencia comercial en el plugin (p. ej. tras install desde portal).
   * Opcional — plugins sin licencia no lo implementan.
   * El core lo invoca tras `installFromLicensePortal` si el plugin está cargado.
   *
   * @optional
   */
  registerLicense?(
    registration: PluginLicenseRegistration,
  ): Promise<void> | void;
}
