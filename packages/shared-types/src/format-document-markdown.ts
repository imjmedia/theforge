/**
 * Normaliza markdown de documentos del Workshop (fences, tablas, Mermaid).
 * Sin LLM — solo limpieza estructural tras pegar contenido mal formateado.
 */

import { repairMarkdownFences } from "./markdown-repair.js";
import {
  normalizeAllTables,
  repairCollapsedPipeTables,
  repairProseGluedTableLines,
} from "./markdown-table.js";
import { normalizeMermaidInDocument } from "./mermaid.js";
import { splitEmbeddedMddFromDbga } from "./dbga-document-structure.js";
import { repairFragmentedSqlFences } from "./repair-collapsed-sql.js";
import {
  repairApiContractJsonFences,
  repairApiResponse204NoContent,
  repairOrphanContratosApiFences,
  repairOrphanFenceBeforeContractLabels,
  repairOrphanSqlBlocks,
  repairPastedMarkdown,
  repairStrayCodeFences,
  repairTableBoundaries,
  repairUnclosedJsonBeforeApiEndpoint,
} from "./repair-pasted-markdown.js";
import { repairMddFormatIssues } from "./repair-mdd-format.js";
import { repairDirectoryTreeBlocks } from "./repair-directory-tree.js";
import {
  homogenizeMarkdownBulletMarkers,
  repairGluedMarkdownHeadings,
} from "./repair-glued-headings.js";
import { repairPhase0FlowFormat } from "./repair-phase0-flow-format.js";
import { repairSplitOrderedListItems } from "./repair-split-ordered-list-items.js";
import { promoteListItemFences } from "./promote-list-item-fences.js";
import { repairDbgaMarkdown } from "./repair-dbga-markdown.js";
import {
  deduplicateDbgaDocument,
  hasDuplicateDbgaBlocks,
} from "./deduplicate-dbga-document.js";
import {
  peelDocumentBodyForPersist,
  peelTheforgeDocStamp,
  reattachTheforgeDocStamp,
} from "./theforge-doc-stamp.js";

export function formatDocumentMarkdown(text: string): string {
  if (!text) return "";
  let trimmed = text.trim();
  if (hasDuplicateDbgaBlocks(trimmed)) {
    trimmed = deduplicateDbgaDocument(trimmed);
  }
  // Quitar stamp corrupto y despegar `--- ##` inline antes del resto del pipeline.
  const initialPeel = peelTheforgeDocStamp(trimmed);
  const docStamp = initialPeel.stamp.includes("theforge-doc:created=")
    && !/\s---\s+#{1,6}\s/.test(initialPeel.stamp)
    ? initialPeel.stamp
    : trimmed.match(/^<!--\s*theforge-doc:created=[^>]+\s*-->\s*\n?/)?.[0] ?? "";
  trimmed = peelDocumentBodyForPersist(trimmed);

  const hadOuterMarkdownFence =
    /^```(?:markdown|md)?\s*\n/i.test(trimmed) && /\n```\s*$/i.test(trimmed);

  let cleaned = repairPastedMarkdown(trimmed);
  if (hadOuterMarkdownFence) {
    cleaned = cleaned
      .replace(/^```(?:markdown|md)?\s*\n/i, "")
      .replace(/\n```\s*$/i, "")
      .trim();
  }
  const yamlMatch = cleaned.match(/^---[\s\S]*?\n---\s*\n?/);
  const searchStart = yamlMatch ? yamlMatch[0].length : 0;
  if (searchStart > 0) {
    const body = cleaned.slice(searchStart);
    const bodyHeader = body.match(/^#{1,2}\s+/m);
    if (bodyHeader && bodyHeader.index !== undefined && bodyHeader.index > 0) {
      cleaned = cleaned.slice(0, searchStart) + body.slice(bodyHeader.index).trimStart();
    }
  } else {
    // Solo recorta preámbulo antes del primer H1/H2; no ante ### (contratos API, Beneficios, etc.)
    const headerMatch = cleaned.match(/^#{1,2}\s+/m);
    if (headerMatch?.index != null && headerMatch.index > 0) {
      cleaned = cleaned.slice(headerMatch.index).trim();
    }
  }
  cleaned = repairMarkdownFences(cleaned.trim());
  cleaned = repairOrphanFenceBeforeContractLabels(cleaned);
  cleaned = repairUnclosedJsonBeforeApiEndpoint(cleaned);
  cleaned = repairMddFormatIssues(cleaned);
  cleaned = repairApiContractJsonFences(cleaned);
  cleaned = repairOrphanContratosApiFences(cleaned);
  cleaned = repairApiResponse204NoContent(cleaned);
  cleaned = repairDbgaMarkdown(cleaned);
  cleaned = repairSplitOrderedListItems(cleaned);
  cleaned = promoteListItemFences(cleaned);
  cleaned = repairGluedMarkdownHeadings(cleaned);
  cleaned = repairPhase0FlowFormat(cleaned);
  cleaned = homogenizeMarkdownBulletMarkers(cleaned);
  cleaned = repairCollapsedPipeTables(cleaned);
  cleaned = repairProseGluedTableLines(cleaned);
  cleaned = normalizeAllTables(cleaned);
  cleaned = repairTableBoundaries(cleaned);
  cleaned = repairStrayCodeFences(cleaned);
  cleaned = repairGluedMarkdownHeadings(cleaned);
  cleaned = normalizeMermaidInDocument(cleaned);
  cleaned = repairFragmentedSqlFences(cleaned);
  cleaned = repairOrphanSqlBlocks(cleaned);
  cleaned = repairDirectoryTreeBlocks(cleaned);
  cleaned = repairFragmentedSqlFences(cleaned);
  cleaned = repairOrphanSqlBlocks(cleaned);
  // Segunda pasada Mermaid: SQL/árboles pueden haber dejado aristas o fences huérfanos.
  cleaned = normalizeMermaidInDocument(cleaned);
  return reattachTheforgeDocStamp(docStamp, cleaned);
}

/** Formatea solo el cuerpo DBGA/Research; separa MDD embebido al final. */
export function formatDbgaDocument(raw: string): {
  formatted: string;
  strippedMdd: string | null;
  deduplicated: boolean;
} {
  const { dbgaBody, embeddedMdd } = splitEmbeddedMddFromDbga(raw);
  const deduplicated = hasDuplicateDbgaBlocks(dbgaBody);
  return {
    formatted: formatDocumentMarkdown(dbgaBody),
    strippedMdd: embeddedMdd,
    deduplicated,
  };
}
