# 01 — PRD: Modo Design-First

Volver al [README](./README.md). Diseño técnico en [03](./03-arquitectura-y-diseno.md).

## Problema y contexto

### Cómo funciona hoy el SDD

- Un proyecto es `NEW` (greenfield) o `LEGACY`. El MDD de 7 secciones (la Constitución) se genera primero con el grafo LangGraph `mdd-graph.ts`; de él cuelgan la cascada de entregables, el PAG (`ProjectArchitectureGraph`), el OpenAPI y el semáforo.
- El PAG se genera con LLM y con self-healing que acepta un PAG inválido "con mejor esfuerzo" (`ai.service.ts:805-810`).
- `Stage.documentAst` está sobrecargado: lo escriben el AST del MDD (`session-chat-turn.runner.ts:322`, `project-mdd-persist.service.ts:498-508`) y el PAG (`project-deliverable-generators.service.ts:1257-1261`). El export OpenAPI (`projects.service.ts:480-506`) solo comprueba `"endpoints" in ast`.
- `AiService.lastGeneratedPag` es un campo de instancia del singleton (`ai.service.ts:369-372, :817`); lo leen contratos, logic flows (`:1587`) e infra (`:1766`). Esto permite que el PAG de un proyecto se filtre a otro proyecto o job (defecto multi-tenant actual).
- El semáforo solo sincroniza `Stage.status` cuando hay MDD: la condición `content.trim().length > 0` (`estimation.service.ts:1190`) impide escribir estado en etapas sin MDD.

### Qué hace `UX_FIRST` a medias

- `ProjectApproach.UX_FIRST` existe y tiene oleadas propias (`deliverables-matrix.ts:132-151`); la cascada pasa `approach` (`deliverables-cascade.service.ts:261-265`).
- No hay un modelo estructurado de pantallas ni de necesidades de datos que alimente el PAG: el contrato sigue saliendo del MDD y del LLM.
- No hay integración con Figma (aunque `THEFORGE-INDEX.md` §4 la menciona). `Project.figmaMapping` y `uxDesignSource` existen sin uso real.

### El problema

Los equipos que diseñan primero (pantallas en Figma o capturas) no tienen un camino donde las pantallas manden: el contrato de datos y de API se infiere del MDD con LLM, sin trazabilidad a pantallas, sin determinismo y sin mocks para que el frontend arranque.

## Objetivos

1. Agregar `ProjectType.DESIGN_FIRST` con tres fases: pantallas y flujos → necesidades de datos → PAG determinista + OpenAPI 3.1 + MDD compilado con §3/§4 fijadas.
2. Entregar un repo-handoff con `openapi.yaml`, handlers MSW v2 y fixtures consistentes.
3. Hacer el PAG de Design-First 100 % determinista y que falle cerrado.
4. Semáforo por fases que funcione sin MDD, con la fórmula MXN de `packages/business-rules` intacta.
5. Corregir de paso el defecto multi-tenant de `lastGeneratedPag` y la sobrecarga de `documentAst` (pasos 2-3).
6. No romper el flujo SDD NEW/LEGACY.

## No-objetivos

- Fase 4 (implementación) dentro de theforge: solo handoff.
- LEGACY en modo Design-First.
- Reconvertir `UX_FIRST`: solo se oculta del wizard y se marca `@deprecated`.
- Cambiar la fórmula o las tarifas de `packages/business-rules`.
- Fusionar (merge) proyectos DESIGN_FIRST: 409 en v1.
- Mocks dinámicos (Prism, servidor de mocks).
- Pase LLM de prosa sobre §3/§4 (decisión Q9).

## Usuarios y roles

Niveles de acceso por proyecto según `docs/adr/0001-autorizacion-por-proyecto.md` (`@ProjectScoped`):

| Nivel | Qué puede hacer en Design-First |
|---|---|
| `read` | `GET /projects/:id/design`: ver spec, revisión, puertas, hashes y `stale`; exportar OpenAPI. |
| `contribute` | Editar pantallas y datos (`PUT`), aceptar o rechazar propuestas, `compile-contract`, importar desde Figma con su propio token. |
| `spend` | Acciones con costo LLM: importar desde imágenes (visión), proponer necesidades de datos, lanzar el job MDD. |
| `manage` | Lo de `spend` más la administración del proyecto según el ADR 0001 (sin endpoints propios nuevos en este paquete). |

La credencial de Figma es **por usuario** (`/me/integrations/figma`), no por proyecto. Un colaborador `SHARED` importa Figma con su token (`contribute`) pero recibe 403 en visión y propuesta de datos si no tiene `spend` (CL-30).

## Historias de usuario

### Creación y modo

- **HU-01.** Como responsable de proyecto, quiero crear un proyecto Design-First desde el wizard para arrancar por pantallas. (RF-01)
- **HU-02.** Como usuario, no quiero ver la opción UX_FIRST en el wizard, pero mis proyectos UX_FIRST existentes siguen funcionando. (RF-02)

### Fase 1: pantallas y flujos

- **HU-03.** Como diseñador, quiero editar pantallas, rutas, roles, estados y componentes, con aviso si otro usuario guardó antes. (RF-03)
- **HU-04.** Como diseñador, quiero subir capturas y recibir una propuesta de pantallas como diff que acepto o rechazo. (RF-04)
- **HU-05.** Como diseñador, quiero importar pantallas desde un archivo de Figma con mi token, y que reimportar sin cambios no produzca diff. (RF-05, RF-19)
- **HU-06.** Como diseñador, quiero definir la navegación entre pantallas con su disparador. (RF-06)
- **HU-07.** Como diseñador, quiero que, si el MCP gráfico (Kreo) está activo, los componentes se completen con paquete y versión, sin que su caída me bloquee. (RF-07)

### Fase 2: necesidades de datos

- **HU-08.** Como analista, quiero una propuesta de necesidades de datos por componente (heurística + LLM, con procedencia marcada) que pueda revisar y guardar. (RF-08)
- **HU-09.** Como analista, quiero ver qué le falta a cada fase para pasar su puerta. (RF-09)

### Fase 3: contrato y MDD

- **HU-10.** Como arquitecto, quiero compilar el contrato (PAG + OpenAPI 3.1) de forma determinista y gratuita. (RF-10)
- **HU-11.** Como arquitecto, quiero compilar el MDD de 7 secciones con §3/§4 iguales al contrato compilado. (RF-11)
- **HU-12.** Como responsable, quiero un semáforo por fases y una estimación basada en el número real de pantallas. (RF-12, RF-13)
- **HU-13.** Como responsable, quiero que la cascada de entregables use el contrato compilado y no vuelva a inventarlo. (RF-14)
- **HU-14.** Como sistema, si alguien edita el diseño tras compilar, quiero ver PAG y MDD marcados como obsoletos y que la cascada se niegue a correr. (RF-17)

### Export y portabilidad

- **HU-15.** Como desarrollador frontend, quiero descargar `openapi.yaml`, handlers MSW y fixtures para arrancar sin backend. (RF-15, RF-16)
- **HU-16.** Como responsable, quiero clonar el proyecto o hacer roundtrip con Notion sin perder el diseño. (RF-18)

## Requisitos funcionales

| ID | Requisito | Criterio de aceptación |
|---|---|---|
| RF-01 | Crear un proyecto DESIGN_FIRST desde el wizard y por `POST /projects` | Con `DESIGN_FIRST_ENABLED=false` → 400 `ERR_DESIGN_FIRST_DISABLED`. Con el flag encendido → Project `projectType=DESIGN_FIRST` y Stage 1 con `designSpec = {schemaVersion:1, entities:[], screens:[], navigation:[], dataNeeds:[]}` y `designSpecRevision = 0`. |
| RF-02 | Ocultar UX_FIRST | El wizard no muestra el selector UX_FIRST. Los proyectos UX_FIRST existentes se siguen leyendo y editando sin cambios. `ProjectApproach.UX_FIRST` queda anotado `@deprecated`. |
| RF-03 | Editar pantallas | `PUT /projects/:id/design/screens` con `revision` hace CAS: 409 `ERR_DESIGN_REVISION_CONFLICT` si no coincide; 422 si se violan I1 (ids únicos, aristas válidas). |
| RF-04 | Pantallas desde imágenes | `POST .../design/import/images` devuelve una propuesta (diff add/update/remove) sin persistir. `POST .../design/proposals/:pid/accept` la aplica con CAS. |
| RF-05 | Pantallas desde Figma | `POST .../design/import/figma {fileUrl, nodeIds?}` usa el token del propio usuario y devuelve un diff. Reimportar el mismo archivo sin cambios da un diff vacío (idempotencia por `nodeId`). |
| RF-06 | Navegación | Aristas `from → to` con trigger. Toda arista que apunta a un id inexistente → 422, y en importación → warning. |
| RF-07 | Enriquecimiento con Kreo, opcional | Si el MCP gráfico está activo, `resolve_component` completa `package`/`version`. Si falla, devuelve un warning y la petición termina en 200. |
| RF-08 | Necesidades de datos | `POST .../design/data-needs/propose` (heurística + LLM, marcados con su procedencia) → diff. `PUT .../design/data-needs` con CAS. Se cumplen I2 e I3. |
| RF-09 | Puertas de fase visibles | `GET /projects/:id/design` devuelve `gates: {phase1, phase2, phase3}`, cada una con `ok` y `issues[]` deterministas. |
| RF-10 | Compilar contrato | `POST .../design/compile-contract` genera un PAG determinista, OpenAPI 3.1 válido (I6-I8) y persiste `architectureGraph` y `architectureGraphSourceHash`. Dos corridas sobre la misma entrada dan bytes idénticos. |
| RF-11 | Compilar MDD | Job MDD en modo pinned. El MDD tiene exactamente 7 secciones y §3/§4 coinciden byte a byte con `compilePagToMddSection3/4(pag)`. Sin `phase2.ok` → 409 `ERR_DESIGN_PHASE_GATE`. |
| RF-12 | Semáforo por fases | ROJO si `phase1` no está ok. AMARILLO si `phase1` ok y falta `phase2`, `phase3` o la frescura de los hashes. VERDE solo con `phase3` ok, el MDD fresco y las puertas actuales del MDD en verde. Lo escribe solo `getLiveMetricsForProject`, también sin MDD. |
| RF-13 | Estimación | En DESIGN_FIRST el conteo de pantallas es `designSpec.screens.length`. `computeCostEstimation` no cambia. |
| RF-14 | Cascada DESIGN_FIRST | Oleadas propias. `api_contracts` se compila desde `architectureGraph` sin LLM. `uiScreensContent` se renderiza desde `designSpec`. Un fallo en ese paso falla cerrado. |
| RF-15 | Export OpenAPI | `GET :id/openapi.json` y `openapi.yaml` leen primero `architectureGraph`. |
| RF-16 | Repo-handoff | El repo-handoff de DESIGN_FIRST incluye `openapi.yaml`, `mocks/handlers.ts`, `mocks/browser.ts`, `mocks/fixtures/*.json`, `mocks/README.md`, `docs/sdd/pantallas.md` y `docs/sdd/datos.md`. |
| RF-17 | Obsolescencia | Editar el diseño después de compilar marca el PAG y el MDD como `stale` en `GET /design` y en la UI, y la cascada responde 409 `ERR_DESIGN_STALE`. |
| RF-18 | Portabilidad | Clonar y hacer roundtrip con Notion preservan `projectType=DESIGN_FIRST`, `designSpec` y `architectureGraph`. |
| RF-19 | Credencial Figma | `PUT`, `GET` y `DELETE` en `/me/integrations/figma`. El GET nunca devuelve el token; solo `{connected, figmaHandle, lastValidatedAt}`. |

## Requisitos no funcionales

| ID | Requisito | Criterio de aceptación |
|---|---|---|
| RNF-01 | Token Figma | Se guarda cifrado (AES-256-GCM, `TokenCryptoService`) y entra en `rotate-master-key.ts`. Un test hace grep del token en logs y TokenUsage y obtiene 0 coincidencias. |
| RNF-02 | Determinismo | Compiladores puros: golden byte a byte, sin `Date.now` ni `Math.random`, con JSON canónico antes del hash. |
| RNF-03 | Sin regresión en NEW | Las specs existentes de cascada, semáforo, OpenAPI y grafo MDD siguen en verde. Hay un test de regresión del semáforo NEW sobre fixtures. |
| RNF-04 | Límites configurables | `designSpec` ≤ `DESIGN_FIRST_MAX_SPEC_BYTES` (512 KB); pantallas ≤ 200; imágenes ≤ `DESIGN_FIRST_MAX_IMAGES` (8) y ≤ 5 MB cada una; nodos Figma ≤ `DESIGN_FIRST_FIGMA_MAX_NODES` (5000). Si se excede → 413 o 422 con código. |
| RNF-05 | Presupuestos | `DESIGN_FIRST_VISION_BUDGET_MS`, `DESIGN_FIRST_DATANEEDS_BUDGET_MS` y `DESIGN_FIRST_FIGMA_TIMEOUT_MS`, validados en `env.schema.ts`. Un abort no persiste nada. |
| RNF-06 | Telemetría | TokenUsage con `documentField` `designScreenSpec`/`designDataNeeds` y `context: "design_first"`. El compilado del MDD registra la métrica `pinned_section_drift`. |
| RNF-07 | Autorización (ADR 0001) | `route-coverage.spec.ts` en verde. Niveles: lectura `read`; edición `contribute`; visión y LLM `spend`; Figma `contribute`. |
| RNF-08 | Figma | Timeout por petición; respeta `Retry-After` en 429 con 2 reintentos como máximo y backoff exponencial; límite de concurrencia por usuario. |
| RNF-09 | Migraciones | Idempotentes (`IF NOT EXISTS`), replicadas en `safe-schema-sync.sql`, forward-only, con down-script documentado. |
| RNF-10 | Idioma | Textos de UI y mensajes de error en español. |

## Métricas de éxito

- Compilado determinista: dos corridas de `compile-contract` sobre la misma entrada producen bytes idénticos (RF-10, RNF-02), verificado con goldens.
- `pinned_section_drift` = 0 en los MDD compilados en modo pinned (RF-11, RNF-06): §3/§4 nunca se desvían del compilador.
- Cero regresiones en NEW: specs existentes de cascada, semáforo, OpenAPI y grafo MDD en verde (RNF-03).
- Cero fugas de PAG entre proyectos (`ai.service.pag-isolation.spec.ts`).
- Cero apariciones del token Figma en logs y TokenUsage (RNF-01).
- Repo-handoff utilizable: `openapi.yaml` válido y fixtures parseables en el smoke del paso 26.
- Golden de visión nocturno: recall dentro de tolerancia y cero campos inventados.
- `git diff --stat packages/business-rules` vacío al terminar.

## Supuestos

- Los consumidores existentes de `domainInventory` siguen funcionando si se deriva desde `designSpec.entities` al cumplirse `phase2`.
- La compilación del MDD puede reutilizar el NDJSON/SSE del job MDD actual; no hace falta un canal SSE nuevo en v1.
- El grafo MDD actual admite un estado `designFirstPinned` sin duplicar su topología.
- Redis está disponible para guardar propuestas con TTL (decisión Q12).
- La complejidad del proyecto se sigue infiriendo como hoy (decisión Q8).
- La estimación no se muestra hasta la fase 3 (decisión Q7); antes, `precisionScore` es porcentaje de completitud con tope 40 (Q6).

## Dependencias

| Dependencia | Uso | Nota |
|---|---|---|
| API REST de Figma | `GET /v1/files/:key` y `/v1/files/:key/nodes?ids=` con header `X-Figma-Token` | Base URL fija `FIGMA_API_BASE_URL` (https), timeout, 429/`Retry-After`. Token personal por usuario. |
| MSW v2 | Sintaxis de los handlers emitidos (`http`, `HttpResponse`) | No es dependencia del repo: shared-types emite strings; el README del handoff fija `msw@^2`. |
| `ajv` + `ajv-formats` | Validación JSON Schema 2020-12 en `apps/api` (paso 9) | Aprobada por Jorge (Q3). La estructura OpenAPI 3.1 se valida con un esquema propio del repo. |
| MCP gráfico Kreo | `resolve_component` para `package`/`version` | Opcional; si cae, warning y 200. |
| OpenRouter (vía `ai/adapters/`) | Visión y propuesta de datos; job MDD | Único proveedor; no se agregan adaptadores. |

## Fuera de alcance

Ver [No-objetivos](#no-objetivos). Además: SSE nuevo para Design-First, tabla persistente de propuestas, endpoints de vista agregada salvo con `endpointHint` explícito (Q5), y retirar el fallback de lectura `documentAst` (se hace en la release siguiente).
