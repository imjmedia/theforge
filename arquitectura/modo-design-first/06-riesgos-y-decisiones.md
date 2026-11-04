# 06 — Riesgos y decisiones

Volver al [README](./README.md). Diseño en [03](./03-arquitectura-y-diseno.md).

## Riesgos

| Riesgo | Prob. | Impacto | Mitigación | Paso |
|---|---|---|---|---|
| Carrera de `AiService.lastGeneratedPag`: el PAG de un proyecto se filtra a otro (defecto multi-tenant actual) | Alta | Alto | Eliminar el campo; el PAG viaja por retorno/argumento y se persiste en `architectureGraph`; `ai.service.pag-isolation.spec.ts` | 3 |
| Sobrecarga de `Stage.documentAst` (MDD AST y PAG en la misma columna) | Alta | Alto | Columna `Stage.architectureGraph` + backfill; doble escritura una release; lectura con fallback | 2, 3 |
| Un Prisma client viejo frente al valor nuevo del enum | Alta | Alto | Migración del enum aislada; dos releases (N con flag apagado y lectores tolerantes, N+1 enciende); down-script | 5, 26 |
| Sellado de §3/§4 hoy es por convención | Alta | Alto | Barrera por hash en `prepare_output`, rutas de reparación cerradas, filtro en `cross_consistency`, spec de sellado con LLM simulado | 15 |
| ~40 literales `"NEW"` repartidos | Alta | Medio | Helpers de `project-type.ts` antes de añadir el valor; test anti-literal | 4, 4b, 4c |
| `entityHasRichProseInSection3` y el Auditor penalizan una §3 compilada | Media | Medio | Puntuación determinista de §3/§4; LLM solo §1, §2, §5-§7 | 15 |
| Inyección desde texto de Figma o de imágenes | Media | Alto | Texto delimitado como dato; salida zod; "no inventar campos" en código; propuestas HITL | 15, 16, 18 |
| `docker/entrypoint-full.sh:21` `prisma migrate deploy \|\| true` oculta migraciones fallidas | Media | Alto | Verificar el esquema tras el deploy (fuera del alcance corregir el entrypoint) | 26 |
| `ui_screens_sync` traga errores (`deliverables-cascade.service.ts:126-133`) | Media | Medio | En DESIGN_FIRST, `design_screens_render` falla cerrado | 13 |
| `UiMcpInstance` fuera de la rotación de claves | Media | Medio | Se agrega a `scripts/rotate-master-key.ts` junto con `UserFigmaCredential` | 5 |
| VERDE prematuro elimina el buffer de costo | Media | Medio | Tope AMARILLO sin MDD; `min(phaseStatus, mddStatus)` | 11 |
| CAS de documento único genera 409 frecuentes con colaboradores simultáneos | Baja | Bajo | La UI recarga y avisa; propuestas diff | 10, 22 |
| `structured_hydrator` lanza trabajo LLM fire-and-forget sin abort | Baja | Bajo | Registrado; fuera de alcance | — |

> El plan asigna una sola severidad (Alta/Media/Baja) por riesgo; aquí se usa como probabilidad. La columna de impacto es una estimación de este documento, no del plan.

## Supuestos

- Los consumidores de `domainInventory` funcionan con el inventario derivado de `designSpec.entities` al cumplirse `phase2`.
- El NDJSON/SSE del job MDD sirve para el compilado pinned; no hace falta SSE nuevo.
- Redis está disponible para las propuestas con TTL.
- `EstimationModule` sigue dependiendo solo de Prisma, sin ciclo al leer columnas nuevas.
- La API de Figma (`/v1/files/:key`, `/v1/files/:key/nodes?ids=`) entrega `nodeId` estables para la idempotencia.
- El grafo MDD admite el estado `designFirstPinned` sin cambiar el parser de 7 secciones ni el lease/fence.

## Decisiones (ADR cortos)

### ADR-DF-01. `ProjectType.DESIGN_FIRST` en lugar de `approach`

- **Contexto.** Existe `ProjectApproach.UX_FIRST`, a medias. IA prefería `approach`; arquitectura aceptaba `ProjectType`.
- **Decisión.** Nuevo valor `ProjectType.DESIGN_FIRST` (decisión D1). Los helpers de `project-type.ts` son la única fuente del enrutamiento. UX_FIRST se oculta y se marca `@deprecated`.
- **Consecuencias.** Hay que encapsular ~40 literales antes (pasos 4-4c) y migrar el enum con dos releases. DESIGN_FIRST se trata como greenfield.
- **Alternativas.** `approach: DESIGN_FIRST` (excluida por D1); reconvertir UX_FIRST (excluido por D8).

### ADR-DF-02. Documento único `Stage.designSpec` con CAS y sin lease

- **Contexto.** IA proponía que toda escritura de diseño pasara por `claimMddWriteFence`; arquitectura, CAS por revisión.
- **Decisión.** Un solo `Stage.designSpec Json` (entities, screens, navigation, dataNeeds) con `designSpecRevision Int` y CAS vía `updateMany where {id, designSpecRevision}`. Solo `mddContent` pasa por fence (ADR 0004). La obsolescencia se calcula por cadena de hashes al leer (`mddUpstreamBaseline.designSpec`).
- **Consecuencias.** Integridad referencial atómica; la edición no se bloquea durante la compilación; 409 posibles con colaboradores simultáneos.
- **Alternativas.** Tres columnas Json separadas (pierden integridad atómica); fence para el diseño (bloquearía la edición).

### ADR-DF-03. `architectureGraph` separado de `documentAst`

- **Contexto.** `documentAst` lo escriben el MDD AST y el PAG; el export OpenAPI solo comprueba `"endpoints" in ast`.
- **Decisión.** Columnas `Stage.architectureGraph` y `architectureGraphSourceHash`, con backfill `WHERE documentAst ? 'endpoints'`, doble escritura una release y lectura `architectureGraph ?? documentAst con endpoints`. Se documenta en `docs/adr/0006-architecture-graph-separado.md`.
- **Consecuencias.** Corrige un defecto actual; el fallback se retira en la release siguiente.
- **Alternativas.** Seguir discriminando por forma del JSON (frágil).

### ADR-DF-04. PAG determinista sin LLM en Design-First

- **Contexto.** El PAG actual usa LLM y self-healing que acepta un PAG inválido (`ai.service.ts:805-810`).
- **Decisión.** `compileDataNeedsToPag` puro y determinista; falla cerrado con 422 y los issues de `validateProjectArchitectureGraph`; sin reparación LLM. Se elimina el singleton `lastGeneratedPag`.
- **Consecuencias.** Bytes idénticos entre corridas; el contrato es gratuito y trazable a pantallas.
- **Alternativas.** PAG con LLM desde DataNeeds (no determinista, ciclo con las ediciones de fase 2).

### ADR-DF-05. MDD pinned en el grafo actual

- **Contexto.** El MDD debe seguir siendo de 7 secciones con §3/§4 fijadas desde el PAG.
- **Decisión.** Mismo `mdd-graph.ts` con estado `designFirstPinned`: se saltan `data_model`, `data_model_patch`, `architect_critic` y `api_contracts`; se cierran rutas de reparación; `cross_consistency` filtra; `prepare_output` reimpone y compara hashes (`pinned_section_drift`); Auditor determinista en §3/§4; Clarifier con `design-first-clarifier.md`. Se documenta en `docs/adr/0005-mdd-compilado-desde-pantallas.md`.
- **Consecuencias.** Lease y fence intactos; zona sensible marcada `[A]` (paso 15).
- **Alternativas.** Grafo `mdd-design-first-graph` nuevo (duplica topología y specs).

### ADR-DF-06. Compiladores §3/§4 nuevos

- **Contexto.** `compilePagToPersistenceMarkdown` (`document-compiler.ts:74-109`) emite H1 propio y tablas markdown; el harness espera `CREATE TABLE` y erDiagram en §3.
- **Decisión.** `compilePagToMddSection3/4`: §3 con `CREATE TABLE`, prosa mínima por plantilla y ER con el util del injector; §4 en el formato de `validateApiTablesSyntax` y `extractMddSection4Endpoints`. Sin pase LLM de prosa (Q9).
- **Consecuencias.** El injector es idempotente; los endpoints de §4 son exactamente los del PAG.
- **Alternativas.** Reutilizar `compilePagToPersistenceMarkdown`/`compilePagToApiContractsMarkdown` (no encajan).

### ADR-DF-07. El diagram injector no se salta

- **Contexto.** IA proponía saltarlo con §3 fijada.
- **Decisión.** Se mantiene; el compilador emite el ER con el mismo util y la barrera por hash de `prepare_output` corrige cualquier deriva.
- **Consecuencias.** Topología más cercana a NEW; la deriva se mide con `pinned_section_drift`.
- **Alternativas.** Saltar el nodo (otra rama de topología que probar).

### ADR-DF-08. FigmaModule separado de ui-mcp, con credencial por usuario

- **Contexto.** `ui-mcp` maneja instancias de equipo; `UserProviderConfig` tiene columnas de LLM.
- **Decisión.** `FigmaModule` propio; tabla `UserFigmaCredential` (`userId @unique`, `tokenCiphertext`, `tokenKeyVersion`) cifrada con `TokenCryptoService`; solo exporta `FigmaImportService`; base URL fija https.
- **Consecuencias.** Cada colaborador importa con su token; el token nunca sale del módulo; entra en la rotación de claves.
- **Alternativas.** Extender `ui-mcp`; reutilizar `UserProviderConfig`.

### ADR-DF-09. Dos releases y flag

- **Contexto.** Un Prisma client viejo no lee un valor de enum desconocido.
- **Decisión.** Release N: enum, columnas y lectores tolerantes con `DESIGN_FIRST_ENABLED=false`. Release N+1: se enciende con aprobación de Jorge. Down-script `docs/recovery/design-first-rollback.sql` (DESIGN_FIRST → NEW con tabla de auditoría). Aceptado (Q2).
- **Consecuencias.** Migraciones forward-only; rollback documentado; 503/400 coherentes con el flag apagado (CL-21).
- **Alternativas.** Un solo release (rompe instancias con client viejo).

### ADR-DF-10. `ajv` + `ajv-formats` con esquema propio de OpenAPI 3.1

- **Contexto.** El OpenAPI emitido debe ser 3.1 válido (I7).
- **Decisión.** Dependencias `ajv` + `ajv-formats` (JSON Schema 2020-12) en `apps/api`; la estructura OpenAPI 3.1 se valida con un esquema propio del repo (Q3). shared-types no gana dependencias.
- **Consecuencias.** Issues con ruta del validador; `phase3` en rojo si falla.
- **Alternativas.** Otra librería de validación OpenAPI (Jorge eligió esta).

### ADR-DF-11. Propuestas de diff en Redis con TTL

- **Contexto.** Visión, Figma y propuesta de datos producen diffs que el usuario acepta o rechaza (HITL).
- **Decisión.** `DesignProposalService` guarda propuestas en Redis con TTL; al aceptar se aplican con CAS (Q12).
- **Consecuencias.** Sin tabla nueva; una propuesta caducada no se puede aceptar (código de error por definir en el paso 16).
- **Alternativas.** Tabla persistente; visión como turno de chat que persiste directo (no validable, contamina `lastUserMessage`).

## Preguntas abiertas (todas RESUELTAS)

| # | Pregunta | Estado | Respuesta de Jorge |
|---|---|---|---|
| 1 | Gate 2 de Ariadne en BLOCKED por índice vacío: ¿reindexar y repetir, o avanzar sin Gate 2? | RESUELTA | Resincronizar Ariadne y repetir `validate_change_plan` antes del paso 1; si sigue BLOCKED, detenerse y preguntar. |
| 2 | Despliegue en dos releases + down-script | RESUELTA | Aceptado. |
| 3 | Dependencia para OpenAPI 3.1 y ajv 2020-12 | RESUELTA | `ajv` + `ajv-formats`; esquema propio para la estructura 3.1. Aprobada. |
| 4 | Documento único `Stage.designSpec` con `dataNeeds` | RESUELTA | Aceptado; cumple la decisión 4. |
| 5 | Pantallas agregadas (dashboards) | RESUELTA | Endpoints por recurso; `GET /views/{screenId}` solo con `endpointHint`. |
| 6 | `precisionScore` en fases 1-2 | RESUELTA | Porcentaje de completitud con tope 40. |
| 7 | Estimación antes del MDD | RESUELTA | No disponible hasta la fase 3. |
| 8 | Complejidad en DESIGN_FIRST | RESUELTA | Inferencia actual con oleadas propias LOW/MEDIUM/HIGH. |
| 9 | §3/§4 sin pase LLM de prosa | RESUELTA | Solo compiladas en v1. |
| 10 | Fusión de DESIGN_FIRST e integración con LEGACY | RESUELTA | Merge → 409 en v1; con LEGACY se trata como greenfield. |
| 11 | ¿PR propio para `lastGeneratedPag`/`documentAst`? | RESUELTA | En el mismo paquete, pasos 2-3, primeros en el orden. |
| 12 | Propuestas: ¿Redis con TTL o tabla? | RESUELTA | Redis con TTL. |

## Discrepancias doc ↔ código

Manda el código. Corregidas en el **paso 25** (salvo nota histórica).

| Documento | Decía | Código real | Estado paso 25 |
|---|---|---|---|
| `CHANGELOG.md` `[Unreleased]` | — | Campo Prisma `Project.approach` | Entradas nuevas usan `approach`. |
| `CHANGELOG.md` (versión publicada) | `methodologicalApproach` | El campo es `approach` | **Pendiente:** entrada histórica (~compiler-first); corregir retroactivamente solo con acuerdo de Jorge. |
| `docs/MCP_GRAFICO.md` | `Stage.uiScreensContent` | Solo `Project.uiScreensContent` | Corregido. |
| `docs/notebooklm/THEFORGE-INDEX.md` §4 | Integración Figma implícita en semáforo | Semáforo = heurística; Figma API = Design-First | §4.3 añadido. |
| `docs/notebooklm/ENTREGABLES-SDD-VALIDACION.md` §3 | Guía UX/UI fuera de cascada | `ux_ui_guide` en oleadas | Corregido. |
| `apps/api/src/modules/crypto/README.md` | `MASTER_ENCRYPTION_KEY` | `TOKEN_MASTER_KEYS` + `TOKEN_ACTIVE_KEY_VERSION` | Corregido. |

Detectada al redactar este paquete: el plan ubica el cliente web en `apps/web/src/api/design-first.api.ts`, pero esa carpeta no existe; los clientes viven en `apps/web/src/lib/*-api.ts`, así que el cliente se crea como `apps/web/src/lib/design-first-api.ts` (ver [02](./02-estructura-de-archivos.md#archivos-no-verificados-uno-por-uno)).

## Veredicto Ariadne: BLOCKED

- `get_sync_status` devolvió `up_to_date` (commit `c42078e0`), pero `get_modification_plan` no devolvió archivos.
- `validate_change_plan` (projectId `7951d411-f30f-4bee-8912-1369d1f4a580`) rechazó "File not in graph" para todos los archivos existentes, verificados en disco (`schema.prisma`, `ai.service.ts`, `estimation.service.ts`, etc.). Los archivos nuevos pasan. `find_similar_implementations` también vuelve vacío.
- El planificador lo considera un **falso negativo del índice**.
- **Instrucción (decisión Q1):** antes del paso 1, reindexar o revisar el ingest de Ariadne y repetir Gate 2 (`validate_change_plan`). Si sigue BLOCKED, **detenerse y preguntar a Jorge**. No se edita con un veredicto BLOCKED sin su decisión.
