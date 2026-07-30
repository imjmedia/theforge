/**
 * @fileoverview **Catálogo JSDoc** de las herramientas MCP de **@theforge/mcp-server** (`index.ts`).
 * Paridad: mismos `name` que el array `TOOLS` y las claves del mapa `handlers`. Cada tool delega en la
 * **API Nest The Forge** (`THEFORGE_API_URL`, default `http://theforge-api:3000` en Docker; `http://localhost:3000` en dev local) con JWT obtenido via
 * **MCP_M2M_SECRET** (`/auth/mcp-login` o flujo equivalente documentado en el servidor).
 *
 * @packageDocumentation
 * @module mcp-tools.doc
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 *
 * ## Autenticación
 *
 * - Sin `MCP_M2M_SECRET` el servidor arranca en modo dev sin auth (solo local).
 * - Con secret: login al bootstrap y refresh ante `401` en `apiFetch`.
 *
 * ## Herramientas por dominio (nombre MCP → endpoint / rol)
 *
 * ### Projects
 *
 * - **`list_projects`**: `GET /projects`
 * - **`get_project`**: `GET /projects/:projectId`
 * - **`create_project`**: `POST /projects` (body: name, projectType NEW|LEGACY, hasUxTeam, theforgeProjectId si LEGACY)
 * - **`delete_project`**: `DELETE /projects/:projectId`
 * - **`get_project_stages`**: `GET /projects/:projectId/stages`
 * - **`get_project_stage_detail`**: `GET /projects/:projectId/stages/:stageId` (detalle + entregables + transiciones permitidas)
 * - **`create_project_stage`**: `POST /projects/:projectId/stages`
 * - **`patch_project_stage`**: `PATCH /projects/:projectId/stages/:stageId`
 * - **`transition_project_stage`**: `POST /projects/:projectId/stages/:stageId/transition` (activate|complete|archive|reopen)
 * - **`get_project_deliverables`**: `GET /projects/:projectId` (resumen cascada + `agentGovernanceContent`)
 * - **`get_conformance`**: `GET /projects/:projectId/conformance?useLlm=`
 * - **`audit_documents`**: `GET /projects/:projectId/audit-documents?useLlm=` (conformidad + gaps SDD + resumen)
 * - **`patch_project`**: `PATCH /projects/:projectId` (body parcial MDD/blueprint/spec/groupId/…)
 * - **`generate_benchmark`**: `POST /projects/:projectId/generate-benchmark`
 *
 * ### Project groups (admin+ salvo list/get)
 *
 * - **`list_project_groups`**: `GET /project-groups` — cualquier usuario autenticado
 * - **`get_project_group`**: `GET /project-groups` + filtro por `groupId` — cualquier usuario autenticado
 * - **`create_project_group`**: `POST /project-groups` `{ name }` — admin / super_admin
 * - **`rename_project_group`**: `PATCH /project-groups/:groupId` `{ name }` — admin+; bloquea grupo por defecto
 * - **`delete_project_group`**: `DELETE /project-groups/:groupId` — admin+; reasigna proyectos al grupo «Proyectos»
 * - **`move_project_to_group`**: `PATCH /projects/:projectId` `{ groupId }` — admin / super_admin
 * - **`move_project_group_to_first`**: `POST /project-groups/:groupId/move-to-first` — admin+; reordena sortOrder
 * - **`phase0_deep_research`**: `POST /projects/:projectId/phase0-deep-research`
 * - **`suggest_brd_tobe_from_dbga`**: `POST /projects/:projectId/suggest-brd-from-dbga` (nombre histórico; solo persiste BRD en etapa)
 *
 * ### Deliverables / generación
 *
 * - **`generate_deliverables`**: `POST /projects/:projectId/generate-deliverables` (cascada completa)
 * - **`generate_spec`**: `POST /projects/:projectId/generate-spec`
 * - **`generate_blueprint`**: `POST /projects/:projectId/generate-blueprint` (preview, gapsFeedback)
 * - **`generate_architecture`**: `POST /projects/:projectId/generate-architecture`
 * - **`generate_api_contracts`**: `POST /projects/:projectId/generate-api-contracts`
 * - **`generate_use_cases`**: `POST /projects/:projectId/generate-use-cases`
 * - **`generate_user_stories`**: `POST /projects/:projectId/generate-user-stories`
 * - **`generate_logic_flows`**: `POST /projects/:projectId/generate-logic-flows`
 * - **`generate_infra`**: `POST /projects/:projectId/generate-infra`
 * - **`generate_agent_governance`**: `POST /projects/:projectId/generate-agent-governance` (preview, queue)
 * - **`get_agent_governance_export`**: `GET /projects/:projectId/agent-governance-export`
 * - **`confirm_complexity`**: `POST /projects/:projectId/confirm-complexity`
 * - **`reassess_complexity`**: `POST /projects/:projectId/reassess-complexity`
 *
 * ### AI Analysis (DBGA / MDD / estimación)
 *
 * - **`start_analysis`**: `POST /ai-analysis/start` (idea, projectId opcional)
 * - **`get_estimation`**: `GET /ai-analysis/estimation` (semáforo, horas, MXN)
 * - **`get_mdd_thread`**: `GET /ai-analysis/mdd/thread`
 * - **`get_adrs`**: `GET /ai-analysis/mdd/adrs`
 * - **`review_mdd`**: `POST /ai-analysis/mdd/review`
 *
 * ### AI Orchestrator
 *
 * - **`orchestrator_chat`**: `POST /ai-orchestrator/chat` (mensaje + contexto pestañas/MDD/DBGA/BRD)
 * - **`orchestrator_welcome`**: `POST /ai-orchestrator/welcome`
 * - **`orchestrator_clear_chat`**: `POST /ai-orchestrator/clear-chat`
 *
 * ### Sessions
 *
 * - **`create_session`**: `POST /sessions`
 * - **`get_project_sessions`**: `GET /sessions/project/:projectId`
 * - **`get_session`**: `GET /sessions/:sessionId`
 * - **`chat_in_session`**: `POST /sessions/:sessionId/chat`
 *
 * ### Legacy flow (AriadneSpecs / MaxPrime)
 *
 * - **`legacy_start`**: `POST /projects/:id/legacy/start`
 * - **`legacy_answer`**: `POST /projects/:id/legacy/answer`
 * - **`legacy_generate_mdd`**: `POST /projects/:id/legacy/generate-mdd` (stageId, `?includeContent=true` opcional)
 * - **`legacy_generate_codebase_doc`**: `POST /projects/:id/legacy/generate-codebase-doc`
 * - **`legacy_generate_deliverables`**: `POST /projects/:id/legacy/generate-deliverables`
 * - **`legacy_update_codebase_doc`**: `PATCH /projects/:id/legacy/codebase-doc`
 * - **`legacy_generate_as_is_manual`**: `POST /projects/:id/legacy/generate-as-is-manual`
 * - **`legacy_suggest_brd_tobe`**: `POST /projects/:id/legacy/suggest-brd-from-codebase-doc` (nombre histórico; solo persiste BRD en etapa)
 * - **`legacy_resolve_index_sdd_conflict`**: `POST /projects/:id/legacy/resolve-index-sdd-conflict`
 *
 * ### Integración The Forge / Ariadne
 *
 * - **`list_theforge_projects`**: `GET /theforge/projects` (índice multi-root en Ariadne)
 * - **`resolve_forge_project_for_ariadne`**: `POST /theforge/resolve-forge-project-for-ariadne` — input: al menos uno de `ariadneProjectId`, `ariadneRepositoryId`, `projectKey`, `repoSlug`, `gitRemoteUrl`. 200 → `{ forgeProjectId, linkKind, … }`; 404 → `{ error: "not_found" }`; 409 → `{ error: "ambiguous", candidates[] }`
 * - **`create_stage_from_ariadne_change_pack`**: `POST /theforge/create-stage-from-ariadne-change-pack` — body `{ forgeProjectId, pack: { version:"1", changeDescription, filesToModify?, … }, stageId?, stageName?, activate?, runLegacyStart?, wireAriadne? }`. Crea etapa LEGACY o importa en existente; devuelve `recommendedNextTools`.
 * - **`get_integration_status`**: `GET /projects/:projectId/integration` — enlaces NEW↔LEGACY, handoff, traces, warnings, `promotableItemIds` (LEGACY).
 * - **`get_integration_traces`**: `GET /projects/:projectId/integration/traces` — matriz NEW-LEG ↔ LEG (`IntegrationTraceRow[]`).
 *
 * **Secuencia alternativa (sin tool unificada):** `resolve_forge_project_for_ariadne` → `create_project_stage` → aplicar pack vía API integration o `POST …/integration/stages/:stageId/import-handoff` (handoff NEW) → `legacy_generate_mdd` / `legacy_generate_deliverables` con `stageId`.
 *
 * ### Spec-kit / SDD implement
 *
 * - **`get_next_implementation_task`**: `GET /projects/:projectId/next-task` (siguiente tarea abierta en tasks.md; `[P]`, rutas, checkpoint)
 *
 * ### Doc gap multi-agent
 *
 * - **`report_documentation_gap`**: `POST /projects/:projectId/stages/:stageId/documentation-gaps` — por defecto queda `PENDING_APPROVAL` hasta aprobar en Workshop; con `DOC_GAP_AUTO_APPLY=1` reconcilia al instante. Respuesta incluye `pendingApproval` cuando aplica.
 * - **`GET /projects/:projectId/stages/:stageId/documentation-gaps?status=pending`**: listar gaps pendientes de aprobación
 * - **`POST …/documentation-gaps/:gapId/approve`** / **`reject`**: HITL en Workshop
 * - **`get_agent_session_log`**: `GET /projects/:projectId/stages/:stageId/agent-session-log`
 * - **`get_change_log`**: `GET /projects/:projectId/change-log`
 *
 * @see {@link ./index.ts} constantes `TOOLS` y `handlers`
 */

/**
 * Revisión del catálogo; incrementar si cambia el conjunto de tools.
 * @constant
 */
export const MCP_THEFORGE_TOOLS_DOC_REVISION = 12;
