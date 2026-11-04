# Design-First — guía operativa (The Forge)

**Tipo de proyecto:** `ProjectType.DESIGN_FIRST` (greenfield; distinto de NEW/LEGACY).  
**Plan detallado:** `arquitectura/modo-design-first/` (PRD, arquitectura, TASKS).  
**ADR formales:** [0005 — MDD compilado desde pantallas](../adr/0005-mdd-compilado-desde-pantallas.md), [0006 — `architectureGraph` separado](../adr/0006-architecture-graph-separado.md).

---

## Resumen

Design-First invierte el orden habitual: el equipo define **pantallas y flujos** (fase 1), luego **necesidades de datos** (fase 2) y, con puertas cumplidas, un **PAG determinista**, **OpenAPI 3.1** y un **MDD de 7 secciones** con §3/§4 **selladas** desde el PAG. La fuente de verdad del diseño es un único JSON `Stage.designSpec` con CAS por `designSpecRevision`. El grafo de arquitectura vive en `Stage.architectureGraph`, no mezclado con el AST legacy del MDD en `documentAst`.

Flujos NEW/LEGACY y el semáforo SDD clásico **no se eliminan**; Design-First añade oleadas, puertas y pestañas propias en el Workshop.

---

## Fases y puertas

| Fase | Contenido en `designSpec` | Puerta (I9) | Efecto al cumplir |
|------|---------------------------|-------------|-------------------|
| **1** | `screens`, `navigation` | `phase1` | Permite avanzar a datos; semáforo por fases (tope AMARILLO sin MDD). |
| **2** | `entities`, `dataNeeds` | `phase2` | Deriva `domainInventory`; habilita compilación de contrato. |
| **3** | PAG + OpenAPI válidos | `phase3` | Permite job MDD pinned, cascada Design-First y estimación completa. |

Evaluación: `evaluateDesignFirstPhaseGates` en `@theforge/shared-types/design-first`. Errores de puerta en jobs/entregables: `ERR_DESIGN_PHASE_GATE`, obsolescencia respecto al baseline MDD: `ERR_DESIGN_STALE`.

---

## Persistencia

| Campo | Modelo | Notas |
|-------|--------|-------|
| `designSpec`, `designSpecRevision` | `Stage` | Documento único (pantallas + datos); PUT con CAS (`updateMany` + revisión). |
| `architectureGraph`, `architectureGraphSourceHash` | `Stage` | PAG; lectura preferente para OpenAPI; fallback temporal a `documentAst` con `endpoints`. |
| `mddContent`, `mddLeaseFence` | `Stage` | MDD Constitución; solo `mddContent` usa fence (ADR 0004). |
| `uiScreensContent` | **`Project`** | En DESIGN_FIRST lo rellena `design_screens_render` desde `designSpec`, no `ui-mcp` sync. |

Propuestas HITL (imágenes, Figma, data-needs): Redis con TTL (~24 h); clave `design-first:proposal:{projectId}:{proposalId}`. Sin `REDIS_URL` en dev/test: memoria en proceso.

---

## API REST (DesignFirstModule)

Prefijo: `/projects/:id/design*` (autorización `@ProjectScoped`; escrituras requieren `DESIGN_FIRST_ENABLED` salvo lectura).

| Método | Ruta | Rol |
|--------|------|-----|
| `GET` | `/design` | Leer spec + gates + revisión |
| `PUT` | `/design/screens` | Fase 1 (CAS) |
| `PUT` | `/design/data-needs` | Fase 2 (CAS) |
| `POST` | `/design/compile-contract` | PAG + validación OpenAPI (determinista) |
| `POST` | `/design/data-needs/propose` | Propuesta LLM/heurística (`spend`) |
| `POST` | `/design/import/images` | Propuesta desde imágenes (`spend`) |
| `POST` | `/design/import/figma` | Propuesta desde Figma (`spend`) |
| `POST` | `/design/proposals/:pid/accept` \| `reject` | Aplicar o descartar diff |

Figma BYOK (token personal, no team MCP): `GET`/`PUT`/`DELETE` `/me/integrations/figma`. Token cifrado en `UserFigmaCredential` vía `TokenCryptoService`.

OpenAPI del proyecto: `GET /projects/:id/openapi.json` y `openapi.yaml` (leen `architectureGraph` primero).

Detalle de códigos: `apps/api/src/modules/design-first/README.md`.

---

## Flags y límites (`env.schema.ts`)

| Variable | Default | Uso |
|----------|---------|-----|
| `DESIGN_FIRST_ENABLED` | `false` | Crear proyectos DESIGN_FIRST y mutaciones `/design*`. |
| `DESIGN_FIRST_MAX_SPEC_BYTES` | 524288 | Tamaño máximo de `designSpec`. |
| `DESIGN_FIRST_MAX_IMAGES` | 8 | Import por imágenes. |
| `DESIGN_FIRST_FIGMA_TIMEOUT_MS` | 60000 | Cliente Figma. |
| `DESIGN_FIRST_FIGMA_MAX_NODES` | 5000 | Tope de nodos por import. |
| `DESIGN_FIRST_VISION_BUDGET_MS` | 120000 | Presupuesto visión. |
| `DESIGN_FIRST_DATANEEDS_BUDGET_MS` | 120000 | Presupuesto propuesta de datos. |
| `FIGMA_API_BASE_URL` | https fijo | Solo URLs https. |

---

## Cascada y MDD

- Oleadas: `DELIVERABLE_WAVES_DESIGN_FIRST_BY_COMPLEXITY` (`packages/shared-types/src/deliverables-matrix.ts`).
- `api_contracts`: desde PAG, **sin LLM**.
- `design_screens_render`: markdown de pantallas desde `designSpec`; **falla cerrado** si falta diseño.
- `syncUiScreens` (`ui-mcp`): **409** `ERR_DESIGN_FIRST_SCREENS_OWNED` en DESIGN_FIRST.
- MDD: mismo grafo LangGraph con estado `designFirstPinned` (ADR 0005); §3/§4 vía `compilePagToMddSection3/4`; métrica `pinned_section_drift`.

En cascada automática, **`ux_ui_guide`** entra en la oleada W2 (junto con API, flujos, blueprint, etc.), no solo por chat; el chat sigue disponible para refinar la guía.

---

## Repo-handoff

`GET /projects/:id/export/repo-handoff` para DESIGN_FIRST incluye, además del bundle spec-kit habitual:

- `openapi.yaml`
- Handlers MSW v2 y fixtures JSON
- `docs/sdd/pantallas.md` y `docs/sdd/datos.md` (desde `renderDesignMarkdown`)

---

## Workshop (web)

- Cliente: `apps/web/src/lib/design-first-api.ts` (`/projects/:id/design*`).
- Estado: `apps/web/src/store/workshop/slice-design.ts` (revisión CAS, propuestas, puertas; 409 → recarga + aviso).
- Paneles: `apps/web/src/views/workshop/design/*` y pestañas en `complexityTabs.ts` para `DESIGN_FIRST`.

---

## Despliegue en dos releases (ADR-DF-09)

| Release | Qué despliega | Flag |
|---------|---------------|------|
| **N** | Enum `DESIGN_FIRST`, columnas, lectores tolerantes, documentación | `DESIGN_FIRST_ENABLED=false` |
| **N+1** | Encendido productivo (aprobación explícita) | `DESIGN_FIRST_ENABLED=true` |

Rollback documentado: `docs/recovery/design-first-rollback.sql`. Cliente Prisma antiguo no tolera valores de enum desconocidos: no mezclar código nuevo con client viejo en la misma release.

---

## MCP gráfico y Figma (no confundir)

- **MCP gráfico (`ui-mcp`):** instancia **team-wide** para enriquecer componentes en documentos; opcional en propuestas de pantallas.
- **Figma import:** módulo **Figma** + credencial **por usuario**; no es la integración genérica mencionada en el semáforo legacy (`hasUxTeam` / referencia de diseño en JSON del MDD).

Ver [THEFORGE-INDEX.md §4.3](THEFORGE-INDEX.md#43-figma-semáforo-vs-design-first) y [MCP_GRAFICO.md](../MCP_GRAFICO.md).

---

## Enlaces útiles

- Módulo API: `apps/api/src/modules/design-first/`
- Tipos y compiladores: `packages/shared-types/src/design-first/`
- Casos límite: `arquitectura/modo-design-first/05-casos-limite.md`
- Riesgos y decisiones cortas: `arquitectura/modo-design-first/06-riesgos-y-decisiones.md`
