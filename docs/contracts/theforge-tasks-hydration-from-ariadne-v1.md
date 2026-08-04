# Contrato: hidratación Tasks desde Ariadne (v1)

Forge implementa este contrato en `packages/shared-types/src/hydrate-tasks-from-ariadne-pack.util.ts`.

## Handoff kinds (Ariadne → Forge)

| kind | Uso |
|------|-----|
| `integration_scope` | `mode`, `taskSource`, `taskSourceFallback`, `skipBaselineDeliverables` |
| `tasks_json_seed` | JSON `schemaVersion: "2"` + `tasks[]` con `id`, `title`, `files[]` |
| `cursor_tasks_markdown` | Markdown `# Tasks` con bloques YAML (fallback) |
| `change_plan_seed` | ChangePlan v1.0 (Gate 2) → mapeo a tasksJson v2 |
| `requirement` | Ítems NEW-LEG checklist (no sustituyen SSOT tasks) |

## Persistencia Forge

- `Stage.tasksJson` / `Project.tasksJson` — SSOT estructurado (no `legacyChangeState.tasksJson`)
- `Stage.tasksContent` — markdown preview / fallback
- `Stage.legacyChangeState.tasksSource` — `ariadne_tasks_json_seed` \| `ariadne_cursor_tasks_markdown` \| `ariadne_change_plan_seed`
- `Stage.legacyChangeState.integrationHandoffTasks` — metadata import (`idempotencyKey`, `packGeneratedAt`, `validationWarnings`)
- `Stage.legacyChangeState.skipBaselineDeliverables` — lista persistida desde `integration_scope`

## Algoritmo

1. `tasks_json_seed` (validado con `source: "ariadne"` + `projectId` UUID)
2. Fallback `cursor_tasks_markdown` → `parseAriadneCursorTasksMarkdown`
3. Fallback `change_plan_seed` → `mapChangePlanSeedToTasksJsonPayload`
4. Re-import: `mergeTasksJsonIdempotent` por task `id`; noop si mismo `idempotencyKey` + `generatedAt` no más reciente (salvo `forceTasksRefresh`)

## Validación Gate 2 (warn-only)

`POST /projects/:projectId/validate-tasks-json` vía `ariadne-validate-tasks-json.util.ts` cuando Ariadne API está configurada.

## Cascada legacy

`resolveLegacyCascadeSkipKindsFromStage` mapea `skipBaselineDeliverables`:

| Ariadne | Forge kind |
|---------|------------|
| `migration_tasks` | `tasks` |
| `change_spec` | `spec` |
| `data_model` | `architecture`, `blueprint` |
| `mdd_full` | `mdd_canonical` |

## MCP / UI

- `get_tasks_json` → `hasTasksJson`, `ariadneTasksSource`
- `get_next_implementation_task` → primera task con `status !== "done"`
- Workshop Tasks (preview) → checkboxes desde `tasksJson`
- IntegrationPanel → badges por `kind`, preview markdown, botón **Ver tareas**

## recommendedNextTools (integration_handoff + tasks hidratadas)

`legacy_answer` (si hay preguntas) → `get_tasks_json` → `get_next_implementation_task` — sin `legacy_generate_deliverables` cuando `skipBaselineDeliverables` incluye `migration_tasks`.
