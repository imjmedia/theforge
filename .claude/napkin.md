# Napkin Runbook

## Curation Rules
- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Domain Behavior Guardrails
1. **[2026-08-03] API conformance — extras §4 → repair determinista antes de retry LLM**
   Do instead: `repairApiProgrammaticGaps` antes del quality gate en `generateApiContracts`; `MAX_API_QUALITY_RETRIES=1` + persist fallback; log `[API] Contratos API completados`; no segundo LLM ~7min solo por `extraInApi`.

2. **[2026-08-03] Blueprint quality gate — separador GFM | :----- | no es “falta |---|”**
   Do instead: `contentHasMarkdownTableSeparator` (línea a línea); `repairMarkdownTableSeparators` antes del quality gate; no retry LLM solo por tablaApi si repair basta; log incluye `tablaApi`.

2. **[2026-07-28] KMS jobs 73/74 — corrupción MDD = bugs código pipeline (no sanitizers markdown)**
   Do instead: `shouldContinueDeliveryGateQualityLoop` false si `gate.ok && blockers===0` (quality loop truncaba §4); gate dupe/§6/§7→`integration` no `data_model`; `preserveValidatedSectionsIfSubstantial` no aborta en §1 (sigue §2–§7); snapshots `securityArchitectMddDraftSnapshot`/`integrationSectionMd` + `preserveTailSectionsFromSnapshots`; merge §4/§5 regression ratio ≥0.75; Clarifier `isSafeClarifierMergeBaseline` (no bloat/dupes); stack dedupe→`preserveSection2FromStackSnapshot`; `deduplicateAndReorderMddSections` trunca §2 embebida (no placeholder); `getSection6Or7Range` `(?!#)`; gate loop `deliveryGateLoopActive`→short-circuit `prepare_output`; `data_model_patch` stopwords ES + `isUsableDataModelPatchSql`. **No** reparar JSON fences/glue/BRD inline — regen/modelo.

3. **[2026-07-27] MDD perf F0–F6 — métricas, scoped context, grafo paralelo**
   Do instead: `logMddLlmMetrics` en nodos LLM; `buildArchitectScopedContext` + `softwareArchitectMddPrompt(scope)`; tras critic OK → `post_critic_parallel` (§4∥§6∥§7) + `mergePostCriticParallelResults`; §4 chunks (`mdd-api-contracts-chunk`); gap tablas → `data_model_patch`; `invokeScopedArchitectLlmWithHeadingCap`; `resolveMddArchitectScopeMaxTokens` por scope; skip `tail_parallel` si `postCriticParallelDone`.

4. **[2026-07-27] F5 off-graph memo — gate + coherencia por fingerprint**
   Do instead: `validateMddForDeliveryMemo` + `MddCoherenceService` memo TTL (`mddGraphFingerprint`); poll job MDD 5s (`pollMddJob` default); throttle log `[MddCoherence] state=stale` 60s.

5. **[2026-07-27] Clarifier perf — DBGA brief + scope enrich**
   Do instead: `buildClarifierDbgaBrief` (narrative H2s + señales estructurales, ≤8k); inventario `domainInventoryPromptBlock` max 4800; `enrichClarifiedScopeFromInventory` post-LLM; prohibido `[ARQUITECTURA - SECCIÓN INMUTABLE]` (`stripClarifierGovernanceFromDraft`); log `durationMs promptChars dbgaBriefChars`.

6. **[2026-07-27] upstream-sync §1 = regen sección (sintetizador), no Clarifier**
   Do instead: `streamMddUpstreamSync` llama `streamMddRegenerateSection` por cada §N; §1 usa `CONTEXT_SYNTHESIZER` + `mdd-section1-regen.util`; UI: tras fallo MDD reponer `error` porque `fetchProject` pone `error:null`.

7. **[2026-07-24] Post-MDD frozen: hide chat column + edit toggle**
   Do instead: `ssotFrozenPanel` → `chatColumn={null}`; hide mobile Chat + «Mostrar conversación»; `deliverablesReadOnly` → `docEditToolbarToggle=null`; no Spec «Aclarar».

8. **[2026-07-24] MDD validado = sección bloqueada; gate > Auditor**
   Do instead: `preserveValidatedSectionsIfSubstantial` tras Cross/Diagram/Formatter/prepare_output; freeze por fase (stack→§2, data_model+critic→§3, api_contracts→§4, TailParallel→§5–§7); gate §5-only → `section5`; Auditor score-only — nunca `deliveryGateFixTarget` desde gaps LLM.

9. **[2026-07-24] HIGH scoped merge baseline = draft actual**
   Do instead: `resolveArchitectMergeBaseline` → `draftTrimmed` en `stack`/`data_model`/`api_contracts`; log `mergeBaseline source=`; `processScopedArchitectResponse` + retry si MDD completo.

10. **[2026-07-24] Contaminación plataforma TheForge en dominios ajenos (KMS)**
    Do instead: `stripUnjustifiedPlatformTablesFromMdd` en SSOT repair; journey `/tenants/{id}/quota` solo si BRD menciona quota; `mddExcludesWebUiSurface` → skip UI/UX enrich; §1 `stripBrdPasteNoiseFromSection1` tras Clarifier.

## Execution & Validation
1. **[2026-07-24] DeliveryGate score≠ok cuando blockers>0**
   Do instead: treat `blockers.length` as source of truth; §1 substance min 200 chars in gate and regen guard.

2. **[2026-07-28] Gate ok + 0 blockers → sin LLM quality loop; guards sustantivos only**
   Do instead: `shouldContinueDeliveryGateQualityLoop` false si `gate.ok && blockers.length===0`; `isSection5SectionRegression` / `isContratosSectionRegression` ratio ≥0.75; `preserveValidatedSectionsIfSubstantial` + snapshots §6/§7; `hydrateEmptyManifestStackInDraft`; **no** reparaciones markdown/cosméticas (JSON fences, heading glue, BRD inline strip, `/api/v1/v1`, dockerfile fence) — regen/modelo.

3. **[2026-07-27] MDD perf specs = node:test (no vitest)**
   Do instead: nuevos `*.spec.ts` en `apps/api` usan `node:test` + `node:assert`; `pnpm test -- --test-path-pattern=…` vía `scripts/run-tests.mjs`.

4. **[2026-07-27] SecurityArchitectureAudit: 1-shot ≤100k + fill catálogo server-side**
   Do instead: KMS ~79k = 1-shot; `finalizeSecurityArchitectureStructured` rellena IDs omitidos en `no_evaluado`; veredicto solo por severidad hallazgos; gate cobertura post-fill (88/88).

5. **[2026-07-24] TokenUsage table missing (migración en carpeta equivocada)**
   Do instead: migración canónica `packages/database/migrations/20260724_add_token_usage/`; `pnpm run db:migrate` desde raíz.
