---
name: ariadne
description: Ariadne FalkorDB knowledge graph governance, 2-gate refactor workflow, impact analysis, and TypeScript prop contracts. Use before writing, modifying, or refactoring code.
---

# Ariadne Codebase Intelligence

Use this skill whenever you explore architecture, plan changes, or modify code in this codebase.

## Quick Reference Tools
- `list_known_projects()`: Discover indexed projects and repository IDs.
- `semantic_search(query)`: Vector + lexical search with 1-hop Ego-Graphs.
- `get_file_context(filePath)`: File content + imports + exports.
- `get_modification_plan(userDescription)`: Gate 1 planning (files to modify + business questions).
- `validate_change_plan(plan)`: Gate 2 audit before multi-file edits.
- `validate_before_edit(nodeName)`: Mandatory contract check before editing any symbol.
- `detect_changes()`: Pre-commit blast radius inspection.
