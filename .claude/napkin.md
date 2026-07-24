# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Domain Behavior Guardrails
1. **[2026-07-24] Post-MDD frozen: hide chat column + edit toggle**
   Do instead: `ssotFrozenPanel` → `chatColumn={null}`; hide mobile Chat + «Mostrar conversación»; `deliverablesReadOnly` → `docEditToolbarToggle=null` + no mobile preview/source pencil; no Spec «Aclarar».

2. **[2026-07-24] MDD validado = sección bloqueada; gate > Auditor**
   Do instead: `preserveValidatedSectionsIfSubstantial` (§2–§7) tras Cross/Diagram/Formatter/prepare_output y post-merge Arquitecto (`preserveNonTargetValidatedSectionsAfterArchitectMerge` excluye §N objetivo); freeze: stack OK→§2, data_model+critic OK→§3, api_contracts OK→§4, TailParallel→§5–§7; gate §5-only → `section5` vía `resolveDeliveryGateFixTargetFromGate`; Auditor **score-only** — **nunca** `deliveryGateFixTarget` desde gaps LLM; Clarifier refinamiento → `mergeSection1IntoDraft`; cola MDD: 1 activo/proyecto + cancelar siblings en `waiting`.

3. **[2026-07-24] HIGH scoped merge baseline = draft actual (no Clarifier stale)**
   Do instead: `resolveArchitectMergeBaseline` → `draftTrimmed` en `stack`/`data_model`/`api_contracts`; `previousMddDraftForMerge` solo si `executorControlled` o `delegateTarget` sections/clarifier_only; log `mergeBaseline source=`.

4. **[2026-07-24] MDD HIGH scoped architect — merge no-op silencioso**
   Do instead: pasadas `stack`/`data_model`/`api_contracts` piden **solo cuerpo §N**; `processScopedArchitectResponse` extrae §N si LLM devuelve MDD completo (WARN log); merge antes de helpers full-doc; `tryMerge` → `merged=false` + 1 reintento «PROHIBIDO MDD completo»; stream live draft: `resolveLiveDraftForScopedArchitectStream`.

5. **[2026-07-24] Logs `getMddDraftSummary`**
   Do instead: usar campo `section3` (sql|placeholder|empty); `section2` es alias deprecated — no loguear §3 como section2.

6. **[2026-07-24] Contaminación plataforma TheForge en dominios ajenos (KMS)**
   Do instead: `stripUnjustifiedPlatformTablesFromMdd` en SSOT repair (incl. `tenants` si BRD excluye multi-tenant SaaS); journey `/tenants/{id}/quota` solo si BRD menciona quota LLM; `mddExcludesWebUiSurface` / `corpusExcludesDashboardWeb` → skip UI/UX enrich y nota diagrama componentes; `get_project_tables` filtra chat/MCP salvo `tableNames` explícito; §1 `stripBrdPasteNoiseFromSection1` tras Clarifier.

7. **[2026-07-24] §2–§7 wipe post-proceso mecánico (extract sin fences + baseline prepare)**
   Do instead: `getSectionBody`/`replaceH2SectionBody` usan `indexOfNextH2OutsideFenced`; `preserveValidatedSectionsIfSubstantial` restaura si baseline sustancial y actual insustancial (<50% len o placeholder); baseline prepare = `input.mddDraft`; `guardValidatedSectionsForPersist` en DiagramInjector/prepare/PersistCheck; abort persist si §2–§7 siguen insustanciales tras guard.

8. **[2026-07-24] Auditor LLM vacío con tokens (tool_calls-only)**
   Do instead: `extractLlmToolCalls` + `acceptToolCallsWithoutContent` en `invokeLlmWithRetry`; mid-loop Auditor OK si hay tool_calls; reintento si content vacío sin tools (máx 2); fallback determinístico si sigue vacío.

9. **[2026-07-24] Modelo MDD no fiable antes del pipeline**
   Do instead: `resolveMddRuntimeWithPreflight` en `streamMddAnalysis` / manager / resume; sonda JSON `{"ok":true,"probe":"mdd"}` o tool_calls; reordenar cadena al primer modelo que pase; abortar con `ModelsUnavailableError` (español) si ninguno.

10. **[2026-07-24] Regen/sync §1: prepare puede partir cuerpo (bare `2. Arquitectura`→##)**
    Do instead: `demoteCanonicalSectionHeadingsInSection1Body`; post-prepare reinyectar si §1 <200; abort sin persist si sigue vacío; `findSection1HeadingSpan` case-insensitive.

## Execution & Validation
1. **[2026-07-24] DeliveryGate score≠ok cuando blockers>0**
   Do instead: treat `blockers.length` as source of truth; §1 substance min 200 chars in gate and regen guard.

2. **[2026-07-24] TokenUsage table missing (migración en carpeta equivocada)**
   Do instead: migración canónica `packages/database/migrations/20260724_add_token_usage/` (no `prisma/migrations/`); `pnpm run db:migrate` desde raíz; `TokenUsageService` ya WARN si falla persistencia.
