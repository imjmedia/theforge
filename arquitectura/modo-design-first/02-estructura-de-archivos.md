# 02 — Estructura de archivos

Volver al [README](./README.md). Responsabilidades técnicas en [03](./03-arquitectura-y-diseno.md). Fichas de ejecución en [TASKS](./tasks/TASKS.md).

Marcas: `[nuevo]` crea el archivo; `[modifica]` cambia uno existente. Este paquete **no elimina archivos**.

## Árbol

```
packages/database/
  schema.prisma                                                     [modifica] enum, columnas Stage, UserFigmaCredential, @deprecated
  migrations/20261104090000_stage_architecture_graph/migration.sql  [nuevo]    columnas PAG + backfill
  migrations/20261104100000_project_type_design_first/migration.sql [nuevo]    solo ALTER TYPE ADD VALUE
  migrations/20261104110000_design_first_spec_figma/migration.sql   [nuevo]    designSpec, revision, UserFigmaCredential
  scripts/safe-schema-sync.sql                                      [modifica] réplica idempotente

packages/shared-types/src/
  project-type.ts (+ .spec)                                         [nuevo]    isGreenfield / isLegacy / isDesignFirst / assertNever
  project.ts                                                        [modifica] ProjectTypeEnum + DESIGN_FIRST; UX_FIRST @deprecated
  index.ts                                                          [modifica] exports
  document-compiler.ts                                              [modifica] operationId, example, x-theforge-sources
  deliverables-matrix.ts (+ .spec)                                  [modifica] oleadas DESIGN_FIRST, opción projectType
  mdd-dependent-deliverables.ts (+ .spec)                           [modifica] getMddDependentKeys(projectType)
  design-first/
    index.ts                                                        [nuevo]    exports del submódulo
    design-spec.ts (+ .spec)                                        [nuevo]    esquemas zod, I1-I3, hash canónico, adaptadores v1
    compile-data-needs-to-pag.ts (+ .spec)                          [nuevo]    DataNeeds → PAG determinista (I4-I6)
    design-first-gates.ts (+ .spec)                                 [nuevo]    evaluateDesignFirstPhaseGates
    export-pag-to-msw.ts (+ .spec)                                  [nuevo]    handlers MSW v2 como string
    build-pag-fixtures.ts (+ .spec)                                 [nuevo]    fixtures con semilla, FK consistentes
    render-design-markdown.ts (+ .spec)                             [nuevo]    pantallas.md / datos.md
    compile-pag-to-mdd-sections.ts (+ .spec)                        [nuevo]    §3 (CREATE TABLE + ER + prosa plantilla) y §4 en formato MDD
    __fixtures__/three-screens*.json                                [nuevo]    goldens (3 pantallas)

apps/api/
  package.json                                                      [modifica] ajv + ajv-formats
  src/app.module.ts                                                 [modifica] registra DesignFirstModule y FigmaModule
  src/config/env.schema.ts (+ .spec), README.md                     [modifica] DESIGN_FIRST_*, FIGMA_*, COMPILER_FIRST_*
  src/common/project-type-literals.spec.ts                          [nuevo]    test anti-literal "NEW"
  src/smoke/ (spec e2e de Design-First)                             [nuevo]    smoke del paso 26
  src/modules/ai/
    ai.service.ts                                                   [modifica] sin lastGeneratedPag; extractScreenSpecFromImages; proposeDataNeeds
    ai.service.pag-isolation.spec.ts                                [nuevo]    dos proyectos concurrentes no comparten PAG
    workshop-system-prompt.builder.ts                               [modifica] rama DESIGN_FIRST (helpers)
    interfaces/llm-provider.interface.ts                            [modifica] helpers de projectType
    utils/suggest-agent-governance-artifacts.ts                     [modifica] helpers de projectType
  src/modules/ai-orchestrator/ai-orchestrator.service.ts            [modifica] helpers de projectType
  src/modules/agent-supervisor/agent-supervisor.types.ts            [modifica] helpers de projectType
  src/modules/ai-analysis/
    ai-analysis.service.ts (entrada de jobs MDD)                    [modifica] 409 ERR_DESIGN_PHASE_GATE, inyección s3/s4
    estimation/estimation.service.ts                                [modifica] semáforo por fases + resolveScreenCount
    estimation/estimation.design-first.spec.ts                      [nuevo]    fases, regresión NEW
    graph/mdd-graph.ts (+ mdd-graph.topology.spec.ts)               [modifica] rutas pinned
    graph/ (spec de sellado §3/§4)                                  [nuevo]    sellado byte a byte
    state/* (estado MDD)                                            [modifica] designFirstPinned
    nodes/mdd-cross-consistency.node.ts                             [modifica] filtra parches sobre §3/§4
    nodes/ prepare_output                                           [modifica] barrera por hash + pinned_section_drift
    nodes/ auditor                                                  [modifica] puntuación determinista §3/§4
    prompts/design-first-clarifier.md                               [nuevo]    Clarifier con pantallas/flujos/PAG como datos
  src/modules/projects/
    projects.service.ts (+ spec OpenAPI)                            [modifica] OpenAPI lee architectureGraph
    project-deliverable-generators.service.ts                       [modifica] persiste architectureGraph; contratos DESIGN_FIRST
    project-lifecycle.service.ts                                    [modifica] crea DESIGN_FIRST detrás del flag
    project-deliverable-gate.service.ts                             [modifica] puertas DESIGN_FIRST, stale
    deliverables-cascade.service.ts                                 [modifica] projectType a oleadas; design_screens_render falla cerrado
    clear-mdd-dependent-deliverables.util.ts (+ .spec)              [modifica] claves por modo
    handoff-export.util.ts                                          [modifica] openapi.yaml, mocks/, datos.md
    sdd-integration.service.ts                                      [modifica] helpers; handoff DESIGN_FIRST
    project-clone.util.ts                                           [modifica] preserva designSpec/architectureGraph
    project-notion-export.util.ts                                   [modifica] helpers; preserva tipo y diseño
    project-notion-import.util.ts                                   [modifica] preserva tipo y diseño
    project-notion-portability.service.ts                           [modifica] helpers greenfield
    project-merge.service.ts                                        [modifica] helpers; merge DESIGN_FIRST → 409
    project-merge-conflicts.util.ts                                 [modifica] helpers
    integration/project-integration.service.ts                      [modifica] helpers greenfield
  src/modules/ui-mcp/ui-screens.service.ts                          [modifica] 409 ERR_DESIGN_FIRST_SCREENS_OWNED
  src/modules/design-first/                                         [nuevo]    DesignFirstModule
    README.md
    design-first.module.ts
    design-first.controller.ts
    design-spec.service.ts
    design-proposal.service.ts
    design-contract.service.ts
    design-artifacts.service.ts
    openapi-validate.util.ts
    data-needs-heuristic.util.ts
    (+ specs colocados)
  src/modules/figma/                                                [nuevo]    FigmaModule
    README.md
    figma.module.ts
    figma-credential.service.ts
    figma-credential.controller.ts
    figma.client.ts
    figma-import.service.ts
    figma-to-screens.mapper.ts
    __fixtures__/file-response.json
    (+ specs colocados)

apps/web/src/
  App.tsx                                                           [modifica] helpers, tipos de shared-types, badges
  components/ProjectFolderTile.tsx                                  [modifica] helpers, badge DESIGN_FIRST
  components/CreateProjectWizardDialog.tsx                          [modifica] origen "Design-First"; oculta UX_FIRST
  components/IntegrationPanel.tsx                                   [modifica] helpers
  components/ProjectSettingsDialog.tsx                              [modifica] modo fijado al crear
  components/FigmaCredentialSettings.tsx                            [nuevo]    conectar/desconectar Figma
  store/workshop/types.ts                                           [modifica] tipos desde shared-types; estado design
  store/workshop/initial-state.ts                                   [modifica] estado inicial design
  store/workshop/selectors.ts                                       [modifica] selectores design
  store/workshop/helpers/chat-scope.ts                              [modifica] helpers
  store/workshop/slice-design.ts (+ .spec)                          [nuevo]    slice con revision y CAS
  api/design-first.api.ts                                           [nuevo]    cliente API encapsulado (ver nota de ruta)
  utils/complexityTabs.ts                                           [modifica] helpers; pestañas Design-First
  utils/workshopDocNav.ts                                           [modifica] navegación Pantallas/Datos/Contrato
  views/WorkshopMetricsColumnInner.tsx                              [modifica] puertas de fase
  views/workshop/WorkshopHeaderBar.tsx                              [modifica] badge de modo
  views/workshop/WorkshopDocPanelContent.tsx                        [modifica] monta paneles design
  views/workshop/design/                                            [nuevo]
    WorkshopDesignScreensPanel.tsx
    WorkshopDesignDataNeedsPanel.tsx
    WorkshopDesignContractPanel.tsx
    DesignProposalDiffDialog.tsx
    design-panels.util.ts (+ .spec)

scripts/rotate-master-key.ts                                        [modifica] UserFigmaCredential + UiMcpInstance
.env.example                                                        [modifica] variables nuevas (sin valores reales)

docs/
  notebooklm/DESIGN-FIRST.md                                        [nuevo]
  adr/0005-mdd-compilado-desde-pantallas.md                         [nuevo]
  adr/0006-architecture-graph-separado.md                           [nuevo]
  recovery/design-first-rollback.sql                                [nuevo]    DESIGN_FIRST → NEW con tabla de auditoría
  notebooklm/THEFORGE-INDEX.md                                      [modifica] §4 Figma
  notebooklm/ENTREGABLES-SDD-VALIDACION.md                          [modifica] §3 Guía UX/UI
  MCP_GRAFICO.md                                                    [modifica] Stage.uiScreensContent → Project
apps/api/src/modules/crypto/README.md                               [modifica] TOKEN_MASTER_KEYS / TOKEN_ACTIVE_KEY_VERSION
apps/api/src/modules/projects/README.md                             [modifica]
apps/api/src/modules/ui-mcp/README.md                               [modifica]
apps/web/src/store/workshop/README.md                               [modifica]
CHANGELOG.md                                                        [modifica] [Unreleased]
```

## Archivo → responsabilidad → paso

### Base de datos

| Archivo | Responsabilidad | Paso |
|---|---|---|
| `packages/database/schema.prisma` | Columnas `Stage.architectureGraph`/`architectureGraphSourceHash`; enum `DESIGN_FIRST`; `designSpec`/`designSpecRevision`; modelo `UserFigmaCredential`; `@deprecated` en `Project.figmaMapping`/`uxDesignSource` | 2, 5 |
| `migrations/20261104090000_stage_architecture_graph/migration.sql` | Migración B parcial: columnas PAG + backfill `WHERE documentAst ? 'endpoints'` | 2 |
| `migrations/20261104100000_project_type_design_first/migration.sql` | Migración A aislada: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` | 5 |
| `migrations/20261104110000_design_first_spec_figma/migration.sql` | `designSpec`, `designSpecRevision`, tabla `UserFigmaCredential` | 5 |
| `scripts/safe-schema-sync.sql` | Réplica idempotente de todo lo anterior | 2, 5 |
| `docs/recovery/design-first-rollback.sql` | Down-script DESIGN_FIRST → NEW con tabla de auditoría | 5 |
| `scripts/rotate-master-key.ts` | Rotar `UserFigmaCredential` y saldar la deuda de `UiMcpInstance` | 5 |

### shared-types

| Archivo | Responsabilidad | Paso |
|---|---|---|
| `src/project-type.ts` (+spec) | Helpers `isGreenfield`/`isLegacy`/`isDesignFirst`/`assertNever`, única fuente del enrutamiento por tipo; luego DESIGN_FIRST como greenfield y merge → 409 | 4, 5 |
| `src/index.ts` | Exports de helpers y del submódulo design-first | 4, 6 |
| `src/project.ts` | `ProjectTypeEnum` + `DESIGN_FIRST`, `UX_FIRST` `@deprecated`; create acepta DESIGN_FIRST, LEGACY con modo de diseño → 400 | 5, 10 |
| `src/design-first/design-spec.ts` (+spec) | Esquemas zod, I1-I3, hash canónico, `toScreenSpecV1`/`fromScreenSpecV1`, tamaño máximo | 6 |
| `src/design-first/index.ts` | Exports del submódulo | 6 |
| `src/design-first/__fixtures__/three-screens.json` | Golden de entrada (3 pantallas) | 6 |
| `src/design-first/compile-data-needs-to-pag.ts` (+spec) | DataNeeds → PAG determinista (I4-I6) | 7 |
| `src/design-first/design-first-gates.ts` (+spec) | `evaluateDesignFirstPhaseGates` (I9) | 7 |
| `src/design-first/__fixtures__/three-screens.pag.json` | Golden del PAG | 7 |
| `src/document-compiler.ts` | `exportPagToOpenApiSpec` con `operationId`, `example` con semilla y `x-theforge-sources`; sin cambio para PAG sin fuentes | 8 |
| `src/design-first/export-pag-to-msw.ts` (+spec) | Handlers MSW v2 emitidos como string | 8 |
| `src/design-first/build-pag-fixtures.ts` (+spec) | Fixtures con semilla y FK consistentes (I8) | 8 |
| `src/design-first/render-design-markdown.ts` (+spec) | `pantallas.md` y `datos.md` | 8 |
| `src/mdd-dependent-deliverables.ts` (+spec) | `getMddDependentKeys(projectType)` | 12 |
| `src/deliverables-matrix.ts` (+spec) | `DELIVERABLE_WAVES_DESIGN_FIRST_BY_COMPLEXITY`; `resolveDeliverableWaves` con `projectType` | 13 |
| `src/design-first/compile-pag-to-mdd-sections.ts` (+spec) | `compilePagToMddSection3/4` en formato MDD | 14 |

### API: config, PAG y helpers

| Archivo | Responsabilidad | Paso |
|---|---|---|
| `apps/api/src/config/env.schema.ts` (+spec), `config/README.md` | Flags y presupuestos Design-First, `FIGMA_*`, `COMPILER_FIRST_*` | 1 |
| `.env.example` | Nombres de variables nuevas | 1 |
| `apps/api/src/modules/ai/ai.service.ts` | Paso 1: leer `COMPILER_FIRST_*` por helper de config. Paso 3: quitar `lastGeneratedPag`, devolver el PAG. Paso 16: `extractScreenSpecFromImages`. Paso 17: `proposeDataNeeds` | 1, 3, 16, 17 |
| `apps/api/src/modules/ai/ai.service.pag-isolation.spec.ts` | Aislamiento del PAG entre proyectos | 3 |
| `projects/project-deliverable-generators.service.ts` | Persistir `architectureGraph` (doble escritura en `documentAst` una release); en DESIGN_FIRST, `api_contracts` y `design_screens_render` desde PAG y `designSpec` | 3, 13 |
| `projects/projects.service.ts` (+spec OpenAPI) | Lectura `architectureGraph ?? documentAst con endpoints` | 3 |
| `projects/integration/project-integration.service.ts` | Helpers greenfield | 4 |
| `projects/sdd-integration.service.ts` | Helpers (paso 4); handoff DESIGN_FIRST (paso 20) | 4, 20 |
| `projects/project-notion-portability.service.ts` | Helpers | 4 |
| `projects/project-notion-export.util.ts` | Helpers (paso 4); preservar tipo y diseño (paso 20) | 4, 20 |
| `projects/project-merge.service.ts` | Helpers; merge con DESIGN_FIRST → 409 vía `project-type.ts` | 4, 5 |
| `projects/project-merge-conflicts.util.ts` | Helpers | 4 |
| `ai/workshop-system-prompt.builder.ts` | Helpers; rama DESIGN_FIRST | 4b |
| `ai/interfaces/llm-provider.interface.ts` | Helpers | 4b |
| `agent-supervisor/agent-supervisor.types.ts` | Helpers | 4b |
| `ai-orchestrator/ai-orchestrator.service.ts` | Helpers | 4b |
| `ai/utils/suggest-agent-governance-artifacts.ts` | Helpers | 4b |
| `apps/api/src/common/project-type-literals.spec.ts` | Falla ante `=== "NEW"` o `"NEW" \| "LEGACY"` en contexto de projectType | 4b |

### API: Design-First, semáforo, cascada y MDD

| Archivo | Responsabilidad | Paso |
|---|---|---|
| `apps/api/package.json` | Dependencias `ajv` + `ajv-formats` | 9 |
| `design-first/openapi-validate.util.ts` (+spec) | Validación OpenAPI 3.1 (esquema propio) + ajv 2020-12; issues con ruta (I7) | 9 |
| `design-first/design-first.module.ts`, `design-first.controller.ts`, `design-spec.service.ts`, `design-contract.service.ts`, `README.md` (+specs) | Módulo, rutas `projects/:id/design*`, CRUD con CAS, compile-contract, cálculo de `stale` | 10 |
| `apps/api/src/app.module.ts` | Registrar DesignFirstModule (paso 10) y FigmaModule (paso 18) | 10, 18 |
| `projects/project-lifecycle.service.ts` | Crear DESIGN_FIRST detrás de `DESIGN_FIRST_ENABLED` | 10 |
| `ai-analysis/estimation/estimation.service.ts`, `estimation.design-first.spec.ts` | Rama `isDesignFirstProjectType`, `hasEvaluableInput`, `resolveScreenCount` | 11 |
| `projects/project-deliverable-gate.service.ts` | Puertas DESIGN_FIRST, `stale` | 12 |
| `projects/clear-mdd-dependent-deliverables.util.ts` (+spec) | Claves por modo; no borra `designSpec` ni `architectureGraph` | 12 |
| `ai-analysis/ai-analysis.service.ts` (entrada del job MDD) | 409 `ERR_DESIGN_PHASE_GATE` (paso 12); inyección `designFirst: {pinnedSections, s3, s4, pagHash}` (paso 15) | 12, 15 |
| `projects/deliverables-cascade.service.ts` (+spec de cascada) | `projectType` a oleadas; `design_screens_render` falla cerrado; 409 si no `phase3.ok` o `stale` | 13 |
| `ui-mcp/ui-screens.service.ts` | `syncUiScreens` → 409 `ERR_DESIGN_FIRST_SCREENS_OWNED` | 13 |
| spec API de `mdd-sections` | Pasa la salida por `parseMarkdownMdd`, `validateApiTablesSyntax`, `extractMddSection4Endpoints` y el injector | 14 |
| `ai-analysis/graph/mdd-graph.ts`, `mdd-graph.topology.spec.ts`, spec de sellado | Rutas pinned; topología sin `data_model`/`api_contracts` | 15 |
| `ai-analysis/state/*` | Campo `designFirstPinned` | 15 |
| `ai-analysis/nodes/mdd-cross-consistency.node.ts` | Descartar parches sobre §3/§4 | 15 |
| nodo `prepare_output` | Reimponer §3/§4 desde snapshots, comparar hash, métrica `pinned_section_drift` | 15 |
| nodo auditor | Puntuación determinista de §3/§4; LLM solo §1, §2, §5-§7 | 15 |
| `ai-analysis/prompts/design-first-clarifier.md` | Clarifier con pantallas, flujos y PAG delimitados como datos | 15 |
| `design-first/design-proposal.service.ts` (+spec), controller | Propuestas en Redis con TTL, accept/reject con CAS (paso 16); enriquecimiento Kreo (paso 19) | 16, 19 |
| `design-first/data-needs-heuristic.util.ts` (+spec), controller | Heurística de DataNeeds + propuesta | 17 |
| `figma/*` (module, credential service/controller, client, import service, mapper, README, fixture, specs) | Credencial por usuario, cliente HTTP, mapeo determinista a pantallas | 18 |
| `ui-mcp/ui-mcp-client.service.ts` (uso, sin cambios de contrato) | `resolve_component` | 19 |
| `design-first/design-artifacts.service.ts` | Archivos del handoff (OpenAPI, MSW, fixtures, md) | 20 |
| `projects/handoff-export.util.ts` | `openapi.yaml`, `mocks/`, `docs/sdd/datos.md` y `pantallas.md` | 20 |
| `projects/project-clone.util.ts`, `project-notion-import.util.ts` (+specs `sdd-integration-handoff.spec.ts`, `project-clone.util.spec.ts`) | Preservar tipo, `designSpec`, `architectureGraph` | 20 |
| `apps/api/src/smoke/` | Smoke e2e Design-First | 26 |

### Web

| Archivo | Responsabilidad | Paso |
|---|---|---|
| `App.tsx`, `components/ProjectFolderTile.tsx`, `components/IntegrationPanel.tsx`, `store/workshop/types.ts`, `utils/complexityTabs.ts`, `store/workshop/helpers/chat-scope.ts` | Helpers; tipos importados de shared-types (se eliminan duplicados) | 4c |
| `components/CreateProjectWizardDialog.tsx` | Origen "Design-First"; oculta UX_FIRST (`:266-330`) | 21 |
| `App.tsx` (`:347-375`), `ProjectFolderTile.tsx`, `views/workshop/WorkshopHeaderBar.tsx`, `components/ProjectSettingsDialog.tsx` + spec util | Badges y modo | 21 |
| `store/workshop/slice-design.ts` (+spec), `api/design-first.api.ts`, `store/workshop/types.ts`, `initial-state.ts`, `selectors.ts` | Estado de servidor con revision; 409 recarga y avisa | 22 |
| `views/workshop/design/*`, `utils/complexityTabs.ts`, `utils/workshopDocNav.ts`, `views/workshop/WorkshopDocPanelContent.tsx`, `views/WorkshopMetricsColumnInner.tsx` | Paneles de fases 1-3, pestañas, puertas en métricas | 23 |
| `components/FigmaCredentialSettings.tsx` + punto de montaje (por localizar) | Credencial Figma; el token no se vuelve a mostrar | 24 |

### Documentación

| Archivo | Responsabilidad | Paso |
|---|---|---|
| `docs/notebooklm/DESIGN-FIRST.md`, `docs/adr/0005-…`, `docs/adr/0006-…` | Guía del modo y ADRs | 25 |
| `THEFORGE-INDEX.md`, `ENTREGABLES-SDD-VALIDACION.md`, `MCP_GRAFICO.md`, README de crypto, projects, ui-mcp y store | Corregir discrepancias y documentar módulos | 25 |
| `apps/api/src/modules/design-first/README.md`, `apps/api/src/modules/figma/README.md` | README de módulos nuevos | 10, 18 |
| `CHANGELOG.md` | `[Unreleased]`: Added / Changed / Fixed con párrafo `>` de resumen | 25 |

> Nota: la regla global de Jorge exige que cada commit con cambio lleve su entrada en `CHANGELOG.md`. El plan concentra la redacción final en el paso 25; si se commitea por paso, cada commit debe agregar su línea en `[Unreleased]` y el paso 25 la consolida.

## Archivos y zonas que NO deben tocarse

| Zona | Regla | Origen |
|---|---|---|
| `packages/business-rules/**` | Fórmula y tarifas intactas; solo cambia la fuente del conteo de pantallas. Verificar con `git diff --stat packages/business-rules` vacío. | THEFORGE-INDEX §5, decisión D7 |
| Estructura de 7 secciones del MDD | `apps/api/src/modules/engine/mdd-markdown-parser.ts` es solo lectura; el MDD compilado tiene exactamente 7 secciones. | ENTREGABLES-SDD-VALIDACION §0 |
| Lease y fence del MDD | No se altera la semántica del lease (ADR 0003) ni del fencing token (ADR 0004). Solo `mddContent` pasa por fence; el diseño usa CAS. | `docs/adr/0003-…`, `docs/adr/0004-…` |
| `apps/api/src/modules/ai/adapters/` | Solo OpenRouter; no se agregan adaptadores. | Zona protegida del plan |
| `ProjectApproach.UX_FIRST` | No se reconvierte: solo se oculta del wizard y se anota `@deprecated`. | Decisiones D1, D8 |

Pasos con aprobación humana `[A]`: 2, 3, 5, 11, 12, 13 y 15.

## Archivos no verificados uno por uno

- **Estado del grafo y nodos `prepare_output` y `auditor`** (`ai-analysis/state/*`): el plan no los verificó individualmente. Quien ejecute el paso 15 los localiza desde el registro de nodos en `apps/api/src/modules/ai-analysis/graph/mdd-graph.ts:588-612`. Como pista (lectura de los imports de ese archivo, no verificada como alcance completo): `nodes/mdd-prepare-output.node.ts` (import en `:32`), `nodes/mdd-auditor.node.ts` (import en `:23`) y `state/index.ts` → `state/mdd-state.annotation.ts` (import en `:50`). Existe además `nodes/auditor.node.ts`; confirmar cuál registra `addNode("auditor", ...)`.
- **Panel BYOK de ajustes de usuario en la web**: no localizado por el plan. En el paso 24 hay que buscar dónde se configura `UserProviderConfig`. Pista: `apps/web/src/lib/user-providers-api.ts` lo consumen `components/AIProvidersCard.tsx` y `components/UserProviderConfigModal.tsx`, entre otros.
- **Ruta del cliente API de la web**: el plan indica `apps/web/src/api/design-first.api.ts`, pero hoy no existe `apps/web/src/api/`; los clientes viven en `apps/web/src/lib/*-api.ts` (p. ej. `ui-mcp-api.ts`, `user-providers-api.ts`). Manda el código: el cliente se crea como `apps/web/src/lib/design-first-api.ts` (paso 22), siguiendo la convención del repo.
