# mdd-sanitize (extracción modular)

Submódulos extraídos de `../mdd-sanitize.ts` durante el refactor GOD-REFACTOR (Fase 1+).

| Archivo | Export público | Notas |
|---------|----------------|-------|
| `json-section-to-markdown.ts` | `jsonSectionToMarkdown` | JSON de sección → markdown; `subsectionsToMarkdown` reutilizado por el barrel |
| `section-body.util.ts` | — (interno) | `extractMddSectionBody` compartido entre submódulos |
| `security-manifest.ts` | `draftUsesLdapPrimaryAuth` (re-export barrel) | `fixSecurityManifestCoherence`, `fixIntegrationMetadataCoherence` |
| `sql-repair.ts` | 7 exports (re-export barrel) | Sanitización/reparación SQL en bloques ```sql del MDD |
| `section-merge.ts` | ~35 exports (re-export barrel) | Merge/preserve/restore §1–§7, dedupe, validateMddStructure |
| `brace.util.ts` | — (interno) | `findBalancedBrace`, `findBalancedBraceRespectingStrings` |
| `mermaid-fences.ts` | 5 exports (re-export barrel) | Fences mermaid: strip, fix doble fence, unescape, §3 repair |
| `persist-format.util.ts` | 3 exports (re-export barrel) | HR/fences del pipeline de persist: `closeUnclosedCodeFencesInDraft`, `collapseConsecutiveHorizontalRules`, `stripStrayParenAfterJsonCodeBlocks` |
| `persist-pipeline.ts` | 11 exports (re-export barrel) | `prepare/store/sanitize` at persist, `normalizeMddFormat`, `finalizeMddDeliverable`, `applyPreDeliveryGateFixes` |
| `cross-consistency.ts` | ~25 exports (re-export barrel) | Coherencia cruzada §1–§7: JWT, outbox, dual approval, lockout, patches LLM, detect* |
| `contratos-format.ts` | §4 Contratos + `isContratosSubstantial` / `isContratosPlaceholder` (gate + Architect) | JSON repair, tablas, `ensureContratosSection`, sustancia de endpoints |
| `draft-normalize.ts` | 13 exports (re-export barrel) | Contexto, §6/§7 JSON→MD, headings canónicos, limpieza artefactos LLM |
| `infra-manifest.ts` | 6 exports (re-export barrel) | Detección infra en texto, manifest §7, sanitize AWS genérico |
| `section-structured.ts` | 5 exports (re-export barrel) | §6/§7 structured→MD, `parseModeloDatosFromSection3Markdown`, `objectSectionToMarkdown` |
| `internal.ts` | resto de exports vía barrel (~665 L) | §2/§3 SQL helpers, §2–§5 range, UI surface, `logMddNodeOutput` |

El entrypoint estable para consumidores sigue siendo `../mdd-sanitize.ts` (re-exports).

**Exports públicos de `sql-repair.ts`:** `sanitizeSqlBrokenCommentsAndProse`, `stripIndexesOnCommentedSqlColumns`, `repairSqlProseInTableBodies`, `repairSqlDetachedCheckConstraints`, `sanitizeAllSqlBlocksInDraft`, `formatSqlBlockWithNewlines`, `detectUnclosedSqlFences`, `repairSqlSpacedColumnIdentifiers`, `stripMonthlyPartitionStubTables`, `repairSection3SqlFenceBeforeJsonBlock`.

**Exports principales de `section-merge.ts`:** `mergeSection1IntoDraft`, `preserveUntouchedMddSectionsFromBaseline`, `restoreMddSectionsFromBaselineStrict`, `deduplicateAndReorderMddSections`, `deduplicateMddDraftSections`, `stripTrailingDuplicateMddSections` (trunca cola §4–§7 duplicada con o sin §7 completa), `validateMddStructure`, `getSection6Or7Range`, `replaceSection6Or7InDraft`, `mergeSingleArchitectSectionIntoDraft` (regen §2/§3/§4 quirúrgica; §4 anti-regresión).

**Exports de `mermaid-fences.ts`:** `stripMermaidFences`, `fixDoubleMermaidFences`, `unescapeMermaidLiteralNewlines`, `fixSection2UnclosedSqlAndGluedMermaid`.

**Exports de `persist-pipeline.ts`:** `sanitizeMddAtPersist`, `prepareMddMarkdownForPersist`, `storeMddMarkdownForPersist`, `sanitizeMddForExport`, `normalizeMddFormat`, `finalizeMddDeliverable`, `applyPreDeliveryGateFixes`, `repairGarbageHeadings`, `repairManifestJsonClosing`, `demoteProseHeadingsInSections`, `stripUiUxSectionForApiOnlyMvp`. `prepareMddMarkdownForPersist` deduplica §1–§7 vía `deduplicateMddDraftSections` y aplica `repairMddFormatIssues` (`@theforge/shared-types/repair-mdd-format`) antes del cierre. `normalizeMddFormat` deduplica al inicio con `deduplicateMddDraftSections` y formatea **todas** las ocurrencias de §4 con `formatAllContratosSectionsInDraft`.

**Exports principales de `cross-consistency.ts`:** `applyDeterministicCrossConsistencyFixes`, `detectCrossConsistencyIssues`, `applyCrossConsistencyPatches`, `fixDeterministicMddCoherence`, `ensureSecurityLockoutInSection6`, `fixDualApprovalSchemaInDraft`, `detectDuplicateOutboxTables`, `draftUsesRs256Jwt`.

**Exports de `contratos-format.ts`:** `repairNestedJsonFencesInDraft`, `repairDisplacedJsonBracesInContratos`, `formatContratosBody`, `formatAllContratosSectionsInDraft`, `normalizeContratosTableSummary`, `ensureContratosSection`, `isContratosSubstantial`, `isContratosPlaceholder`, `isContratosSectionRegression`, `countContratosEndpointRows`, `extractContratosSectionBody`, `MIN_CONTRATOS_LENGTH`.

**Exports de `draft-normalize.ts`:** `sanitizeContextSection`, `sanitizeSeguridadIntegracionRawJson`, `normalizeMddEnglishSubheadings`, `CANONICAL_HEADINGS`, `stripMeshDirectivesFromDraft`, `forceStripBrokenPrefix`, `unescapeLiteralNewlines`.

**Exports de `infra-manifest.ts`:** `extractIdentifiedInfraFromText`, `extractAlreadyDocumentedTopics`, `buildManifestFromIdentifiedInfra`, `buildNewFormatManifestFromIdentifiedTerms`, `sanitizeManifestToMatchIdentifiedInfra`, `replaceAwsProseWithGenericWhenInfraNotAws`.

**Exports de `section-structured.ts`:** `seguridadItemsToSection6Markdown`, `integracionToSection7Markdown`, `parseModeloDatosFromSection3Markdown`, `normalizeTablesToRecord`, `objectSectionToMarkdown`.
