# Módulo TheForge (cliente MCP)

Integración HTTP JSON-RPC con el MCP AriadneSpecs (`THEFORGE_MCP_URL`): proyectos, `get_modification_plan`, `generate_legacy_documentation`, `ask_codebase`, búsqueda semántica, contenido de archivo y herramientas SDD (`validate_before_edit`, etc.).

## `list_known_projects` → ids (canónico: repo Ariadne `docs/MCP_HTTPS.md` o `docs/notebooklm/MCP_HTTPS.md`, SPEC-MCP-001)

- **`id`**: proyecto workspace Ariadne → rutas ingest **`/projects/:id/...`** (`get_modification_plan`, `ask_codebase` según spec).
- **`roots[].id`**: repo → **`/repositories/:id/...`** y valor típico de `projectId` en nodos Falkor según sync.
- **`TheForgeService`** cachea `list_known_projects` (`THEFORGE_LIST_PROJECTS_CACHE_MS`, default 60s; `0` = sin caché) y, a partir del UUID guardado en `Project.theforgeProjectId`, calcula:
  - **`workspaceProjectId`**: siempre el **`id` del workspace** cuando el catálogo lo permite (si guardaste un `roots[].id`, se busca el proyecto padre). Se usa como **`projectId`** en **`ask_codebase`** y **`get_modification_plan`** (alineado con `POST /projects/:id/chat` y `POST /projects/:id/modification-plan`).
  - **`graphProjectId`**: repo para **grafo / herramientas MCP solo-UUID**: primer `roots[].id` si elegiste el workspace, o el **mismo** `roots[].id` si elegiste un repo. Se usa en `get_file_content`, `get_definitions`, etc. **`TheForgeService.semanticSearch`**: con proyecto multi-root, el servicio usa **`scope.repoIds`** del catálogo y **concatena** una `semantic_search` por repo (el MCP no tiene `scope`). Con un solo root, una sola llamada con `limit` total.
  - **`scope.repoIds`**: en **`ask_codebase`** y **`get_modification_plan`**, lista de `roots[].id`. Si `theforgeProjectId` es el **workspace** `id`, son todos los roots; si es un **`roots[].id`**, igualmente se envían **todos** los roots del padre (proyecto completo en ingest). Para acotar a un repo, el caller puede pasar `opts.scope.repoIds` y hace overlay (ver `mergeAriadneCodebaseScope`).
- **Sharding (`FALKOR_SHARD_BY_PROJECT`)**: el UUID en Falkor debe coincidir con el índice; si el despliegue parte por proyecto, revisar que `graphProjectId` sea el que usa el sync (repo vs workspace) según `.ariadne-project` / ingest.

**Timeouts HTTP (cliente Nest → MCP):** `THEFORGE_MCP_TIMEOUT_MS` (default **60000**) aplica a **casi todas** las herramientas (`semantic_search`, `get_file_content`, …). **`ask_codebase`** usa **`THEFORGE_MCP_ASK_CODEBASE_TIMEOUT_MS`** si está definido; si no, default **900000** (15 min) en código para no cortar ingest/evidence_first mientras el servidor sigue procesando. Alinear con **`MCP_ASK_CODEBASE_TIMEOUT_MS`** en el despliegue Ariadne (MCP) / ingest.

**Depuración:** con `DEBUG_MCP=1` (o `true`), `TheForgeService.postTheForgeMcp` registra cada cuerpo JSON-RPC enviado y la respuesta cruda (truncada por `DEBUG_MCP_MAX_RESPONSE_CHARS`, default 32768; request por `DEBUG_MCP_MAX_REQUEST_CHARS`, default 65536). En Docker: variable en `.env` o `docker-compose` (`DEBUG_MCP: ${DEBUG_MCP:-0}`).

**Despliegue Docker:** en `docker-compose.yml`, `THEFORGE_MCP_URL` / tokens MCP no deben quedar fijados a `""` vía `${VAR:-}`; ver comentarios en el compose y `README` raíz (Dokploy → servicio `theforge-api`).

## Contexto evidencia-primero (legacy / entregables)

`theforge-evidence-context.util.ts` arma Markdown de contexto para **SDD legacy**:

1. Varios `semantic_search` (`LEGACY_SEMANTIC_SEARCH_LIMIT`, default **80** hits por query; recorte markdown `LEGACY_SEMANTIC_SECTION_MAX_CHARS`, default **16000**). El armado de **doc. partida** §5 (`generate-codebase-doc` modo clásico) usa `clipLegacySemanticSectionForCodebaseDoc` → `LEGACY_CODEBASE_DOC_SEMANTIC_MAX_CHARS` (default **48000**).
2. Extracción heurística de rutas desde el texto MCP (`extractCandidatePathsFromMcpText`).
3. `get_functions_in_file` por rutas candidatas (tope configurable).
4. Con **`LEGACY_ANALYZER_COMPACT=1` (default):** no se vuelcan extractos completos de archivo; un paso **Legacy Analyzer** (`runLegacyAnalyzerPass`) devuelve secciones fijas (impacto, API, datos, riesgos) vía `ask_codebase` solo sobre la evidencia recortada. Con `LEGACY_ANALYZER_COMPACT=0` se restaura el flujo anterior (extractos de archivo + síntesis larga).
5. Anexo de evidencia bruta: `LEGACY_ANALYZER_ATTACH_RAW=1` (solo debug).

**Caché:** `TheForgeContextCacheService` (memoria) deduplica `getContextForDeliverables` por `projectId` + huella fija `generate_legacy_documentation_v1` + `THEFORGE_CONTEXT_REVISION` opcional (bump tras resync/embed). Desactivar: `THEFORGE_CONTEXT_CACHE=0`.

`TheForgeService.getContextForDeliverables` y **`LegacyCoordinatorService.generateCodebaseDoc`** comparten el mismo modo MCP **`generate_legacy_documentation`** (evidence_first determinista en Ariadne). **Multi-root:** `generateLegacyDocumentation` lanza **una llamada MCP por cada** `roots[].id` del scope resuelto y fusiona el markdown con cabecera `## Repositorio: …` (mismo criterio que `semanticSearch`). Si `theforgeProjectId` es un solo `roots[].id`, solo ese repo. Caché contexto: huella `generate_legacy_documentation_v2_multi_repo`. **`generateMdd`** sigue con **descubrimiento escalonado** (LLM + herramientas MCP). `buildLegacyEvidenceMarkdown` queda solo para señales de la puerta índice↔SDD (`gatherLegacyIndexSignals`); ver `docs/notebooklm/LEGACY-EVIDENCE-CONTEXT.md` y `legacy-flow/README.md`.

Variables relevantes: ver `.env.example` en la raíz del monorepo (prefijo `LEGACY_*`, `THEFORGE_CONTEXT_*`). **`LEGACY_SEMANTIC_KEEP_MARKDOWN_DOCS`:** si no está en `1`, se eliminan del texto de evidencia las líneas `**MarkdownDoc:**` devueltas por el MCP (documentación de diseño indexada, no código).

**Contexto TheForge en entregables:** `getContextForDeliverables` devuelve el MDD de `generate_legacy_documentation`. Recorte en prompts: `THEFORGE_CONTEXT_PREPEND_MAX_CHARS` (default 16000).

**Paridad grafo MCP vs explorador Ariadne (operación):** Las herramientas `get_component_graph` y `get_legacy_impact` intentan primero el **API Nest** (`GET /api/graph/*`) cuando el **proceso** `mcp-ariadne` tiene `ARIADNE_API_URL` + JWT (`ARIADNE_API_BEARER` / `ARIADNE_API_JWT`). Eso es **independiente** del token cliente→`/mcp` (`MCP_AUTH_TOKEN` / `MCP_X_M2M_TOKEN` en The Forge). Sin JWT Nest en el contenedor MCP, el servidor hace **fallback Falkor** y el resultado puede diferir del explorador web — no es un bug del cliente Nest `THEFORGE_MCP_URL`.

**`ask_codebase` (Ariadne SPEC):** por defecto `TheForgeService.askCodebase` envía **`responseMode: raw_evidence`** + **`deterministicRetriever: true`** y convierte la respuesta JSON a **markdown** (`normalizeAskCodebaseRawEvidenceContent` → `formatRawEvidenceObjectToMarkdown` en `theforge-raw-evidence-markdown.ts`). Override: `evidence_first` (MDD 7 claves) o `default` (prosa). `getLegacyAskCodebaseOptions()` alinea legacy con ese default; `LEGACY_ASK_CODEBASE_EVIDENCE_FIRST=0` fuerza `default`. Doc. partida con body UI: **`askCodebaseOptionsForCodebaseDoc(responseMode)`** (mismo modo en ReAct `getStagedDiscoveryTheForgeTools(..., opts)` y en las rondas clásicas). El modo **`ingest_mdd`** (Workshop) equivale a **`evidence_first`** en una sola llamada previa al clásico; ver `legacy-flow/README.md`.

**MDD con JSON crudo pegado por el LLM:** el descubrimiento escalonado a veces vuelca en el markdown un objeto `{ "mode": "raw_evidence", … }` aunque la herramienta ya devolviera texto normalizado. Antes de persistir `legacyFlowState.codebaseDoc`, `LegacyCoordinatorService.generateCodebaseDocCore` aplica **`normalizeLegacyMddV1JsonBlocksInMarkdown`** (envelope `legacy_mdd_v1` → tablas markdown vía `legacy-mdd-v1-markdown.util.ts`) y **`normalizeRawEvidenceJsonBlocksInMarkdown`**: detecta objetos `raw_evidence`, los parsea y los sustituye por markdown con tablas de conteos/muestras, `collectedResults`, `cypher`, etc. La sección **OpenAPI / especificación** renderiza metadatos JSON + **`#### Documentación complementaria`** con el extracto de `openapi_spec.supplementary_docs` (p. ej. `INVENTARIO_ENDPOINTS_*.md`) cuando Ariadne lo incluye en el MDD. Por defecto **no** se trunca ese markdown; caps opcionales vía `RAW_EVIDENCE_*` o `LEGACY_MDD_*` (entero > 0) si un despliegue necesita acotar memoria/prompt.

**Auto MDD completo tras doc. partida:** con `LEGACY_AUTO_GENERATE_MDD_AFTER_CODEBASE_DOC=1`, tras persistir `codebaseDoc` el coordinator invoca `generateMdd` y devuelve `{ codebaseDoc, mddContent? }` (default off).

**Repo por defecto (fallback `start`):** Si `get_modification_plan` falla y el JSON viene solo con paths, `getDefaultRepoIdForStoredProject` devuelve un **`roots[].id`** cuando el catálogo lo permite, en lugar de usar el UUID del workspace como `repoId`.

**Descubrimiento escalonado (ReAct):** `getStagedDiscoveryTheForgeTools(theforge, pid, askCodebaseOpts?)` reenvía `askCodebaseOpts` a cada `ask_codebase` y expone además **`get_contract_specs`** (props UI) y **`get_implementation_details`** (firma/tipos backend vía MCP `symbolName`). Aplica suelo a `semantic_search.limit` (`LEGACY_STAGED_DISCOVERY_SEMANTIC_FLOOR` o `LEGACY_SEMANTIC_SEARCH_LIMIT`) para que el LLM no pase límites tipo 20. Doc. partida modo clásico: `ask_codebase` en serie por defecto (`LEGACY_CODEBASE_DOC_PARALLEL_ASK`); ver `docs/notebooklm/integracion-theforge/ARIADNE-CONSULTA-DESDE-THEFORGE.md`.

**Contrato MCP (humo):** con `THEFORGE_MCP_URL` (y auth si aplica), desde la raíz del monorepo `npm run test:mcp-alignment -w @theforge/api` llama `tools/list` y comprueba que cada `inputSchema.required` de las herramientas que usa el cliente esté cubierto por `THEFORGE_MCP_CLIENT_ARG_KEYS` (`theforge-mcp-client-contract.ts`). Sin URL, el test se omite.

**Alineación cliente HTTP con AriadneSpecs (Streamable HTTP):** `POST` + JSON-RPC `2.0`, `method: "tools/call"`, `params: { name, arguments }`, headers `Content-Type`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2025-03-26`, auth `Authorization: Bearer` o `X-M2M-Token`. Respuestas JSON o SSE (primera línea `data: {…}` parseada). No se usa `initialize` ni `Mcp-Session-Id` (servidor stateless). Argumentos MCP según `tools/list` del despliegue (p. ej. `get_definitions` / `get_references` → `symbolName`). Extensión Ariadne: `ask_codebase` con `evidence_first` devuelve JSON MDD; con **`raw_evidence`** (default en `askCodebase`) retrieve determinista + JSON evidencia, normalizado a markdown en la API.

**«Sin datos en índice» en MDD inicial:** el MCP filtra por el **id de repo** tras normalizar (o por `scope` en ask/plan). Si el UUID no coincide con lo indexado en Ariadne o el índice RAG está vacío, el Analyzer puede devolver ese texto. **La API ya no persiste** ese mensaje como `codebaseDoc`: se detecta con `legacyAnalyzerIndicatesEmptyIndex` y se reintenta el **modo clásico** (`ask_codebase` directo + bloques semánticos). Si tras el clásico sigue sin haber partes, el doc queda vacío: revisa sync del repo y que el id sea el mismo que en `list_known_projects`. Con `LEGACY_ANALYZER_REQUIRE_GRAPH_HITS=1` (default) también se omitía el Analyzer cuando no hay hits de grafo; la detección por frase cubre el caso `REQUIRE_GRAPH_HITS=0` o hits débiles que igual disparan la respuesta vacía de Ariadne.

## Brownfield converge auto-wire (Ariadne ingest)

Al crear un proyecto **`LEGACY`** (`POST /projects`) o al **promover handoff a etapa** (`POST /projects/:id/integration/promote-to-stage`), si `THEFORGE_MCP_URL` está configurado y `ARIADNE_BROWNFIELD_CONVERGE_AUTO` no es `0`, la API hace **`PATCH /api/repositories/:id`** (proxy ingest) en cada repo resuelto desde `list_known_projects`:

- `theforgeProjectId` → UUID del proyecto Workshop
- `theforgeStageId` → etapa 1 al crear legacy; **etapa promovida** tras integración NEW-LEG
- `theforgeConvergeTriggerMode` → `ARIADNE_BROWNFIELD_CONVERGE_MODE` (default `incremental`)
- `theforgeServiceToken` → `THEFORGE_SERVICE_JWT` si está definido

Auth: token Ariadne del usuario (`User.ariadneMcpToken`) o `MCP_AUTH_TOKEN` / `MCP_X_M2M_TOKEN` en env. URL ingest: `ARIADNE_INGEST_URL` o derivada de `THEFORGE_MCP_URL` (`/mcp` → `/api`). Utilidades: `ariadne-brownfield-wire.util.ts`, `ariadne-ingest-api.util.ts`, `TheForgeService.wireAriadneBrownfieldConverge`.

Al programar el auto-wire, **`scheduleAriadneBrownfieldWire`** también hace upsert del enlace primario en **`project_ariadne_links`** (`ProjectAriadneLinkService.upsertPrimaryFromBrownfield`) — tabla persistida en Forge, no editable desde Ariadne.

## Resolución Forge ↔ Ariadne (MCP)

- **`POST /theforge/resolve-forge-project-for-ariadne`** — input: al menos uno de `ariadneProjectId`, `ariadneRepositoryId`, `projectKey`, `repoSlug`, `gitRemoteUrl`. Resuelve proyecto Workshop con scoring en `resolve-forge-project-for-ariadne.util.ts`. 404 si no hay match; 409 con `candidates[]` si hay empate.
- **MCP:** `resolve_forge_project_for_ariadne` (delega en el endpoint anterior; devuelve JSON estructurado en 404/409 para modal en Ariadne).
- **`POST /theforge/create-stage-from-ariadne-change-pack`** — MCP `create_stage_from_ariadne_change_pack`. Crea etapa LEGACY o importa pack v1 en `stageId` existente (≥2). Contrato en `@theforge/shared-types/ariadne-change-pack`. Con `handoffPlanType: migration_tasks` o `cursorTasksMarkdown` importa tasks del handoff y **omite LLM tasks** en cascada legacy.
- **Flujo Ariadne recomendado:** (1) `resolve_forge_project_for_ariadne` → (2) `create_stage_from_ariadne_change_pack` → (3) `legacy_generate_mdd` → (4) `legacy_generate_deliverables` (sin `tasks` si migration) → (5) `get_next_implementation_task`.
- **Secuencia alternativa:** `create_project_stage` + `POST …/integration/stages/:stageId/import-handoff` (handoff NEW) + tools legacy scoped con `stageId`.
