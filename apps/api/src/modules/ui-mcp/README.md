# `ui-mcp` — MCP gráfico (componentes UI)

Integración con **MCPs externos de componentes UI**. The Forge define un contrato
(`@theforge/shared-types/ui-mcp-contract`) y usa el MCP **compatible y activo** para sustituir
componentes genéricos por reales en las secciones UI/UX del MDD/Blueprint, inferir el design system
y generar el deliverable **«Pantallas / UI Screens Spec»** (texto, sin TSX).

## Contrato de compatibilidad

Un MCP es **compatible** cuando:

1. **Nativo:** `tools/list` expone `describe_capabilities`, `list_components`, `resolve_component` y
   `describe_capabilities` declara un `contractVersion` reconocido, **o**
2. **Adaptador genérico:** no cumple el contrato nativo pero `tools/list` coincide con un adaptador
   registrado (p. ej. MCP con `resolve_component_for_entity` + `get_ui_component_catalog`).

Tools opcionales del contrato nativo: `list_screens`, `get_design_tokens`.

## Piezas

| Archivo | Rol |
|---------|-----|
| `adapters/semantic-catalog-ui-mcp.adapter.ts` | Adaptador genérico: MCPs con `resolve_component_for_entity` + `get_ui_component_catalog` (Kreo y otros). |
| `adapters/kreo-ui-mcp.adapter.ts` | Alias legacy → reexport del adaptador semántico. |
| `adapters/ui-mcp-adapter.registry.ts` | Matching de adaptadores por `tools/list`. |
| `ui-mcp.service.ts` | CRUD de `UiMcpInstance` (team-wide), activación exclusiva, detección de compatibilidad (persistida) y token cifrado con `TokenCryptoService`. Expone `getActiveCompatibleConnection` / `hasActiveCompatible` / `getActiveCompatibleMeta`. |
| `ui-mcp-client.service.ts` | Cliente de alto nivel del MCP activo+compatible. Tools parseados con Zod; cualquier error → `null` para fallback heurístico. |
| `ui-mcp-transport.util.ts` | Transporte JSON-RPC sobre HTTP/SSE con URL/token explícitos (evita el bug de `baseUrl` de `TheForgeService`). |
| `ui-mcp.controller.ts` | REST `/api/ui-mcp` (list/create/update/delete/activate/detect/test/active). Solo admin/super_admin para mutaciones. |
| `ui-component-resolver.ts` | `UiComponentResolver` pluggable: `HeuristicUiComponentResolver` (comportamiento previo) y `McpUiComponentResolver` (MCP con **fallback por-entidad**). |
| `ui-screens.service.ts` + `ui-screens.controller.ts` | Deliverable «Pantallas»: `syncUiScreens` (cruce §3 + HU, `list_screens`, respaldo `resolve_component`) → `POST /api/projects/:id/ui-screens/sync`; persiste en `Project.uiScreensContent`. Lee MDD del stage activo y `userStoriesContent`. |
| `ui-screens-mdd.util.ts` | Extracción tolerante de entidades §3 (`CREATE TABLE`) con headings pegados o SQL sin fence ```sql. |
| `ui-screens-plan.util.ts` | Cruce §3 + HU → plan de pantallas. Si MDD §2.2 lista **≥4 vistas administrativas**, prioriza journeys (no CRUD por cada tabla); excluye tablas glue (`agent_skills`, `messages`, …). API en columna solo desde `api-contracts` (sin `REST /api/...` inventado). |
| `ui-screens-markdown.util.ts` | Ensambla la spec de pantallas en markdown (columna Componentes según MCP activo). Anexo catálogo sin tokens. |
| `ui-project-instructions.util.ts` | Instrucciones de prototipo UI (UiProjectInstructions v1) cuando el MCP activo las soporta; export → `ui-project.json`. |
| `ui-screen-routes.util.ts` | Roles, rutas React Router, estados UI y helpers de journey. |
| `api-contract-endpoints.util.ts` | Endpoints verificables desde `api-contracts.md` (no inventar REST). |
| `ui-design-system-section.util.ts` | Construye la sección de design system inferido del MCP para la Guía UX/UI. |

## Consumo

- **MDD UI/UX Design Intent** — `mdd-enrich-uiux-intent` recibe el resolver (async) vía el chokepoint `prepareMddForOutput`.
- **MDD §2 Frontend — UI Library** — Con MCP compatible activo, `mdd-inject-ui-mcp-frontend.util` añade la librería del MCP en **Stack UI → UI Library** (ej. `Tailwind CSS + Radix UI + Kreo UI 5.3`). El Arquitecto recibe hint en prompt; el chokepoint post-LLM garantiza la línea aunque el modelo la omita.
- **Blueprint §9** — `enrichBlueprintWithUiDesignSystem` anexa UI tras generación (§8 reservado al checklist del prompt); recibe el resolver (async) desde `ProjectsService`.
- **Guía UX/UI** — `ProjectsService.generateUxUiGuide` anexa la sección de design system del MCP si hay uno compatible activo.
- **Export / handoff** — `uiScreensContent` → `{featureDir}/pantallas.md` + `ui-project.json` (solo si el MCP soporta prototipo) + espejo `docs/sdd/pantallas.md`.
- **Formato accionable** — tablas por rol (Ruta, Página, US, Componentes UI, API, Estados); endpoints solo de api-contracts; sin MCP → shadcn/ui + design-system.

Sin MCP compatible activo, **todo cae al comportamiento heurístico/Ariadne** actual.

## Design-First (`ProjectType.DESIGN_FIRST`)

- **`POST /api/projects/:id/ui-screens/sync`** (`UiScreensService.syncUiScreens`) responde **409** con código **`ERR_DESIGN_FIRST_SCREENS_OWNED`**: las pantallas del handoff las genera la cascada `design_screens_render` desde `Stage.designSpec`, no el sync MCP.
- El MCP gráfico sigue siendo **opcional** para enriquecer componentes en propuestas de diseño u otros entregables; no sustituye credenciales Figma (módulo `figma/`).
- Ver `apps/api/src/modules/design-first/README.md` y [docs/notebooklm/DESIGN-FIRST.md](../../../../docs/notebooklm/DESIGN-FIRST.md).
