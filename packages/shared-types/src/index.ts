/**
 * @fileoverview **@theforge/shared-types** — barril de tipos Zod/TS compartidos entre API y web (estado MDD,
 * proyecto, sesión, estimación, orquestador, legacy doc, etc.).
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */
export * from "./status.js";
export * from "./checklist.js";
export * from "./project.js";
export * from "./project-group.js";
export * from "./project-merge.js";
export * from "./deliverables-matrix.js";
export * from "./project-generation-guard.js";
export * from "./mdd-job-progress.js";
export * from "./mdd-upstream-sync.js";
export * from "./agent-governance.js";
export * from "./governance-targets.js";
export * from "./stage.js";
export * from "./legacy-change-gate.js";
export * from "./legacy-change-state.util.js";
export * from "./stage-deliverable-snapshot.js";
export * from "./mdd-dependent-deliverables.js";
export * from "./session.js";
export * from "./estimation.js";
export * from "./mdd.js";
export * from "./mdd-pipeline-limits.js";
export * from "./markdown-repair.js";
export * from "./repair-directory-tree.js";
export * from "./markdown-table.js";
export * from "./mermaid.js";
export * from "./format-document-markdown.js";
export * from "./theforge-doc-stamp.js";
export * from "./tasks-pipeline.js";
export * from "./tasks-context-contracts.js";
export * from "./repair-pasted-markdown.js";
export * from "./repair-glued-headings.js";
export * from "./repair-phase0-flow-format.js";
export {
  demoteSqlPseudoHeadings,
  repairFragmentedSqlFences,
} from "./repair-collapsed-sql.js";
export * from "./repair-infra-markdown.js";
export * from "./dbga-document-structure.js";
export * from "./deduplicate-dbga-document.js";
export * from "./orchestrator.js";
export * from "./legacy-codebase-doc.js";
export * from "./document-changelog.js";
export * from "./document-persist-validation.js";
export * from "./mdd-governance-patterns.js";
export * from "./mdd-governance-pattern-compat.js";
export * from "./phase0-content.js";
export * from "./project-integration.js";
export * from "./project-notion-portability.js";
export * from "./spec-kit-bundle.js";
export * from "./ui-screens-export.js";
export * from "./ui-mcp-adapter-label.js";
export * from "./tasks-parse.js";
export * from "./change-plan/index.js";
export * from "./sdd-integrations.js";
export * from "./document-clarification.js";
export * from "./sdd-analyze.js";
export * from "./cascade-accuracy.js";
export * from "./domain-inventory.js";
export * from "./us-id-registry.js";
export * from "./tasks-resolve.js";
export * from "./deliverable-bundle.js";
export * from "./document-layout.js";
export * from "./doc-consumption-guide.js";
export * from "./brd-health.util.js";
export * from "./stage-change-spec.util.js";
export * from "./openspec-export.util.js";
export * from "./documentation-gap.js";
export * from "./traceability-suggest.js";
export * from "./aem.js";
export * from "./document-edit-intent.js";
export * from "./workshop-fin-delimiter-covenant.js";
export * from "./ariadne-forge-link.js";
export * from "./ariadne-change-pack.js";
export * from "./dbga-endpoint-catalog-merge.js";
export * from "./ui-mcp-contract.js";
export * from "./technology-docs/index.js";
export * from "./plugin.js";
export * from "./plugin-packaging.js";
export * from "./document-ast/index.js";
export * from "./system-config.js";
export * from "./readiness-audit.util.js";
export * from "./external-integration-registry.js";
export * from "./mdd-cascade-delta.util.js";
export * from "./workshop-doc-policy.js";
export * from "./sdd-graph-sync.js";
