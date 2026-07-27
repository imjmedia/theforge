# Changelog

Todas las notas relevantes de este repositorio se documentan aquí. El formato sigue una variante orientada a release técnico (Added / Changed / Fixed / Architecture).

## [Unreleased]

> **Coste IA por documento — telemetría de tokens y tipo de cambio editable** — Captura el consumo real (prompt + completion) de cada llamada LLM en los adapters (OpenAI-compat / Anthropic / Gemini) y en el pipeline MDD, lo agrupa por documento y modelo, y muestra USD + MXN estimado en una sección colapsable de la columna de métricas. El tipo de cambio MXN/USD se mantiene en Ajustes → Sistema (categoría "Coste & facturación") y se snapshotea por evento para que los totales históricos no cambien al editarlo.

### Added

- **Telemetría de tokens por documento generado**: nuevo modelo Prisma `TokenUsage` + migración `20260724_add_token_usage` (`apps/api/src/modules/ai-analysis/token-usage/`, `packages/database/prisma/migrations/20260724_add_token_usage/`). Cada llamada LLM en workshop chat, cascada de documentos (Spec, Blueprint, Architecture, etc.) y pipeline MDD (Clarifier, SoftwareArchitect, Stack, DataModel, API contracts, Section5, Security, Integration, CrossConsistency, Auditor, Formatter, DiagramInjector, etc.) persiste `promptTokens / completionTokens / totalTokens / costUsd / costMxn` con `documentField` (e.g. `mddContent`, `specContent`, `chat`), `context` (`initial` | `regenerate` | `repair` | `chat`), `node`, `providerId`, `modelId`, `jobId`. Endpoint `GET /ai-analysis/token-usage?projectId&stageId&includeChat` devuelve resumen agregado por documento y modelo, con generaciones (regens) y rango de fechas; `GET /ai-analysis/token-usage/events` lista los eventos crudos para vista admin.
- **Catálogo de pricing por modelo** (`apps/api/src/modules/ai/providers/chat-model-pricing.ts`, 13 specs): USD por millón de tokens de input/output para OpenRouter, OpenAI, Anthropic, Gemini, Groq y Cloudflare. `resolveChatModelPricing(providerId, modelId)` y `calculateChatCostUsd(...)` exponen lookup y cálculo; `registerChatModelPricingOverride` permite override en runtime (tests / instancias con precio custom). Fallback silencioso a 0 USD para modelos no catalogados.
- **`FxRateService`** (`apps/api/src/modules/fx-rate/`, 8 specs): lee `AppConfig.mxn_per_usd` con cache in-memory de 60s, default 20. `getMxnPerUsd()` async; `usdToMxn(usd)` async. El cache se invalida automáticamente desde `SystemConfigService.patchSettings` cuando el usuario guarda el valor, por lo que la siguiente lectura recarga.
- **Nueva entrada `mxn_per_usd` en Ajustes → Sistema** (`packages/shared-types/src/system-config.ts`, nueva categoría `cost`): input numérico, rango 1–100, default 20 (envKey `MXN_PER_USD`). Etiqueta "Tipo de cambio MXN/USD (estimado)" y descripción aclarando que el valor lo mantiene el usuario y no es un feed live. Se renderiza automáticamente en `SystemConfigCard` sin tocar la UI de la pestaña.
- **AsyncLocalStorage de telemetría** (`token-usage.context.ts`, 5 specs): propaga `projectId/stageId/documentField/context/node/jobId` desde controllers a adapters vía `runWithTokenUsageContext(ctx, fn)`. `withTokenUsageContextPatch` aplica patch parcial cuando entramos en una fase del pipeline (p. ej. node="auditor"). `getActiveTokenUsageContext()` consumido por los adapters para registrar uso sin inflar firmas.
- **Captura de `usage` en los 3 adapters LLM** (`apps/api/src/modules/ai/adapters/`): `OpenAICompatibleAdapter` lee `response.usage` (no-stream) y habilita `stream_options: { include_usage: true }` para recibir usage en el chunk final del stream (OpenRouter y OpenAI nativos). `AnthropicAdapter` extrae `usage.input_tokens` / `output_tokens` de `message.usage` y de los eventos `message_start` + `message_delta` del stream. `GeminiAdapter` extrae `usageMetadata.promptTokenCount` / `candidatesTokenCount` del response y de cada chunk del stream. La conversión USD→MXN la hace el helper `recordTokenUsageFromContext` (DI-agnóstico, registrado en `globalThis` por `TokenUsageService.onModuleInit`).
- **Captura en `mdd-llm-retry.util.ts`** (`apps/api/src/modules/ai-analysis/utils/mdd-llm-retry.util.ts`): el helper `invokeLlmWithRetry` extrae `usage_metadata` de la `AIMessage` retornada por LangChain y la persiste vía `recordTokenUsageFromContext`. El `providerId` / `modelId` se derivan por duck-typing del `BaseChatModel` (nombre de clase + `modelName` / `model`).
- **Wire-up a las entradas LLM existentes**:
  - `AiService.generateResponse` y `AiService.generateResponseStream` envuelven la llamada en `withTelemetryContext` cuando `options.telemetryContext` está presente; `GenerateResponseOptions.telemetryContext` añadido a la interfaz LLM (opcional, no rompe callers).
  - Session chat (`sessions.service.ts`): `buildSessionChatLlmOptions` añade `telemetryContext: { projectId, stageId, documentField: "chat", context: "chat" }`.
  - `finishDocumentGeneration` (Spec / Architecture / UseCases / UserStories / Blueprint / ApiContracts / LogicFlows / Tasks / Infra / AgentGovernance / UxUiGuide): añade `telemetryContext.documentField: "<type>Content"` en el `generateOptions` que pasa a `generateWithDocumentHooks`.
  - `mdd-queue.service.executeJob`: envuelve el job MDD entero (legacy y new pipeline) en `runWithTokenUsageContext` con `documentField: "mddContent"`, `context: "initial" | "regenerate"`, `jobId`. Así cada nodo (Clarifier, SoftwareArchitect, Stack architect, Data model, API contracts, Section5, Security, Integration, Auditor, Formatter, CrossConsistency, DiagramInjector) registra su uso atribuido al MDD.
- **Sección colapsable "Consumo IA (tokens & coste)" en la columna de métricas del Workshop** (`apps/web/src/components/TokenUsageCard.tsx`, integrado en `WorkshopMetricsColumnInner.tsx`): tabla por documento con generaciones, tokens, USD, MXN; sub-fila por modelo con `calls`; totales en cabecera (`Total acumulado`, TC, disclaimer "MXN estimado"); badge "MXN estimado" con tooltip aclarando que no es un feed live; columna "MXN (est.)" para reforzar la advertencia. Fetch lazy al expandir (`GET /ai-analysis/token-usage`). Empty state: "Aún no hay telemetría registrada".

### Changed

- **`SystemConfigService`:** inyecta `FxRateService`; al detectar cambio en `mxn_per_usd` (en `patchSettings`) llama `fxRate.invalidate()` para forzar recarga en la próxima lectura. La invalidación cubre también el caso de borrar la key (set a `null` / `""`).
- **`legacy_evidence_first_context` env-var** se mantiene como default del campo `mxn_per_usd` (20) — la nueva entrada de catálogo usa la misma envKey (`MXN_PER_USD`) para mantener compatibilidad con deployments existentes que ya configuraban la constante en `.env`.

### Fixed

- **`mdd-llm-retry.util.ts` — atribución OpenRouter en pipeline MDD:** `deriveLlmIdentity` ahora inspecciona `baseURL` (donde `createDbgaLLM` guarda el endpoint del runtime) antes de caer al heurístico por nombre de clase. OpenRouter entraba al MDD pipeline vía `ChatOpenAI` con `configuration.baseURL = "https://openrouter.ai/api/v1"`, pero la heurística anterior devolvía `providerId: "openai"` y `costUsd` quedaba en 0. Cascada ahora: 1) nombre de clase (`ChatAnthropic`, `ChatGoogleGenerativeAI`, `ChatBedrock`), 2) `baseURL` (OpenRouter, Groq, Cloudflare, OpenAI nativo, Gemini vía OpenAI-compat), 3) heurística sobre el slug del modelo (`anthropic/…`, `openai/…`, `google/…`, `meta-llama/…`, `minimax/…` → OpenRouter; `@cf/…` → Cloudflare), 4) default `openai`. 21 tests en `node:test` (`mdd-llm-retry.util.derive.spec.ts`) — todos los proveedores del catálogo OpenAI / Anthropic / Gemini / Groq / Cloudflare / OpenRouter + custom endpoint cubiertos.

### Fixed

- **MDD full-regen: §4 vacía, Mermaid partido y §1 mal formateado pasaban el gate.** Tras limpiar y regenerar el MDD (caso Jarvis IMJ), el documento cerraba en AMARILLO ~92% con `(Falta: definir endpoints…)`, diagrama de componentes con fence cerrado prematuro (`### USR["…"]` fuera de Mermaid), headings `### 1.1 Propósito Jarvis…` pegados y tablas pipe en una sola línea. Causas: el delivery gate solo medía longitud (≥200 chars); `sanitizeMermaidInDraft` aceptaba `flowchart` sin aristas; `splitHeadingTitleFromInlineProse` no cortaba títulos numerados MDD. Fix:
  - **Gate §4:** `isContratosSubstantial` / `isContratosPlaceholder` compartidos (`contratos-format.ts`); `validateMddForDelivery` bloquea placeholder o stubs sin endpoints/` ```json ` (el auto-loop re-enruta a `software_architect` vía `§4`).
  - **Mermaid:** `repairPrematureMermaidFenceClose` reensambla nodos huérfanos; fences sin aristas se eliminan; `injectProposedComponentDiagramIntoSection2` solo omite si el diagrama existente es usable.
  - **§1:** `repairGluedMarkdownHeadings` parte `### 1.1 Propósito …`; `repairCollapsedPipeTables` expande tablas colapsadas (pre-gate + `formatDocumentMarkdown`).
  - **§3 SQL:** `original text TEXT` → `original_text TEXT`; stubs `tabla_YYYY_MM` omitidos si existe la tabla padre.
- **Worker restart borraba los checkpoints de LangGraph y el MDD se truncaba.** El `docker-entrypoint.sh` corría `prisma db push --accept-data-loss` después de `migrate deploy`, lo que detectaba las tablas `public.checkpoint_*` (creadas por DDL directo en `ensureLangGraphCheckpointSchema`, no modeladas en `schema.prisma`) como "drift" y las DROPEABA. Al perder el checkpoint, la siguiente respuesta del LLM (truncada por límite de tokens) pisaba el MDD ya regenerado, borrando secciones como §4 Contratos de API o pegando bloques de otra plantilla (caso real: el proyecto "ForgeOps" perdió §5–§8 y se le insertó un bloque "## UI/UX Design Intent" de un template genérico).
  - **Capa A (`docker-entrypoint.sh`):** `prisma db push --accept-data-loss` queda DESHABILITADO por defecto. Se reactiva sólo si se define explícitamente `THEFORGE_ALLOW_DB_PUSH=1` en el contenedor. El esquema se mantiene con `prisma migrate deploy` + `safe-schema-sync.sql` (aditivo). Comentario in-line en el entrypoint documenta el incidente.
  - **Capa B (defensa en profundidad):** las tablas de LangGraph (`checkpoint_migrations`, `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) se mueven del schema `public` al schema dedicado `langgraph` mediante la nueva migración `20260722100000_move_langgraph_checkpoints_to_dedicated_schema`. Aunque alguien habilite `db push --accept-data-loss` en prod, las tablas ya no están en el schema gestionado por Prisma (`public`) y不会被 dropeadas. La migración es idempotente: en BD fresca crea el schema y las tablas; en BD vieja copia los datos existentes y borra las copias en `public`.
  - **Capa C (`mergeMddBySection`):** el orchestrator ahora MERGEA el MDD por sección (heading `## N. …`) en lugar de reemplazar el documento completo. Si el LLM devuelve un MDD regenerado pero truncado (cubre mucho menos de la mitad del existente y tiene menos secciones), se aplica merge: las secciones del incoming sustituyen a sus homólogas en el existing, y el resto del existing se preserva. Si el incoming es un placeholder vacío o claramente más corto que la sección buena (ratio < 20%), se descarta y se mantiene la sección existente. Si el incoming es un full-regen limpio (cubre todas las secciones y no se detecta truncado), sí se aplica full-replace. Code fences respetados, sub-secciones (`###`, `####`) no se promueven a secciones. Nuevo util `apps/api/src/modules/ai-orchestrator/mdd-section-merge.util.ts` con 13 tests (vitest) cubriendo: parseo por sección, ignorado de code fences, regeneración de una sola sección, full-replace, truncación defensiva, placeholders vacíos, secciones nuevas, preservación de front matter.

### Changed

- **`AiOrchestratorService.tryPersistMddContent`:** antes de persistir el MDD devuelve por la IA, hace `findOne(projectId)` para obtener el MDD actual, ejecuta `mergeMddBySection(currentMdd, incomingMdd)`, y persiste el resultado. Loggea `[Orchestrator] mddContent merge defensivo (incoming posiblemente truncado)` con `mode`, `truncatedIncoming`, `sectionsReplaced`, `sectionsKept`, `sectionsAdded` y longitudes, para que un futuro debug del flujo Workshop pueda auditar por qué se preservó X sección. Si el merge lanza (BD no accesible, etc.) cae al comportamiento anterior (replace) en lugar de bloquear el chat.
- **Decisión de devx: sin step de typecheck en CI.** El deployment de Dokploy ya rebuild-ea `@theforge/shared-types` durante el `Dockerfile` build (pnpm install + pnpm build), así que en prod/staging nunca llega un `dist/` stale. Enforzar un `pnpm typecheck` en CI duplica ese trabajo y añade un gate que rompe PRs legítimos cuando el dev olvidó rebuild-ear localmente. La responsabilidad de mantener `dist/` fresco en local queda en el dev: el githook `pre-commit` lo cubre en commits, y `pnpm --filter @theforge/shared-types build` o `pnpm typecheck` lo cubren en cualquier otro momento. Si el dev olvida y ve `TS2305` falsos positivos, ya sabe qué comando correr.

### Added

- **`apps/api/src/modules/ai-orchestrator/mdd-section-merge.util.ts`** + spec: parser y merger de MDD por sección, puro, determinista, sin dependencias externas.
- **Migración `20260722100000_move_langgraph_checkpoints_to_dedicated_schema`:** mueve los datos de `public.checkpoint_*` a `langgraph.checkpoint_*` (idempotente, seguro en BD fresca y vieja). Marca v=0..4 en `langgraph.checkpoint_migrations` para que `ensureLangGraphCheckpointSchema` arranque como no-op.
- **Script raíz `typecheck` (`package.json`):** `turbo run build && turbo run test:types`. Asegura que los `dist/*.d.ts` de `@theforge/shared-types` están frescos antes del `tsc --noEmit` de las apps, eliminando los falsos positivos `TS2305: Module '@theforge/shared-types' has no exported member 'X'` que aparecían cuando `src/` avanzaba más rápido que su build.
- **Githook `.githooks/pre-commit`:** detecta cambios staged en `apps/api/**` o `packages/shared-types/**` y dispara `pnpm turbo run build --filter=...{./apps/api}`. Resuelve el grafo `^build` de `turbo.json` (rebuild sólo lo necesario, cache hit si nada cambió). Re-stage-a `dist/`/`dist-cjs/` para que el commit los incluya. Activado por `pnpm setup:githooks`.
- **Sección "Build antes de tsc" en `packages/shared-types/README.md`:** explica por qué `dist/` puede quedar stale y la matriz de comandos (build, typecheck, githook, deployment) para cada caso. La responsabilidad de rebuild local queda en el dev (githook + comando manual); CI no enforza un typecheck porque el deployment (Dokploy) ya rebuild-ea al construir la imagen.
- **Retry automático en nodos LLM del pipeline MDD** (`apps/api/src/modules/ai-analysis/utils/mdd-llm-retry.util.ts` + spec, 9 tests). El log del job 92 del proyecto ForgeOps (2026-07-22 05:35–05:59) muestra 4 de 9 invocaciones devolviendo texto vacío (rate-limit del proveedor). Sólo el nodo `Security` tenía retry 1x; `SoftwareArchitect`, `Clarifier`, `LLMFormatter` y `Auditor` caían directamente al fallback ("borrador sin transformar", "usando fallback", "determinístico con gaps estructurados") y degradaban el MDD persistido. Nuevo `invokeLlmWithRetry(llm, messages, { tag, maxAttempts, backoffMs, isResponseValid })` — backoff por default `[0, 1500, 4000]`, aplicado a las 4 invocaciones que fallaron en el log. En los tool loops (SoftwareArchitect, Auditor) el retry sólo se aplica a la iteración final (cuando el LLM ya no devuelve `tool_calls`); iteraciones intermedias vacías son OK porque el LLM sigue invocando tools hasta agotar el loop.
- **Quality Gate endurece substance check por sección canónica** (`apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate.util.ts`). El `validateMddForDelivery` solo validaba estructura (headings §1-§7 presentes, no duplicados, sin fences abiertos, TechnicalMetadata en §3). El LLMFormatter (u otro nodo) puede comprimir el MDD a ~18k chars dejando §2-§7 como `(Pendiente)` o placeholders triviales, y el gate pasaba con `ok=true score=100` — bug del job 92 del proyecto ForgeOps. Ahora se extrae el cuerpo de cada sección canónica con `extractSectionBody` (robusto a headings pegados al body por `applyDeterministicCrossConsistencyFixes` upstream y a code fences) y se bloquea si el body es un placeholder del pipeline (`isMddSectionPipelinePlaceholderBody`) o tiene < 200 chars (< 100 para §3, que típicamente trae SQL DDL). Excepciones: cuerpo que contiene `Ver §N` (referencia cruzada, ej. tras dedup de UAT) se considera válido aunque sea corto. Test que reproduce el caso del job 92 (3 de 7 secciones en Pendiente) confirma que ahora se rechazan con `ok=false score=76` en vez de persistirse silenciosamente.
- **Dedicated §5 pass: nodo `section5` que regenera SOLO `## 5. Lógica y Edge Cases`** (`apps/api/src/modules/ai-analysis/nodes/mdd-section5.node.ts` + spec, 5 tests; `mdd-delivery-gate-loop.util.ts` + spec, 6 tests). El commit `82797038` de Óscar anunció "add a dedicated architect §5 pass" pero el código nunca lo implementó — §3/§4/§5 salían siempre en un solo LLM call desde `software_architect`. Cuando el substance check falla únicamente en §5, no tiene sentido re-correr todo `software_architect` (que regenera §2-§5 juntos y puede volver a fallar en §5 por la misma razón). Ahora:
  - Nuevo nodo `createMddSection5Node(llm)` con prompt enfocado (`section5-prompt.md`) que genera SOLO el bloque `## 5. …` con reglas BDD/AAA y edge cases.
  - `DeliveryGateFixTarget` extendido a `"software_architect" | "integration" | "clarifier" | "section5"`. Si TODOS los substance blockers mencionan §5, el loop enruta a `section5` (más eficiente). Si hay blockers de otras secciones también, va a la ruta normal.
  - `getSectionsToPreserveFromExecutorPlan` reconoce `"section5"` como nodo que sólo toca §5.
  - Ambos grafos (`createMddGraph` y `createMddGraphWithManager`) registran el nodo, lo exponen en `managerEnds`/`executorEnds`, y `section5` re-empuja a `prepare_output` para re-evaluar el gate tras la regeneración.
  - 5 tests del nodo: regenera §5 preservando el resto, fallback si LLM devuelve placeholder/vacío/corto, recorte defensivo si el LLM incluye §6.
  - 6 tests del routing: §5 solo → section5; §2+§5 → software_architect; §5+§7 → integration; §1+§5 → clarifier; comportamiento legacy preservado.
- **Eliminado el `llm_formatter` (nodo LLM destructivo) del pipeline MDD** (`apps/api/src/modules/ai-analysis/graph/mdd-graph.ts`). El bug que reportaste en el proyecto ForgeOps: en la primera pasada el formato estuvo perfecto, pero al final del loop el LLM re-formateó y dejó el MDD mal. Causa raíz: el pipeline tenía 4 formatters y uno de ellos (`llm_formatter`, en `mdd-llm-formatter.node.ts`) era destructivo — re-generaba el markdown desde el JSON estructurado via LLM, descartando el formato bien armado por los 3 formatters deterministas. Su skip heurístico (`draft > 5000 chars + 7 secciones + §3 con payloads`) era frágil: tras el `section5` regen (mi commit anterior) el §3/§4 cambiaban lo suficiente para que el skip fallara y el LLM re-formateara con resultado peor. Fix: el nodo `llm_formatter` se quitó del grafo (`createMddGraph` y `createMddGraphWithManager`); los formatters deterministas (`format_after_architect`, `format_sec_int`, `format_after_redactor`) producen el formato final; el `format_after_redactor` ahora va directo a `cross_consistency_checker` + `diagram_injector` en paralelo. El archivo `mdd-llm-formatter.node.ts` se conserva marcado `@deprecated` con instrucciones de cómo reintroducirlo de forma segura si en el futuro hace falta. Confiamos en el substance check del delivery gate (mi commit anterior) para detectar MDDs degradados antes de persistir.
- **Pantallas: PascalCase limpio en `inferPageComponentName` + title legible en `buildUiProjectInstructions`** (`ui-screen-routes.util.ts` + spec, 8 tests; `ui-screens-plan.util.ts`; `ui-project-instructions.util.ts`). El bug que reportaste: el JSON de `pantallas.md` salía con `title: "-APP_PACKAGESGestionarApp_packagesPage"` y `useCase.name` con `*Referencia:* US-CRUD` redundante. Causa raíz en 3 lugares:
  - **`inferPageComponentName` (`ui-screen-routes.util.ts`):** capitalizaba solo la primera letra de cada palabra sin slugificarla — `app_packages` → `App_packages` (no `AppPackages`). Además, las palabras con acentos (`ó`, `á`) se partían porque el split usaba `[^a-zA-Z0-9]+`. Fix: nueva helper `toPascalCase` que normaliza acentos con NFD + strip combining marks antes de split; produce `AppPackages`, `GestionarAppPackagesPage`, `InicioDeSesionPage`.
  - **`buildUiProjectInstructions` (`ui-project-instructions.util.ts`):** usaba `item.pageName ?? item.screenName` para el `title` del screen — el `pageName` es el nombre de componente React (PascalCase), no un título visible. Fix: usa `item.screenName` directamente (frase legible: "Gestionar app_packages", "Chat del copiloto"). Lo mismo para el `page-header` section title.
  - **`formatStoryPurpose` (`ui-screens-plan.util.ts`):** agregaba `\n*Referencia:* ${story.id}` al final, pero ese id ya está en `useCase.id`. Fix: eliminado el duplicado.
- **Documentación para devs:**
  - `README.md` raíz: bloque `pnpm run setup:githooks` en la sección "Desarrollo".
  - `CONTRIBUTING.md`: sub-sección "Githooks (recomendado)" en "Local development" + nota en "Tests and lint" sobre `pnpm typecheck` vs `pnpm test:types`.
  - `README-LOCAL.md`: paso 6 "Githooks (recomendado)" tras los pasos de Docker / dev.

## [v1.7.0] — 2026-07-27

> **Coherencia MDD sin Falkor + fixes pipeline MDD (Clarifier / delivery gate)** — El API deja de depender de FalkorDB para el grafo SDD documental; la coherencia §3↔§4 se infiere del markdown. ADRs y legacy gate migran a fuentes Prisma/markdown. Incluye correcciones cuando el Clarifier devuelve §1 vacío con DBGA grande y cuando un cascarón MDD debe re-enrutar al arquitecto completo.

### Added

- **`engine/mdd-coherence/`** — `MddCoherenceService`, `evaluateMddCoherenceFromMarkdown`, `buildSddStageSnapshotFromMdd`, utilidades CONSUMES desde SQL §3 y rutas §4; snapshot en `Stage.shortTermContext.sddGraph`.
- **`finalizeClarifierDraft`** (`mdd-clarifier-draft.util.ts`) — preserva baseline si el LLM devuelve §1 insustancial; hidrata §1 desde scope/DBGA cuando DBGA ≥ 5k.
- **Nodo LangGraph `structured_hydrator`** — sustituye `graph_populator`: hidrata `mddStructured` y extrae ADRs a `agentGovernanceContent` (sin Falkor).
- **`persistProjectAdrsToGovernance`** — ADRs de patrones SSOT y extracción MDD en `agentGovernanceContent`.

### Changed

- **FalkorDB retirado del API:** eliminados `graph-memory/`, `SddIngestorService`, dependencia `falkordb`, tools Cypher (`query_sdd_graph`, `supervisor_query_sdd_graph`), contenedor `theforge-falkor-sdd` en `ensure-infra.js` y vars `FALKORDB_*` en `.env.example`.
- **Semáforo / pipeline HIGH:** `sddDomainGraphOk` vía `MddCoherenceService` (markdown) en lugar de `GraphMemoryService.evaluateSddDependencyHealth`.
- **Legacy index gate:** `assertLegacyIndexSddGate` usa snapshot §3/§4 parseado del MDD de la etapa, no Falkor.
- **Manager MDD:** `search_memory` ejecuta patch/enmienda MDD y MCP legacy; sin búsqueda semántica Falkor. Prompt y README alineados.
- **Workshop:** badge «Coherencia §3/§4» (antes «Grafo SDD»). Labels `SDD_GRAPH_SYNC_STATE_LABELS`: Coherente / Incoherente / Sin §3/§4.
- **Docs locales:** `README-LOCAL.md`, `scripts/README.md`, `agent-supervisor/README.md` sin Falkor SDD.

### Fixed

- **Clarifier con DBGA grande (1.3):** draft corrupto (§1 ~64 chars, §3–§7 faltantes) ya no pisa el baseline cuando el LLM devuelve §1 insustancial.
- **Delivery gate cascarón (1.4):** §1/§2 rotas + ≥3 secciones §3–§7 faltantes enrutan a `software_architect`, no a `clarifier`. `gateHasSection5SubstanceBlocker` no confunde blocker de secciones faltantes con sustancia §5.

### Architecture

- ADRs: única fuente en `agentGovernanceContent` (`ArchitectureDecisionService`, `getProjectDecisions`, wizard de patrones SSOT).
- Integración legacy/new: eliminados sync Falkor (`INTEGRATES_WITH`, handoff `SATISFIES`); persistencia Prisma intacta.

## [v1.6.3] — 2026-07-21

> **Tasks — contratos livianos y map-reduce por capa** — Sustituye el dump masivo de documentos SDD por manifiesto JSON, Context Anchors por HU y prompts segmentados Backend / Frontend / Infra / QA / Integración.

### Added

- **`tasks-context-contracts.ts`:** tipos Zod (`TasksContractManifest`, `TasksContextAnchor`, capas dominio/arquitectura/experiencia/integración).
- **`tasks-contract-layers.util.ts`:** extracción determinista del manifiesto (glosario, reglas, stack, pantallas, endpoints, servicios externos).
- **`tasks-context-anchor.util.ts`:** Context Anchor por HU + partición del plan por capa de generación.
- **`tasks-layer-context.util.ts`:** matriz de contexto mínimo por tipo de task (map-reduce).
- **Modo contratos en `generateTasks`:** `tasksContractContext` + `tasksGenerationLayer` en lugar de adjuntar markdown completo.
- **Specs:** `tasks-contract-layers.util.spec.ts`.

### Changed

- **`tasks-generation-pipeline.service.ts`:** planner sobre manifiesto JSON; redactor map-reduce por capa; fallback legacy dump solo si falla el planner.
- **`tasks-prompt.md`:** sección Context Anchor y reglas por capa.
- **README** projects y prompts Tasks.

### Fixed

- **Chat Fase 0 (DBGA) — cambios que no se persistían:** (1) `parseBenchmarkResponse` tolera variantes del marcador (`---FIN_DBGA`, `FIN_DBGA---`, `## FIN_DBGA`, `**FIN_DBGA**`). (2) `isDbgaContentNearlyIdentical` con tolerancia acotada (cap 200 chars) para no descartar ediciones pequeñas en DBGA grandes. (3) Imperativo «Haz los cambios al documento» y renombres propuestos (p. ej. **PAT Wasender** / **PAT SSO**) se detectan y validan sin rechazar acrónimos cortos. (4) Pedidos largos de edición DBGA pasan por **LLM de intención** (confianza heurística ~0.78; el clasificador por keywords ya no corta con 0.92 ante «haz los cambios» embebido). (5) `isDbgaEditEffectivelyUnchanged` no descarta renombres cortos que sí reflejan el pedido. (6) El refinado prefiere `FIN_DBGA`; si el modelo omite el marcador pero devuelve un **DBGA completo** (título + tamaño), se acepta (`acceptCompleteDbgaWithoutFinMarker`) en lugar de descartar toda la respuesta (caso Gemma).

## [v1.6.2] — 2026-07-19

> **MDD SSOT — UAT, §4 journeys y tablas plataforma** — Paridad escenarios UAT BRD→MDD, contratos CRUD/journey en §4, gate MCP/memoria alineado con contexto BRD.

### Added

- **`brd-mdd-uat-conformance.util.ts`:** paridad escenarios UAT BRD → MDD §1; inyección determinista de escenarios faltantes (p. ej. límite IA, stop-loss).
- **`mdd-journey-section4.util.ts`:** requisitos §4 para watchlists, strategies, credentials, `/dashboards/me`, `/tenants/:id/quota` y WebSocket si §2 lo describe.
- **`mdd-ssot-repair.util.ts`:** orquestación pre-gate (plataforma + UAT + §4) en `mdd-prepare-output` y estimación.
- **`platform-table-justify.util.ts`:** ancla tablas MCP/memoria en BRD §3, MDD §1 o Spec; auto-comentarios `[platform:*]`.
- **Specs:** brd-mdd-uat, mdd-journey-section4, mdd-ssot-repair, platform-table-justify.

### Changed

- **Delivery gate / W4 / `collectConformanceGaps`:** blockers `domain-uat-regression` y `domain-section4-journey`.
- **`DBGA_CORE_ENTITIES`:** incluye `strategies`.
- **`domain-inventory.util.ts`:** aliases `strategy` / `estrategia`.

### Fixed

- **Regresión UAT:** MDD ya no pierde escenarios 3–4 tras regeneración cuando el BRD los mantiene.
- **§4 sin contratos journey:** tablas §3 con endpoints CRUD y rutas especiales ausentes en contratos.
- **`normalizeApiPathForCompare`:** `{id}` ya no produce doble barra (`/tenants//*/quota`).
- **Gate tablas plataforma:** `mcp_plugins` / `conversation_memory` justificables por contexto MCP/memoria en corpus.

## [v1.6.1] — 2026-07-19

> **MDD como SSOT — brechas críticas de dominio** — Entidades DBGA en §3, tablas plataforma, prefijo API unificado, decision log BRD, trazabilidad entidad→API e integraciones externas.

### Added

- **`domain-inventory-conformance.util.ts`:** gate entidades DBGA faltantes (`users`, `watchlists`, `operations`, `credentials`, `dashboard_configs`, `otp_sessions`) y tablas plataforma (`messages`, `mcp_plugins`, `conversation_memory`) sin ancla BRD/DBGA.
- **`brd-decision-log.util.ts`:** cierre decision log (fiscal %, `$N$`, tokens/plan, «Por validar»).
- **`api-prefix-unify.util.ts`:** reconcilia `/api/` → `/api/v1/` en contratos según MDD §4.
- **`entity-api-trace.util.ts`:** matriz explícita entidad → §3 → endpoint API.
- **`dbga-benchmark-matrix.util.ts`:** aviso si DBGA promete matriz competitiva sin tabla.
- **`sdd-external-contracts.util.ts`:** WebSocket gateway, Banxico, Polygon cuando DBGA/BRD los mantienen en alcance.
- **`PLATFORM_ORPHAN_TABLES` / `DBGA_CORE_ENTITIES`** en `@theforge/shared-types`.
- **Specs:** domain-inventory-conformance, mdd-ssot-gaps.

### Changed

- **Delivery gate MDD** y **cascada W4:** blockers de dominio + decision log; retry API/Architecture ante gaps SSOT.
- **`collectConformanceGaps` / `audit_documents`:** incluye inventario, trazabilidad, benchmark DBGA e integraciones.
- **`repairApiProgrammaticGaps`:** unifica prefijo antes de inyectar endpoints §4 faltantes.
- **`mdd-quality-audit.util.ts`:** DLQ distingue RabbitMQ vs Celery; Argon2id sin cambio de contrato.

### Fixed

- **MDD auth-skewed:** inventario DBGA alimenta `suggestedEntities` y stubs §3 deterministas.
- **Drift API prefix:** contratos ya no mezclan `/api/` y `/api/v1/` tras reparación programática.

## [v1.6.0] — 2026-07-19

> **Pipeline de generación — 10 brechas post GOD-REFACTOR** — IDs US estables, SSOT tasks, bundle version atómico, conformidad cross-artifact, partición por journey, alcance v1 de pantallas, cardinalidad Prisma, parser tasksJson v2, re-estimación post-consolidación y cableado MCP/spec-kit.

### Added

- **`us-id-registry.ts`:** namespaces `US-CRUD-*` / `US-JRN-*` para IDs de user stories estables entre regeneraciones.
- **`tasks-resolve.ts` + `resolveProjectTasksSsot`:** SSOT único (`tasksJson` v2 → fallback `tasksContent`) para Workshop, spec-kit, next-task y MCP.
- **`deliverable-bundle.ts` + `deliverable-bundle-persist.util.ts`:** `bundleVersion` en snapshot de etapa tras oleadas de regeneración atómica.
- **`cross-artifact-trace.util.ts`:** conformidad pantalla → API → US → task en post-pase W4.
- **`tasks-journey-partition.util.ts`:** generación de tasks particionada por journey/fases.
- **`ui-screens-v1-scope.util.ts`:** política de pantallas fuera de alcance v1 (`v1InScope`).
- **`model-cardinality.util.ts`:** alineación cardinalidad MDD §3 = inventario = T-002 Prisma.
- **Parser `tasks-parser-v2`:** metadata solo bajo `## Metadata`; strip de `---` anidados.
- **MCP `mcp-ssot.util.ts`:** tool `get_tasks_json`; `tasksSsot` en `get_project_deliverables`; `deliverableBundleVersion` en `get_project_stages` y `get_next_implementation_task`.
- **Specs:** us-id, tasks-resolve, ui-screens-v1-scope, tasks-journey-partition, tasks-parser-v2, tasks-ssot-resolve, mcp-ssot.

### Changed

- **`buildThinUserStoriesFromInventory`:** user stories delgadas con `usId` estable desde inventario de dominio.
- **`deliverables-cascade.service.ts`:** persistencia de bundle version post-oleadas; trazabilidad cross-artifact.
- **`tasks-generation-pipeline.service.ts`:** redactor por fases/journey; heurística mín. 1 task frontend por pantalla v1 con API.
- **`tasks-coverage-checklist.util.ts` / `tasks-heuristic-plan.util.ts`:** rutas v1 en checklist y plan heurístico.
- **`spec-kit-bundle.ts` / handoff export:** `buildSpecKitBundleFiles` consume SSOT `tasksJson`.
- **`project-estimation-recalc.service.ts`:** re-estimación con `consolidatedTaskCount` tras `generateTasks`.
- **`ProjectNextTaskResponse`:** expone `tasksSource`, `hasTasksJson`, `taskCount`, `deliverableBundleVersion`.

### Fixed

- **Regeneración parcial:** snapshot de entregables versionado evita mezcla de artefactos de oleadas distintas.
- **Drift tasks markdown vs JSON:** consumidores (MCP, spec-kit, next-task) leen la misma fuente resuelta.

### Architecture

- Sin cambios en fórmulas MXN (`packages/business-rules`) ni contratos REST públicos breaking.
- Workshop web sigue leyendo `tasksContent` directamente (fuera de scope MCP; SSOT ya disponible vía API/MCP).


> **GOD-REFACTOR (Fases 0–6)** — Descomposición de god modules sin cambiar contratos públicos: MDD sanitize/manager, chat API, `projects.service`, Workshop UI/store, legacy coordinator, MCP server y gobernanía IA por artefacto. Build monorepo verde.

### Added

- **Fase 0:** red de specs de regresión (golden MDD, workshop store smoke, MCP tools).
- **`store/workshop/`:** 7 slices Zustand (`project`, `session-chat`, `mdd`, `deliverables`, `clarify`, `legacy-debug`, `ui`) + composición en `workshopStore.ts` (~51 L).
- **`packages/mcp-server/src/tools/`:** tools MCP por dominio (`project`, `generation`, `analysis`, `orchestrator`, `legacy`, `integration`, `markdown`); bootstrap HTTP/stdio ~248 L.
- **`agent-governance/`:** módulos por artefacto (`rules-artifacts`, `skills-artifacts`, `agents-artifacts`, `install-map`, `sdd-conflict`).
- **Legacy-flow:** `legacy-stage-context`, `legacy-mdd-generation`, `legacy-deliverables-orchestrator` + util/types compartidos.

### Changed

- **`mdd-sanitize.ts`:** barrel sobre submódulos (`section-merge`, `persist-pipeline`, `sql-repair`, `mermaid-fences`, …).
- **`mdd-manager`:** plan, heuristics, LLM turn, state handlers y delegate en archivos dedicados.
- **Chat API:** `workshop-system-prompt.builder.ts`, runner compartido de turnos en `sessions`; duplicación sync/stream reducida.
- **`projects.service.ts`:** fachada ~420 L; lógica en servicios por dominio (MDD persist, entregables, etapas, conformidad, …).
- **`WorkshopView.tsx`:** layout shell, paneles, hooks de props y métricas extraídos (~5 140 L vs ~5 917).
- **`legacy-coordinator.service.ts`:** ~680 L; delega MDD y entregables en orchestrators.
- **`packages/mcp-server`:** cliente API, tipos y registry en `tools/index.ts`; `.gitignore` corrige exclusión de `packages/mcp-server/src/tools/`.

### Fixed

- **Build API (Nest):** typo `systemPrompt` en multimodal; import `buildApiRetryFeedback`; narrowing `MddUpdatePipelineResult`; `legacyChangeState` con `Prisma.JsonNull`; imports muertos tras split `mdd-sanitize/internal.ts`.
- **`mdd-golden.util.ts`:** `__dirname` compatible con salida CJS del build.

### Architecture

- Documentación: `docs/GOD-REFACTOR.md` (incrementos 5a–6-4), READMEs de carpetas afectadas.
- **Sin cambios** en fórmulas MXN (`packages/business-rules`), delimitadores `---FIN_*---`, contratos MCP/REST públicos ni flujo legacy de negocio.

### Removed

- **Integración Hermes Agent:** eliminados webhook (`HERMES_*`), endpoints `GET /projects/hermes-status` y `POST /projects/:id/launch-hermes`, botón «Lanzar a Hermes» en Workshop y claves en Ajustes → Sistema. Handoff sigue vía export ZIP / repo-handoff / MCP.

## [v1.4.0] — 2026-07-18

> **Tasks — cobertura 100% determinista** — Pipeline endurecido para que el documento Tasks sea ejecutable por cualquier IA sin gaps en API, pantallas, Testing ni Deploy.

### Added

- **`tasks-coverage-checklist.util.ts`:** checklist determinista endpoint↔task, ruta↔Frontend, drift API, secciones Testing/Deploy; serialización JSON para auditor/repair LLM.
- **Use Cases en pipeline Tasks:** planner, redactor y contexto slim incluyen `useCasesContent`.
- **`tasksGenerationPrerequisites.ts` (web):** botón Tasks deshabilitado hasta cumplir MDD + Spec + Blueprint + API (+ Pantallas si UX team).

### Changed

- **Redactor Tasks:** `max_tokens` perfil **`tasksDoc` (131K)** — corrige truncado silencioso a 8K en MVPs grandes.
- **Caps upstream redactor:** API y pantallas a 20K; user stories a 12K; use cases a 10K.
- **Gates estructurales:** 1 task Backend por endpoint de `api-contracts`; 1 task Frontend por ruta en `pantallas.md`; drift API desde ≥1 ruta inventada; Testing/Deploy obligatorios cuando aplica §7/§8.
- **Task auditor v2:** `mdd_ref` error en tareas de implementación; `story_ref` error si hay user stories upstream.
- **Planner heurístico:** 1 ítem plan por endpoint (no agrupación por resource).
- **Auditor/repair LLM:** contexto ampliado (API, pantallas, checklist determinista); repair usa `tasksDoc` tokens.
- **Reparaciones:** 3 ciclos si documento truncado (`TASKS_PIPELINE_MAX_REPAIRS_TRUNCATED`).
- **W4 cascada:** `acknowledgeGaps` en retry Tasks solo si DocAccuracy upstream &lt; 70.

### Fixed

- **Tasks truncados en proyectos grandes:** el pipeline ya no usa el perfil `chat` (8K) para generar el markdown completo.

## [v1.3.0] — 2026-07-18

> **Configuración de plataforma en UI** — Tunables operativos migrados de `.env` a Ajustes → Sistema con defaults y persistencia en `AppConfig`.

### Added

- **Catálogo `system-config` (`@theforge/shared-types`):** allowlist de ~40 claves (integraciones, LLM, BullMQ, MCP, legacy, debug) con tipo, default, categoría y metadatos.
- **API `SystemConfigModule`:** `GET/PATCH /admin/system-config` (solo `super_admin`); resolución runtime **BD → env → default** vía `platform-config.runtime.ts`.
- **Web — pestaña Sistema:** `SystemConfigCard` en Ajustes (visible solo para `super_admin`); badges de origen (default/env/guardado) y aviso de reinicio para concurrencia BullMQ.

### Changed

- **Runtime API:** LLM (`llm_max_tokens`, embeddings, fallback 429), LangGraph recursion, concurrencia BullMQ, timeouts MCP, Hermes, brownfield Ariadne, caché contexto TheForge y evaluador legacy leen el catálogo de plataforma.
- **`.env.example`:** recortado a bootstrap (DB, Redis, JWT, SMTP, BYOK, MCP M2M, build); tunables documentados como override opcional o vía UI.

## [v1.2.2] — 2026-07-17

> **Workshop MDD — progreso unificado y portabilidad Notion** — Panel de avance estable en chat, detección correcta de cambios sin guardar, export/import de proyecto y jobs MDD en background.

### Added

- **Portabilidad de proyecto (formato Notion):** export/import ZIP Markdown & CSV a nivel proyecto — páginas `.md` por documento, carpetas por etapa, `Integración/Handoff items.csv`, `Integración/Trazas integración.csv`, `Etapas.csv`, `index.html` y metadatos en `_theforge/`. API: `GET /projects/:id/export/notion`, `POST /projects/import/notion`, `POST /projects/import/notion/pair` (restaura vínculo NEW↔LEGACY y matriz de trazas). UI: export en configuración del proyecto; import e import pareja en el dashboard.
- **Resolución Forge ↔ Ariadne:** tabla `project_ariadne_links`, `POST /theforge/resolve-forge-project-for-ariadne` y MCP `resolve_forge_project_for_ariadne` (404/409 con candidatos para modal en Ariadne). Enlace primario al crear proyecto LEGACY o promover handoff.
- **Change pack Ariadne → etapa LEGACY:** `POST /theforge/create-stage-from-ariadne-change-pack` y MCP `create_stage_from_ariadne_change_pack` (pack v1, `recommendedNextTools` para MDD/entregables).
- **MDD jobs — visibilidad y cancelación:** `GET /projects/:id/generation-status` incluye `mddJobs[]` (jobId, mode, status, progreso). `DELETE /projects/:id/mdd-jobs/:jobId` cancela jobs en cola o aborta pipeline activo entre nodos LangGraph. Banner Workshop con detalle del job y botón «Cancelar MDD».
- **Worker BullMQ dedicado:** proceso `worker.js` (`THEFORGE_RUNTIME_ROLE=worker`) y servicio `theforge-worker` en compose; la API (`http`) solo encola. Config `bullmq-runtime.config.ts` con concurrencia por cola (`MDD_BULLMQ_CONCURRENCY`, default 2).
- **MDD upstream sync:** banner «Sincronizar MDD» cuando Fase 0 / BRD / Benchmark cambian; regeneración parcial por secciones afectadas; baseline por etapa en BD.

### Changed

- **Producción:** `REDIS_URL` obligatorio (`NODE_ENV=production`); entrypoint, `main.ts` y `worker.ts` abortan si falta. Sin Redis queda fallback in-memory solo en desarrollo.
- **Etiquetas MDD en progreso:** `getAgentLabel` y mensajes para nodos `diagram_injector`, `format_after_architect`, `cross_consistency_checker`, etc.
- **`docker-compose.yml`:** `theforge-api` con `THEFORGE_RUNTIME_ROLE=http`; nuevo `theforge-worker` con rol `worker`.
- **Progreso MDD en chat:** un solo panel «Progreso del flujo» (sin burbuja «Generando…» duplicada); regeneración §N incluida; historial colapsado tras 6 pasos; agentes repetidos etiquetados «2ª pasada».

### Fixed

- **MDD «cambios sin guardar» falsos:** baseline alineado con `normalizeWorkshopDocumentForEditor` y `workshopDocumentBodiesEqual` tras refresh o `/formatear`.
- **Progreso MDD stream ↔ poll:** `mergeAgentProgressFromMddEvent` fusiona eventos NDJSON y snapshot del job sin acortar la lista visible al cambiar de fuente.
- **Panel «Progreso del flujo» MDD:** deduplicación de pasos idénticos reemitidos por polling del job en background (evita decenas de filas `diagram_injector`).
- **Poll MDD en Workshop:** reintentos de red (~30 s) antes de error fatal; aviso amarillo si el job sigue en servidor tras fallo de poll.
- **Listas ordenadas partidas:** `repairSplitOrderedListItems` en `formatDocumentMarkdown` une marcadores `1.` en línea sola con el texto en la siguiente.
- **Mermaid en viewer:** `<br>` → `<br/>` en SVG generado.
- **Stamp MDD en editor:** el panel MDD quita cabecera API al cargar (paridad con DBGA/Spec).

## [v1.2.1] — 2026-07-17

> **Workshop — edición DBGA y covenant de delimitadores** — Pipeline de edición en chat endurecido, heurística «revisa gaps», avisos sin jerga `---FIN_*---` para el usuario y regla firmada para agentes.

### Added

- **Workshop — pipeline de edición de documentos (3 fases):**
  - `workshop-document-turn.util.ts` — gate de persistencia por intención (`chat_only` / `confirm_then_edit` no guardan aunque venga `---FIN_*---`), `sanitizeLlmResponse` (strip thinking), prefijo `[MODO EDICIÓN]`, validación estructural MDD (§1–§7), métricas `[DocumentTurn]`.
  - `document-refine.util.ts` + `refineDocumentFromUserRequest` — segunda pasada barata de refinado para todos los tabs (paridad con DBGA).
  - `resolveMddContentForReturn` / `resolveDeliverableContentForReturn` — merge + `validateDocumentForPersist` + retry si falta delimitador o el doc no refleja la petición.
  - Dual Output RFC-001 solo en `edit_document` + tab `mdd`.
  - Intent router: contexto `lastAssistantMessage` y heurística de confirmación (`assistantOfferedDocumentEdit` + «dale» / «sí»).
- **`workshop-fin-delimiter-covenant.ts`:** covenant LLM (`WORKSHOP_DBGA_EDIT_COVENANT`, `workshopFinDelimiterCovenant`) y mensajes al usuario cuando el panel no persistió.

### Changed

- **`SessionsService.chat` / `chatStream`:** aplican gate de intención, sanitización, resolución unificada de documentos y log `[DocumentTurn]` en cada turno.
- **`IntentRouterService`:** cache incluye último mensaje del asistente; prompt LLM del router recibe contexto del turno anterior.
- **Heurística DBGA «revisa gaps»:** mensajes tipo «revisa que no tenga gaps / motor agnóstico» clasifican como edición (`looksLikeDbgaEditRequest`) aunque el router LLM diga `chat_only`.
- **Aviso UI/API con delimitador sin persistencia:** si el modelo emite documento (`hadDelimiter`) pero el panel no cambia, warning en chat + banner en Workshop (`documentHadDelimiter` / `documentPersisted` en SSE `done`).
- **Mensajes al usuario sin jerga `---FIN_*---`:** avisos de panel no persistido ya no piden reformular con delimitadores; el covenant refuerza la regla solo para agentes.
- **`AiService` / `phase0-benchmark-refine-prompt.md`:** regla firmada DBGA — documento completo + `---FIN_DBGA---`; si hay duda, preguntar en chat sin pedir delimitadores al usuario.

### Fixed

- **Ediciones accidentales en modo exploración:** el modelo ya no puede persistir documento cuando el router clasifica `chat_only` o `confirm_then_edit`, aunque emita delimitador.
- **Validación server-side alineada con web:** entregables del chat pasan por `validateDocumentForPersist` completo (no solo shrink peligroso).
- **SSE `done`:** el orquestador reenvía `documentHadDelimiter` / `documentPersisted` al frontend para el banner del Workshop.

## [v1.2.0] — 2026-07-17

> **Auditoría SDD y calidad de cascada** — Endurecimiento agnóstico del pipeline MDD→entregables: gates de calidad estructural, conformidad Infra/API ampliada, semáforo alineado con cascada, MCP `audit_documents` y panel Workshop.

### Added

- **Cascade accuracy — C7/C8:** componentes `C7_useCases` y `C8_userStories` en `computeDocAccuracy`; pesos redistribuidos.
- **Tasks planner — orphan detection:** `evaluateTasksStructure()` reporta tareas sin `target_files`/`verification`.
- **Governance — CLAUDE.md contextual** y reglas enriquecidas (`architecture-patterns`, `api-contracts`).
- **`mdd-quality-audit.util`:** detección determinista de JSON §4 desbalanceado, Mermaid sin fence, tablas SQL huérfanas, manifest §7 truncado, placeholders en §1; extracción de requisitos Infra desde manifest; alias semánticos API.
- **Delivery gate MDD:** blockers por §5/§6/§7 duplicadas y issues de calidad estructural; `applyPreDeliveryGateFixes` repara Mermaid suelto y deduplica secciones.
- **Auditor determinista:** penalización y `syntax_errors` por duplicados, JSON roto y tablas huérfanas.
- **Conformidad Infra:** `checkInfraManifestConformance` (Argon2id, DLQ, rate limits, CloudFront vs nginx, `/health` Celery).
- **API post-generación:** doble pasada de `repairApiProgrammaticGaps`; change log JSON estructurado en gaps de conformance.
- **Cascada:** `runCascadeConformanceRetry` (hasta 2 iteraciones API+Infra) tras generar entregables.
- **Estimación en vivo:** penalización por gaps API/Infra; `conformanceSummary` en `get_estimation`; Spec sustituto de BRD en trazabilidad greenfield; Use Cases thin capados a 50% completitud.
- **API:** `GET /projects/:id/audit-documents` — auditoría integral (conformidad + gaps SDD).
- **MCP:** tool `audit_documents`.
- **Workshop:** panel «Conformidad cascada» cuando `conformanceSummary.ok === false`.

### Changed

- **LLM maxTokens:** `document`, `tasksPlanner` y `default` elevados a 65,536 tokens.
- **Tasks pipeline caps** ampliados (MDD, Blueprint, Spec, API, Logic Flows, Infra).
- **Infra/Tasks prompts:** secciones CI/CD, Deploy y Testing obligatorias; `preferThinLiteraryDocs` default `false`.
- **`generateInfra`:** retry con `buildInfraConformanceGapFeedback` (incluye manifest §7).
- **Semáforo:** no puede quedar verde con `conformanceSummary` roto o >3 endpoints API faltantes.

### Fixed

- **Tasks parser front-matter:** `stripFrontMatterFromRaw()` evita duplicación de campos parseados.
- **Consistencia transversal:** proyectos sin BRD ya no quedan penalizados con score 50 fijo si tienen Spec trazable.

## [v1.1.0] — 2026-07-16

> **Motor de plugins genérico** — implementación completa del framework anunciado en `v1.0.0-RC`: hooks en todos los generadores LLM de entregables, artifacts encolables, Workshop con cola + polling, lifecycle y health de boot. Sin plugins cargados, el core se comporta igual que en v1.0.0.

### Added

- **Motor de plugins (API):**
  - `PluginDocumentPipelineService` — orquesta `beforeDocumentRender`, `afterDocumentRender`, `afterDocumentPersist` y lifecycle.
  - `PluginArtifactService` — `generateArtifact` → persistencia en `project.pluginData[pluginId]`.
  - `PluginProjectContext` — `buildProjectHookContext`, `pickPrimaryStageForHooks`, validación `requires`.
  - Cola BullMQ / in-memory: job `plugin-artifact` en `DeliverablesQueueService`.
  - Endpoints: `POST /plugins/projects/:id/generate/:pluginId/:artifactId`, `GET /plugins/health` (plugins cargados, artifacts, conteo de hooks).
  - Stub de desarrollo: `plugins-enabled/stub-plugin` (`dev.theforge.stub-plugin`, artifact `demo-report`).
  - Template terceros: `plugins-enabled/template/README.md`.
- **Hooks en generadores LLM:** `AiService.finishDocumentGeneration` integrado en Spec, Architecture, Tasks, Blueprint, API Contracts, Logic Flows, Infra, Use Cases, User Stories, Agent Governance, AEM y UX/UI Guide; `ProjectsService` pasa `hookContext` y dispara `afterDocumentPersist` tras persistir.
- **Lifecycle:** `onProjectCreate` (ya existente) + **`onProjectUpdate`** al persistir cambios de proyecto.
- **Workshop (web):**
  - `PluginDocPanel` — generación encolada con `generateAndPollPluginArtifact`, guards `requires` y `generationStatus.busy`.
  - `pluginData` en `useWorkshopStore` (sincronizado desde API).
  - `contentType` en artifacts (`markdown` | `json` | `html`) y util `pluginArtifactContent`.
  - Sidebar: `pluginId` correcto por artifact (sin hardcode EVD).
- **Shared-types:** `ArtifactTypeDefinition` ampliado (`generatable`, `requires`, `contentType`); gate `plugin-artifact` en `buildGenerationGates`.
- **CI:** spec `plugin-project-context.util.spec.ts`.

### Changed

- **`generateSpec`:** unificado en `finishDocumentGeneration` (sin rama duplicada).
- **DashboardSidebar:** deja de fetchear `pluginData` por plugin; usa el store del Workshop.

### Architecture

- **Modo A (hooks):** generación LLM con `projectId` → hooks opcionales; sin plugins = `generateResponse` directo (zero overhead).
- **Modo B (artifacts):** generación propia del plugin vía cola o sync; no entra en cascada automática de entregables core.
- **Graceful degradation:** plugin roto al boot → skip + log; la API arranca sin plugins.

## [v1.0.0] — 2026-07-15

> **General Availability** — release estable tras las RC `v1.0.0-rc.2` / `v1.0.0-rc.3`. Incluye el pipeline Tasks planner + auditor LLM, endurecimiento Excalidraw/Mermaid, cabeceras de trazabilidad en entregables y correcciones de deploy/Workshop acumuladas desde la RC.

### Added

- **Pipeline Tasks planner + auditor LLM:** `TasksGenerationPipelineService` — pre-flight estricto (`runTasksPreflightStrict`: gate MDD delivery, Spec/Blueprint obligatorios, API si §4, DocAccuracy ≥ 90; modo `legacyBaselineStage` relaja gate en AS-IS) → **Tasks Planner** (modelo `auditorChatModel`, misma ruta OpenRouter/BYOK que chat) → redacción con plan JSON (modelo de chat) → **Tasks Auditor LLM** (umbral 92, hasta 2 reparaciones dirigidas) → gates deterministas + `TaskAccuracy`. Schemas y snapshot en `@theforge/shared-types/tasks-pipeline`; persistencia `tasksQualitySnapshot` en `Stage.shortTermContext`.
- **Legacy y brownfield en el mismo pipeline:** `LegacyCoordinatorService` delega Tasks en `ProjectsService.generateTasks` (bulk y `generate-from-codebase`); si falta MDD en stage legacy se siembra AS-IS antes de encolar.
- **Workshop — badge de calidad Tasks:** `TasksQualityBadge` en toolbar Tasks (score auditor LLM + tooltip de métricas); `WorkshopStage.shortTermContext` expuesto al front.
- **IA — `generateAuditorResponse`:** `AiService` + `AIFactory.createAuditorForUser` para Planner/Auditor Tasks y reutilización del modelo auditor MDD.
- **Gobernanza multi-target:** scaffold de agent governance con varios destinos de export (`feat/agent-governance-multi-target`).
- **Workshop — trazabilidad:** inserción de gaps de trazabilidad y corrección de baseline en autoguardado (`traceability gap insert`).

### Changed

- **Ajustes → instancia activa:** etiqueta **Modelo auditor / planner** (`auditorChatModel`) — Auditor MDD, Tasks Planner y Tasks Auditor LLM comparten un solo campo.
- **Documentación:** `docs/TASKS-ROL-EN-SDD.md`, READMEs en `projects/`, `ai/`, `ai/prompts/`, `web/components/`.

### Fixed

- **Cabeceras SDD con fecha/hora completa:** `prependDocumentTimestamps` en todos los entregables (`Creado` / `Última regeneración` con segundos UTC); el formateador preserva el stamp (`preserve-doc-stamp`).
- **Deploy TS2353:** `uiScreensContent` solo en persistencia Project (`PROJECT_ONLY_DELIVERABLE_KEYS`), no en columnas Stage.
- **MDD background:** omitir delivery gate al persistir borradores de job MDD en cola.
- **Workshop MDD:** bucle de `PATCH` al persistir MDD desde chat interrumpido.
- **Excalidraw / Mermaid (web):** canvas alineado al papel del Workshop, chrome nativo oculto, toolbars opacas, pantalla completa, zoom con rueda, reparación del canvas híbrido.
- **Mermaid flowchart:** prompts endurecidos y etiquetas con `<br/>` entrecomilladas.
- **MCP agent governance:** export acotado para parse en spec-kit.

### Architecture

- Un solo runtime **auditor/planner** (`auditorChatModel`) para MDD Auditor, Tasks Planner y Tasks Auditor; redactor Tasks usa modelo de chat con plan JSON inyectado. Pre-flight sync bloquea generación aguas arriba insuficiente; legacy baseline relaja Spec/Blueprint sin saltarse gates de calidad del pipeline.

## [v1.0.0-rc.3] — 2026-07-15

### Added

- **MDD en background (greenfield + legacy):** cola `theforge-mdd` (`MddQueueService`, BullMQ con `REDIS_URL`, fallback in-memory por proyecto). Modos `pipeline`, `section`, `manager` (arranque) y `legacy`. Persistencia de borradores y `done` en servidor vía `runMddGenerationJob` + `projects.update` (sin depender de `persistMddContent` en el cliente).
- **Endpoints MDD jobs:** `POST /ai-analysis/mdd/jobs`, `GET /ai-analysis/mdd/jobs/:jobId`, `GET /projects/:id/mdd-jobs/:jobId`; legacy `POST …/legacy/generate-mdd` encola por defecto (`?queue=false` sync) + `GET …/legacy/mdd-jobs/:jobId`.
- **Web polling:** `apps/web/src/utils/pollMddJob.ts`; Workshop (`generateMddFromBenchmark`, `legacyGenerateMdd`, regeneración §N) migrado a cola + polling + `fetchGenerationStatus`.

### Changed

- **`ProjectGenerationGuardService`:** `mddStreamActive` incluye `mddQueue.isProjectBusy()` — un job MDD activo o en cola bloquea entregables downstream.
- **Ayuda Workshop:** `generacion-en-segundo-plano.md` — MDD ya va en cola; Manager HITL sigue en SSE.
- **Documentación release:** `docs/THE-FORGE-V1-RELEASE.md` §1.6 (jobs MDD); `apps/api/src/modules/ai-analysis/mdd/README.md`.

### Architecture

- Misma infra que entregables SDD (BullMQ / in-memory). Wizard SSOT de patrones (`suggest-governance-patterns`, `enforceMddGovernancePatternsOnPersist`, `appendMddGovernancePatternsToPrompt`) **sin cambios** — la cola reutiliza `streamMddAnalysis` / `prepareMddForOutput` y persiste por `projects.update`.

## [v1.0.0-rc.2] — 2026-07-15

### Added

- **Markdown Formatter — remark AST engine (Phases 1–3):**
  - **remark adapter** (`remark-adapter.ts`): `parseMarkdown`, `stringifyMarkdown`, `normalizeMarkdown` con options para bullet, emphasis, rule, GFM, frontmatter. Type guards `isHeading`, `isParagraph`, `isCode`, `isTable`, `isListItem` + helpers `findNodes`, `replaceNodes`, `extractHeadings`.
  - **AST-based repair suite**: `markdown-table-ast.ts` (table normalization), `repair-glued-headings-ast.ts` (inline headings, glued prose), `markdown-repair-ast.ts` (fence unwrap, unclosed fence repair).
  - **Pattern classifier** (`pattern-classifier.ts`): classifies content into 10 patterns (mermaid, sql, dockerfile, docker-compose, env, json, yaml, directory-tree, markdown, unknown) with confidence scores. `classifyPattern` + `classifyCodeBlock`.
  - **Repair pipeline** (`repair-pipeline.ts`): `runRepairPipeline()` orchestrates classify→repair→replace in two phases (code blocks + prose segments). Options: `skipPatterns`, `onlyPatterns`, `debug`.
  - **Pattern repairers** (`repairers/pattern-repairers.ts`): per-pattern repair dispatcher wrapping existing domain repairers (mermaid, SQL, infra, directory tree, flow sections).
  - **AST-based format orchestrator** (`format-document-markdown-ast.ts`): 9-step pipeline — trim → fence repair → heading repair → table normalization → remark stringify → pattern pipeline → boundary repair → task list normalization → optional TOC insertion. `useAst` toggle for incremental migration.
  - **TOC generator** (`toc-generator.ts`): `generateToc` from remark headings, `insertToc` with `<!-- toc -->` marker support. Options: minDepth, maxDepth, useAnchors, title.
  - **GFM task list normalizer** (`gfm-task-lists.ts`): normalizes checkbox markers (X, ✓, ✔ → [x]), detection, counting, optional sort unchecked-first.
  - **Formatter presets** (`formatter-presets.ts`): 3 built-in presets (minimal, standard, strict) + `registerPreset` for custom configs. Each preset bundles FormatOptions + TocOptions + TaskListOptions.
  - **Dependencies**: `unified`, `remark-parse`, `remark-stringify`, `remark-gfm`, `remark-frontmatter`, `mdast-util-toc`, `unist-builder`. Package now `"type": "module"`.
  - **Tests**: 26 new tests across `toc-generator.spec.ts`, `gfm-task-lists.spec.ts`, `formatter-presets.spec.ts`, `pattern-classifier.spec.ts` (20), `repair-pipeline.spec.ts` (8). Total: 148 tests pass, `tsc --noEmit` clean.
  - **Improvement plan** (`docs/FORMATTER_IMPROVEMENT_PLAN.md`): 4-phase roadmap — Phases 1–3 complete, Phase 4 (integration tests + docs) pending.

- **Document Engine v2 (RFC-001) — AST deterministic, patch semántico y validación:**
  - **MddMarkdownTranspiler** (`mdd-markdown-transpiler.ts`): motor registry-based que serializa `MddDocumentAst` → Markdown determinísticamente (sin LLM, sin heurísticas). 15 tipos de sección (`processInventory`, `crudMatrix`, `techStack`, etc.) con sus renderers. Bidireccionalmente estable: re-render de un AST siempre produce el mismo Markdown.
  - **DocumentPatchEngine** (`document-patch-engine.ts`): 6 operaciones de patch semántico (`ADD_SECTION`, `MODIFY_SECTION`, `DELETE_SECTION`, `REPLACE_SECTION`, `REPLACE_FIELD`, `ADD_FIELD`) con tracking de `entityIndex` para merge incremental por ID. Idempotente: patches repetidos no duplican datos.
  - **Validation Gates** (`validation-gates.ts`): 5 puertas de validación — Schema (Zod), Referencia Cruzada (§ refs), Completitud (campos requeridos), Circularidad (refs rotos) y Unicidad (IDs duplicados). Devuelve array de `ValidationGateResult` con passed/warnings/errors por gate.
  - **DocumentResponseParser** (`document-response-parser.ts`): detecta ` ```json ` fences en respuestas del LLM, valida contra `MddDocumentAstSchema` (Zod), calcula divergencia (secciones faltantes/extras/modificadas) y extrae `remainingMarkdown` para la parte de chat. Fallback automático al parser legacy cuando no hay bloque JSON.
  - **Intent Router** (`intent-router.service.ts`): clasificación de intención por keywords + routing a agentes (MDD, legacy, spec, architecture, tasks). Extensible con patrones regex.
  - **DocumentEngineService** (`document-engine.service.ts`): API de alto nivel — `parseResponse()`, `applyPatches()`, `classifyIntent()`. Orquesta parser → validación → patches.
  - **AST Types** (`packages/shared-types/src/document-ast/types.ts`): `MddDocumentAst`, `DocumentSection` (15 tipos), `PatchOp`, `DocumentResponse`, `IntentClassification`, `ValidationGateResult`, schemas Zod exportados.
  - **Prisma schema**: `documentAst Json?` + `documentVersion Int @default(0)` en modelo `Stage`, con migración idempotente `IF NOT EXISTS`.
  - **Dual Output Protocol**: el LLM puede emitir ` ```json ` block + markdown chat en la misma respuesta. `ChatResponseParserService.tryParseDualOutput()` intenta dual antes de `splitMddAndChat`. Si el LLM no emite JSON, fallback transparente al parser legacy (backward compatible).
  - **Persistencia en update flow**: `ProjectsService.update()` captura `documentAst`/`documentVersion` desde el DTO y los persiste en `Stage` via `prisma.stage.update()` con null handling Prisma-correcto (`Prisma.JsonNull`).
  - **docker-entrypoint.sh**: guard `P3009` para la migración `20260715100000_add_document_ast_columns` (idempotente, no bloquea deploy).

- **Excalidraw Hybrid Phase 1 — vista Excalidraw por defecto para diagramas Mermaid:**
  - **`mermaid-diagram-type.util.ts`**: detecta tipo de diagrama Mermaid (flowchart, erDiagram, sequenceDiagram, classDiagram, stateDiagram) y determina soporte Excalidraw. Flowcharts generan elementos nativos editables; ER/Sequence/Class usan fallback de imagen.
  - **`ExcalidrawDiagramBlock.tsx`**: wrapper lazy-loaded de `@excalidraw/excalidraw` + `@excalidraw/mermaid-to-excalidraw`. Convierte Mermaid → `ExcalidrawElementSkeleton[]` → `OrderedExcalidrawElement[]` via `convertToExcalidrawElements`. Toolbar con rebuild manual, toggle edición/vista, export PNG.
  - **Vista por defecto**: Excalidraw para tipos soportados (flowchart, ER, sequence, class). SVG como fallback para stateDiagram y tipos no soportados.
  - **Rebuild automático**: al editar Mermaid en source mode, el `rebuildKey` cambia y `ExcalidrawDiagramBlock` reconvierte automáticamente al volver a preview.
  - **Toggle Excalidraw/SVG**: botón `PenLine`/`Code` en toolbar para alternar entre vistas.
  - **`@excalidraw/excalidraw@^0.18.1` + `@excalidraw/mermaid-to-excalidraw@^2.2.2`** añadidos a `apps/web/package.json`.

### Architecture

- **Document Engine** como módulo independiente dentro de `modules/engine/` (5 archivos + tests + barrel index). `DocumentEngineService` registrado en `EngineModule` como provider/export.
- **Flujo de datos**: LLM response → `DocumentResponseParser.parseDualOutput()` → Zod validate → `DocumentPatchEngine.applyPatch()` → `MddMarkdownTranspiler.renderDocument()` → `prisma.stage.update(documentAst, documentVersion, mddContent)`.
- **Dual Output como opt-in**: si el LLM no emite ` ```json ` block, el sistema cae al parser legacy (`splitMddAndChat`) sin degradación. Compatible con prompts existentes sin cambios.
- **Tests**: 12/12 unit tests (transpiler, patch engine, validation gates, dual output parser) con `node:test`. No dependen de DB ni LLM.

### Fixed

- **Fase 0 / DBGA — wipe por catálogo de endpoints:** una lista numerada `POST/GET /v1/…` ya no se trata como DBGA completo ni pasa el umbral absurdo de 2500 chars que permitía sustituir un documento de 10–20k. `looksLikeApiEndpointCatalog`, merge que anexa bajo «Integración API», shrink ≥70% relativo, y prompt de refine anti-borrado.
- **Fase 0 / DBGA — merge de endpoints y anti-duplicado:** respuesta con catálogo HTTP se fusiona de forma determinista en **§11 API de Integración con Chat Externo** (cierra la pregunta pendiente + changelog) sin exigir `---FIN_DBGA---` ni verbo “integra”. `mergeDbgaOrUseFull` ya no concatena un segundo `# Domain Benchmark` truncado tras `---`; usa `deduplicateDbgaDocument`.

## [0.14.0] — 2026-07-14

### Added

- **Cascade accuracy ≥90 (PLAN-CASCADE-90-ACCURACY) — métricas F0–F4 (#438):** scores Docs/Tasks vs BRD, domain inventory + auth-skew delivery gate, analyze `accuracy` + dashboard badge, optional hard export gate (`REQUIRE_DOC_ACCURACY_90`), ui-screens plan improvements, UC/US thin.
- **Cascade agentic wiring (#438):** `brdContent` en estado MDD; Clarifier/SA/Critic/Auditor con inventario; SA no copia §3 bajo auth-skew; critic en one-shot; prepare_output con domain gate; checklist CrudMatrix/BRD; W4 si `TaskAccuracy < 90`; Falkor solo LEGACY; UC/US thin por defecto.
- **Cascade P0–P2 (este release):**
  - **P0** `Stage.domainInventory` (JSON SSOT) + sync al gate/cascade; composición determinista de stubs §3 (`mergeDomainTablesIntoMdd`) en prepare_output.
  - **P1** pantallas desde CrudMatrix/ProcessInventory; task auditor dominio (T-AUD-013/014); matching C1/T1 con aliases/stems.
  - **P2** Spec journeys desde ProcessInventory; HIGH omite UC/US literarios (`omitLiteraryUcUs` → templates thin); hard gate documentado vía `REQUIRE_DOC_ACCURACY_90` (off por defecto).

### Fixed

- **Technology Docs MCP (Context7):** el test de conexión y las llamadas reales hacen `initialize` + `Mcp-Session-Id` en `mcp.context7.com` (antes `tools/list` directo → HTTP 400 «No valid session ID»). Sesión cacheada por URL + `CONTEXT7_API_KEY`.
- **Markdown / Mermaid — SSOT de `/format`:** `formatDocumentMarkdown` repara sufijos `mermaid` pegados en headings (`Superadminmermaid`), fences que solo envuelven títulos, ``` huérfanos antes de `##`, y homologiza viñetas `*` → `-` en Fase 0/DBGA. `MddViewer` deja de duplicar un pipeline parcial y usa el mismo formateador; el orchestrator normaliza BRD del panel con `cleanDocumentContent`. Corrección en `stripOrphanFenceLineBeforeMermaid` para no eliminar cierres válidos de ` ```sql `; fences Mermaid sin cerrar cortan en `## N. Sección` colada.

### Added

- **Context7 en Fase 0 / Benchmark:** consulta automática cuando gaps o chat mencionan PAT, API key, OAuth, JWT, webhooks o vendors (`Phase0InterviewService`, `DiscoveryService`, tabs `benchmark`/`phase0`). Consulta explícita: «Según Context7, …» en el chat del Workshop. Helpers en `@theforge/shared-types/technology-docs/phase0-tech-docs.util.ts`.
- **Technology Docs MCP (`technology-docs-mcp`):** integración opcional Context7-compatible (`resolve-library-id`, `query-docs`) para enriquecer **Architecture**, **Contratos API** y **Tasks** con documentación oficial de librerías detectadas en MDD §2 / Blueprint. **Credenciales por usuario** en Ajustes → Docs técnicas (`User.techDocsMcpUrl` / `techDocsMcpToken`); sin API key = skip elegante. `@theforge/shared-types/technology-docs` — detector de stack.

## [v1.0.0-RC] — 2026-07-13

> **Release Candidate con sistema de plugins modular.**
> Extracción completa del código EVD (Executive Visual Deck) a repositorio independiente; el core ahora expone un framework de plugins genérico vía hooks. Disponible en el tag [v1.0.0-RC](https://github.com/kreodevs/theforge/releases/tag/v1.0.0-RC).

### Architecture (Breaking)

- **Sistema de Plugins:** framework genérico de extensión por hooks (`ITheForgePlugin`, `PluginLoaderService`, `PluginModule`). El core carga plugins vía `dynamic import()` desde `plugins-enabled/`; comunicación bidireccional sin imports estáticos.
- **Separación de EVD:** todo el código de Executive Visual Deck (12 archivos en `modules/evd/`, componentes React, tipos compartidos y migraciones DB) se extrajo al repositorio privado [`kreodevs/evd-plugin`](https://github.com/kreodevs/evd-plugin). El plugin comercial incluye validación de licencias, generación de imágenes con IA y exportación PDF/PPTX.

### Added

- **Plugin Framework:**
  - `ITheForgePlugin` — interfaz de contrato con lifecycle + hooks de documentos y proyectos.
  - `PluginLoaderService` — carga dinámica con graceful degradation (plugin fallido = skip, core continúa).
  - `PluginModule` — módulo NestJS registrado en `AppModule`.
  - Hooks disponibles: `beforeDocumentRender`, `afterDocumentRender`, `afterDocumentPersist`, `onProjectCreate`, `onProjectUpdate`.
  - Documentación completa: [`docs/PLUGINS.md`](./docs/PLUGINS.md) — guía de desarrollo de plugins; [`docs/ARCHITECTURE_PLUGINS.md`](./docs/ARCHITECTURE_PLUGINS.md) — arquitectura técnica.

### Removed (EVD extraction)

- **Backend:** directorio `apps/api/src/modules/evd/` completo (chart, design-system, diagram, export, image-gen, pdf, pptx, storage controller/service/module, visual-stylist, wireframe). Prompts EVD de AI. Métodos `generateEVD()`, `generateEvd()`, `generateEVDJSON()` y sus imports.
- **Frontend:** componentes `EvdSlideViewer`, `EvdBrandingDialog`. Estados EVD en workshop store. Tab EVD en navegación.
- **Packages:** tipos `evd-types.ts`, exports `@theforge/shared-types/evd-types`. Campos `evdContent` en Prisma schema (`Project`, `Stage`). Migraciones de DB `20260711_*` y `20260712_*`.

### Docs

- [`docs/PLUGINS.md`](./docs/PLUGINS.md): guía completa — estructura, contrato, ciclo de vida, hooks, instalación, ejemplos minimal y avanzado, troubleshooting.
- [`docs/ARCHITECTURE_PLUGINS.md`](./docs/ARCHITECTURE_PLUGINS.md): arquitectura técnica del sistema de plugins.
- [`docs/ARCHITECTURE_EVD_PLUGIN.md`](./docs/ARCHITECTURE_EVD_PLUGIN.md): caso de estudio del plugin comercial EVD.
- [`docs/EVD_PLUGIN_DELIVERY.md`](./docs/EVD_PLUGIN_DELIVERY.md): resumen de entrega del plugin EVD.
- [`packages/evd-executive-visual-deck/docs/LICENSE_PORTAL_SPEC.md`](./packages/evd-executive-visual-deck/docs/LICENSE_PORTAL_SPEC.md): especificación del portal de licencias (API REST, modelo de datos, seguridad).

## [0.13.0] — 2026-07-09

### Notes

- **Lint del monorepo desalineado con ESLint 9 (preexistente):** el entorno resuelve **ESLint 9.39** pero los paquetes (`shared-types`, `api`, `web`) siguen configurados con `.eslintrc.*` (sin `eslint.config.js` de flat config), por lo que `pnpm lint` falla con *"ESLint couldn't find an eslint.config.(js|mjs|cjs) file"* en los tres. No está causado por cambios de feature; la validación se cubre con `tsc --noEmit` (limpio en `api` y `web`) y los tests `node --test`. **Acción pendiente:** migrar a flat config de ESLint 9 **o** fijar `eslint@^8` en devDependencies.

### Architecture

- **SDD precisión — flujo de generación greenfield (HIGH):** el pipeline deja de ser «todos los entregables en paralelo» por un grafo de oleadas con refresh DB entre ellas. Los generadores LLM reciben checklist + phase0; tras W3, `collectSddPrecisionGaps` alimenta W4 (retry dirigido por prefijo de gap) y el semáforo (`sddCrossArtifactGapCount`). La validación es **agnóstica al proyecto** (parseo de MDD/phase0/blueprint); los fixtures `ia-trading-gaps/` son solo regresión de tests. PRs: #416 (precisión), #417 (perf W4).

### Added

- **validate_change_plan (Gate 2):** nueva tool MCP + `POST /projects/:id/validate-change-plan` en ingest Ariadne. Audita un `ChangePlan` JSON (archivos, símbolos, overlap con modification-plan, cobertura tasks) contra FalkorDB; veredicto `APPROVED` | `APPROVED_WITH_WARNINGS` | `BLOCKED`. Contrato v1 en `docs/contracts/change-plan-validation-v1.md`.
- **The Forge — integración Gate 2:** `@theforge/shared-types/change-plan` (extractor desde Tasks + legacy state), `PlanValidationService`, auto-validación tras `generateTasks` cuando hay `theforgeProjectId`, REST `GET/POST …/plan-validation`, panel **Plan Ariadne** en semáforo Workshop, ayuda `validacion-plan-ariadne.md`.

### Deferred (SDD precisión — no implementado y por qué)

- **Tasks con coordenadas exactas / diffs en repo** (`docs/implementation-scope.md` §6): **MVP wired** en `generateTasks`; **Gate 2** (`validate_change_plan`) cubre auditoría del plan vs grafo; pendiente **scanner de formularios** (Fase 1 entregables 2–3) para líneas exactas sin LLM.
- **Corregir repos de código ya generados** (p. ej. proyectos cliente con SDD incompleto): fuera de alcance; The Forge mejora el **generador**, no el output histórico.
- **Forzar despliegue microservicios reales vs monolito modular:** el check exige **módulo documentado** en architecture, no pods/K8s separados; evita imponer topología infra no elegida en el wizard.
- **Segundo pase W4 / loop hasta 0 gaps:** un solo post-pase + semáforo AMARILLO; evita cascadas de 30+ min y deja al humano decidir en Workshop (`analyzeArtifacts` + PROGRESO).
- **Regeneración de `pantallas` en W4:** doc-reconcile la incluye en orden lógico, pero W4 solo reintenta architecture/logic-flows/api/tasks; pantallas ya se sincronizan en W2b y el check de cobertura es heurístico — retry LLM de pantallas duplicaría MCP sync sin ganancia clara aún.
- **Gate MDD `assertDeliverablesAllowed` → ROJO por gaps SDD:** se optó por **AMARILLO** vía `SemaphoreService` (no bloquea generación con `acknowledgeGaps`); ROJO quedaría demasiado restrictivo mientras el LLM aún converge en un pase.
- **Test de integración cascada completa con LLM mock:** solo unit tests por check + matrix de oleadas; E2E de cascada es lento y frágil en CI — pendiente si hace falta contrato estable de jobs BullMQ.

### Fixed

- **Chat DBGA — preguntas borraban el documento sin mostrar propuesta:** mencionar «en el DBGA» en una pregunta condicional («¿te parece bien? Si es así, la integro…») activaba el fast-path de edición (`tryBenchmarkDbgaEditTurn`) y persistía un DBGA truncado con solo «Fase 0 actualizado» en chat. Ahora `isUserExploringDbgaIntent` + clasificador `explore` evitan persistir; `looksLikeDbgaEditRequest` exige verbo de cambio junto al target; `wouldShrinkDbgaDangerously` rechaza docs que pierden secciones principales (p. ej. solo registro de cambios).
- **Deploy — API exit 1 por DI circular en LegacyFlowModule:** `ResolveChangeToFilesService` (y servicios legacy hermanos) inyectaban `ProjectsService` sin `forwardRef`, lo que rompía el bootstrap tras añadir `ProjectGenerationGuardService` (#420). Corregido con `@Inject(forwardRef(() => ProjectsService))`.
- **Blueprint — gaps recurrentes en Conformance tras generar:** el pipeline ahora reintenta una vez con feedback automático aunque llegue `gapsFeedback` del Workshop; reparación determinista post-IA (`blueprint-conformance-repair.util.ts`) inyecta entidades §3 faltantes, tecnologías §2 (incl. **Redis** en el detector de stack) y cabeceras obligatorias; § UI Design System pasa a **§9** (§8 reservado al checklist del prompt); post-check usa conformidad completa MDD ↔ Blueprint.
- **Contratos API — gaps `[API falta]` / `[API extra]` tras generar:** nuevo pipeline en `generateApiContracts` (lista exacta de endpoints §4 en el prompt, reintento LLM, reparación programática de filas faltantes); normalización de rutas `{id}` ↔ `:id` en `checkApiVsMdd`; extracción mejorada de tablas markdown (columna Ruta antes que Método, path params, `/health`). Util `api-conformance-repair.util.ts` + tests `conformance-api.spec.ts`.

- **Markdown — `stripOrphanFenceLineBeforeMermaid` no borra cierres válidos entre diagramas BRD:** la heurística eliminaba cualquier ` ``` ` seguido de heading + ` ```mermaid `, incluido el cierre legítimo del diagrama anterior. Eso dejaba un fence abierto desde §4.1 y el §5 (`---`, `## 5`, listas) se renderizaba como bloque de código. Ahora solo se quita el fence huérfano si **no** cierra un bloque ` ```mermaid ` abierto. cuando el LLM cierra el primer bloque con ` ```mermaid ` en lugar de ` ``` ` y abre un segundo `sequenceDiagram`, el render fallaba y dejaba texto suelto. Nuevo `repairMermaidFenceClosedWithMermaidTag` fusiona sequence/flowchart contiguos; entrecomilla mensajes sequence con `{`/`?key=` (p. ej. respuestas JSON SSO).
- **BRD generación — fences Mermaid eliminados al extraer (bug raíz):** `extractBrdFromLlmResponse` aplicaba `stripCodeFences` a **toda** la respuesta del LLM y **borraba** todos los ` ```mermaid ` antes de persistir, aunque el modelo los hubiera generado bien. Sustituido por `stripOuterMarkdownWrapperFence` (solo quita un envoltorio ` ```markdown ` exterior). Tests de regresión en `brd-extract.util.spec.ts`.
- **BRD generación — contrato Mermaid en prompt + reintento:** el system/user prompt tenía conflicto («listas numeradas para flujos» vs §4 Mermaid) y el outline describía fences en prosa sin ejemplo literal. Añadidos `BRD_MERMAID_OUTPUT_CONTRACT`, anti-patrones, ejemplos mínimos en user prompt, `validateBrdMermaidOutput` (≥4 fences, sin headers sueltos ni `- A --> B` fuera del fence) y reintento automático con `buildBrdGenerationRetryReminder` en `suggest-brd-from-dbga` y legacy `suggest-brd-from-codebase-doc`.
- **Mermaid — diagramas sin fence ` ```mermaid ` (solución general):** el LLM a veces vuelca diagramas como markdown plano (`flowchart LR`, `erDiagram`, `stateDiagram-v2`, `sequenceDiagram` en línea suelta) con aristas en listas `- A --> B`. El normalizador solo procesaba bloques ya cercados, por lo que `/format` no cambiaba nada. Nuevo paso `repairUnfencedMermaidInDocument` detecta declaraciones de diagrama fuera de fences, absorbe el cuerpo (incl. viñetas, `### Foo->>Bar`, líneas indentadas de sequence), envuelve en ` ```mermaid ` y normaliza. Cubre flowchart, erDiagram, stateDiagram y sequenceDiagram. BRD `/format` ahora informa «sin cambios» cuando no hay diff.

- **Mermaid BRD — viñetas unicode y `erDiagram` fugado:** el LLM suele volcar aristas de `flowchart` y relaciones de `erDiagram` como listas markdown (`•`, `-`, numeradas) **fuera** del fence ` ```mermaid `; el normalizador ya reparaba `sequenceDiagram` y flowchart con `-`/`*` pero no `•` ni cardinalidad ER. `repairFragmentedSequenceMermaidInDocument` ahora detecta `erDiagram` y re-absorbe relaciones huérfanas; `sequenceLineCore`/`normalizeMermaidDiagramBody` limpian viñetas unicode y listas numeradas dentro y fuera del fence. Prompt BRD reforzado: prohibido listas para conexiones; una entidad/relación por línea en `erDiagram`. Tests BRD-style en `mermaid-document.spec.ts`.

### Added

- **Generación de entregables en segundo plano (jobs + gates de orden):** la regeneración individual (Spec, Architecture, Blueprint, API, Tasks, etc.) y la cascada se encolan por defecto (`?queue=false` solo para sync explícito). Con **Redis** (`REDIS_URL`) los jobs BullMQ persisten aunque cierres el navegador; sin Redis, cola **in-memory secuencial por proyecto**. **`ProjectGenerationGuardService`** + `project-generation-guard.ts` (shared-types): **un job activo por proyecto**, dependencias por oleadas `DELIVERABLE_WAVES_BY_COMPLEXITY` (upstream debe estar **persistido**; estar en cola **no** cuenta como listo), bloqueo durante stream MDD. **`GET /projects/:id/generation-status`** expone `{ busy, activeJob, queuedJobs, mddStreamActive, gates }`; intentos fuera de orden → **409 Conflict**. Corregido bug **`generate-spec`** que encolaba como `tasks`. Workshop: polling de estado, banner informativo, botones deshabilitados según gates; Spec/Tasks vía `queueAndPoll` (timeout ~6 h). Ayuda: **`generacion-en-segundo-plano.md`** en el modal de ayuda.
- **SDD — precisión en generación de entregables (greenfield HIGH/MEDIUM):** iniciativa para que la cascada SDD produzca documentos **más completos y coherentes entre sí**, detectando gaps cross-artifact antes del handoff (caso de regresión: proyecto fintech/trading con servicios §2 ausentes en architecture, migraciones SQL sin task, phase0 sin propagar a tasks, scheduler inconsistente, etc.). **Qué se hizo:**
  - **Cascada por oleadas** (`DELIVERABLE_WAVES_BY_COMPLEXITY`, `@theforge/shared-types`): sustituye el `Promise.allSettled` total por dependencias reales — W0 noop MDD → W1 spec+architecture → W2 UC/HU/API/flujos/UX/blueprint (paralelo intra-oleada) → W2b sync pantallas (`UiScreensService.syncUiScreens`, omitido si MCP inactivo) → W3 tasks+infra+gobernanza → **W4 post-pase** condicional. *Por qué:* tasks/API/blueprint se generaban con siblings vacíos o stale; la latencia extra compra coherencia documental.
  - **Checklist greenfield** (`sdd-coverage-checklist.util.ts`): extrae del MDD §2–§5, phase0/research, blueprint y open gaps `[OPEN-GAP]`; se inyecta en prompts de `generateArchitecture`, `generateTasks`, `generateUseCases`, `generateLogicFlows`, `generateApiContracts`, `generateBlueprint`. *Por qué:* el checklist existía solo en legacy AS-IS; greenfield lo mencionaba en prompts pero nunca lo recibía.
  - **Phase0 bridge:** `phase0SummaryContent` / `phase0GapsJson` propagados vía `LegacyGenerateOptions` y `greenfieldGenerateOptions()`. *Por qué:* research identificaba gaps (M*, open gaps) que no llegaban a tasks ni API.
  - **Validadores deterministas** (`sdd-precision-checks.util.ts` + integración en `analyzeArtifacts`, `collectConformanceGaps`, W4): architecture vs MDD §2, migraciones por columna SQL, fases blueprint en tasks, scheduler canónico, research→tasks, RabbitMQ, schemas Zod en UC, pantallas vs logic-flows. *Por qué:* conformidad previa no leía SQL §3 ni servicios core ni phase0→tasks.
  - **Semáforo y PROGRESO:** HIGH baja a **AMARILLO** (score ≤ 82) si quedan gaps cross-artifact; `PROGRESO.md` incluye **Gaps SDD pendientes**. *Por qué:* evitar falsa sensación de completitud cuando tasks es espejo incompleto.
  - **Prompts endurecidos:** architecture, tasks, logic-flows, use-cases, phase0-deep-research (módulos §2, fases blueprint, scheduler único, Zod, formato `[OPEN-GAP]`).
  - **Tests:** fixtures genéricos en `__fixtures__/ia-trading-gaps/` (dominio fintech como golden file, **sin hardcode de projectId**).
- **Tasks con coordenadas exactas (MVP):** al regenerar `tasks.md`, si el proyecto tiene anclaje a código (`theforgeProjectId` + navigation map Ariadne, **ChangeScope** en `Stage.legacyChangeState`, o árbol `modules/` en architecture), The Forge activa **modo coordenadas** en el prompt: resolución determinista de archivos vía `ResolveChangeToFilesService` (capacidades MDD §1 o descripción del ChangeScope), hints de módulos Nest desde MDD §2/architecture, y formato T-NNN con **Archivo / Función / Línea / diff sugerido** (`tasks-coordinates-context.util.ts`, `tasks-prompt.md` §Coordenadas). *Por qué:* cerrar brecha B de `legacy-coverage-analysis` / entregable 6 de `implementation-scope.md` sin esperar scanner de formularios completo. *Cuándo:* mejora iterativa sobre código indexado; greenfield día 1 solo recibe hints de módulo hasta que exista repo en Ariadne.
- **MDD §2 Frontend — MCP gráfico en UI Library:** cuando hay un MCP gráfico compatible activo, la generación del MDD incluye su librería en **### 2.2 Frontend → Stack UI → UI Library** además del stack definido por el Arquitecto (ej. `Tailwind CSS + Radix UI + Kreo UI 5.3`). Hint en el prompt del Arquitecto (`buildUiMcpFrontendArchitectHint`) + inyección determinista idempotente en `prepareMddForOutput` (`mdd-inject-ui-mcp-frontend.util.ts`). Wiring en `createMddGraph` / `createMddGraphWithManager` y `runPrepareMddForOutput`. Tests: `mdd-inject-ui-mcp-frontend.util.spec.ts`.
- **SDD UI/UX accionable — pantallas, design-system, tasks y export Kreo-agnóstico:** reglas compartidas (`sdd-ui-ux-actionable-rules`) inyectadas en prompts de Guía UX/UI, User Stories, Tasks y Blueprint; MDD § UI/UX Design Intent reorientado a personas/journeys y referencia a `pantallas.md` (sin tabla entidad→componente ni `GET /api/v1/{tabla}`); `pantallas.md` accionable por rol/ruta con API verificable desde contratos; tasks UI atómicas por pantalla; sección **🎨 Criterios UI** en historias; doc-reconcile regenera `uxUiGuide` y `pantallas`; export spec-kit incluye `pantallas.md` limpio + `ui-project.json` opcional (solo si el MCP expone `validate_ui_project_instructions`); util `buildUiProjectInstructions` y split `---UI_PROJECT_JSON---` en `@theforge/shared-types`.
- **MCP gráfico — adaptador semántico genérico:** sustituye el adaptador vendor-specific Kreo por `semantic-catalog-ui-mcp.adapter` (tools `resolve_component_for_entity` + `get_ui_component_catalog`; alias legacy `kreo` → `semantic-catalog`); `resolveUiMcpAdapterById` en el registro; etiqueta **Catálogo semántico** en Ajustes (`getUiMcpAdapterLabel` en `@theforge/shared-types` + `UiMcpInstancesCard`); sin MCP activo la documentación SDD apunta a shadcn/ui + `design-system.md`.
- **Usuarios — editar nombre y correo (admin):** nuevo endpoint `PATCH /users/:id` (`updateUserProfileSchema`, admin-only) que actualiza `name` y/o `email` de un usuario. El email se normaliza (trim + lowercase) y debe ser único (`400` si ya existe); el rol y el `mcpSecret` no se tocan (siguen en sus endpoints dedicados). En la web, `UsersList` añade acción **Editar** (ícono lápiz en la fila desktop y botón en la card móvil) con un modal (email requerido, nombre opcional) que hace el `PATCH` y refresca la fila in situ sin recargar la lista.

### Changed

- **Entregables — cola por defecto:** `POST /projects/:id/generate-*` encola en background sin exigir `?queue=true` explícito en el cliente; el Workshop y el MCP pueden recargar el proyecto al día siguiente sin mantener la pestaña abierta.
- **SDD cascada — W4 más rápido (follow-up #417):** eliminados reintentos inline duplicados en `generateArchitecture` y `generateTasks` durante W1/W3 (un solo pase LLM por oleada); la corrección por gaps de precisión queda **centralizada en W4**. W4 ejecuta architecture, logic-flows y api-contracts **en paralelo** y **tasks al final** (tasks depende del upstream ya regenerado). *Por qué:* la versión inicial (#416) podía triplicar llamadas LLM (inline + W4 secuencial) y alargar la cascada HIGH a ~20 min; se mantiene la precisión con menos wall time (~10–14 min estimado en proyectos con muchos gaps).
- **MCP gráfico / SDD UI:** eliminado hardcode Kreo en prompts, enrich MDD/Blueprint, markdown de pantallas y reglas SDD; columna dinámica **Componentes ({libraryName})** o **Componentes UI**; anexo catálogo sin duplicar tokens.
- **MCP gráfico — componentes UI reales, design system inferido y deliverable «Pantallas»:** nueva sección de Ajustes **«MCP gráfico»** (`UiMcpInstancesCard`) para conectar MCPs de componentes UI team-wide (CRUD, activar, detectar compatibilidad con badge y librería/versión). The Forge define un **contrato UI MCP** (`@theforge/shared-types/ui-mcp-contract`: `describe_capabilities`, `list_components`, `resolve_component` obligatorios; `list_screens`, `get_design_tokens` opcionales; `UI_MCP_CONTRACT_VERSION`) y detecta compatibilidad vía `tools/list` + `describe_capabilities`. Backend nuevo `modules/ui-mcp` (`UiMcpService` CRUD + token cifrado con `TokenCryptoService`, `UiMcpClientService` con validación Zod, transporte JSON-RPC/SSE propio para evitar el bug de `baseUrl`, `UiMcpController` REST). Cuando hay un MCP **compatible y activo**, un `UiComponentResolver` pluggable (`McpUiComponentResolver` con **fallback por-entidad** al `HeuristicUiComponentResolver`) sustituye los componentes genéricos por reales en **UI/UX Design Intent** del MDD (`mdd-enrich-uiux-intent`, ahora async) y en **§8 del Blueprint** (`blueprint-enrich-ui-system`, ahora async); sin MCP compatible activo se conserva la generación heurística actual. Nuevo deliverable **«Pantallas / UI Screens Spec»** (texto, sin TSX ni preview): `UiScreensService.syncUiScreens` (usa `list_screens` con respaldo por-entidad vía `resolve_component`) + `POST /projects/:id/ui-screens/sync`, persistido en `Project.uiScreensContent`/`Stage.uiScreensContent`; pestaña **Pantallas** en el Workshop con botón **Sincronizar**, visible solo si hay MCP compatible activo. La **Guía UX/UI** infiere el design system desde el MCP (`get_design_tokens` + `list_components`) anexando una sección dedicada, con fallback al design system heurístico/Ariadne del LLM. Prisma: modelo `UiMcpInstance` + `uiScreensContent` en `Project`/`Stage` (migraciones nuevas). Specs de contrato, transporte, resolver, ensamblador de pantallas y sección de design system; los specs heurísticos de enrich/blueprint siguen verdes.
- **BRD — diagramas Mermaid obligatorios (§4):** el prompt de generación (`brd-generation-prompt.md` + `BRD_SECTION_OUTLINE`) ahora exige una nueva sección **§4 Diagramas de referencia (Mermaid)** con: (1) **Arquitectura de integración (el ecosistema)** — `flowchart` con sistemas/actores de negocio sin HTTP ni tablas; (2) **Diagrama entidad-relación** — `erDiagram` con entidades corporativas; (3) **2–3 flujos críticos** — un diagrama por flujo (`stateDiagram-v2`/`flowchart`/`sequenceDiagram`). Guardas de sintaxis alineadas con casos de uso/handoff (un fence por diagrama, etiquetas entrecomilladas, sin `subgraph_ID`). Secciones posteriores renumeradas (Alcance §5, Reglas §6, …). Aplica a `suggest-brd-from-dbga`, legacy BRD y refinamiento chat (`BRD_CHAT_REFINE_BUSINESS_RULES`).
- **Docs MCP Server (`@theforge/docs-mcp-server`):** nuevo servidor MCP con el SDK oficial de Anthropic que sirve la documentación estructurada de `docs_mcp/` a agentes de IA (filosofía atómica tipo Astryx). **Recursos:** `docs://manifest` (JSON con índice/jerarquía) y `docs://<section>/<topic>` (página Markdown limpia). **Herramientas:** `search_docs(query)` (búsqueda por palabras clave con fragmentos rankeados) y `get_component_api(componentName)` (solo Props/Tipos/Uso + reglas de diseño). Transporte **stdio** (Cursor) y **HTTP streamable** (`--http`, `/health`). Entrada en `.cursor/mcp.json` (`theforge-docs`). Smoke test: `packages/docs-mcp-server/scripts/smoke.mjs`.
- **Corpus `docs_mcp/` (14 páginas):** `DOCUMENTATION_TEMPLATE.md` + **componentes** con props exactas del código (`button`, `badge`, `card`, `input`, `dialog`, `empty-state`), **arquitectura** (`monorepo-overview`, `docs-mcp-server`, `data-layer` web↔API, `estado-workshop-store` Zustand, `mdd-semaforo` con las dos capas de semáforo, `agentes-ia-langgraph` Manager+nodos+BYOK, `integracion-new-legacy` con la Regla de Oro) y **guías** (`consumir-docs-mcp`).
- **Handoff Spec — `/format` (reformatea Mermaid y repara `subgraph` persistido):** el comando de chat `/format` (alias `/formatear`, `/reformatear`, `/formato`) ahora opera también en la pestaña **Handoff Spec** (antes caía en «tab sin documento formateable»). Formatea el documento **guardado** (no solo el render) vía `formatDocumentMarkdown` → `normalizeMermaidInDocument`, lo que **repara de forma definitiva** los diagramas con header corrupto `subgraph_NEW["…"]` → `subgraph NEW["…"]` y demás normalización Mermaid/tablas/fences, y lo persiste con `persistHandoffSpecContent`. Útil cuando el documento fue generado por un build anterior al fix y el auto-repair en render no bastaba. `formatDocumentForActiveTab` (case `handoff-spec`) + `handoff-spec` añadido a `TABS_WITH_FORMAT_COMMAND`/`ActiveTab` para que el chip `/formatear` y el placeholder aparezcan en esa pestaña.
- **Casos de Uso — diagrama Mermaid por cada CU:** el prompt (`use-cases-prompt.md`) ahora exige, **además** de la tabla del caso (actor, precondiciones, flujo principal, alternativos/excepciones, postcondiciones), **un** diagrama Mermaid que represente *ese* caso. **Preferencia `stateDiagram-v2`** (estados del recurso y transiciones, con `[*]` y eventos en las aristas), con fallback a `flowchart` (procesos con decisiones) o `sequenceDiagram` (interacción entre actores/sistemas) según el caso. Incluye las guardas de sintaxis ya probadas (un solo fence ` ```mermaid ` por diagrama, sin partirlo ni usar otra etiqueta de lenguaje, etiquetas con `/{}:()` entre comillas, `subgraph ID["Título"]`, declarar cada estado/nodo una sola vez, definir todas las transiciones). Aplica también al flujo legacy etapa 1 AS-IS (usa el mismo prompt base).
- **Handoff Spec — sección «Gaps y decisiones pendientes»:** el documento ahora incluye una **tabla consolidada de gaps** (`GAP-NN`: item(s) afectados, tipo, descripción, qué bloquea, acción/decisión requerida, dueño sugerido `Equipo NEW`/`Equipo LEGACY`/`Ambos`) que reúne en un solo lugar lo que hoy quedaba disperso por item: endpoints inexistentes, contratos/DTO sin definir, tablas/relaciones por crear y decisiones de diseño abiertas. Deduplica gaps compartidos por varios items y prohíbe inventarlos (solo los derivados de la evidencia o de la ausencia comprobada de un contrato/endpoint en el contexto del proyecto NEW). El Resumen añade el contador «Gaps bloqueantes: n». Cambio de prompt (`integration-agent-prompt.md`).
- **Handoff Spec — cita el endpoint exacto del proyecto NEW:** el redactor ahora recibe los **Contratos de API del proyecto NEW** (`apiContractsContent`, deliverable etapa→proyecto) + su MDD §4 como contexto (`newApiContext`). Cuando un item propone consumir/exponer un endpoint (p. ej. «obtener `margen_minimo` consumiendo el endpoint del microservicio»), el prompt obliga a escribir el **método + ruta concretos** definidos en esos documentos en vez de la frase genérica «el endpoint del microservicio»; si la ruta no existe en los contratos NEW, se marca como pregunta abierta. Funciona al sincronizar desde el proyecto LEGACY (lee el NEW vinculado) o desde el NEW (lee el propio). `IntegrationAgentService.gatherNewApiContext`.
- **Handoff Spec — sondeo profundo de Ariadne por item:** el redactor (`integration-agent.node.ts`) ya no se limita a `validate_before_edit` + un único `semantic_search`. Por cada NEW-LEG ahora lanza **en paralelo**: `ask_codebase` con una pregunta dirigida a §3/§4 (¿qué tablas/columnas/relaciones EXISTEN?, ¿qué endpoints/servicios se afectan o deben crearse?, ¿qué archivos/símbolos son los puntos de integración?), `semantic_search` con **palabras clave de dominio** extraídas del item (incl. snake_case tipo `medio_costo`, segmentos de ruta de API) y `validate_before_edit` por símbolo PascalCase. La auth por-usuario del MCP (URL + token de Ariadne en Ajustes) se reenvía vía `X-M2M-Token`. El prompt ahora exige **afirmar con base en la evidencia** y reservar «verificar manualmente» solo cuando el bloque de evidencia esté realmente vacío (evita falsos «Sin evidencia…» cuando Ariadne sí responde). Helpers puros `extractDomainKeywords` / `buildItemQuestion` con tests (`integration-agent.node.spec.ts`).
- **Handoff Spec — diagrama por cada NEW-LEG:** el prompt del IntegrationAgent ahora pide, **por cada item NEW-LEG**, el/los diagrama(s) Mermaid que mejor expliquen ese requerimiento (no solo el diagrama global de integración): `erDiagram` para cambios de esquema (§3), `sequenceDiagram` para interacciones/contratos de API (§4), `flowchart` para flujos con decisiones, `stateDiagram-v2` para transiciones de estado; puede combinar varios cuando el item toca modelo y flujo. Incluye guardas de sintaxis (entrecomillar etiquetas con `/ { } :`, `subgraph ID["Título"]`, definir aristas).
- **Handoff Spec — edición manual + diagramas Mermaid:** la pestaña **Handoff Spec** ahora permite **editar** el documento (toggle *Editar*/*Vista previa*, autoguardado por blur/debounce vía `persistHandoffSpecContent`), no solo verlo. El prompt del IntegrationAgent (`integration-agent-prompt.md`) instruye generar **diagramas Mermaid** (`flowchart` de integración NEW→LEGACY, `erDiagram` para cambios §3, `sequenceDiagram`/`flowchart` para §4), que se renderizan en la vista previa vía `MddViewer`/`MarkdownMermaid`.
- **IntegrationAgent — `handoff-spec.md` dinámico (NEW→LEGACY):** nuevo agente especializado que traduce los items `NEW-LEG-*` registrados en la Matriz de Trazabilidad en requerimientos técnicos para el equipo legacy (Brownfield), alineados con MDD §3 (Modelo) y §4 (API). Patrón **Plan-then-Execute**: el redactor (`ai-analysis/nodes/integration-agent.node.ts`, `runIntegrationAgent`) sondea el grafo LEGACY de AriadneSpecs por item (`validate_before_edit` / `semantic_search`) y sintetiza el documento; lo orquesta `IntegrationAgentService`. **Gobernanza (Regla de Oro):** organiza y profundiza los items existentes, nunca crea handoffs. Endpoints `POST /projects/:id/integration/sync-handoff-spec` y `.../stages/:stageId/sync-handoff-spec`. Persistencia: `Stage.handoffSpecContent` (aplanado a Project como el resto de entregables). UI: pestaña **Handoff Spec** (read-only) en el Workshop con botón **«Sincronizar Especificación de Handoff»** (solo proyectos LEGACY). Prompt `apps/api/src/modules/ai/prompts/integration-agent-prompt.md`. Hook preparado del Manager (`detectLegacyIntegrationIntent`) que sugiere la sincronización al detectar intención de integración legacy. Prisma: migración `20260625120000_add_handoff_spec_content`.
- **Integración — revertir promoción de handoff (`abandon-handoff`):** `POST /projects/:id/integration/stages/:stageId/abandon-handoff` archiva una etapa legacy promovida por error (`workflowStatus: ARCHIVED`, visible en el selector del Workshop), congela el snapshot de entregables si falta, conserva `handoffSnapshot` + `abandonedAt` para auditoría, limpia `legacyStageId` en los ítems NEW-LEG y en las filas `IntegrationTrace`, y libera los ítems a `sent` (re-promovible) o `rejected` (`rejectReleasedItems`). Si la etapa abandonada estaba activa, activa la etapa 1 baseline (o `activateStageId`); el enlace NEW↔LEGACY se mantiene. UI: botón **Revertir promoción** en `IntegrationPanel`. `abandon-handoff.util.ts` (+ spec), schemas en `@theforge/shared-types`.
- **Diagramas Mermaid en tutorial/ayuda + visor a pantalla completa:** los bloques ` ```mermaid ` del tutorial brownfield (`ProjectTutorialDialog`) y de la ayuda del Workshop (`WorkshopHelpModal`) se renderizan como SVG mediante `MarkdownMermaid.tsx`, compartido también por `MddViewer`. Cada diagrama incluye botón **Pantalla completa** (overlay `100dvh` con scroll; Esc / cerrar para volver al documento), útil para diagramas ER densos en el MDD. Diagramas de flujo NEW↔LEGACY añadidos en `apps/web/src/content/tutorial/brownfield.md`.

### Fixed

- **Mermaid — auto-repara `subgraph_ID[…]` ya persistido (documentos viejos, sin re-sync):** un `handoff-spec.md` generado por un servidor anterior al fix de subgraph quedó con el header corrupto `subgraph_NEW["…"]` / `subgraph_LEGACY["…"]` **horneado en el contenido guardado** (el único diagrama con `subgraph`, por eso era el único que fallaba mientras el resto renderizaba). El normalizador solo **prevenía** crear esa corrupción, pero no la **reparaba**; como el render del web re-normaliza en cada carga, `normalizeMermaidDiagramBody` ahora restaura `subgraph_<id>` → `subgraph <id>` cuando tras el id viene `[`, `(` o `"` (header inequívoco), arreglando el documento existente sin regenerarlo por LLM. Test con el cuerpo corrupto exacto en `mermaid-document.spec.ts`.
- **Mermaid handoff-spec — etiquetas truncadas y prosa tragada por el 2.º fence:** dos correcciones sobre el normalizador (`mermaid.ts`) tras revisar un `handoff-spec.md` real ya desplegado. (1) **Truncación de etiquetas (bug propio):** `normalizeMermaidDiagramBody` recortaba toda etiqueta entrecomillada a **56 caracteres**, mutilando textos legítimos con `<br/>` o rutas (`"Microservicio … (Node/Express)"` → `"… (Node/Expre"`, `-->|"… (endpoint a crear)"|` → `… (endpoint a cre`); tope subido a **120** (`MAX_MERMAID_LABEL_CHARS`, solo corta prosa desbocada). (2) **Fence partido sin cerrar que se traga la sección siguiente:** cuando el LLM cierra el `mermaid` tras los `participant` y vuelca los mensajes en un ` ```dockerfile ` que envuelve además la prosa del item siguiente, `mergeSplitMermaidContinuationFences` ahora toma **solo el prefijo de líneas que son sintaxis Mermaid** (`splitMermaidContinuationPrefix`) y **re-emite el remanente como markdown**, en vez de fusionar todo el bloque (el umbral del 50% anterior tragaba/strippeaba el encabezado `### NEW-LEG-N` y los bullets). Tests con los fragmentos exactos del documento que falló en `mermaid-document.spec.ts`.
- **Mermaid handoff-spec — fences partidos y aristas fugadas:** el normalizador (`mermaid.ts`) ahora repara dos corrupciones recurrentes del LLM: (1) un diagrama partido en un **segundo fence con lenguaje arbitrario** (` ```dockerfile `, ` ```text `) se **fusiona** en el bloque `mermaid` original (`mergeSplitMermaidContinuationFences`), salvo que el segundo bloque arranque su propia declaración de diagrama (no fusiona `erDiagram` + `flowchart` distintos); (2) las **aristas de flowchart** que el LLM dejó fuera del fence (`### A -->|x| B`, `- A --> B`) se re-absorben — antes solo se reabsorbían líneas de `sequenceDiagram` (`isOrphanFlowchartLine`; `repairFragmentedSequenceMermaidInDocument` ahora detecta la familia del diagrama). Además limpia el `\n` literal en etiquetas (→ espacio; el prompt pide `<br/>`) y entrecomilla llaves en etiquetas de **arista** (`-->|"…/{id}/…"|`), no solo de nodo. El prompt del IntegrationAgent refuerza: un solo fence ` ```mermaid ` por diagrama, sin partirlo, sin otro lenguaje, sin líneas en blanco internas, sin `\n` literal, y **declarar cada nodo/entidad una sola vez** (evita entidades duplicadas). Tests en `mermaid-document.spec.ts`.
- **Mermaid — `subgraph ID[Título]` ya no se corrompe al normalizar:** `normalizeMermaidDiagramBody` aplicaba la regla «une `palabra espacio palabra[`» (pensada para IDs de nodo con espacios) también a las líneas `subgraph NEW[Microservicio…]`, generando `subgraph_NEW[…]` (sintaxis inválida → "No se pudo mostrar el diagrama"). Ahora se exceptúan las líneas que empiezan por palabra clave de bloque (`subgraph`, `state`, `class`, `namespace`, `direction`). Además, las etiquetas de nodo con llaves (paths tipo `/{id}`) se entrecomillan automáticamente para no romper el parser. Cubierto con tests en `mermaid-document.spec.ts`.
- **IntegrationAgent — handoff-spec visible y generable en ambos proyectos:** la pestaña **Handoff Spec** ahora aparece en proyectos **NEW y LEGACY** (no solo LEGACY), como artefacto de acuerdo mutuo (el NEW valida el modelado de la integración; el LEGACY corrobora el impacto). Además, `resolvePromptContext` ya no devuelve «sin items» en la etapa 1 (AS-IS) del legacy: cuando no hay snapshot de etapa promovida (2+), usa como *fallback* los items **SENT/ACCEPTED** del proyecto NEW enlazado, permitiendo sincronizar antes de promover una etapa.
- **Deploy Dokploy — API exit 1 tras build OK:** Entrypoint endurecido: `safe-schema-sync.sql` antes de `migrate deploy`, `resolve --applied` cuando `db push` adelantó columnas (`agentGovernanceContent`, merge suite), host Postgres desde `DATABASE_URL` (no `localhost`), validación explícita de `TOKEN_MASTER_KEYS` / `CORS_ORIGINS` vacío, log en `bootstrap().catch`.
- **Nest circular dependency (merge):** `ProjectsModule` importaba `AiAnalysisModule` solo por `Phase0InterviewService` → `Phase0Module` dedicado; rompe ciclo `AiAnalysisModule ↔ ProjectsModule`.
- **safe-schema-sync:** `FavoriteProject_userId_projectId_key` idempotente si ya existe como índice; `postgresql-client` en imagen API; fallback `mcpSecret` vía Prisma (sin `psql`).
- **BUILD_CACHE_BUST**: 94 → 96

- **BUILD_CACHE_BUST**: 96 → 97 (release 0.13.0)

## [0.12.0] — 2026-06-12

### Added

- **Fusión de proyectos en Paso 0:** Sintetiza el DBGA / borrador Fase 0 de **2 o más** productos en un destino (proyecto nuevo por defecto o existente), con vista previa, detección de conflictos y linaje.
  - `POST /projects/merge` — body `projectMergeBodySchema` (`@theforge/shared-types`): `sourceProjectIds`, `targetMode`, `deleteSources` (`keep` \| `archive` \| `delete`), `resetDownstream` (limpia MDD y entregables), `createSuite` (`parentProjectId` en fuentes), `includeBenchmark`, `autoAudit`, `preview`.
  - `ProjectMergeService` + prompt `merge-phase0-prompt.md`; conflictos deterministas (`project-merge-conflicts.util.ts`) + reporte LLM.
  - Prisma: `archivedAt`, `mergedFrom` (JSON), `parentProjectId` (suite). Migración `20260612120000_project_merge_suite`. `findAll` excluye archivados.
- **Dashboard — fusión multi-select:** Checkbox en carpetas para todos los usuarios; barra inferior con **Fusionar** (≥2 seleccionadas). Borrar masivo sigue solo admin.
- **`ProjectMergeDialog`:** Configuración, preview de markdown/conflictos y confirmación; abre Workshop del proyecto resultante.
- **Auditoría post-fusión:** `autoAudit` lanza `Phase0InterviewService.audit()`; `Phase0ManualAudit` acepta `initialAudit` para reanudar preguntas.
- **MCP:** tool `merge_projects` → `POST /projects/merge`.

### Fixed

- **Paso 0 — finalize tras auditoría:** `normalizePhase0Document` / `mergePhase0Borrador` evitan crash cuando el LLM devuelve borrador parcial (`proposito` o `roles.permisos` ausentes) al serializar con `phase0ToMarkdown`.

### Architecture

- `ProjectsModule` importa `AiAnalysisModule` para reutilizar `Phase0InterviewService` en el merge.
- Heurística de fallback si el LLM de fusión falla; el destino en `targetMode: existing` no recibe `deleteSources` sobre sí mismo.

## [0.11.3] — 2026-05-26

### Fixed

- **Deploy Dokploy — `failed to solve: base name (${NGINX_IMAGE})`:** `FROM` con imágenes ECR fijas en Dockerfiles (sin `ARG` en stage base); algunos builders no sustituyen build-args en el segundo stage.

### Changed

- **BUILD_CACHE_BUST**: 93 → 94

## [0.11.2] — 2026-05-26

### Fixed

- **Deploy Dokploy — TLS timeout a Docker Hub:** Builds y servicios `postgres`/`redis` usan por defecto **ECR Public** (`public.ecr.aws/docker/library/...`) en lugar de `docker.io`. Override `POSTGRES_IMAGE` / `REDIS_IMAGE` en compose/.env.

### Changed

- **BUILD_CACHE_BUST**: 92 → 93

## [0.11.1] — 2026-05-26

### Added

- **Media runtime desde instancia de provider (BYOK/tenant):** STT y modelo de visión se resuelven desde `ProviderInstance` / `UserProviderConfig` (`visionModel`, `sttModel`, respaldo en `extras`), no desde variables de entorno del servidor.
  - `UserProvidersService.resolveVisionRuntime`, `getRuntimeMediaConfig` y `resolveVisionModelForRuntime` en `provider-config.helpers.ts`.
  - `GET /audio/config` devuelve `{ sttModel, visionModel, supportsVision, supportsStt }` para el chat.
  - `AiService.describeImagesForChat` usa `resolveVisionRuntime` antes de describir imágenes.
- **Autoguardado no invasivo en Workshop:** `persist-field-guard` evita que un PATCH tardío pise texto si el usuario siguió escribiendo; `WorkshopDocTextarea` no aplica `value` externo con foco; guía UX/UI deja de mutar YAML en debounce (solo en blur).
- **Reparación Mermaid — flujo webhook aplanado:** `looksLikeJsonFlattenFlowchart`, `repairFlattenedWebhookFlowchart` y `webhookSyncFlowchartBody()` en `@theforge/shared-types`; las secciones «Flujo de…» con bloque existente se reparan en lugar de borrarse (`repair-flow-sections`).

### Changed

- **Chat (web):** `ChatContainer` consulta `/audio/config` y deshabilita adjuntar imagen o micrófono solo cuando la instancia activa no expone modelo (mensaje apunta a Ajustes → Gestionar instancias). Ambos layouts del compositor reciben las mismas props de visión.
- **Upsert de instancias:** `buildModelFields` con `visionModel: undefined` ya no fuerza el default del catálogo al actualizar; `provider-instances.service` conserva `existing.visionModel` si el DTO no lo envía.
- **Chat Fase 0 / Benchmark:** El asistente en pestaña benchmark persiste en `dbgaContent` (panel Análisis DBGA), no en Deep Research; mensajes con imagen (p. ej. ERD) refinan DBGA con contexto de visión; `done` del stream expone `dbgaContent` y `phase0SummaryContent`; eliminado mirror incorrecto DBGA → `phase0SummaryContent` en orquestador.
- **BUILD_CACHE_BUST**: 91 → 92 (`docker-compose.yml`, Dockerfiles api/web/mcp)

### Fixed

- **Falso «sin modelo de visión»** con instancia ya configurada (`llama/…-vision-instruct:floor`, etc.): el runtime y la UI leían env o columna sin merge; ahora la cadena instancia → `resolveVisionModelForRuntime` → `/audio/config` alimenta el adapter (`visionModelChain` sin modelos vacíos).
- **Benchmark chat sin cambio visible en Fase 0:** heurística `dbgaReflectsUserEditIntent`, `effectiveUserMessage` con bloque de visión, orden de persistencia del log tras resolver DBGA, y ack `BENCHMARK_CHAT_NO_CHANGE` cuando no aplica edición.
- **Cursor al final del textarea** tras autoguardado en paneles de documento estándar, DBGA, Benchmark y guía UX/UI.
- **Formateo `/formatear`:** diagramas `flowchart TD` con cadena `s0→s1→…` (JSON del webhook aplanado) y texto de Beneficios dentro del bloque Mermaid.

### Architecture

- `openai-compatible.adapter.ts`: cadena de modelos de visión desde runtime de instancia (`visionModel`, fallback en `extras.visionModelFallback`, chat).
- `OPENROUTER_DEFAULT_VISION_MODEL` en `llm-config.ts` queda como referencia de catálogo al crear config vacía, no como override de servidor.
- Tests: `provider-config.helpers.spec.ts`, `resolveVisionRuntime` en `user-providers.service.spec.ts`, `dbga-edit.util.spec.ts`, `persist-field-guard.spec.ts`, `repair-flow-sections.spec.ts`.

## [0.10.1] — 2026-05-25

### Fixed

- **Healthchecks en docker-compose:** Reemplazados `127.0.0.1:3000` y DNS service-name (`theforge-mcp:3000`) por `localhost:3000` en los healthchecks de `theforge-api` y `theforge-mcp`. `127.0.0.1` daba falso negativo en Dokploy (monitor externo apunta al host físico, no al contenedor). DNS por service-name fallaba en Swarm por hairpin VIP. `localhost` es portable en Compose y Swarm.
- **BUILD_CACHE_BUST**: 88 → 89

## [0.11.0] — 2026-05-25

### Added

- **Design References**: Catálogo de 54 design systems reales (Stripe, Linear, Vercel, etc.) para inspirar la Guía UX/UI.
  - `GET /api/design-refs` — lista todas las referencias
  - `GET /api/design-refs/:slug` — detalle completo con tokens de diseño
  - `POST /api/design-refs/auto-match` — matching automático por dominio del MDD
  - `POST /api/design-refs/scan-url` — escáner de URL para extraer tokens (stub)

- **uxGuideDesignRef**: Nuevo campo en el modelo Project para seleccionar design reference.
  Soporta slugs del catálogo, "auto" para matching automático, o URL personalizada.

- **Inyección en prompt UX/UI**: Cuando hay un design reference seleccionado, el LLM recibe los tokens de ese diseño como referencia visual para adaptar al proyecto. Con instrucciones explícitas de no copiar textualmente.

- **DesignRefSelector**: Componente frontend con selector visual en dropdown categorizado + URL personalizada + auto-match.

### Architecture

- Nuevo módulo `design-ref` con service, controller y data catalog.
- Integración en `ai.service.ts` → `appendUxGuideStitchPolicy()` para inyectar tokens.
- Integración en `ux-guide-llm-context.ts` para pasar el design ref a opciones del LLM.
- Prompt `ux-ui-guide-prompt.md` actualizado con instrucciones para design references.
- **DesignRefSelector**: Texto descriptivo de la funcionalidad visible en el componente.

### Fixed

- **DesignRefSelector**: Cierre de div faltante que rompía el build.
- **DesignRefItem interface**: Agregado campo `colors` faltante (TS2339).
- **ux-guide-llm-context.ts**: Import path corregido de `./data/` a `../design-ref/data/` (TS2307).
- **design-ref.service.ts**: Import no usado `DESIGN_REFERENCES` eliminado (TS6133).
- **BUILD_CACHE_BUST**: 90 → 91

## [0.10.0] — 2026-05-23

### Added

- **Fase 0 Interactiva — Entrevistador IA guiado:** Nuevo módulo dentro del pipeline de especificación que permite al usuario describir su idea (o pegar un documento externo) y recibir un borrador inicial de 8 secciones. Luego, el entrevistador hace **una pregunta a la vez** (máx 5) para llenar gaps críticos, actualizando el borrador en vivo tras cada respuesta. Al completarse, el documento se serializa a markdown y se inyecta como `dbgaContent` para que el pipeline MDD existente lo consuma automáticamente.
  - `ai-analysis/phase0/phase0.types.ts` — interfaces del documento (8 secciones: propósito, entidades, reglas, flujos, roles, integraciones, edge cases, pendientes)
  - `ai-analysis/phase0/phase0-gap-analyzer.ts` — 7 reglas lógicas de validación por criticidad (sin LLM, funciona como fallback)
  - `ai-analysis/phase0/phase0-to-markdown.ts` — serializa el JSON estructurado a markdown legible para el pipeline
  - `ai-analysis/phase0/phase0-interview.service.ts` — orquestador del loop: start → question → answer → finalize
  - 3 prompts en `prompts/phase0/`: arranque (idea/doc → borrador + gaps), question (una pregunta a la vez), update (respuesta → actualización)
  - 4 endpoints REST: `POST /ai-analysis/phase0/start`, `GET phase0/question/:threadId`, `POST phase0/answer`, `GET phase0/state/:threadId`
  - DB: 3 campos nuevos en `Project` (`phase0Status`, `phase0Gaps`, `phase0Questions`) + safe-schema-sync.sql
- **Frontend Phase0InterviewPanel:** Nuevo componente React con input inicial, indicador de progreso (5 dots), una pregunta a la vez con respuesta inline, borrador visible toggle, y estados idle/starting/interviewing/done/error. Integrado en la pestaña Fase 0 del Workshop.

### Changed

- **WorkshopView:** La pestaña Fase 0 ahora muestra el entrevistador interactivo cuando no hay `dbgaContent`, y el flujo legacy (DBGA) cuando ya existe contenido. La integración es transparente: al completar la entrevista, se genera `dbgaContent` y el panel legacy se muestra automáticamente.
- **load-prompts.ts:** Registro de `PHASE0_ARRANQUE_PROMPT`, `PHASE0_QUESTION_PROMPT`, `PHASE0_UPDATE_PROMPT` en el loader central.
- **AiAnalysisController / Module:** Import, provider, export e inyección de `Phase0InterviewService`.
- **BUILD_CACHE_BUST**: 80 → 81

## [0.10.2] — 2026-05-25

### Fixed

- **Orquestador IA — cambios de usuario con prioridad sobre inferencia del LLM:** El prompt del sistema ahora incluye instrucciones explícitas para que el LLM **no evalúe cambios como "ya cubiertos" o "impacto mínimo"**. Cuando el usuario expresa un requisito explícito (ej. "necesitamos X", "queremos Y", "falta Z", "usa W"), el LLM debe tratarlo como orden y devolver el `---FIN_MDD---` con el documento actualizado. Se corrigieron 3 puntos en `ai.service.ts`: la instrucción de desambiguación (línea 150) y las 2 reglas MDD (líneas 177 y 342).
  - `apps/api/src/modules/ai/ai.service.ts` — 3 cambios en prompts del sistema

### Changed

- **BUILD_CACHE_BUST**: 87 → 88 (Dockerfiles), 84 → 88 (docker-compose.yml)

---

## [0.10.1] — 2026-05-23

### Fixed

- **Phase0 build fix:** Eliminado import no usado de `Phase0QA` en `phase0-interview.service.ts` que rompía el build estricto de TypeScript en Docker.

### Changed

- **BUILD_CACHE_BUST**: 81 → 82

## [0.10.2] — 2026-05-23

### Fixed

- **Prompts Fase 0 contaminados con tecnología:** Los 3 prompts (arranque, question, update) no limitaban a análisis de dominio de negocio. El LLM respondía con decisiones técnicas (AriadneSpecs, PostgreSQL, FalkorDB, BullMQ, etc.) que corresponden al MDD, no a Fase 0. Se agregaron guardrails explícitos: instrucciones de QUÉ no incluir y conversión de lenguaje técnico a concepto de negocio.

### Changed

- **BUILD_CACHE_BUST**: 82 → 83

## [0.10.3] — 2026-05-23

### Fixed

- **MCP Server crash al inicio:** El Dockerfile del MCP copiaba `package.json` del mcp-server a la raíz (`./`) en vez de a su ruta correcta (`./packages/mcp-server/`), lo que rompía la resolución del workspace `@theforge/shared-types` desde node_modules hoisted.

### Changed

- **BUILD_CACHE_BUST**: 83 → 84

---


---

## [0.9.2] — 2026-05-22

### Fixed

- **Diagramas Mermaid con errores de sintaxis en el MDD:** El pipeline de normalización interna (`sanitizeMermaidBlock`) solo corregía espacios unicode y comas `PK, FK`, pero no los errores estructurales más comunes que el LLM genera: IDs con espacios, bloques alt/opt/loop sin cerrar, subgraphs sin `end`, quotes inconsistentes, etc. Estos sí los corrige la herramienta experta `normalizeMermaid` de `@theforge/shared-types/mermaid`, pero no estaba integrada en el pipeline de persistencia.
  - `sanitizeMermaidBlock` ahora llama a `normalizeMermaid` después de sus correcciones básicas — corrige IDs, cierra bloques, normaliza quotes automáticamente
  - `validateMermaidSyntax` ahora también ejecuta `validateMermaid` (experta) además del chequeo de `PK, FK`
  - Corre en cada `PATCH /projects/:id` via `mddUpdatePipeline.process()` antes de persistir
- **`validateMermaid` de shared-types no reconocía `flowchart`:** La regex de detección de tipo solo incluía `graph`, no `flowchart`. También se pasaba el contenido con fences a `validateMermaid`, que espera el contenido crudo. Se usa `require()` dinámico para evitar errores de moduleResolution en build.
- **Frontend no normalizaba diagramas viejos con la experta al renderizar:** El backend ya aplica `normalizeMermaid` de shared-types al persistir (PATCH), pero diagramas guardados antes del fix quedan con errores en DB. El frontend solo aplicaba normalización básica (unicode spaces, indent, keyword casing) sin usar la experta. Se importa `normalizeMermaid` de `@theforge/shared-types/mermaid` y se aplica como pre-paso en ambos paths de render (useEffect y ReactMarkdown custom renderer), cubriendo todos los tipos de diagrama (graph, flowchart, sequenceDiagram, erDiagram, etc.).

### Changed

- **BUILD_CACHE_BUST**: 79 → 80

---

## [0.9.1] — 2026-05-22

### Fixed

- **§6 Seguridad no se generaba con DeepSeek/Claude:** `stripThinkingTags()` solo limpiaba tags HTML-style (``), ignorando los formatos nativos de DeepSeek (`` ```think``` ``) y Claude. El texto con razonamiento llegaba a `isCorruptedSecurityLlmText()` que lo descartaba como corrupto, eliminando toda la sección 6.
  - `stripThinkingTags` ahora también remueve fenced code blocks con "think/thought/reasoning"
  - Patrón `"6\.\s*Seguridad"\s*:` removido de `CORRUPTED_SECURITY_TEXT_PATTERNS` — matcheaba falsos positivos dentro de valores JSON válidos
  - `parseSecurityLlmResponse` ahora prueba legacy JSON (`{ securitySection }`) antes del chequeo de corrupción, alineado con el formato del prompt default
- **Prompts MDD con supresión de razonamiento explícito:** Software Architect, Security, Integration y MDD Auditor ahora incluyen "NO uses tags de razonamiento ni pienses en voz alta. Devuelve ÚNICAMENTE el JSON." para prevenir thinking output desde la fuente.
- **`prepareMddForOutput` pierde §6 al reconstruir desde structured:** Nueva guarda en `shouldPreferDraftOverStructured`: si el draft tiene contenido real en §6 (>15 chars, no "Pendiente") pero el structured solo tiene placeholder, se preserva el draft.

### Changed

- **BUILD_CACHE_BUST**: 75 → 76

---

## [0.9.0] — 2026-05-22

### Added

- **Enriquecimiento semántico UI/UX en MDD:** Nueva sección `## UI/UX Design Intent` añadida automáticamente al final del MDD. Clasifica cada entidad del modelo de datos (`CREATE TABLE` de §3) como `WorkflowProcess`, `DataRegistry` o `Configuration`; infiere lifecycle states con colores sugeridos; asigna `component_type` semántico (KanbanBoard, DataTable, PropertyGrid, etc.) y mapea props del modelo a props del componente. Implementado en `utils/mdd-enrich-uiux-intent.ts`; integrado en `prepareMddForOutput()` (chokepoint único de salida MDD). No altera contenido previo.
- **Sección 8: UI Design System & Component Mapping en Blueprint:** Nueva sección anexada automáticamente al final del Blueprint. Clasifica las entidades del MDD §3 (`WorkflowProcess`, `DataRegistry`, `Configuration`), asigna componentes recomendados (KanbanBoard, DataTable, PropertyGrid), y especifica reglas de renderizado (prioridad de componente, estándar de formularios React Hook Form + Zod, responsive MobileStackView, validación de contrato previa). Implementado en `engine/blueprint-enrich-ui-system.ts`; integrado en `generateBlueprint()`. No altera secciones previas del Blueprint.

### Changed

- **BUILD_CACHE_BUST**: 74 → 75

---

## [0.8.1] — 2026-05-21

### Added

- **Validación de idea DBGA insuficiente:** `streamAnalysis` rechaza saludos o textos demasiado cortos antes de invocar el grafo LangGraph, emitiendo un evento NDJSON `error` con código `INSUFFICIENT_IDEA` y mensaje en español orientado al Benchmark.
- **Util `dbga-idea-validation`:** Heurística de saludos (normalización NFD, sin acentos) y umbral de longitud mínima; tests unitarios dedicados.

### Fixed

- **Nodo Scout (DBGA):** Si el modelo responde en prosa en lugar de JSON (p. ej. ante un saludo), el parseo ya no aborta todo el stream: se reutiliza `parseJsonOrThrow` compartido y se continúa con lista vacía de competidores.
- **Errores de stream DBGA:** `formatDbgaStreamError` traduce `SyntaxError` por JSON inválido (token inesperado) a mensaje amigable en español, sin exponer detalles del motor de parseo al cliente.

---

## [0.8.0] — 2026-05-20

### Added

- **Arquitectura multi-proveedor BYOK + tenant:** Cada usuario resuelve runtime IA con prioridad **instancia tenant** (`ProviderInstance`) y respaldo **BYOK personal** (`UserProviderConfig`). Sin fallback a claves LLM en variables de entorno (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, etc.). Documentación: `multi_provider_spec.md`.
- **Rol `super_admin`:** CRUD de instancias tenant, promoción de otros super admins, bypass de whitelist de modelos en instancias. Primer usuario (`POST /auth/register-first-admin`) → `super_admin`. Migración: usuario más antiguo por `createdAt` si no existía ningún `super_admin`.
- **Cifrado de tokens BYOK:** Módulo `crypto/` con `TOKEN_MASTER_KEYS` y `TOKEN_ACTIVE_KEY_VERSION`. Script `scripts/rotate-master-key.ts` y `npm run rotate-master-key` (incluye `provider_instances`). Guía en README § Cifrado de tokens BYOK; script empaquetado en imagen API.
- **Catálogo de proveedores:** `provider-catalog.ts` — OpenRouter, OpenAI, Anthropic, Gemini, **Cloudflare Workers AI** y **Groq** (chat, embeddings y/o STT según capacidades del proveedor).
- **`AIFactory` + adaptadores OpenAI-compatible:** Resolución tenant-first vía `UserProvidersService.resolveRuntime`; jobs BullMQ propagan `userId` con `runWithRequestUserAsync`.
- **API tenant:** `GET/POST/PUT/DELETE /provider-instances` (super_admin), `GET /provider-instances/enabled` (usuarios con instancias habilitadas).
- **API usuario:** `GET/PUT /user-providers/*` — configuración BYOK personal, ajustes activos (`activeProvider`, `activeTenantInstanceId`, `embeddingProvider`), catálogo de modelos y fallbacks.
- **Visibilidad de proyectos:** Enum `Visibility` (`PRIVATE` | `SHARED`). `PRIVATE`: solo owner; `SHARED`: accesible a usuarios autenticados del tenant. Campo en Prisma, DTO y listado/filtrado en `projects.service.ts`.
- **UI de ajustes (`#/settings`):** `ProviderInstancesCard`, `AIProvidersCard`, modales `UserProviderConfigModal` / `ProviderInstanceConfigModal`, formularios compartidos y diálogo `ModelsUnavailableDialog` cuando no hay modelos configurados.
- **Filtro de errores LLM:** `ModelsUnavailableExceptionFilter` — respuestas HTTP coherentes cuando el runtime no tiene proveedor usable o modelos disponibles (chat, MDD, DBGA, entregables).

### Changed

- **Pipeline IA (MDD, DBGA, entregables, chat, audio STT, embeddings/Falkor):** Todas las llamadas LLM usan runtime BYOK del usuario autenticado (o `job.data.userId` en cola).
- **`docker-compose` / `.env.example`:** Eliminadas variables de claves LLM en servidor; obligatorias `TOKEN_MASTER_KEYS` + `TOKEN_ACTIVE_KEY_VERSION`. Opcionales de servidor: `LLM_MAX_TOKENS`, `STT_MODEL`, `EMBEDDING_DIM` como defaults cuando el usuario omite valor en BYOK.
- **`BOOTSTRAP_ADMIN_EMAILS`:** Solo promueve a `admin` (nunca `super_admin`).
- **Setup / Login:** Primer admin con `super_admin` y `mcpSecret` autogenerado; `UsersList` permite asignar `super_admin` solo si el usuario actual lo es.
- **Workshop:** Integración de selección de instancia tenant / proveedor personal en el store y vistas.

### Fixed

- **Asignación de `super_admin`:** Lógica de bootstrap y creación de usuarios aclarada — `BOOTSTRAP_ADMIN_EMAILS` no eleva a super admin; rol reservado al primer registro o migración explícita.

### Impacto arquitectónico

- **Nuevo eje de configuración IA:** De “clave global en env” a “tenant instance → BYOK personal → error explícito”. `EngineModule` / LangGraph / `ProjectsService` dependen de `UserProvidersModule`.
- **Seguridad:** Tokens API nunca en texto plano en BD; solo `tokenCiphertext` + versión de clave. Rotación sin re-ingestar proyectos.
- **Despliegue:** Requiere migraciones `20260519120000`–`20260519140000` y definir `TOKEN_MASTER_KEYS` antes de arrancar el API en producción.

---

## [0.7.3] — 2026-05-20

### Added

- **Corazón de favoritos en proyectos:** Cada proyecto en el listado ahora muestra un ❤️ que permite marcarlo como favorito con toggle persistente en BD. Backend: `FavoriteProject` table (Prisma + migración), `POST /projects/:id/favorite`, `GET /projects/favorites`. Frontend: `isFavorite` desde API + `onToggleFavorite` en `ProjectFolderTile`.

### Changed

- **BUILD_CACHE_BUST**: 73 → 74

### Fixed

- **Blueprint pierde contenido al modificar por chat:** `mergeDocSectionOrUseFull()` tenía un fallback peligroso: si el LLM devolvía un fragmento ≥600 chars sin encabezado `## N.`, reemplazaba todo el documento. Ahora cualquier contenido sin encabezado numerado preserva el documento existente.

---

## [0.7.2] — 2026-05-21

### Fixed

- **Botón Reparar YAML en Guía UX/UI no mostraba loading:** `repairUxGuide` no establecía `uxGenerating`, por lo que no había spinner ni progreso visible. Ahora usa el mismo patrón que `generateUxGuideSequential`.
- **React error #310 al reparar YAML:** `repairUxGuide` llamaba `setUxUiGuideContent()` + `persistUxUiGuideContent()` causando doble re-render y colapso de hooks. Se eliminó la llamada directa al store — `persistUxUiGuideContent` maneja todo el estado en un solo re-render vía `persistField`.

### Changed

- **N/A**

---

## [0.7.1] — 2026-05-21

### Fixed

- **Cascada de documentos trabada en "Generando...":** El polling frontend consultaba `j.state` pero la API devuelve `j.status`. Nunca detectaba "completed" y el loop seguía hasta el deadline de 45 min.
- **Modificaciones al MDD vía chat no se aplicaban:** El LLM respondía solo con "MDD generado" sin incluir el documento actualizado con el delimitador `---FIN_MDD---`. Reforzada la instrucción en el system prompt del tab MDD para que SIEMPRE devuelva el MDD completo con los cambios.
- **Botón reparar YAML frontmatter de Guía UX/UI ahora usa LLM con contexto MDD:** Antes solo hacía regex sobre el body existente (fallaba si el formato no era limpio). Ahora llama al endpoint `POST /projects/:id/repair-ux-ui-guide` que genera el YAML de diseño desde el MDD, Blueprint y Spec.
- **Botón "Generar documentos" mostraba conteo incorrecto (125):** Cambiado de `cascadeProgress.length` (cuenta todos los ticks de polling) a `cascadeCompleted/cascadeTotal` (solo docs únicos completados).
- **Progreso sin visibilidad en el chat:** `agentProgress` ahora se muestra en el ChatContainer durante la cascada de entregables (`loadingReason === "deliverables-cascade"`).

### Changed

- **UX de progreso en cascada:** Ahora se inicializan los 11 documentos con `⚪ Nombre — Generando…` y al completarse cambian a `✅ Nombre — Terminado`. Se actualizan in-place en vez de acumular entradas duplicadas.

---

## [0.7.0] — 2026-05-19

### Added

- **Cascada de documentos en paralelo:** `generateDeliverablesCascade` reemplaza `for...of await` con `Promise.allSettled()`. Los 11 documentos (Blueprint, Spec, Arquitectura, etc.) se generan simultáneamente. HIGH: de ~5-22min a ~30s-2min. Cada documento es una llamada LLM independiente sin estado compartido — riesgo cero de `INVALID_CONCURRENT_GRAPH_UPDATE`.
- **Progreso visible en el chat:** `agentProgress` ahora acumula (append) cada documento completado con icono ✅. El botón muestra "Generando documentos (N)" con el conteo en vivo.

### Changed

- **`projects.service.ts`**: `completedCount` atómico en vez de array index para progreso real con paralelismo. Labels legibles para la UI (Blueprint, Spec, Arquitectura, etc.).
- **`workshopStore.ts`**: `generateDeliverablesCascade` usa `set((s) => ({ agentProgress: [...s.agentProgress, { agent, message }] }))` en vez de reemplazar.
- **`WorkshopView.tsx`**: Botón muestra "Generando documentos (N)" en vez de "Generando step (N/11)".

### Fixed

- **INVALID_CONCURRENT_GRAPH_UPDATE revertido (PR #175):** Security e Integration escriben ambos a `mddStructured` (canal `LastValue`). Revertidos a secuencial. CrossConsistency+DiagramInjector permanecen en paralelo porque escriben a canales distintos.
- **Docker build mcp-server (PR #171, #173, #174):** Contexto cambiado de subdirectorio a repo root para resolver workspaces npm. Agregados `@theforge/shared-types` y `@theforge/config` como dependencias. Producción copia `node_modules` raíz (npm hoist).

---

## [0.6.0] — 2026-05-19

### Added

- **NodeCacheService**: Cache en memoria por nodo LLM con TTL de 1 hora. Cada nodo del pipeline MDD (Clarifier, Software Architect, Security, Integration, LLM Formatter, Cross-Consistency) calcula un hash SHA-256 de sus campos de entrada y reusa el resultado si el input no cambió. En re-runs tras fallo, el ahorro es de ~70-85% del tiempo total del pipeline.
- **Paralelismo Security + Integration** (ambos grafos): Security (§6) e Integration (§7) corren en paralelo en el grafo `createMddGraph` (one-shot) y `createMddGraphWithManager` (Manager). Escriben keys distintas del estado (`mddStructured.seguridad` vs `mddStructured.integracion`). Ahorro ~15s.
- **Paralelismo Cross-Consistency + DiagramInjector** (grafo one-shot): CrossConsistency (read-only, produce `internalDirectives`) y DiagramInjector (code-only, inyecta diagramas) corren en paralelo tras LLMFormatter. Auditor espera a ambos mediante fan-in. Sin riesgo de precisión porque el Auditor usa shortcut code-only (99% casos) que no evalúa diagramas.

### Changed

- **`mdd-graph.ts`**: Los nodos LLM se envuelven con `wrapCache()` que checkea cache antes de ejecutar. Se añadió `routeAfterSecurity` → `format_after_redactor` (en vez de `integration`) para el caso default.
- **`ai-analysis.service.ts`**: Inyecta `NodeCacheService` y lo pasa a `createMddGraph` y `createMddGraphWithManager` via `MddGraphCompileOptions.nodeCache`.

---

## [0.5.0] — 2026-05-19

### Added

- **Cross-project table import (`get_project_tables` tool):** El Software Architect ahora puede importar tablas SQL de otro proyecto de TheForge durante la generación del MDD. Se invoca con `get_project_tables(projectId, tableNames?)`. Útil cuando un proyecto necesita tablas compartidas de un proyecto existente. Ver README sección "Cross-Project Table References".
- **MCP tool `get_project_tables`:** Nueva herramienta en el MCP server que expone la misma funcionalidad para acceso externo.
- **Detección de lenguaje natural para regenerar secciones:** El chat del MDD ahora reconoce frases como "regenera sección 2" sin necesidad del comando `/`.

### Fixed

- **Secciones §6-§7 preservadas al regenerar §2:** Doble capa: prompt + post-processing code para que el SA no reemplace Seguridad e Infraestructura con placeholders.
- **Líneas en blanco en tablas markdown:** Regla explícita en prompts para evitar renderizado roto.
- **Anti-Swagger/OpenAPI en §4:** Prohibición explícita con ejemplo concreto para evitar que el SA genere OpenAPI specs en vez de markdown plano.

### Changed

- **`tool-registry.ts`:** `getMddArchitectTools()` ahora retorna `[createGetProjectTablesTool()]` (antes array vacío).

---

## [0.4.0] — 2026-05-16

### Changed

- **BRD (greenfield y legacy):** El prompt de generación ahora exige que el BRD comience con la sección **«Pain Points & Problem Statement»**, incluyendo mapa de dolores (tabla), validación de demanda, perfil del cliente objetivo y consecuencias de no actuar. Los datos se extraen del DBGA o codebase doc; si falta evidencia se indica como «Por validar».
  - `apps/api/src/modules/projects/projects.service.ts` — prompt `DBGA_BRD_TOBE_SUGGEST_SYSTEM` + `brdPrompt` para greenfield
  - `apps/api/src/modules/legacy-flow/legacy-coordinator.service.ts` — prompts de BRD inicial y BRD de cambio para legacy

### Added

- **Sección Pain Points & Problem Statement en BRD:** Estructura estandarizada de 4 sub-secciones que obliga al LLM a documentar el problema de negocio antes de pasar a requisitos.
- **Botón «Reparar» en guía UX/UI:** Nuevo botón con icono Wrench en la toolbar del panel UX/UI Guide que toma el markdown existente (de IAs externas o copiado manualmente) y genera el YAML frontmatter estructurado para el preview visual de DesignMdPreview. Usa las funciones existentes `replaceYamlFrontMatter`, `extractDesignMdFrontMatter`, `fillDesignMdDefaults` y `tokensToYamlFrontMatter`.

---

## [0.3.0] — 2026-05-02

### Added

- **AEM (Análisis y Estrategia de Mercado)**: nueva pestaña en el Workshop con editor preview/source, auto-save al perder foco, y soporte en ZIP de descarga. Campo `aemContent` en Prisma + DTO + MCP tool `set_aem_content`.
- **Design token extraction**: reemplazado extractor LLM-based por tool MCP dedicado `extract_design_tokens` en AriadneSpecs (sin LLM, más rápido). Añadido método `extractDesignTokens()` en TheForgeService. Eliminado `design-token-extractor.ts`.

### Changed

- **Docs**: actualizados MCP server docs, CHANGELOG, README.

---

## [0.2.0] — 2026-05-02

### Added

- **BRD/To-Be/As-Is por Stage:** Campos `brdContent`, `toBeManualContent`, `asIsManualContent`, `brdApprovedAt`, `toBeApprovedAt` en Prisma `Stage`. Flujo greenfield: BRD → To-Be (gate opcional) → MDD. Flujo legacy: As-Is desde codebaseDoc → BRD/To-Be → MDD de cambio.
- **Gates BRD/To-Be:** `requireBrdTobeGate` por proyecto. Streams MDD emiten `blocked` si faltan aprobaciones. Preámbulo `composeBrdToBeAsIsPreamble` en síntesis MDD.
- **Etapas como cambios legacy:** Cada etapa de cambio es un `Stage` independiente con FalkorDB (`LegacyStage` nodos + `DERIVED_FROM` por ordinal). Dual-write legacy → stage para migración gradual.
- **Prompts incrementales en etapas legacy:** MDD de etapa base (hasta 30k chars) inyectado como contexto con instrucción "describe SOLO las modificaciones respecto a esta línea base".
- **BRD/To-Be legacy como reflejo del MDD inicial:** En Stage 1 se titulan "BRD (sistema actual)" y "Manual To-Be (sistema actual)".
- **Desambiguación en chat legacy:** Instrucción en prompt: "Si el usuario menciona un cambio o hay ambigüedad, preguntar si es consulta o cambio."
- **Botón "+ Nueva etapa de cambio":** En WorkshopView, modal con selección de etapa fuente para crear nuevas etapas legacy.
- **FalkorDB `syncLegacyStage` / `clearLegacyStage`:** Sincronización de nodos `:LegacyStage` con relaciones `DERIVED_FROM` y `HAS_LEGACY_STAGE`.
- **Schema `copyLegacyChangeFromStageId`:** En `createStageBodySchema` para copiar estado legacy entre etapas.
- **Variables de entorno:** Documentación completa de todas las variables `LEGACY_*`, `THEFORGE_CONTEXT_*`, `MCP_*`, `FALKORDB_*`, `PRISMA_*` y operacionales en `README.md` y `.env.example`.

### Changed

- **`LegacyCoordinatorService`:** Migración completa de métodos → `getLegacyChangeState()` + `persistLegacyChangeState()` con dual-write y fallback a `project.legacyFlowState`.
- **`createStage` en `proyectos.service.ts`:** Búsqueda de `parentStageId` por ordinal para FalkorDB `DERIVED_FROM`.
- **`WorkshopView.tsx` y `workshopStore.ts`:** ~30 referencias migradas de `project.legacyFlowState` → `activeLegacyState`.
- **Controller legacy:** Endpoints aceptan `stageId` opcional para operaciones multi-etapa.
- **Documentación:** `blueprint.md`, `mdd.md`, `PROJECT_BRAIN_DUMP.md` actualizados a v2.0 reflejando el estado actual del proyecto.

### Fixed

- **Error de build en Dokploy:** `@theforge/web#build` fallaba por `brdGateBlocked` declarada pero no usada en `WorkshopView.tsx`. Eliminadas IIFEs muertas. Commit `0a8c600`.
- **Legacy:** BRD/To-Be en Stage 1 ahora reflejan el MDD inicial como sistema actual, no como documento de cambio.

### Impacto arquitectónico

- **Nuevo eje en Pipeline MDD:** BRD/To-Be como precursores opcionales antes del MDD técnico. Gates que bloquean pasos LLM y emiten eventos `blocked`.
- **Grafo de etapas:** FalkorDB ahora modela relaciones `DERIVED_FROM` entre etapas legacy por ordinal, permitiendo trazabilidad completa de cambios.
- **Dual-write:** `legacyFlowState` en `legacyCoordinator` se escribe tanto en `project.legacyFlowState` como en `stage.legacyChangeState` durante migración.

---

## [0.1.0] — 2026-03-27

### Added

- **`@theforge/business-rules`**: paquete compartido con estimación de costo (MXN), parsing de horas fijas de infra, estructura de equipo por defecto y constantes alineadas con negocio. Fuente única de verdad para API y Workshop web.
- **Grafo SDD (FalkorDB) — lectura y salud** (`GraphMemoryService`):
  - `getSddStageSnapshot`: entidades y endpoints ingeridos por `projectId` + `stageId`.
  - `evaluateSddDependencyHealth`: coherencia `API_Endpoint -[:CONSUMES]-> DB_Entity` (conteo de huérfanos y bandera `isCoherent`).
- **Pipeline MDD** (`MddUpdatePipelineService`): con `graphScope` en complejidad **HIGH**, re-ingiere MDD al grafo y pasa `sddDomainGraphOk` al semáforo para **relajar** el camino documental estricto (edge_cases / field_types) cuando el grafo es coherente.
- **Legacy — puerta índice vs SDD**: `assertLegacyIndexSddGate` cruza índice Ariadne (MCP) con snapshot Falkor; discrepancia grave → `409` con código `LEGACY_INDEX_SDD_MISMATCH` y payload `gate`; resolución explícita en `legacyFlowState.legacyIndexSddResolution` (`trust_index` | `trust_sdd` | `proceed_with_warnings`). Feature flag `LEGACY_SDD_INDEX_GATE` (default activo).
- **Util `legacy-index-sdd-alignment.util.ts`**: heurísticas de solapamiento y umbrales tunables vía env (`LEGACY_SDD_*`).
- **Puertos de orquestación**: `PROJECTS_ORCHESTRATOR_PORT`, `THEFORGE_ORCHESTRATOR_PORT` con implementación `useExisting` sobre servicios concretos; tests de DI (`ai-orchestrator.di.spec.ts`, `semaphore.service.spec.ts`, specs de alineación legacy).
- **`gatherLegacyIndexSignals`** y **`legacyIndexHasUsableGraphEvidence`** en `theforge-evidence-context.util.ts` para reutilizar recolección MCP sin duplicar lógica.
- **Módulo** `graph-memory.module.ts` y documentación README en submódulos (ai-analysis graph-memory, ai-orchestrator, business-rules).

### Changed

- **`CostCalculatorService`** y **`apps/web/src/utils/costCalculator.ts`**: delegan en `@theforge/business-rules` (sin duplicar multiplicadores, buffer ni tarifas).
- **`SemaphoreService` (HIGH)**: nuevo input opcional `sddDomainGraphOk`; si el MDD tiene lagunas documentales pero el grafo SDD es sano, puede alcanzar **VERDE** con `precisionScore` ajustado (92 vs 95).
- **`MddUpdatePipelineService.process`**: ahora **async** e inyecta `GraphMemoryService`; `EngineModule` importa `GraphMemoryModule`.
- **`LegacyCoordinatorService`**: inyección de `GraphMemoryService`; manejo de `ConflictException` para el gate índice/SDD.
- **`AiOrchestratorService`**: depende de puertos `IOrchestratorProjectsPort` / `IOrchestratorTheForgePort` en lugar de clases concretas.
- **`ProjectsModule` / `TheForgeModule`**: exportan tokens de puerto para consumo del orquestador.
- **Documentación**: actualizaciones en `docs/notebooklm/THEFORGE-INDEX.md`, `docs/notebooklm/LEGACY-EVIDENCE-CONTEXT.md`, skill The Forge; ajustes en `docker-compose.yml`, `vite.config.ts` y paths TS del web según el paquete compartido.

### Fixed

- **Consistencia estimación**: elimina el riesgo de drift entre front (Workshop) y API al centralizar reglas en `business-rules`.
- **Semáforo HIGH**: reduce falsos AMARILLO cuando el modelo de dominio en grafo está enlazado aunque el texto MDD aún no cubra todos los apartados §3–§5.
- **Legacy**: evita avanzar con síntesis LLM cuando el índice MCP y el SDD ingerido divergen de forma grave, salvo resolución explícita del usuario.

### Impacto arquitectónico (grafo de dependencias)

- **Nuevo nodo de paquete**: `api` y `web` → `@theforge/business-rules` ← `@theforge/shared-types`.
- **`EngineModule` → `GraphMemoryModule`**: el motor de validación MDD/semáforo queda acoplado al subsistema de grafo (Falkor) en el camino HIGH con scope de proyecto/etapa.
- **`LegacyFlowModule` → `AiAnalysisModule`**: el coordinador legacy depende explícitamente de `GraphMemoryService` para gates de alineación.
- **Inversión de dependencias en orquestador**: `AiOrchestratorService` solo conoce interfaces (puertos); los módulos `projects` y `theforge` mantienen las implementaciones Nest y exportan los tokens.

---

|Este documento representa el estado incremental del proyecto a fecha de **20 de mayo de 2026**.

## [0.10.2] — 2026-05-23

### Added

- **Chat → Phase0**: ahora el tab `phase0` soporta el delimitador `---FIN_PHASE0---` para que las ediciones en el chat se persistan correctamente a `phase0SummaryContent`.
- **Parser**: método `splitPhase0AndChat` + `mergePhase0OrUseFull` + fallback `detectDocFallback` para tab `phase0`.
- **SessionsService**: soporte completo de `phase0SummaryContent` en `chat()`, `chatStream()`, y su tipo de retorno.
- **Orchestrator**: persistencia de `phase0SummaryContent` cuando vuelve del chat, tanto en `chat()` como en `chatStream()`.
- **LLM context**: nueva opción `currentPhase0SummaryContent` en `GenerateResponseOptions` para que el LLM reciba el documento actual al editar.
- **Controller**: `phase0SummaryContent` aceptado como parámetro desde el frontend.
- **AI service**: tag `PHASE0` registrado en el mapa de delimitadores del sistema de prompts.

### Fixed

- Las conversaciones que refinaban el documento Fase 0 en el Workshop quedaban perdidas — no existía el pipeline de parseo/persistencia para `phase0SummaryContent`. Ahora el flujo completo (LLM → parser → service → persistencia) funciona igual que para MDD, DBGA, SPEC, etc.

## [0.10.3] — 2026-05-23

### Added

- **Fallback regeneración DBGA en streaming**: cuando DeepSeek no emite el delimitador `---FIN_DBGA---` en el chat streaming del tab Benchmark, el sistema detecta la omisión y llama de nuevo al modelo con un prompt estricto que fuerza la generación completa del documento. Aplica tanto al endpoint `POST /chat` (no-streaming) como al `POST /chat/stream`.

### Fixed

- Las ediciones en el chat del tab Benchmark/Fase 0 que quedaban perdidas porque DeepSeek respondía conversacionalmente sin emitir `---FIN_DBGA---`. Ahora el fallback de regeneración captura esos casos y persiste el documento.
