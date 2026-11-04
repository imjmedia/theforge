# 04 — Plan de pruebas

Volver al [README](./README.md). Requisitos en [01](./01-PRD.md). Casos límite en [05](./05-casos-limite.md).

Runner del repo: `node scripts/run-tests.mjs` con `--test-path-pattern=` en api, web y shared-types (node:test).

## Pirámide

| Nivel | Qué cubre | Comando |
|---|---|---|
| Unitarias shared-types (goldens) | `design-spec`, `compile-data-needs-to-pag`, `compile-pag-to-mdd-sections`, `export-pag-to-msw`, `build-pag-fixtures`, `design-first-gates`, `render-design-markdown`, `project-type`, `deliverables-matrix`, `mdd-dependent-deliverables`. Golden byte a byte sobre `__fixtures__/three-screens*`. | `pnpm --filter @theforge/shared-types test` |
| Unitarias e integración API (node:test) | Aislamiento del PAG, OpenAPI desde `architectureGraph`, `env.schema`, CAS 409/422, `route-coverage` y access wiring, semáforo por fases + regresión NEW, gate/cascada/claves dependientes, sellado del grafo pinned y fence, abort/deadline de visión, Figma, handoff/clone/Notion, anti-literal. | `pnpm --filter @theforge/api test --test-path-pattern=<x>` |
| Web | `slice-design`, utils de paneles, `complexityTabs` y `workshopDocNav` con DESIGN_FIRST. | `pnpm --filter @theforge/web test` |
| Tipos y build | Obligatorio en cada paso que toque shared-types. | `pnpm run typecheck` |
| Alineación MCP | Solo si cambian tools MCP. | `pnpm --filter @theforge/api run test:mcp-alignment` |
| Golden de visión (nocturno, **fuera de CI**) | 3-5 imágenes con tolerancia de recall y cero campos inventados. | Ejecución nocturna aparte |
| Smoke e2e | Paso 26: crear DESIGN_FIRST → fixture → compile-contract → job MDD → cascada → repo-handoff. | spec en `apps/api/src/smoke/` |

## Matriz requisito → prueba

| Req. | Prueba | Nivel | Comando |
|---|---|---|---|
| RF-01 | Creación con flag apagado (400) y encendido (`designSpec` inicial, revisión 0); create con LEGACY + modo de diseño → 400 | API | `pnpm --filter @theforge/api test --test-path-pattern=design-first` |
| RF-02 | Wizard sin selector UX_FIRST; proyectos UX_FIRST siguen leyéndose (spec util web) | Web | `pnpm --filter @theforge/web test` |
| RF-03 | CAS en `PUT screens`: 409 por revisión, 422 por I1 | API | `--test-path-pattern=design-first` |
| RF-04 | `import/images` devuelve diff sin persistir; `accept` aplica con CAS | API | `--test-path-pattern="design-proposal\|screen-extract"` |
| RF-05 | Import Figma con fixture grabado; reimport sin cambios → diff vacío | API | `--test-path-pattern=figma` |
| RF-06 | Arista a id inexistente → 422; en importación → warning | API + shared-types | `--test-path-pattern=design-first`; `pnpm --filter @theforge/shared-types test --test-path-pattern=design-spec` |
| RF-07 | Kreo activo completa `package`/`version`; MCP caído → warning y 200 | API | `--test-path-pattern=design-proposal` |
| RF-08 | Propuesta con procedencia marcada; `PUT data-needs` con CAS; I2/I3 | API | `--test-path-pattern=data-needs` |
| RF-09 | `gates.phase1/2/3` con `ok` e `issues[]` deterministas | shared-types + API | `pnpm --filter @theforge/shared-types test --test-path-pattern=design-first`; API `--test-path-pattern=design-first` |
| RF-10 | PAG y OpenAPI byte a byte iguales en dos corridas; persistencia de `architectureGraph` + hash | shared-types + API | `--test-path-pattern=design-first`; `--test-path-pattern=openapi-validate` |
| RF-11 | Sin `phase2.ok` → 409; topología pinned sin `data_model`/`api_contracts`; LLM simulado que reescribe §3/§4 no cambia bytes; 7 secciones | API | `--test-path-pattern="gate\|mdd-dependent\|clear-mdd"`; `--test-path-pattern=mdd-graph`; `--test-path-pattern=mdd-sections` |
| RF-12 | Semáforo por fases (ROJO/AMARILLO/VERDE), tope AMARILLO sin MDD | API | `--test-path-pattern=estimation` |
| RF-13 | Conteo = `designSpec.screens.length`; `computeCostEstimation` sin cambios | API | `--test-path-pattern=estimation` |
| RF-14 | Oleadas DESIGN_FIRST por complejidad; `api_contracts` sin LLM; `design_screens_render` falla cerrado | shared-types + API | `pnpm --filter @theforge/shared-types test --test-path-pattern=deliverables-matrix`; API `--test-path-pattern="deliverables\|cascade\|ui-screens"` |
| RF-15 | `openapi.json`/`.yaml` leen `architectureGraph` primero (fallback `documentAst`) | API | `--test-path-pattern=openapi` |
| RF-16 | Handoff con `openapi.yaml`, `mocks/*`, `pantallas.md`, `datos.md` | API | `--test-path-pattern="handoff\|clone\|notion"` |
| RF-17 | Editar tras compilar → `stale`; cascada → 409 `ERR_DESIGN_STALE` | API | `--test-path-pattern=design-first`; `--test-path-pattern="gate\|mdd-dependent\|clear-mdd"` |
| RF-18 | Clone y roundtrip Notion preservan tipo, `designSpec`, `architectureGraph` | API | `--test-path-pattern="handoff\|clone\|notion"` |
| RF-19 | `/me/integrations/figma`: GET sin token | API | `--test-path-pattern=figma` |
| RNF-01 | Grep del token en logs y TokenUsage = 0; rotación incluye `UserFigmaCredential` | API | `--test-path-pattern=figma` |
| RNF-02 | Goldens byte a byte; hash canónico independiente del orden de claves | shared-types | `pnpm --filter @theforge/shared-types test` |
| RNF-03 | Specs existentes de cascada, semáforo, OpenAPI y grafo MDD en verde; regresión del semáforo NEW sobre fixtures; OpenAPI de NEW idéntico (golden) | API + shared-types | `pnpm test` |
| RNF-04 | Límites de spec, pantallas, imágenes y nodos → 413/422 | API + shared-types | `--test-path-pattern="design-first\|design-proposal\|figma"` |
| RNF-05 | Presupuestos < 15000 inválidos; abort no persiste nada | API | `--test-path-pattern=env.schema`; `--test-path-pattern="design-proposal\|screen-extract"` |
| RNF-06 | TokenUsage con `designScreenSpec`/`designDataNeeds` y `context: "design_first"`; métrica `pinned_section_drift` | API | `--test-path-pattern="screen-extract\|data-needs\|mdd-graph"` |
| RNF-07 | Rutas decoradas con su nivel; SHARED sin `spend` → 403 | API | `--test-path-pattern=route-coverage` |
| RNF-08 | 429 con `Retry-After`, máximo 2 reintentos, backoff; timeout | API | `--test-path-pattern=figma` |
| RNF-09 | Migración dos veces sin error; backfill idempotente | Manual + build | `pnpm run db:generate && pnpm run db:migrate && pnpm run typecheck` |
| RNF-10 | Mensajes de error y textos de UI en español | Revisión + web | `pnpm --filter @theforge/web test` |
| Defecto PAG | Dos proyectos concurrentes no comparten PAG | API | `--test-path-pattern=pag-isolation` |
| Helpers | Ningún literal `"NEW"` en contexto de projectType | API | `--test-path-pattern=project-type-literals` |

## Datos de prueba

| Dato | Ubicación | Uso |
|---|---|---|
| Spec de 3 pantallas | `packages/shared-types/src/design-first/__fixtures__/three-screens.json` | Entrada golden (paso 6) |
| PAG golden | `__fixtures__/three-screens.pag.json` | Salida golden de `compileDataNeedsToPag` (paso 7) |
| Goldens de OpenAPI, MSW, fixtures y markdown | `__fixtures__/three-screens*` | Pasos 8 y 14 |
| Golden de regresión OpenAPI NEW | spec de `document-compiler` | El OpenAPI de NEW no cambia (paso 8) |
| Fixture grabado de Figma | `apps/api/src/modules/figma/__fixtures__/file-response.json` | Mapeo, idempotencia, frames sin `transitionNodeID` resoluble (paso 18) |
| Imágenes del golden de visión | Fuera de CI (3-5 imágenes) | Recall y cero campos inventados (nocturno) |
| Fixtures del semáforo NEW | spec de estimation | Regresión de NEW (paso 11) |

## Mocks y dobles

| Doble | Para qué |
|---|---|
| LLM simulado | Visión (salida inválida → una reparación → 502), propuesta de datos, y un LLM que intenta reescribir §3/§4 en el grafo pinned. |
| Figma grabado | Respuestas reales grabadas, más 401/403, 429 con `Retry-After` y timeout. |
| MCP gráfico caído | `resolve_component` falla → warning y 200. |
| Fence perdido | Turno MDD zombi → `MddWriteFencedError` sin reintento. |
| Abort / deadline | Visión y datos: sin propuesta ni escritura, sin reintento; abort después de §2 deja el Stage intacto. |
| Dos proyectos concurrentes | Aislamiento del PAG. |

## Criterios de salida

La funcionalidad se da por terminada solo con todo esto en verde:

- [ ] `pnpm --filter @theforge/shared-types test` (goldens byte a byte).
- [ ] `pnpm --filter @theforge/api test` completo, incluidas las suites nuevas y las existentes de cascada, semáforo, OpenAPI y grafo MDD.
- [ ] `pnpm --filter @theforge/web test` y `pnpm --filter @theforge/web run test:types`.
- [ ] `pnpm run typecheck` (build + test:types).
- [ ] `pnpm --filter @theforge/api test --test-path-pattern=route-coverage`.
- [ ] Test anti-literal: `pnpm --filter @theforge/api test --test-path-pattern=project-type-literals`.
- [ ] `git diff --stat packages/business-rules` vacío.
- [ ] Migraciones: `pnpm run db:generate && pnpm run db:migrate`, dos veces sin error.
- [ ] `pnpm --filter @theforge/api run test:mcp-alignment` si cambiaron tools MCP.
- [ ] Smoke del paso 26 (`openapi.yaml` válido y fixtures parseables).
- [ ] `pnpm run build` y `pnpm test`.
- [ ] `detect_changes` de Ariadne revisado (radio de impacto) antes de proponer commit.
- [ ] Verificación visual del Workshop (abajo), registrando qué se vio.

## Verificación manual y visual (Workshop)

Con el flag encendido en local y un proyecto DESIGN_FIRST creado desde el wizard:

| Pantalla | Qué mirar |
|---|---|
| Wizard | Aparece el origen "Design-First"; no aparece UX_FIRST. Con flag apagado, la creación da error en español. |
| Badges | `ProjectFolderTile` y `WorkshopHeaderBar` muestran el modo; ajustes no permiten cambiarlo. |
| Pestañas | Se ven `Pantallas`, `Datos` y `Contrato` solo en DESIGN_FIRST; un proyecto NEW no cambia. |
| Pantallas | Estado vacío inicial; editar y guardar; ids/rutas duplicados muestran el error 422; subir imágenes abre `DesignProposalDiffDialog` con add/update/remove; aceptar y rechazar. |
| Conflicto | Guardar desde dos pestañas: la segunda recibe aviso y recarga (409). |
| Figma | Sin credencial: aviso de conectar (412). Con credencial: diff; reimportar sin cambios: diff vacío. Token inválido: pide reconectar. |
| Datos | Propuesta con procedencia (heurística/LLM/usuario) visible; issues de `phase2` visibles. |
| Contrato | compile-contract muestra resultado y puertas; editar pantallas después marca PAG y MDD como `stale`. |
| Métricas | Puertas de fase en la columna de métricas; semáforo ROJO/AMARILLO coherente; nunca VERDE sin MDD fresco. |
| Ajustes de usuario | `FigmaCredentialSettings`: conectar, ver `figmaHandle` y `lastValidatedAt`; el token nunca se vuelve a mostrar; desconectar. |
| General | Estados de carga, error y vacío en cada panel; textos en español; sin JSON crudo en pantalla. |
