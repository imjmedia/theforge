# Plugin UI (`plugin-ui/`)

Extensión genérica del Workshop para **vistas preview de artifacts de plugins**.

## Contrato

1. **Backend (plugin):** `getArtifactTypes()` declara `workshopPreview: "{pluginId}/{kind}"`.
2. **Vendor en el core:** copia en `vendors/{plugin}-workshop-ui/` (p. ej. EVD) registrada en `bootstrap.ts`. Evita `file:` links a repos hermanos que rompen Docker.
3. **Core (aquí):** `bootstrap.ts` registra las entradas al arrancar la app. `PluginDocPanel` resuelve por `artifact.workshopPreview` — **sin hardcodear plugin IDs**.

## Archivos

| Archivo | Rol |
| --- | --- |
| `types.ts` | `PluginWorkshopPreviewEntry` (React + metadatos) |
| `registry.ts` | `registerPluginWorkshopPreview`, `getPluginWorkshopPreview`, `renderPluginWorkshopPreview` |
| `bootstrap.ts` | Instala registros de vendors embebidos (`vendors/evd-workshop-ui`, …) |

## Añadir un plugin nuevo

```ts
// bootstrap.ts
import { myPluginRegistration } from "@/plugin-ui/vendors/my-plugin-workshop-ui/registration";
registerPluginWorkshopPreview(myPluginRegistration);
```

Añadir carpeta vendor y redeploy web.
