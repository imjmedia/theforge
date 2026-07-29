/**
 * @fileoverview Barrel de sanitización MDD — re-exporta submodulos.
 */

/** Barrel estable: re-exports de submódulos + implementación restante en internal. */
export * from "./mdd-sanitize/internal.js";
export * from "./mdd-sanitize/cross-consistency.js";
export {
  CANONICAL_HEADINGS,
  collapseDuplicateMainTitle,
  forceStripBrokenPrefix,
  normalizeMddEnglishSubheadings,
  sanitizeContextKeyValueAndObject,
  sanitizeContextSection,
  sanitizeSeguridadIntegracionRawJson,
  stripBrokenMetadataDocumentBlock,
  stripInstructionAndFeedbackBlocks,
  stripMeshDirectivesFromDraft,
  stripUserResponsesAndConversationHistory,
  unbulletAndJoinForJson,
  unescapeLiteralNewlines,
} from "./mdd-sanitize/draft-normalize.js";
export {
  CONTRATOS_HAS_ENDPOINTS,
  CONTRATOS_IS_PLACEHOLDER,
  ensureContratosSection,
  extractContratosSectionBody,
  formatContratosBody,
  isContratosPlaceholder,
  isContratosSectionRegression,
  isContratosSubstantial,
  countContratosEndpointRows,
  MIN_CONTRATOS_LENGTH,
  normalizeContratosTableSummary,
  repairDisplacedJsonBracesInContratos,
  repairNestedJsonFencesInDraft,
  stripLeadingContratosPlaceholder,
} from "./mdd-sanitize/contratos-format.js";
export {
  buildManifestFromIdentifiedInfra,
  buildNewFormatManifestFromIdentifiedTerms,
  extractAlreadyDocumentedTopics,
  extractIdentifiedInfraFromText,
  hydrateEmptyManifestStackInDraft,
  replaceAwsProseWithGenericWhenInfraNotAws,
  sanitizeManifestToMatchIdentifiedInfra,
} from "./mdd-sanitize/infra-manifest.js";
export {
  integracionToSection7Markdown,
  normalizeTablesToRecord,
  objectSectionToMarkdown,
  parseModeloDatosFromSection3Markdown,
  seguridadItemsToSection6Markdown,
} from "./mdd-sanitize/section-structured.js";
export { jsonSectionToMarkdown } from "./mdd-sanitize/json-section-to-markdown.js";
export { draftUsesLdapPrimaryAuth } from "./mdd-sanitize/security-manifest.js";
export {
  detectUnclosedSqlFences,
  formatSqlBlockWithNewlines,
  repairSqlDetachedCheckConstraints,
  repairSqlProseInTableBodies,
  repairSqlSpacedColumnIdentifiers,
  sanitizeAllSqlBlocksInDraft,
  sanitizeSqlBrokenCommentsAndProse,
  stripIndexesOnCommentedSqlColumns,
  stripMonthlyPartitionStubTables,
} from "./mdd-sanitize/sql-repair.js";
export type { ValidateMddStructureResult, MergeSingleArchitectSectionResult, MergeArchitectSectionRejectReason, MddSection3Status } from "./mdd-sanitize/section-merge.js";
export {
  applyDeploymentStackDirectiveToDraft,
  deduplicateAndReorderMddSections,
  ensureMissingCanonicalSections,
  ensureSection6WhenSection7Present,
  extractArquitecturaSectionBody,
  extractContextSectionBody,
  extractSection3Body,
  extractSection4Body,
  extractSection5Body,
  extractSection6Body,
  extractSection7Body,
  fixGluedSection6Heading,
  getMddDraftSummary,
  getSection6Or7Range,
  getSectionsToPreserveFromExecutorPlan,
  hydrateStructuredFromDraft,
  isMddSectionPipelinePlaceholderBody,
  isMddSectionPlaceholderBody,
  logSection3Debug,
  mergeSection1IntoDraft,
  mddHasDuplicateSectionHeadings,
  normalizeCanonicalMddSectionHeadings,
  preserveArquitecturaSectionIfSubstantial,
  preserveContextSectionIfSubstantial,
  preserveUntouchedMddSectionsFromBaseline,
  replaceArquitecturaSectionBody,
  replaceContextSectionBody,
  replaceContextWhenInstructions,
  replaceContextWhenOnlyMetadata,
  replaceSection1BodyFromAnyHeading,
  replaceMddSection3Body,
  replaceMddSection4Body,
  replaceMddSection5Body,
  insertMddSection4Block,
  mergeSingleArchitectSectionIntoDraft,
  tryMergeSingleArchitectSectionIntoDraft,
  reattachMddUiUxDesignIntentSuffix,
  repairMisplacedCanonicalSectionsAfterUiUx,
  replaceSection6Or7InDraft,
  restoreArquitecturaSectionFromBaselineIfMissing,
  restoreContextSectionFromBaselineIfMissing,
  restoreMddSectionsFromBaselineStrict,
  splitMddUiUxDesignIntentSuffix,
  stripTrailingDuplicateMddSections,
  deduplicateMddDraftSections,
  validateMddStructure,
} from "./mdd-sanitize/section-merge.js";
export { findBalancedBrace, findBalancedBraceRespectingStrings } from "./mdd-sanitize/brace.util.js";
export {
  fixDoubleMermaidFences,
  fixSection2UnclosedSqlAndGluedMermaid,
  stripMermaidFences,
  unescapeMermaidLiteralNewlines,
} from "./mdd-sanitize/mermaid-fences.js";
export {
  closeUnclosedCodeFencesInDraft,
  collapseConsecutiveHorizontalRules,
  stripStrayParenAfterJsonCodeBlocks,
} from "./mdd-sanitize/persist-format.util.js";
export {
  applyPreDeliveryGateFixes,
  demoteProseHeadingsInSections,
  finalizeMddDeliverable,
  normalizeMddFormat,
  prepareMddMarkdownForPersist,
  repairGarbageHeadings,
  repairManifestJsonClosing,
  sanitizeMddAtPersist,
  sanitizeMddForExport,
  storeMddMarkdownForPersist,
  stripUiUxSectionForApiOnlyMvp,
} from "./mdd-sanitize/persist-pipeline.js";
