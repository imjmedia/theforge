# CLAUDE.md — Ariadne Codebase Intelligence

You are paired with **Ariadne MCP** — a FalkorDB-backed knowledge graph of this codebase tracking components, functions, routes, models, imports, and TypeScript prop contracts.

## First Step Every Session
```
list_known_projects()
```
Use the `roots[].id` as `projectId` in multi-root monorepos, or pass `currentFilePath` to let the server infer it.

## Core 2-Gate Workflow
1. `get_sync_status(projectId)` → Check if the graph is up-to-date.
2. **Gate 1**: `get_modification_plan(userDescription)` → Yields exact `filesToModify` and `questionsToRefine`.
3. **Code Inspection**: Read the relevant local files from `filesToModify`.
4. **Gate 2**: `validate_change_plan(changePlanJson)` → Mandatory before editing code. STOP if `BLOCKED`.
5. **Per Symbol**: `validate_before_edit(nodeName)` → Check impact and prop contracts before touching any function/component.
6. **Pre-Commit**: `detect_changes()` → Verify blast radius before committing.
