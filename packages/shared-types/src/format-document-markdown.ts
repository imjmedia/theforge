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
import { findTopLevelFences } from "./mermaid-oracle.js";
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

export interface FormatDocumentMarkdownOptions {
  /**
   * Tratamiento de los fences ```mermaid de nivel raíz:
   * - `"normalize"` (default en F1): pasan por `normalizeMermaidInDocument` como siempre.
   * - `"preserve"`: se extraen antes de cualquier reparación y se restituyen byte a byte; el resto del
   *   documento se formatea igual. Lo usa el visor, donde el bloque decide su propia reparación con el
   *   parser real.
   */
  mermaid?: "normalize" | "preserve";
  /**
   * Solo en `"preserve"`: se invoca por cada bloque ```mermaid cuyo marcador desapareció durante el
   * formateo (región descartada). El bloque se reinserta al final del documento en vez de perderse.
   */
  onMermaidReinserted?: (info: { index: number; block: string }) => void;
}

// Marcadores en caracteres de uso privado: ninguna reparación los interpreta como markdown ni los recorta.
const MERMAID_MARKER_OPEN = "\uE000FORGE_MERMAID_";
const MERMAID_MARKER_CLOSE = "\uE001";

interface MaskedMermaidBlock {
  /** Línea de apertura del fence tal como llegó (```mermaid, con su indentación e info). */
  open: string;
  /** Líneas interiores originales. */
  body: string;
  /** Línea de cierre del fence tal como llegó. */
  close: string;
}

/**
 * Fences ```mermaid de nivel raíz y los que viven dentro de un fence exterior ```markdown / ```md
 * (documentos pegados envueltos en ````markdown). Devuelve índices absolutos de línea.
 */
function collectMermaidFences(lines: string[]): Array<{ open: number; close: number }> {
  const out: Array<{ open: number; close: number }> = [];
  const isMermaid = (info: string): boolean => /^mermaid(?:\s|$)/i.test(info);
  for (const fence of findTopLevelFences(lines)) {
    if (isMermaid(fence.info)) {
      out.push({ open: fence.open, close: fence.close });
    } else if (/^(?:markdown|md)$/i.test(fence.info)) {
      const inner = lines.slice(fence.open + 1, fence.close);
      for (const f of findTopLevelFences(inner)) {
        if (isMermaid(f.info)) {
          out.push({ open: f.open + fence.open + 1, close: f.close + fence.open + 1 });
        }
      }
    }
  }
  return out.sort((x, y) => x.open - y.open);
}

/**
 * Enmascara SOLO el cuerpo de cada fence ```mermaid: las líneas de apertura y cierre se conservan y el
 * marcador queda como única línea interior. Así ninguna reparación puede pegar el marcador a un `1.`
 * previo ni promoverlo a heading (el fence sigue siendo un fence). Cuerpos idénticos comparten marcador,
 * de modo que `deduplicateDbgaDocument` sigue viendo duplicados idénticos.
 */
function maskMermaidFences(text: string): { masked: string; blocks: MaskedMermaidBlock[] } {
  const lines = text.split("\n");
  const fences = collectMermaidFences(lines).filter((f) => f.close - f.open > 1);
  if (fences.length === 0) return { masked: text, blocks: [] };
  const blocks: MaskedMermaidBlock[] = [];
  const indexByBody = new Map<string, number>();
  const out: string[] = [];
  let cursor = 0;
  for (const fence of fences) {
    out.push(...lines.slice(cursor, fence.open + 1));
    const body = lines.slice(fence.open + 1, fence.close).join("\n");
    let index = indexByBody.get(body);
    if (index === undefined) {
      index = blocks.length;
      indexByBody.set(body, index);
      blocks.push({ open: lines[fence.open]!, body, close: lines[fence.close]! });
    }
    out.push(`${MERMAID_MARKER_OPEN}${index}${MERMAID_MARKER_CLOSE}`);
    cursor = fence.close;
  }
  out.push(...lines.slice(cursor));
  return { masked: out.join("\n"), blocks };
}

/**
 * Restituye los cuerpos originales sustituyendo la línea del marcador (regex anclada a línea completa).
 * Si el formateo descartó una región con un marcador (p. ej. el preámbulo previo al primer H1/H2), el
 * bloque NO se pierde: se reinserta íntegro (apertura, cuerpo y cierre) al FINAL del documento y se
 * avisa por `onReinserted`. Elegimos el final del documento y no "la sección" porque tras un
 * descarte no hay forma fiable de saber a qué sección pertenecía.
 */
function unmaskMermaidFences(
  text: string,
  blocks: MaskedMermaidBlock[],
  onReinserted?: (info: { index: number; block: string }) => void,
): string {
  if (blocks.length === 0) return text;
  const re = new RegExp(`^[ \\t]*${MERMAID_MARKER_OPEN}(\\d+)${MERMAID_MARKER_CLOSE}[ \\t]*(?=\\r?$)`, "gm");
  const seen = new Set<number>();
  let out = text.replace(re, (whole, idx: string) => {
    const block = blocks[Number(idx)];
    if (!block) return whole;
    seen.add(Number(idx));
    return block.body;
  });
  const lost = blocks.map((_, i) => i).filter((i) => !seen.has(i));
  for (const i of lost) {
    const b = blocks[i]!;
    const full = `${b.open}\n${b.body}\n${b.close}`;
    out = `${out.replace(/\s+$/, "")}\n\n${full}\n`;
    onReinserted?.({ index: i, block: full });
  }
  return out;
}

export function formatDocumentMarkdown(
  text: string,
  opts: FormatDocumentMarkdownOptions = {},
): string {
  if (!text) return "";
  if (opts.mermaid === "preserve") {
    const { masked, blocks } = maskMermaidFences(text);
    return unmaskMermaidFences(formatDocumentBody(masked, true), blocks, opts.onMermaidReinserted);
  }
  return formatDocumentBody(text, false);
}

function formatDocumentBody(text: string, preserveMermaid: boolean): string {
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
  if (!preserveMermaid) cleaned = normalizeMermaidInDocument(cleaned);
  cleaned = repairFragmentedSqlFences(cleaned);
  cleaned = repairOrphanSqlBlocks(cleaned);
  cleaned = repairDirectoryTreeBlocks(cleaned);
  cleaned = repairFragmentedSqlFences(cleaned);
  cleaned = repairOrphanSqlBlocks(cleaned);
  // Segunda pasada Mermaid: SQL/árboles pueden haber dejado aristas o fences huérfanos.
  if (!preserveMermaid) cleaned = normalizeMermaidInDocument(cleaned);
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
