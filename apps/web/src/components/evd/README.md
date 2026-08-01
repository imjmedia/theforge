# EVD — Visor de diapositivas (Workshop)

Componentes para mostrar el artifact **Executive Visual Deck** del plugin `com.kreodevs.evd` en The Forge.

## Componentes

| Archivo | Descripción |
| --- | --- |
| `EvdDeckPreview.tsx` | Carrusel 16:9 con fondo generado (base64), título, contenido por tipo de slide y navegación anterior/siguiente. |
| `EvdSlideContent.tsx` | Renderiza el cuerpo textual según `slide.type` (pain points, features, timeline, etc.). |
| `evd-deck.types.ts` | Tipos mínimos del JSON EVD en el cliente web. |

## Integración

- `PluginDocPanel` detecta el artifact EVD y abre en modo **Diapositivas** por defecto.
- Toggle **Diapositivas / JSON** en la barra superior del panel.
- Modo JSON muestra el deck sin blobs base64 (`utils/evdDeck.ts` → `sanitizeEvdDeckForDisplay`).
- `StandardDocPanel` acepta `previewSlot` para vistas preview no-markdown.

## Atajos

- `←` / `→`: diapositiva anterior / siguiente (cuando el foco está en la ventana).
