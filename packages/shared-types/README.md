# @theforge/shared-types

DTOs e interfaces compartidas (Zod).

## ⚠️ Build antes de tsc

Este paquete publica tipos en `dist/*.d.ts` (vía `package.json#types`). Las
apps (`@theforge/api`, `@theforge/web`, plugins) **leen tipos desde `dist/`,
no desde `src/`**. Si cambias un export en `src/` y no rebuild-eas, las apps
ven tipos stale y `tsc` emite falsos positivos:

```
error TS2305: Module '"@theforge/shared-types"' has no exported member 'X'.
```

**Cómo evitarlo:**

| Tarea | Comando |
|---|---|
| Build manual (rebuild `dist/` cuando toques `src/`) | `pnpm --filter @theforge/shared-types run build` |
| Antes de commit (ya lo hace el githook) | `pnpm setup:githooks` (una vez) |
| Verificar todo el repo | `pnpm typecheck` (turbo `^build` + `test:types`) |
| **Deployment** (Dokploy / Docker) | Automático — el `Dockerfile` corre `pnpm install` y `pnpm build` durante el build de imagen, así que en prod/staging nunca verás tipos stale. CI no enforza un typecheck adicional; la responsabilidad de rebuild local queda en el dev (githook + comando manual arriba). |

El githook `.githooks/pre-commit` detecta cambios en `apps/api/**` o
`packages/shared-types/**` y dispara `pnpm turbo run build --filter=...{./apps/api}`
automáticamente, que respeta el grafo `^build` de `turbo.json` y reconstruye
sólo lo necesario (turbo cache hit si no cambió nada).

- Status, ChecklistResult, **MddJson** (`mddConstitutionSchema`, `constitution` opcional; `.passthrough()` para campos extra).
- **`mdd-pipeline-limits.ts`:** constantes de tamaño (brief, plan, goals, aviso de pegado largo en Workshop).
- **`markdown-repair.ts`:** export también vía subpath `@theforge/shared-types/markdown-repair` (MddViewer / limpieza de fences).
- **`format-document-markdown.ts`:** `/formatear` + preview `MddViewer` — repara fences/tablas/Mermaid/infra. Antes de recortar el preámbulo (todo lo anterior al primer H1/H2) **preserva** la cabecera `Creado` / `Última regeneración` (`theforge-doc-stamp.ts`); sin eso el viewer ocultaba fecha y hora aunque estuvieran en la DB. **`repair-mdd-format.ts`:** reparaciones deterministas MDD P0–P2 (§2 ASCII en ` ```text `, §4 JSON paginación/claves/comas/fences anidados, §5 BDD, `---### GET`, fusión de diagramas partidos); orquestador `repairMddFormatIssues` invocado desde `repairPastedMarkdown` y `formatDocumentMarkdown`. **`detectTruncatedMddTail`** alimenta `collectMddQualityIssues` (delivery gate). **`repair-phase0-flow-format.ts`:** en Fase 0 §N Flujos convierte pasos mal emitidos como `## 1. …` a listas `1. …` y notas `### La cola…` a viñetas. **`repair-split-ordered-list-items.ts`:** fusiona marcadores `1.` / `1.1.` / `a.` en línea solitaria con el texto de la línea siguiente (sub-puntos DBGA/BRD/MDD). **`promote-list-item-fences.ts`:** promueve fences `` ```lang `` dentro de viñetas (p. ej. `- ```TechnicalMetadata`) a bloques de nivel raíz. **`repair-dbga-markdown.ts`:** DBGA/Fase 0 — doble H1, desenvelopa markdown en fences ` ```text ` erróneos, pseudo-tablas `| • |` / `| - 1. |`, `## 2.` huérfanos, secciones `4. Microservicios` / `3.6 …` / `4.1 …` sin `#`, viñetas `-**R5.1**`, diagramas con `- │` y headings duplicados.
- **`theforge-doc-stamp.ts`:** peel/reattach del stamp `<!-- theforge-doc:created|updated -->` + blockquote 📅; `peelDocumentBodyForPersist`, `extractCanonicalMddBody` y `repairInlineHorizontalRuleSectionBreaks` limpian stamps pegados/corruptos (incl. §1–§2 inline en la zona de fechas) antes de persistir o mostrar en Workshop. El **MDD** ya no se persiste con stamp de fechas (`storeMddMarkdownForPersist`); el peel sigue limpiando MDD legado sellado.
- **`repair-directory-tree.ts`:** árboles de directorios del Blueprint colapsados en una línea → bloque ` ```text ` multilínea (vía `repairPastedMarkdown`).
- createProjectSchema, updateProjectSchema, sessionResponseSchema, etc.
- `ComplexityLevelEnum` (`LOW` | `MEDIUM` | `HIGH`): política de adopción SDD y semáforo (campo `complexity` en proyecto).
- `orchestrator.ts`: `chatOrchestratorResponseSchema` (respuesta stream/orquestador; incluye `evaluatorCritique` opcional).
- **`legacy-codebase-doc.ts`:** `codebaseDocResponseModeSchema`, `generateCodebaseDocRequestSchema` (body `POST …/legacy/generate-codebase-doc`).
- **`doc-consumption-guide.ts`:** SSOT `buildTheforgeDocConsumptionGuide` (layout spec-kit dual) para handoff y gobernanza.
- **`project.ts`:** `updateProjectSchema` incluye `uxGuideDesignRef` (biblioteca visual Design System).
- **`document-layout.ts`:** mapa spec-kit ↔ `docs/sdd/` para gobernanza (MDD, Paso 0, Spec, Arq., casos, H.U., Blueprint, Design System, Pantallas, API, Flujos, Tasks, Infra, ADRs) + suplemento Workshop (BRD, AEM, Handoff Spec).
- **`ui-screens-export.ts`:** split `---UI_PROJECT_JSON---`, preview formateado (`formatPantallasMarkdownForPreview`) y export limpio de `pantallas.md`.
- **`spec-kit-bundle.ts`:** `buildSpecKitBundleFiles` — export layout compatible con github/spec-kit; tasks vía `resolveTasksForConsume` (SSOT `tasksJson` + fallback markdown).
- **`us-id-registry.ts`:** IDs estables `US-CRUD-*` / `US-JRN-*` (sin re-numerar por orden CrudMatrix).
- **`tasks-resolve.ts`:** `resolveTasksForConsume`, `hasValidTasksJson` — SSOT tasks para Workshop/spec-kit/MCP.
- **`deliverable-bundle.ts`:** `buildDeliverableBundleVersion` — versión atómica US+pantallas+API+tasks.
- **`integration-handoff-tasks.util.ts`:** `INTEGRATION_HANDOFF_SEED_EXCLUDE_KEYS`, `resolveIntegrationHandoffTasksMarkdown`, `shouldSkipLegacyTasksGeneration` — handoff NEW→LEG sin entregables fantasma del baseline.
- **`hydrate-tasks-from-ariadne-pack.util.ts`:** `validateTasksJsonV2`, `hydrateTasksFromAriadnePack`, `buildTasksPreviewMarkdownFromTasksJson` — SSOT tasks desde pack Ariadne (`tasks_json_seed` / markdown fallback).
- **`ariadne-change-pack.ts`:** change pack v1 + `handoffPlanType`, `cursorTasksMarkdown` (alias `cursor_tasks_markdown`).
- **`sdd-analyze.ts`:** tipos del reporte `GET /projects/:id/analyze`.
- **`readiness-audit.util.ts`:** semáforo compuesto, clasificación de gaps (auto/LLM/humano), plan de convergencia post-cascada.
- **`external-integration-registry.ts`:** registro extensible de integraciones externas (WebSocket, Banxico, Polygon, Stripe, RabbitMQ).
- **`mdd-cascade-delta.util.ts`:** delta de entregables tras cambio MDD (`pendingCascadeDelta` en etapa).
- **`mermaid.ts`:** normalización/reparación de diagramas (erDiagram PK/FK, **erDiagram BRD con viñetas/`###` dentro del fence**, atributos con tipo duplicado `string col string`, entidades `} foo {` en la misma línea, fences partidos, cabeceras duplicadas, flowchart `]text`/`]textGateway` y labels con espacios/acentos sin comillas, `subgraph ID["…"]`, secuencia sin cabecera, flechas/participantes, `resolveMermaidBlockForRender` para preview); `assessMermaidFixStrategy` prioriza reparación local si `validateMermaid` pasa tras el fix. Consumido por `normalizeMermaidInDocument`, `MarkdownMermaid` y `MddViewer`.
- **`sdd-integrations.ts`:** Zod `convergeBodySchema`, `tasksToIssuesBodySchema`.
- **`plugin.ts`:** `ArtifactTypeDefinition` (con `pluginId`, `generatable`, `requires`, `contentType`, `workshopPreview`), `PluginWorkshopPreviewProps`, `PluginArtifactContext`, `PluginArtifactResult`; job `plugin-artifact` en `project-generation-guard.ts` (incl. gate `project_busy`).
- **`workshop-fin-delimiter-covenant.ts`:** covenant LLM (`WORKSHOP_DBGA_EDIT_COVENANT`, `workshopFinDelimiterCovenant`) y mensajes al usuario cuando el panel del Workshop no persistió (sin mencionar `---FIN_*---` en la UI).
- **`system-config.ts`:** catálogo allowlist Ajustes → Sistema (`SYSTEM_CONFIG_CATEGORIES` con `description` por pestaña, `SYSTEM_CONFIG_DEFINITIONS` con texto de impacto por campo).
