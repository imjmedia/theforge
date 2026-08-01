# Plugins (core runtime)

Motor de carga dinámica e instalación ZIP.

| Servicio | Rol |
|----------|-----|
| `plugin-loader.service.ts` | `import()` en boot, hooks, artifacts, reload/unload. Si `onPluginInit` falla pero el plugin expone `getSettingsPanels`, queda en **modo degradado** (ajustes sí, hooks no) hasta recargar. |

En **producción** solo se escanean plugins en `PLUGINS_DIRECTORY` (p. ej. `/app/plugins-enabled`). No incluir copias de desarrollo en la imagen Docker (`apps/api/plugins-enabled` está en `.dockerignore`).

| `plugin-install.service.ts` | Validar `.tfplugin`, escribir en `PLUGINS_DIRECTORY`, portal de licencias |
| `plugin-packaging.util.ts` | Manifest, checksum, semver, firma HMAC |
| `plugin-artifact.service.ts` | Modo B — `generateArtifact` |
| `plugin-document-pipeline.service.ts` | Modo A — hooks en entregables |
| `plugin-user-settings.service.ts` | Ajustes por usuario |

Docs: `docs/PLUGINS.md`, `docs/PLUGINS-PACKAGING.md`, `docs/ARCHITECTURE_PLUGINS.md`.

Empaquetar: `pnpm exec tsx scripts/pack-theforge-plugin.ts --dir … --out …`
