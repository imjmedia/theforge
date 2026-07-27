# Módulo Legacy Flow

Flujo separado para **proyectos legacy** (documentados en TheForge): modificaciones sin Paso 0, con coordinador, revisor y cascada de entregables.

## Endpoints

- `POST /projects/:projectId/legacy/generate-codebase-doc` — body opcional `{ stageId?: string }`. MCP **`generate_legacy_documentation`** (MDD determinista desde Falkor). **Multi-root:** una llamada MCP **por cada** `roots[].id` del workspace (si `theforgeProjectId` es el workspace) y fusión en markdown con cabecera por repo. Tras normalizar el markdown, TheForge **añade** `## Diagrama de Componentes` (Mermaid flowchart derivado de entidades/API/servicios de la doc. de partida). Desactivar: `LEGACY_MDD_COMPONENT_DIAGRAM=0`. El campo `responseMode` en el body está **deprecado** e ignorado.
- `PATCH /projects/:projectId/legacy/codebase-doc` — body `{ codebaseDoc?: string }`. Actualiza la documentación de partida (edición manual). Devuelve `{ codebaseDoc }`.
- `POST /projects/:projectId/legacy/start` — body `{ description: string }`. Llama a TheForge **`get_modification_plan`** (SPEC-MCP-001); si no está disponible, fallback a `ask_codebase`. Devuelve `{ filesToModify, questions }` y persiste en `legacyFlowState`.
- `POST /projects/:projectId/legacy/answer` — body `{ answers: Record<string, string> }`. Guarda respuestas del usuario.
- `POST /projects/:projectId/legacy/generate-mdd` — Genera el MDD y persiste en `mddContent`. **Respuesta HTTP ligera** (`ok`, `mddLength`, `wordCount`, `stageId`); el Workshop hace `GET /projects/:id` tras generar. Query `?includeContent=true` solo para MCP/debug. **Etapa 1 (`ordinal === 1`):** MDD **AS-IS** del sistema completo — no inyecta preámbulo BRD ni consultas de cambio aunque exista `description` en `legacyChangeState`; §1 Contexto describe el sistema **tal como existe hoy** (prohibido lenguaje de modificación/MVP). Tras la revisión, **§2–§7** se sustituyen por evidencia del `codebaseDoc` (Ariadne): §2 stack/patrones anclados al índice (anti-alucinación Laravel/Vue; Resumen sin metadata `Consulta:`/`evidence_first`); §3–§5 tablas completas de entidades, contratos API y **Lógica de negocio** con edge cases de servicios críticos indexados; §7 infra desde JSON `Infraestructura` + `Rutas de evidencia` (p. ej. `database.js`→PostgreSQL, `vite-env.d.ts`→Vite, no confundir Webpack admin Strapi con frontend). Desactivar: `LEGACY_AS_IS_MDD_EVIDENCE_INJECT=0`. Inyecta **`### Diagrama de Componentes`** en §2 si falta (antes del post-proceso §2–§7). **Etapas 2+:** MDD de **cambio** con preámbulo BRD, línea base de la etapa anterior y descripción del cambio. Usa descubrimiento escalonado TheForge + revisor. **Prod:** subir timeout Traefik/proxy del API (≥600s) — la generación puede tardar varios minutos en repos grandes.
- `POST /projects/:projectId/legacy/generate-as-is-manual` — Sintetiza manual **As-Is** desde `legacyFlowState.codebaseDoc` (mín. ~400 caracteres).
- `POST /projects/:projectId/legacy/suggest-brd-from-codebase-doc` — Borrador **BRD** desde `codebaseDoc` (mín. ~300 caracteres); persiste en la etapa. Compacta `evidence_paths`, tope `LEGACY_BRD_CODEBASE_DOC_PROMPT_MAX_CHARS` (default 120k). Sistemas grandes: inventario de negocio en 2 pasadas (`LEGACY_BRD_INVENTORY_THRESHOLD_CHARS`). To-Be eliminado.
- `POST /projects/:projectId/legacy/generate-from-codebase` — body `{ documentType, stageId? }`. Regenera un entregable (spec, architecture, …) desde `codebaseDoc`. Antes de persistir aplica **`validateDocumentForPersist`** (no shell solo-changelog ni borrado masivo del documento previo).
- `POST /projects/:projectId/legacy/generate-deliverables` — Despacho dinámico según `Project.complexity`: matriz `DELIVERABLES_BY_COMPLEXITY`, filtrada con **`planLegacyDeliverablesToGenerate`** (shared-types): omite **solo** **`mdd_canonical`** si ya hay `mddContent` (el MDD se regenera manualmente con «Regenerar MDD»). **Generar todos** vuelve a generar el resto de entregables aunque ya existan. **Ejecución en paralelo** (`Promise.allSettled`, misma UX que proyectos nuevos). **Con `REDIS_URL`:** encola BullMQ (`theforge-legacy-deliverables`) y responde `{ queued: true, jobId }`; progreso vía `GET …/legacy/deliverables-jobs/:jobId` (Workshop hace polling con labels `DELIVERABLE_STEP_LABELS`). **Sin Redis:** HTTP síncrono (puede cortarse por timeout de proxy en proyectos grandes). **Con `mddContent`:** cada paso usa **`runStepWithMdd`** (runner legacy + MDD completo; `ProjectsService.generateDocument` bloquea LEGACY en spec). **Solo `codebaseDoc` (ingeniería inversa):** pasos mapeados delegan en **`generate-from-codebase`**; **`ux_ui_guide`** y **`agent_governance`** siguen `legacy_run_step_fallback`. La traza expone **`pipelineMode`**. Si hay `complexityPending` sin confirmar, 400. **Respuesta:** `{ ok, lastDeliverablesDebug }` — traza de pasos (duración, `outChars`, errores). Persiste en **`legacyFlowState.lastDeliverablesDebug`**. Logs: `LEGACY_DELIVERABLES_DEBUG=1`.
- `POST /projects/:projectId/legacy/resolve-index-sdd-conflict` — body `{ choice: "trust_index" | "trust_sdd" | "proceed_with_warnings" }`. Tras un **409** `LEGACY_INDEX_SDD_MISMATCH`, el usuario confirma cómo proceder; se persiste en `legacyFlowState.legacyIndexSddResolution` y se desbloquean `generate-codebase-doc`, `generate-mdd` y `generate-deliverables`.

**Throttle + 429:** la cascada bulk corre en **paralelo** (sin pausa inter-paso). Si el MDD completo supera **`LEGACY_DELIVERABLES_LARGE_MDD_THRESHOLD_CHARS`** (default **80000**), **`LEGACY_DELIVERABLES_LARGE_MDD_COOLDOWN_MS`** (default **20000**) antes del primer paso entregable. Cada paso reintenta ante 429 / *Resource exhausted* (**`LEGACY_DELIVERABLES_LLM_429_MAX_RETRIES`**, default **5**; backoff **`LEGACY_DELIVERABLES_LLM_429_BASE_DELAY_MS`** o Retry-After). **429 upstream:** cuerpo `{ statusCode: 429, code: "UPSTREAM_LLM_RATE_LIMIT", …, lastDeliverablesDebug }`.

**Section merge (entregables por § MDD):** con **`LEGACY_DELIVERABLES_SECTION_MERGE`** (`all` por defecto, `blueprint` solo, **`auto`** por estimación de tokens, `0` off), el coordinador consulta **`LegacyDeliverablesStrategyService`** (`legacy-deliverables-strategy/`) y decide por entregable si intenta ventanas o va directo al monolítico. Con `all`/`blueprint`/`off` la decisión no usa tokens; con `auto`, si la estimación (**`js-tiktoken`** sobre muestra del user monolítico + overhead configurable, o fallback chars/ratio) supera **`LEGACY_DELIVERABLES_STRATEGY_AUTO_USER_PROMPT_TOKEN_MAX`** (default 28000), se intenta section merge. Cada entregable soportado puede usar **ventanas** del MDD (`## 1.`…`## 7.`), ensamblado, **verificación mecánica** + **`conformanceCheck`** (Blueprint, API, Flujos, Infra) y reparación LLM. Fallo en una ventana → fallback monolítico. **Contratos API (section merge):** §3–§5 + Blueprint (8k). Telemetría: **`lastDeliverablesDebug.sectionMergeTraces`** y **`strategyDecisions`**. Runner: `legacy-section-merge-deliverables.runner.ts`.

## Alineación índice Ariadne ↔ grafo SDD (FalkorDB)

Antes de llamar a la IA en documentación/MDD/entregables legacy, el coordinador **parsea §3/§4 del MDD** (`buildSddStageSnapshotFromMdd`) y lo cruza con señales del índice MCP (`gatherLegacyIndexSignals`: `semantic_search` + rutas, sin LLM).

**Optimización (doc. partida):** si el gate corrió y pasó, `assertLegacyIndexSddGate` devuelve las mismas señales MCP; en el **modo clásico** de `generate-codebase-doc`, la **§5 (índice semántico)** reutiliza esos tres bloques y **no** vuelve a lanzar 3× `semantic_search` (misma orden eje modelos/API/UI que `DEFAULT_SEMANTIC_QUERIES`). Si el gate no ejecutó gather (`LEGACY_SDD_INDEX_GATE=0`, sin snapshot, etc.), se mantiene el triple `semantic_search` explícito del modo clásico.

- **Índice vacío + SDD "rico"** (varias entidades o endpoints en Falkor): **409** — el código indexado no aporta evidencia pero el SDD asimilado sí; riesgo de UUID/repo desalineado.
- **Solapamiento bajo** entre nombres de entidades/rutas del SDD y el texto del índice: **409** — discrepancia grave entre diseño en grafo y lo que refleja Ariadne.

Desactivar el guardarraíl: `LEGACY_SDD_INDEX_GATE=0`. Umbrales: `LEGACY_SDD_INDEX_MIN_OVERLAP_RATIO` (default 0.28), `LEGACY_SDD_RICH_MIN_ENTITIES`, `LEGACY_SDD_RICH_MIN_ENDPOINTS`, `LEGACY_SDD_MIN_ARTIFACTS_FOR_OVERLAP` — ver `legacy-index-sdd-alignment.util.ts`.

## Servicios

- **LegacyCoordinatorService:** Orquesta start (TheForge), answer, generateCodebaseDoc, suggestBrd, generateFromCodebase; delega `generateMdd` y `generateDeliverables`.
- **LegacyStageContextService:** Proyecto legacy, etapa gate, lectura/persistencia de `legacyChangeState`, gate índice↔SDD, sync Falkor.
- **LegacyMddGenerationService:** `POST …/legacy/generate-mdd` — descubrimiento TheForge, prompt AS-IS/cambio, revisor, persist.
- **LegacyDeliverablesOrchestratorService:** Cascada bulk `generate-deliverables` (paralelo, section merge, telemetría `lastDeliverablesDebug`).
- **legacy-coordinator.util.ts** / **legacy-coordinator.types.ts:** Helpers compartidos (429 retries, clip debug, tipos de traza).
- **`legacy-generate-options.util.ts`:** `buildLegacyGenerateOptions` — `legacyBaselineStage` + TheForge para cascada legacy y regeneración individual (`ProjectsService.generateBlueprint|ApiContracts|LogicFlows|Infra` en proyectos `LEGACY`). **`mergeLegacyTasksGenerateOptions`** — combina esas opciones con entregables del proyecto (Spec, HU, API, Flujos, Infra) y mapa de navegación MCP; lo usa **`generateTasks`** en cascada (`runStepWithMdd`) y en **`generate-from-codebase`** (tipo `tasks`), alineado con `ProjectsService.generateTasks`.
- **`legacy-flow-state-debug.util.ts`:** parches parciales a `legacyFlowState.lastDeliverablesDebug` (p. ej. `logicFlowsSection5Coverage` tras regen individual de flujos etapa 1).
- **LegacyReviewerService:** Revisa lista archivos/preguntas y borrador MDD. Si el MDD casi no cita rutas (menos de 3 referencias tipo `archivo.ts`), antepone aviso SDD al prompt de revisión.

## Conocimiento

Carpeta `knowledge/`: contenido derivado de los 3 cuadernos NotebookLM (Arquitectura de Prompts, Specification-Driven Development, Architecting Agentic Systems). Se carga en runtime con `loadLegacyKnowledgePack()` e se inyecta en los prompts del coordinador y revisor.

## Dependencias

- TheForgeService (getModificationPlan preferido para start; askCodebase para contexto MDD y sugerencias de respuestas).
- AiService (generateSpec, generateArchitecture, etc., como librería).
- PrismaService (Project.legacyFlowState, mddContent, entregables).

La API pública (coordinador, revisor, controlador, knowledge-loader) está documentada con **JSDoc en español** (`@param`, `@returns`).

Ver plan histórico en `docs/archive/PLAN-FLUJO-LEGACY-V2.md`.

## Contrato con TheForge (SPEC-MCP-001)

- **Primario:** Se llama **`get_modification_plan(userDescription, projectId)`**. Respuesta: `{ filesToModify: string[], questionsToRefine: string[] }`. Garantías del MCP: `filesToModify` = solo rutas de nodos File del proyecto en FalkorDB (verificadas); `questionsToRefine` = solo preguntas de negocio/funcionalidad (no "¿hay otros componentes?").
- **Fallback:** Si el MCP no expone `get_modification_plan`, se usa `ask_codebase` con un prompt que pide el mismo JSON; se filtran preguntas tipo "otros componentes". Los `filesToModify` usan `getDefaultRepoIdForStoredProject` como **`repoId`** (primer root del workspace en catálogo), no el UUID del proyecto workspace crudo.
- **`generate-mdd`:** `validate_before_edit` / `get_definitions` usan un nombre de nodo inferido desde `get_functions_in_file` (`legacy-graph-node-name.util.ts`), no solo el stem del path.
- **`ask_codebase` en legacy:** Por defecto `raw_evidence` + `deterministicRetriever` + `twoPhase` (`getLegacyAskCodebaseOptions` / default en `TheForgeService.askCodebase`); prosa clásica sin flags: `LEGACY_ASK_CODEBASE_EVIDENCE_FIRST=0`.
- **Sugerencias de respuestas:** Tras obtener las preguntas, se llama `ask_codebase` para rellenar sugerencias desde el codebase.
