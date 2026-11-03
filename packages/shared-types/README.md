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
- **`format-document-markdown.ts`:** `/formatear` + preview `MddViewer` — repara fences/tablas/Mermaid/infra. Antes de recortar el preámbulo (todo lo anterior al primer H1/H2) **preserva** la cabecera `Creado` / `Última regeneración` (`theforge-doc-stamp.ts`); sin eso el viewer ocultaba fecha y hora aunque estuvieran en la DB. Con `mermaid: "preserve"` (usado por `MddViewer`) los fences ` ```mermaid ` de nivel raíz se extraen antes de cualquier reparación y se restituyen byte a byte; `onMermaidReinserted` avisa si un marcador desapareció. **`repair-mdd-format.ts`:** reparaciones deterministas MDD P0–P2 (§2 ASCII en ` ```text `, §4 JSON paginación/claves/comas/fences anidados, §5 BDD, `---### GET`, fusión de diagramas partidos); orquestador `repairMddFormatIssues` invocado desde `repairPastedMarkdown` y `formatDocumentMarkdown`. **`detectTruncatedMddTail`** alimenta `collectMddQualityIssues` (delivery gate). **`repair-phase0-flow-format.ts`:** en Fase 0 §N Flujos convierte pasos mal emitidos como `## 1. …` a listas `1. …` y notas `### La cola…` a viñetas. **`repair-split-ordered-list-items.ts`:** fusiona marcadores `1.` / `1.1.` / `a.` en línea solitaria con el texto de la línea siguiente (sub-puntos DBGA/BRD/MDD). **`promote-list-item-fences.ts`:** promueve fences `` ```lang `` dentro de viñetas (p. ej. `- ```TechnicalMetadata`) a bloques de nivel raíz. **`repair-dbga-markdown.ts`:** DBGA/Fase 0 — doble H1, desenvelopa markdown en fences ` ```text ` erróneos, pseudo-tablas `| • |` / `| - 1. |`, `## 2.` huérfanos, secciones `4. Microservicios` / `3.6 …` / `4.1 …` sin `#`, viñetas `-**R5.1**`, diagramas con `- │` y headings duplicados.
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
- **`hydrate-tasks-from-ariadne-pack.util.ts`:** `validateTasksJsonV2`, `hydrateTasksFromAriadnePack`, `buildTasksPreviewMarkdownFromTasksJson` — SSOT tasks desde pack Ariadne.
- **`parse-ariadne-cursor-tasks-markdown.util.ts`**, **`change-plan-seed-to-tasks-json.util.ts`**, **`merge-tasks-json-idempotent.util.ts`**, **`skip-baseline-deliverables.util.ts`** — parsers, idempotencia y skip cascada.
- **`ariadne-change-pack.ts`:** change pack v1 + `handoffPlanType`, `cursorTasksMarkdown` (alias `cursor_tasks_markdown`).
- **`sdd-analyze.ts`:** tipos del reporte `GET /projects/:id/analyze`.
- **`readiness-audit.util.ts`:** semáforo compuesto, clasificación de gaps (auto/LLM/humano), plan de convergencia post-cascada.
- **`external-integration-registry.ts`:** registro extensible de integraciones externas (WebSocket, Banxico, Polygon, Stripe, RabbitMQ).
- **`mdd-cascade-delta.util.ts`:** delta de entregables tras cambio MDD (`pendingCascadeDelta` en etapa).
- **`mermaid.ts`:** normalización/reparación de diagramas (erDiagram PK/FK, **erDiagram BRD con viñetas/`###` dentro del fence**, atributos con tipo duplicado `string col string`, entidades `} foo {` en la misma línea, fences partidos, cabeceras duplicadas, flowchart `]text`/`]textGateway` y labels con espacios/acentos sin comillas, `subgraph ID["…"]`, secuencia sin cabecera, flechas/participantes, `resolveMermaidBlockForRender` para preview); `assessMermaidFixStrategy` sigue exportada, pero el render web ya no la usa (sale en F3). `normalizeMermaidInDocument` repara la estructura de los fences y nunca degrada uno a prosa; lo consume `formatDocumentMarkdown` en modo `normalize`. La web usa `resolveMermaidBlockForRender` en `proposeExtendedMermaidRepairs` (`mermaid-render-prep.util.ts`).
- **Registro de reglas de Mermaid (`mermaid.ts`, lote 2b):** `normalizeMermaidDiagramBody(raw, options?)` aplica en orden las reglas de `MERMAID_BODY_RULES`, cada una con nombre estable. `options.disabledRules` salta reglas por nombre (`listMermaidBodyRuleNames()` las lista); las reglas estructurales (preámbulo, cabecera, trim) no se pueden deshabilitar. Medición por ablación y decisiones en ADR 0002, addendum.
- **`token-usage-api.ts` (lote 2b):** contrato compartido de `GET /ai-analysis/token-usage` (`TokenUsageSummary`, `TokenUsageDocumentSummary`, `TokenUsageModelSummary`). Los contadores `failedCalls`, `estimatedCalls` y `costUnknown` son opcionales para no romper clientes anteriores.
- **`mdd-eval-api.ts`:** `auditorOutcomeSchema` / `AuditorOutcome` (`scored` | `unavailable`). `unavailable` significa «sin nota», nunca 0.

- **Lote 2 de calidad del MDD (ADR 0002):** `mermaid.ts` ya no sustituye un flowchart válido por un webhook inventado; se eliminaron `looksLikeJsonFlattenFlowchart`, `webhookSyncFlowchartBody` y `repairFlattenedWebhookFlowchart`, y el módulo `repair-flow-sections.ts` (`repairFlowSectionsToMermaid`). Salieron también las reglas de cliente (Odoo, OBP4MO, tablas espejo, títulos fijos, prosa filtrada) de `repair-pasted-markdown.ts`, `repair-collapsed-sql.ts` y `mermaid.ts`. Exports nuevos: `auditorOutcomeSchema` / `AuditorOutcome` (`mdd-eval-api.ts`, con `unavailable` = sin nota) y `MDD_TOP_SECTION_TITLE` (`repair-glued-headings.ts`), ambos vía barril. Exports retirados de `mermaid.ts` por no tener consumidores (ADR 0002, addendum): `normalizeErDiagramPgTypes`, `repairSequenceArrowParties` y `normalizeSequenceActivationOrder` y `erDiagramHasPkFkComma` (esta última se quitó porque `PK, FK` válido ya no se rechaza).
- **`mermaid-oracle.ts`** (subpath `@theforge/shared-types/mermaid-oracle`): regla de oro de Mermaid, pura y **sin dependencia de `mermaid`** (el parser se inyecta). Si el original parsea no se toca; solo se repara lo que el parser rechaza y una reparación se acepta únicamente si parsea; con el parser caído el resultado es `unverified`, nunca inválido. API: tipos `MermaidParseResult` (`ok` | `invalid` | `unavailable`), `MermaidParser`, `MermaidResolution` (`original` | `repaired` | `invalid` | `unverified`); `proposeMermaidRepairs(body)` (candidatos deduplicados; en F3 se dividirá en reglas con nombre); `resolveMermaidWithOracle(body, parse, { maxAttempts, signal, propose })` y `resolveMermaidBlocksInDocument(markdown, parse, opts)` (async; solo sustituye los bloques `repaired` y respeta fences de otros lenguajes). La web inyecta `mermaid.parse` del navegador; la API solo tiene parser en pruebas (`apps/api/src/modules/mermaid-oracle/`, la Fase 2 lo lleva a runtime). Pruebas: `mermaid-oracle.spec.ts` con parser falso.
- **`markdown-table.ts`** (subpath `./markdown-table`): `scanFenceRanges` y `fencedLineMask` localizan fences de código con reglas CommonMark; las reparaciones de tablas no tocan líneas dentro de fences. En `mermaid.ts` se exportan además `isMermaidDiagramHeaderLine`, `splitMermaidPreamble` y `startsWithMermaidDiagramHeader`: la lista única de cabeceras y el preámbulo (front-matter y `%%{init}%%`) que ninguna reparación debe tocar.
- **`sdd-integrations.ts`:** Zod `convergeBodySchema`, `tasksToIssuesBodySchema`.
- **`plugin.ts`:** `ArtifactTypeDefinition` (con `pluginId`, `generatable`, `requires`, `contentType`, `workshopPreview`), `PluginWorkshopPreviewProps`, `PluginArtifactContext`, `PluginArtifactResult`; job `plugin-artifact` en `project-generation-guard.ts` (incl. gate `project_busy`).
- **`workshop-fin-delimiter-covenant.ts`:** covenant LLM (`WORKSHOP_DBGA_EDIT_COVENANT`, `workshopFinDelimiterCovenant`) y mensajes al usuario cuando el panel del Workshop no persistió (sin mencionar `---FIN_*---` en la UI).
- **`system-config.ts`:** catálogo allowlist Ajustes → Sistema (`SYSTEM_CONFIG_CATEGORIES` con `description` por pestaña, `SYSTEM_CONFIG_DEFINITIONS` con texto de impacto por campo).
- **Pruebas:** `pnpm --filter @theforge/shared-types test` corre todos los `src/**/*.spec.ts` con `node:test` + `tsx` (`scripts/run-tests.mjs` descubre los archivos sin globs del shell); filtra con `pnpm --filter @theforge/shared-types test -- --test-path-pattern=mermaid`. Fallos conocidos fuera de Mermaid, ya presentes en `HEAD`: `ariadne-tasks-hydration-gap.spec.ts`, `project-integration.spec.ts`, `readiness-audit.util.spec.ts` y `repair-dbga-fences.spec.ts`.
