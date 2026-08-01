# Plugin UI (`plugin-ui/`)

Extensión genérica del Workshop para **vistas preview de artifacts de plugins**.

## Contrato (autocontenido en `.tfplugin`)

1. **Backend (plugin):** `getArtifactTypes()` declara `workshopPreview: "{pluginId}/{kind}"`.
2. **Manifest del paquete:** `workshopUi.entry` apunta al bundle ESM dentro del ZIP (p. ej. `workshop-ui/workshop-preview.js`).
3. **Bundle del plugin:** exporta `register(host)` y llama `host.registerWorkshopPreview({ id, Preview, … })` usando el React del core vía `globalThis.__THEFORGE_PLUGIN_UI__`.
4. **Core API:** sirve el bundle en `GET /api/plugins/workshop-ui/:pluginId/:filename`.
5. **Core web:** `bootstrap.ts` carga dinámicamente los bundles de plugins instalados — **sin imports estáticos por plugin**.

## Archivos

| Archivo | Rol |
| --- | --- |
| `types.ts` | `PluginWorkshopPreviewEntry` (React + metadatos) |
| `registry.ts` | `registerPluginWorkshopPreview`, `getPluginWorkshopPreview`, `renderPluginWorkshopPreview` |
| `host-bridge.ts` | Expone React/registry al bundle embebido |
| `load-installed-workshop-ui.ts` | `import()` dinámico tras login / install |
| `bootstrap.ts` | Inicializa host + carga bundles instalados |

## Autor de plugin

Empaqueta el bundle en el `.tfplugin` y declara en el manifest:

```json
{
  "workshopUi": {
    "entry": "workshop-ui/workshop-preview.js",
    "hostApiVersion": "1"
  }
}
```

Ver `docs/PLUGINS-PACKAGING.md` y el repo `evd-plugin` como referencia.
