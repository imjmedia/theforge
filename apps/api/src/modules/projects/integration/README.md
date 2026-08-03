# Project integration (NEW ↔ LEGACY)

Cross-project handoff, trace matrix, and stage promotion for brownfield SDD.

## Endpoints (`ProjectIntegrationController`)

| Method | Path | Role |
|--------|------|------|
| `GET` | `/projects/:projectId/integration` | Status, warnings, traces, `promotableItemIds` (LEGACY) |
| `PATCH` | `/projects/:projectId/integration/link` | Bidirectional NEW ↔ LEGACY link |
| `POST` | `/projects/:projectId/integration/handoff/send` | NEW: draft → sent |
| `POST` | `/projects/:projectId/integration/stages/:stageId/import-handoff` | LEGACY: import into existing stage 2+ |
| `POST` | `/projects/:projectId/integration/stages/:stageId/reconcile-handoff` | LEGACY: retroactive Ariadne wire + `legacy/start` on imported stage |
| `POST` | `/projects/:projectId/integration/stages/:stageId/abandon-handoff` | LEGACY: archive stage + release NEW-LEG for re-promotion |
| `POST` | `/projects/:projectId/integration/promote-to-stage` | **P1:** create stage from SENT handoff batch |
| `POST` | `/projects/:projectId/integration/stages/:stageId/sync-handoff-spec` | **IntegrationAgent:** (re)generate `handoff-spec.md` for a stage |
| `POST` | `/projects/:projectId/integration/sync-handoff-spec` | **IntegrationAgent:** same for the primary (active) stage |

Bridge Ariadne (también vía `TheForgeController` + MCP): `POST /theforge/create-stage-from-ariadne-change-pack` — ver sección **Ariadne change pack** en `apps/api/src/modules/theforge/README.md`.

### MCP (`@theforge/mcp-server`)

| Tool | Endpoint |
|------|----------|
| `get_integration_status` | `GET …/integration` |
| `get_integration_traces` | `GET …/integration/traces` |

## Ariadne change pack (MCP `create_stage_from_ariadne_change_pack`)

Body (`createStageFromAriadneChangePackInputSchema`):

```json
{
  "forgeProjectId": "uuid-workshop",
  "pack": {
    "version": "1",
    "changeDescription": "Añadir módulo de descuentos",
    "filesToModify": [{ "path": "src/discount.ts" }]
  }
}
```

- LEGACY only; sin `stageId` → crea etapa; con `stageId` → importa en existente (ordinal ≥ 2)
- **`handoffItems[].id`:** Ariadne puede enviar `LEG-01`, `NEW-LEG-1`, UUID, etc.; Forge normaliza a `NEW-LEG-NN` antes del parse Zod (`ariadne-handoff-normalize.util.ts`). Log en API: `[Integration] Ariadne handoff id remap`.
- Secuencia alternativa: `create_project_stage` → `import-handoff` (NEW) → `legacy_generate_mdd` con `stageId`

## Promote to stage (hybrid C+B)

Body (`promoteHandoffToStageBodySchema` in `@theforge/shared-types`):

```json
{ "itemIds": ["NEW-LEG-01"], "stageName": "Integración — Microservicio X", "activate": true }
```

- LEGACY only; requires `linkedNewProjectId`
- Default items: SENT traces without `legacyStageId`, else all SENT
- Creates stage via `ProjectsService.createStage`, applies `handoffSnapshot` + `legacyChangeState.description` (`buildHandoffImportDescription`)
- After import/promote: **`legacy/start`** (Ariadne `get_modification_plan`) when `LEGACY_HANDOFF_AUTO_LEGACY_START` is enabled (default)
- **Retroactive:** `POST …/stages/:stageId/reconcile-handoff` with `{ wireAriadne?, legacyStart? }` (default both true) — for stages promoted before auto-start or failed wire/analyze

## Reconcile handoff (retroactive)

Body (`reconcileHandoffStageBodySchema`):

```json
{ "wireAriadne": true, "legacyStart": true }
```

- LEGACY only; stage must already have `handoffImportedAt` or `handoffSnapshot`
- Awaits `wireAriadneBrownfieldConverge` (PATCH `theforgeStageId` on Ariadne repos) then `legacy/start` using persisted handoff description
- Does not re-import handoff from NEW (no duplicate description merge)

## Abandon handoff (revert promotion)

Body (`abandonIntegrationHandoffBodySchema`):

```json
{ "reason": "alcance mal definido", "rejectReleasedItems": false, "activateStageId": "…" }
```

- LEGACY only; stage 2+ with imported handoff; sets `workflowStatus: ARCHIVED` (visible in Workshop selector)
- Freezes deliverables snapshot if missing; keeps `handoffSnapshot` + `abandonedAt` for audit
- Clears `legacyStageId` on NEW handoff items and `IntegrationTrace` rows
- Released items → `sent` (re-editable / re-promotable) or `rejected` if `rejectReleasedItems`
- If abandoning ACTIVE stage, activates etapa 1 baseline (or `activateStageId`)

## IntegrationAgent — handoff-spec.md (dynamic)

`integration-agent.service.ts` (`IntegrationAgentService`) turns the registered NEW-LEG items into a dynamic **`handoff-spec.md`** (Brownfield technical breakdown), persisted as `Stage.handoffSpecContent` (flattened to Project like other deliverables) and shown in the Workshop **Handoff Spec** tab.

- **Mutual-agreement artifact (both sides):** the **Handoff Spec** tab is visible on **NEW and LEGACY** projects (like the *Integración* tab). NEW (greenfield) validates it is modeling the integration correctly; LEGACY (brownfield) corroborates the impact. Each side persists its own `handoffSpecContent` and re-syncs independently.
- **Item resolution (`resolvePromptContext`):** NEW reads items from its own `integrationHandoff`. LEGACY reads them from the **promoted stage snapshot** (stage 2+); **before promotion** it falls back to the linked NEW project's **SENT/ACCEPTED** items, so the spec can be produced on stage 1 (AS-IS) for early agreement.
- **Governance ("Regla de Oro"):** only structures/deepens existing items; never creates handoff items.
- **Plan-then-Execute redactor:** `apps/api/src/modules/ai-analysis/nodes/integration-agent.node.ts` (`runIntegrationAgent`) — per item it probes the LEGACY graph **in parallel** with `ask_codebase` (targeted §3/§4 question via `buildItemQuestion`), `semantic_search` (domain keywords via `extractDomainKeywords`, incl. snake_case table tokens + API path segments) and `validate_before_edit` (per PascalCase symbol), then synthesizes the doc against MDD §3 (Model) / §4 (API). Per-user Ariadne MCP URL/token (Settings) is forwarded automatically. The prompt requires asserting from the gathered evidence and only flags "verify manually" when the evidence block is genuinely empty.
- **NEW API context (`gatherNewApiContext`):** the redactor also receives the **NEW project's API contracts** (`apiContractsContent`, stage→project fallback) + MDD §4 as `newApiContext`. Endpoints proposed by the NEW team live in the NEW docs (not the legacy graph), so the prompt requires citing the exact method+path (e.g. `GET /api/v1/listas-precios/{id}/margen-minimo`) instead of "el endpoint del microservicio". LEGACY sync reads the linked NEW project; NEW sync reads itself.
- **Gaps section:** the generated doc includes a consolidated **«Gaps y decisiones pendientes»** table (`GAP-NN`: affected item(s), type, description, what it blocks, required action/decision, suggested owner `Equipo NEW` / `Equipo LEGACY` / `Ambos`). It deduplicates per-item open questions (missing endpoints, undefined contracts, tables/relations to create, design decisions) into one actionable list for both teams. The prompt forbids inventing gaps — only those derived from evidence or the proven absence of a contract/endpoint in the NEW project context.
- **Prompt:** `apps/api/src/modules/ai/prompts/integration-agent-prompt.md`.
- **Manager hook (prepared):** `ai-analysis/utils/integration-intent.util.ts` (`detectLegacyIntegrationIntent`) — the MDD Manager suggests running the sync when it detects a legacy-integration message (it does not call the service inline, to avoid a circular module dependency).

## Helpers

- `integration-context.util.ts` — prompt blocks, `parseSatisfiesLinksFromUserStories`
- `promote-handoff.util.ts` — item selection for promote (unit-tested)
- `reconcile-handoff.util.ts` — resolve description from stage snapshot (unit-tested)
- `abandon-handoff.util.ts` — release items + pick stage to activate (unit-tested)

See `docs/plans/PLAN-INTEGRATION-AS-STAGE.md`.
