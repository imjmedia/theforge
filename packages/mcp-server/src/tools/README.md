# tools/

Registro modular de herramientas MCP (Fase 6 — GOD-REFACTOR).

| Archivo | Rol |
| ------- | --- |
| **index.ts** | `buildMcpTools()` + `buildMcpHandlers(api)` — compone dominios + project-group + project-stage. |
| **project.tools.ts** | CRUD proyecto, entregables, conformidad, audit; incluye spreads de `PROJECT_STAGE_TOOLS` y `PROJECT_GROUP_TOOLS`. |
| **generation.tools.ts** | Generación de entregables (spec, blueprint, gobernanza IA, phase0, …). |
| **analysis.tools.ts** | Análisis IA, estimación, MDD thread, ADRs, review. |
| **orchestrator.tools.ts** | Chat orquestador y sesiones. |
| **legacy.tools.ts** | Flujo legacy (entrevista, MDD, codebase doc, transiciones). |
| **integration.tools.ts** | Ariadne, merge, AEM, tasks/spec-kit, change log, `get_integration_status` / `get_integration_traces`. |
| **markdown.tools.ts** | Tablas y diagramas Mermaid (utilidades shared-types). |

Infra compartida en el padre: `mcp-api-client.ts`, `mcp-client-context.ts`, `mcp-governance.util.ts`, `mcp-ssot.util.ts` (SSOT tasks + `deliverableBundleVersion`), `mcp-tool.types.ts`.

`project-group-tools.ts` y `project-stage-tools.ts` viven en `src/` (pre-Fase 6); sus handlers se fusionan en `buildMcpHandlers`.

`index.ts` (bootstrap) solo transporte JSON-RPC y auth; no define tools inline.
