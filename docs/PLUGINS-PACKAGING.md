# Empaquetado de plugins (`.tfplugin`)

Contrato de distribución e instalación de plugins The Forge sin consola ni `git clone` en producción.

## Formato `.tfplugin`

Archivo ZIP con extensión `.tfplugin`. Al extraer, la **raíz del ZIP** es la carpeta del plugin en `plugins-enabled/{id}/`.

```text
com.kreodevs.evd@2.1.0.tfplugin
├── theforge-plugin.manifest.json   ← obligatorio
├── index.js                        ← entry (ESM, export default class)
├── dist/                           ← opcional si index re-exporta
└── assets/                         ← opcional
```

## Manifest (`theforge-plugin.manifest.json`)

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `manifestVersion` | Sí | `"1"` |
| `id` | Sí | reverse-DNS (`com.kreodevs.evd`) |
| `version` | Sí | semver (`2.1.0`) |
| `name` | Sí | Nombre legible |
| `entry` | No | Default `index.js` |
| `minCoreVersion` | No | Versión mínima del core |
| `payloadSha256` | Recomendado | SHA-256 hex del payload (sin manifest) |
| `signature` | Opcional | HMAC-SHA256 del JSON sin `signature` |
| `workshopUi` | No | `{ "entry": "workshop-ui/workshop-preview.js", "hostApiVersion": "1" }` — bundle ESM de preview Workshop embebido en el ZIP |

Tipos compartidos: `packages/shared-types/src/plugin-packaging.ts`.

## Reglas de build (autores de plugins)

1. **Solo JavaScript en producción** — compilar con `tsc` o bundlear con esbuild.
2. **`index.js` en la raíz del ZIP** con `export default class … implements ITheForgePlugin`.
3. **Contrato autocontenido** — no importar código del monorepo core (ver `docs/PLUGINS.md`).
4. **Peer deps del core** (`@nestjs/common`, etc.) no van en el ZIP.
5. **Calcular `payloadSha256`** con el mismo algoritmo que el core (archivos ordenados por ruta, excluyendo manifest).
6. **Firmar** con `PLUGINS_SIGNING_SECRET` si `PLUGINS_REQUIRE_SIGNATURE=true` en el servidor.

### Empaquetar con el script del monorepo

```bash
cd my-plugin
pnpm run build

cd /path/to/theforge
pnpm exec tsx scripts/pack-theforge-plugin.ts \
  --dir /path/to/my-plugin \
  --out dist/com.mycompany.plugin@1.0.0.tfplugin \
  --id com.mycompany.plugin \
  --sign   # opcional; requiere PLUGINS_SIGNING_SECRET
```

Nombre recomendado: `{id}@{version}.tfplugin`.

## Instrucciones IA para empaquetado

Bloque listo para pegar en Cursor/Copilot al trabajar en el **repo del plugin**. Espejo en ayuda Workshop → **Plugins (.tfplugin)**.

Ver contenido completo en `apps/web/src/content/help/plugins-packaging.md` (sección *Instrucciones IA para empaquetado*).

Resumen de lo que debe hacer el agente:

1. Implementar `ITheForgePlugin` con contrato autocontenido (sin imports del monorepo core).
2. Build → solo `.js` en el ZIP; `index.js` en la raíz; `export default class`.
3. Generar manifest v1 + `payloadSha256` con `scripts/pack-theforge-plugin.ts`.
4. Verificar checklist (install UI, worker restart, artifacts en Workshop).

Opcional: copiar el bloque a `.cursor/rules/plugin-packaging.mdc` en el repo del plugin.

## Instalación

### Desde la UI (Ajustes → Plugins)

Administradores pueden:

- Subir un archivo `.tfplugin`
- Configurar licencia y demás campos en **Ajustes por plugin** (paneles declarados por cada plugin cargado vía `getSettingsPanels()`)
- Desinstalar / recargar plugins

La API acepta `licenseKey` + `pluginId` para el **portal de licencias** (no en la UI de install). Tras descargar e instalar el `.tfplugin`, el core llama `registerLicense()` en el plugin si lo implementa — así la clave queda en el plugin sin formulario global.

### Desde la API

| Método | Ruta | Rol |
|--------|------|-----|
| GET | `/api/plugins/installed` | Listado instalado + health |
| POST | `/api/plugins/install` | Multipart `file` o JSON `{ downloadUrl, licenseKey, pluginId }` |
| POST | `/api/plugins/provision` | JSON `{ pluginId, downloadUrl?, licenseKey?, licensePortalUrl? }` — install + licencia |
| DELETE | `/api/plugins/installed/:pluginId` | Desinstalar (admin) |
| POST | `/api/plugins/reload` | Re-escaneo (admin) |

### Dokploy / Docker

`docker-compose.yml` monta volumen compartido:

```yaml
PLUGINS_DIRECTORY: /app/plugins-enabled
volumes:
  - theforge_plugins:/app/plugins-enabled   # API + worker
```

Los plugins instalados desde UI **persisten** entre redeploys. API y worker comparten el mismo volumen (jobs `plugin-artifact`).

Variables de entorno:

| Variable | Descripción |
|----------|-------------|
| `PLUGINS_DIRECTORY` | Directorio de plugins (alias `THEFORGE_PLUGINS_DIR`) |
| `PLUGINS_MAX_UPLOAD_BYTES` | Límite upload (default 50 MB) |
| `PLUGINS_REQUIRE_SIGNATURE` | Exigir firma HMAC válida |
| `PLUGINS_SIGNING_SECRET` | Secreto para verificar/firmar manifests |
| `LICENSE_PORTAL_URL` | Base URL portal (`…/api/v1`) |

## Portal de licencias

Tras validar licencia, el portal expone:

```http
POST /api/v1/plugins/download
X-API-Key: tk_…
X-Plugin-Id: com.kreodevs.evd

{ "pluginId": "com.kreodevs.evd", "coreVersion": "1.6.2" }
→ 200 application/zip (cuerpo .tfplugin)
```

Ver también `docs/PLUGINS_PROVISIONING_DBGA.md` (modelo DBGA + aprovisionamiento compuesto).

## Ejemplo EVD

1. CI del repo `evd-plugin` genera `com.kreodevs.evd@X.Y.Z.tfplugin`.
2. Se publica en el portal de licencias.
3. Admin en The Forge → Ajustes → Plugins → clave de licencia → instalar.
4. Core valida manifest, extrae en volumen, recarga plugin.
5. Panel EVD aparece en Ajustes y Workshop.

## Referencias

- `docs/PLUGINS.md` — contrato `ITheForgePlugin`
- `docs/ARCHITECTURE_PLUGINS.md` — arquitectura runtime
- `scripts/pack-theforge-plugin.ts` — empaquetador
- `apps/api/src/plugins/plugin-install.service.ts` — instalador
