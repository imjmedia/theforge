# Plugin UI (`plugin-ui/`)

Extensión genérica del Workshop para **vistas preview de artifacts de plugins**.

## Contrato

1. **Backend (plugin):** `getArtifactTypes()` declara `workshopPreview: "{pluginId}/{kind}"`.
2. **Paquete npm del plugin:** exporta `*WorkshopPreviewRegistration` con el mismo `id`, componente `Preview`, y opcionalmente `parsePayload` / `toEditorText`.
3. **Core (aquí):** `bootstrap.ts` registra las entradas al arrancar la app. `PluginDocPanel` resuelve por `artifact.workshopPreview` — **sin hardcodear plugin IDs**.

## Archivos

| Archivo | Rol |
| --- | --- |
| `types.ts` | `PluginWorkshopPreviewEntry` (React + metadatos) |
| `registry.ts` | `registerPluginWorkshopPreview`, `getPluginWorkshopPreview`, `renderPluginWorkshopPreview` |
| `bootstrap.ts` | Instala registros de paquetes npm (`@kreodevs/evd-workshop-ui`, …) |

## Añadir un plugin nuevo

```ts
// bootstrap.ts
import { myPluginRegistration } from "@vendor/my-plugin-workshop-ui";
registerPluginWorkshopPreview(myPluginRegistration);
```

Añadir dependencia en `apps/web/package.json` y redeploy web.
