# 05 — Casos límite

Volver al [README](./README.md). Pruebas en [04](./04-plan-de-pruebas.md). Contratos y errores en [03](./03-arquitectura-y-diseno.md#contratos).

La columna "Paso" indica la ficha de [TASKS](./tasks/TASKS.md) que implementa el comportamiento. Cuando aparecen dos pasos, el primero lo implementa y el segundo lo expone o lo completa.

| ID | Escenario | Comportamiento esperado | Prueba que lo cubre | Paso |
|---|---|---|---|---|
| CL-01 | Token Figma inválido o expirado (401/403) | 401 `ERR_FIGMA_TOKEN_INVALID`, `lastValidatedAt` sin cambios, la UI pide reconectar. | `figma` (fixture con 401/403) | 18, 24 |
| CL-02 | URL sin `fileKey` válido | 400 `ERR_FIGMA_URL`. | `figma` (validación regex) | 18 |
| CL-03 | Archivo sin frames | 422 `ERR_FIGMA_NO_FRAMES` y diff vacío. | `figma` (mapper) | 18 |
| CL-04 | 429 de Figma | Respeta `Retry-After`, 2 reintentos como máximo; después 503 `ERR_FIGMA_RATE_LIMIT` con `retryAfterSec`. | `figma` (client 429) | 18 |
| CL-05 | Más nodos que `DESIGN_FIRST_FIGMA_MAX_NODES` | 413, o se limita a `nodeIds`. | `figma` (límite) | 18 |
| CL-06 | Transición rota | Warning en la propuesta; no se descarta en silencio. | `figma` (frames sin `transitionNodeID` resoluble) | 18 |
| CL-07 | Imágenes ilegibles o sin pantallas | Propuesta vacía con `issues`, sin escritura. | `screen-extract` (LLM simulado) | 16 |
| CL-08 | Exceso de imágenes o bytes | 413 antes de llamar al LLM. | `design-proposal` / `screen-extract` | 16 |
| CL-09 | Salida de visión inválida tras 1 reparación | 502 `ERR_DESIGN_EXTRACT_INVALID`, con TokenUsage registrado. | `screen-extract` (LLM simulado) | 16 |
| CL-10 | Deadline o abort | Sin propuesta ni escritura, y sin reintento. | spec de abort de visión | 16 |
| CL-11 | ScreenSpec vacío | `phase1` en rojo y compile-contract 409. | `design-first` (gates + controller) | 7, 10 |
| CL-12 | Ids o rutas duplicados | 422 I1. En importación, el sufijo `-2` resuelve la colisión. | `design-spec`; `design-first`; `design-proposal` | 6, 10, 16 |
| CL-13 | Pantalla sin datos | Issue en `phase2` salvo `static: true`. | `design-first` (gates) | 7 |
| CL-14 | Campo sin tipo o con tipos contradictorios (I3) | 422 al guardar, o issue en la propuesta. | `design-spec`; `data-needs` | 6, 17 |
| CL-15 | Borrar una pantalla referenciada | 422 con la lista de referencias; el cliente puede pedir `cascade=true`. | `design-first` (CRUD) | 10 |
| CL-16 | Cambio de diseño tras compilar | PAG y MDD `stale`; la cascada responde 409 `ERR_DESIGN_STALE`; recompilar regenera. Si la edición llega durante un job MDD, el job termina y el MDD queda `stale` por hash (sin bloqueo). Un turno MDD zombi recibe `MddWriteFencedError`. | `design-first` (stale); `gate\|mdd-dependent\|clear-mdd`; `fence` | 10, 12, 15 |
| CL-17 | PAG inválido al compilar | 422 con los issues de `validateProjectArchitectureGraph`, sin persistir y sin reparación por LLM. | `design-first` (compile-contract) | 7, 10 |
| CL-18 | OpenAPI inválido | 422 con rutas del validador; `phase3` en rojo. | `openapi-validate`; `design-first` | 9, 10 |
| CL-19 | Dos usuarios editando | El segundo `PUT` recibe 409 con la revisión actual; la UI recarga y avisa. | `design-first` (CAS); `slice-design` | 10, 22 |
| CL-20 | LEGACY intentando Design-First | `/design*` responde 400 `ERR_DESIGN_FIRST_NOT_ALLOWED`; crear un LEGACY con modo de diseño → 400. | `design-first` (controller + create) | 10 |
| CL-21 | Flag apagado | La creación da 400. Los proyectos DESIGN_FIRST ya existentes se leen y `/design*` responde 503 `ERR_DESIGN_FIRST_DISABLED` en escrituras. | `env.schema`; `design-first` | 1, 10 |
| CL-22 | DESIGN_FIRST en cascada sin `designSpec` o sin PAG | 409 `ERR_DESIGN_PHASE_GATE`. | `gate\|mdd-dependent\|clear-mdd`; `deliverables\|cascade` | 12, 13 |
| CL-23 | `syncUiScreens` en DESIGN_FIRST | 409 (`ERR_DESIGN_FIRST_SCREENS_OWNED`). | `ui-screens` | 13 |
| CL-24 | Migración sobre datos existentes | Backfill solo donde `documentAst ? 'endpoints'`. Rollback según la política de dos releases y el down-script. | Migración dos veces + `pnpm run typecheck` | 2, 5 |
| CL-25 | Clonar o roundtrip Notion | Preservan tipo, `designSpec` y `architectureGraph`. El import pareado NEW+LEGACY acepta DESIGN_FIRST como greenfield. | `handoff\|clone\|notion` | 4, 20 |
| CL-26 | Merge con DESIGN_FIRST | 409 en v1. | `project-type` (shared-types); specs de merge | 5 |
| CL-27 | Semáforo con fases parciales | ROJO o AMARILLO según las puertas; nunca VERDE sin MDD fresco. | `estimation` (`estimation.design-first.spec.ts`) | 11 |
| CL-28 | JSON por encima de `DESIGN_FIRST_MAX_SPEC_BYTES` | 413. | `design-spec`; `design-first` | 6, 10 |
| CL-29 | MCP gráfico caído | Warning y la petición sigue. | `design-proposal` (MCP caído) | 19 |
| CL-30 | Colaborador SHARED | Importa Figma con su propio token (`contribute`). Visión y propuesta de datos dan 403 `PROJECT_LEVEL_FORBIDDEN` (`spend`). | `route-coverage`; `figma`; `design-proposal` | 10, 16, 17, 18 |
| CL-31 | Usuario sin credencial Figma | 412 `ERR_FIGMA_NOT_CONNECTED`. | `figma` | 18 |

Las pruebas se nombran por su `--test-path-pattern`; el comando completo está en [04](./04-plan-de-pruebas.md#matriz-requisito--prueba).
