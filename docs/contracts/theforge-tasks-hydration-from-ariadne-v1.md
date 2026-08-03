# Contrato: hidratación Tasks desde Ariadne (v1)

Forge implementa este contrato en `packages/shared-types/src/hydrate-tasks-from-ariadne-pack.util.ts`.

## Handoff kinds (Ariadne → Forge)

| kind | Uso |
|------|-----|
| `integration_scope` | `mode`, `taskSource`, `taskSourceFallback`, `skipBaselineDeliverables` |
| `tasks_json_seed` | JSON `schemaVersion: "2"` + `tasks[]` con `id`, `title`, `files[]` |
| `cursor_tasks_markdown` | Markdown `# Tasks` con bloques YAML (fallback) |
| `requirement` | Ítems NEW-LEG checklist (no sustituyen SSOT tasks) |

## Persistencia Forge

- `Stage.tasksJson` / `Project.tasksJson` — SSOT estructurado
- `Stage.tasksContent` — markdown preview / fallback
- `Stage.legacyChangeState.tasksSource` — `ariadne_tasks_json_seed` \| `ariadne_cursor_tasks_markdown`
- `Stage.legacyChangeState.integrationHandoffTasks` — metadata import

## MCP / UI

- `get_tasks_json` → `hasTasksJson`, `ariadneTasksSource`
- `get_next_implementation_task` → primera task con `status !== "done"`
- Workshop Tasks (preview) → checkboxes desde `tasksJson`

## Flags

- `skipBaselineDeliverables` incluye `migration_tasks` → no recomendar `legacy_generate_deliverables` por defecto
- `shouldSkipLegacyTasksGeneration` — omitir LLM tasks en cascada legacy
