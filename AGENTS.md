# AGENTS.md — Ariadne Codebase Intelligence

You have access to **Ariadne MCP** — a knowledge graph of this codebase powered by FalkorDB. It knows every component, function, route, model, import, and prop contract. Use it **before** writing code, not after.

## First steps (every session)

```
list_known_projects()
```

This gives you project IDs, repo names, and branches. Use the `roots[].id` (repo ID) as `projectId` in multi-root projects, not the project UUID. If you're editing a file, pass `currentFilePath` instead — the server infers the project.

## Core workflow

```
1. list_known_projects() → get_sync_status(projectId)  [STOP if stale before large refactors]
2. semantic_search("what you're looking for") → find relevant code & Ego-Graphs
3. get_file_context(filePath) or get_file_content(path) → read the file
4. validate_before_edit(nodeName) → check impact + contract
5. Edit the code
6. detect_changes() → pre-commit blast radius check
```

## Planned change workflow (multi-file / refactors)

```
1. get_sync_status → resync if stale
2. Gate 1: get_modification_plan(userDescription) → filesToModify + changePlanTemplate
3. Build ChangePlan JSON (include referencePlan from Gate 1)
4. Gate 2: validate_change_plan → STOP if verdict === BLOCKED
5. Per symbol: validate_before_edit + get_references
6. Edit → detect_changes before commit
```

## Rules

1. **Always validate before editing** — `validate_before_edit` on the node you're about to touch. No exceptions.
2. **Resolve projectId early** — Cache it. Every tool that accepts `projectId` works better with it.
3. **Route to cheap tools** — If you know the symbol/path, use `get_file_content` / `get_definitions` / `get_references` instead of general chat.
4. **Live Local Sync** — The Ariadne daemon watches your local file changes automatically in real time without requiring commit/push.
