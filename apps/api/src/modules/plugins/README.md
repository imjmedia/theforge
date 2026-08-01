# Módulo HTTP de plugins

Expone el contrato runtime entre el core y plugins cargados dinámicamente.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/plugins/artifacts` | Artifact types (incluye `pluginId`, `generatable`, `requires`, `contentType`) |
| GET | `/plugins/health` | Snapshot de boot: plugins cargados, hooks registrados |
| GET | `/plugins/installed` | Plugins en disco + estado cargado (manifest) |
| POST | `/plugins/install` | Instalar `.tfplugin` (multipart `file`) o JSON `{ downloadUrl, licenseKey, pluginId }` — **admin** |
| POST | `/plugins/provision` | Aprovisionamiento compuesto `{ pluginId, downloadUrl?, licenseKey?, licensePortalUrl? }` — **admin** |
| DELETE | `/plugins/installed/:pluginId` | Desinstalar — **admin** |
| POST | `/plugins/reload` | Re-escaneo de directorios — **admin** |
| GET | `/plugins/installed/:pluginId/instance-settings` | Ajustes de instancia en disco (sin cargar plugin) — **admin** |
| PUT | `/plugins/installed/:pluginId/instance-settings` | Parche JSON instancia + recarga plugin — **admin** |
| GET | `/plugins/settings-panels` | Paneles de Ajustes declarados por plugins |
| GET | `/plugins/user-settings` | Mapa de ajustes del usuario autenticado |
| GET | `/plugins/:pluginId/user-settings` | Ajustes de un plugin |
| PUT | `/plugins/:pluginId/user-settings` | Guardar ajustes (validación opcional del plugin) |
| GET | `/plugins/projects/:id/plugin-data/:pluginId` | Datos del plugin por proyecto |
| PUT | `/plugins/projects/:id/plugin-data/:pluginId` | Persistir datos del plugin |
| POST | `/plugins/projects/:id/generate/:pluginId/:artifactId` | Generar artifact (cola `plugin-artifact` o sync) |

## Instalación ZIP (`.tfplugin`)

Ver **`docs/PLUGINS-PACKAGING.md`**: manifest, `pnpm exec tsx scripts/pack-theforge-plugin.ts`, volumen Dokploy `theforge_plugins`.

## Servicios relacionados (core)

| Servicio | Rol |
|----------|-----|
| `PluginLoaderService` | Carga dinámica, registro de hooks y artifacts, reload |
| `PluginInstallService` | Validación ZIP, escritura en `PLUGINS_DIRECTORY`, portal de licencias |
| `PluginDocumentPipelineService` | Invoca hooks desde generadores |
| `PluginArtifactService` | Orquesta `generateArtifact` → `project.pluginData` |
| `PluginUserSettingsService` | Persistencia en `UserAISettings.pluginUserSettings` |

Plugin de desarrollo: `plugins-enabled/stub-plugin/` (`dev.theforge.stub-plugin`).

Ver `docs/PLUGINS.md`, `docs/ARCHITECTURE_PLUGINS.md`, `docs/PLUGINS-PACKAGING.md`, `docs/PLUGINS_PROVISIONING_DBGA.md`.
