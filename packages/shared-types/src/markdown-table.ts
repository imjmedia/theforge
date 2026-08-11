/**
 * @fileoverview **Experta en tablas Markdown** — única fuente de verdad para generar y normalizar
 * tablas markdown en todo TheForge. Tanto el MCP server como el pipeline de generación de documentos
 * (prompts LLM, AI service) deben usar estas funciones en vez de dejar que cada LLM genere tablas
 * a su manera.
 *
 * ## Reglas de normalización
 *
 * 1. Sin línea en blanco después del separador `|---|---|`.
 * 2. Separador con alignment explícito (`:---`, `:---:`, `---:`) según config.
 * 3. Columnas padding al ancho de la celda más larga en cada columna.
 * 4. Sin filas vacías.
 * 5. Pipe final en cada fila.
 * 6. Celdas multilínea soportadas (con `<br>` si se requiere).
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface TableColumn {
  header: string;
  /** Alineación del contenido: 'left' | 'center' | 'right' */
  align?: "left" | "center" | "right";
  /** Ancho mínimo (en caracteres). Si no se especifica, se calcula automáticamente. */
  minWidth?: number;
}

export interface TableData {
  /** Encabezados de columna. Si son strings, se usan con align=left. */
  columns: (string | TableColumn)[];
  /** Filas de datos. Cada fila debe tener el mismo número de celdas que columns. */
  rows: string[][];
  /** Título opcional antes de la tabla */
  caption?: string;
}

export interface NormalizeOptions {
  /** Alignment por defecto para columnas sin especificar */
  defaultAlign?: "left" | "center" | "right";
  /** Forzar un ancho mínimo para todas las columnas */
  globalMinWidth?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function resolveColumn(c: string | TableColumn): { header: string; align: "left" | "center" | "right"; minWidth: number } {
  if (typeof c === "string") {
    return { header: c, align: "left" as const, minWidth: 0 };
  }
  return {
    header: c.header,
    align: c.align ?? "left",
    minWidth: c.minWidth ?? 0,
  };
}

function colWidth(name: string, min: number): number {
  return Math.max(name.length, min);
}

/** Escapa pipes dentro del contenido de una celda */
function escapeCell(raw: string): string {
  return raw.replace(/\|/g, "\\|");
}

/** Pads a cell to a given width, accounting for alignment */
function padCell(content: string, width: number, align: "left" | "center" | "right"): string {
  const diff = width - content.length;
  if (diff <= 0) return content;
  switch (align) {
    case "right":
      return " ".repeat(diff) + content;
    case "center": {
      const left = Math.floor(diff / 2);
      const right = diff - left;
      return " ".repeat(left) + content + " ".repeat(right);
    }
    case "left":
    default:
      return content + " ".repeat(diff);
  }
}

const ALIGN_MAP: Record<string, string> = {
  left: ":---",
  center: ":---:",
  right: "---:",
};


function detectAlign(sep: string): "left" | "center" | "right" {
  const s = sep.trim();
  if (s.startsWith(":") && s.endsWith(":") && s.length >= 5) return "center";
  if (s.endsWith(":") && !s.startsWith(":")) return "right";
  if (s.startsWith(":")) return "left";
  return "left";
}

// ─── Generate ───────────────────────────────────────────────────────────

/**
 * Genera una tabla markdown normalizada a partir de datos estructurados.
 *
 * @example
 * ```ts
 * const md = generateTable({
 *   columns: ["Nombre", { header: "Edad", align: "right" }, "Rol"],
 *   rows: [
 *     ["Ana", "28", "Admin"],
 *     ["Bob", "34", "Editor"],
 *   ],
 * });
 * // | Nombre | Edad | Rol     |
 * // |:-------|-----:|:--------|
 * // | Ana    |   28 | Admin   |
 * // | Bob    |   34 | Editor  |
 * ```
 */
export function generateTable(data: TableData): string {
  const { columns, rows, caption } = data;

  if (columns.length === 0) return "";

  const cols = columns.map(resolveColumn);

  // Calcular anchos de columna
  const widths = cols.map((c, i) => {
    let w = colWidth(c.header, c.minWidth);
    for (const row of rows) {
      const cell = row[i] ?? "";
      w = Math.max(w, escapeCell(cell).length);
    }
    return w;
  });

  // Construir líneas
  const lines: string[] = [];

  // Header
  const headerLine =
    "| " +
    cols.map((c, i) => padCell(c.header, widths[i]!, c.align)).join(" | ") +
    " |";

  // Separator
  const sepLine =
    "| " +
    cols.map((c, i) => {
      const alignStr = ALIGN_MAP[c.align] ?? ":---";
      const needed = widths[i]!;
      const baseLen = alignStr.length;
      if (baseLen >= needed) return alignStr;
      // Add dashes to match width
      const extra = needed - baseLen;
      return alignStr.slice(0, -1) + "-".repeat(extra) + alignStr.slice(-1);
    }).join(" | ") +
    " |";

  // Data rows
  const dataLines = rows.map((row) => {
    const cells = cols.map((c, i) => {
      const raw = row[i] ?? "";
      return padCell(escapeCell(raw), widths[i]!, c.align);
    });
    return "| " + cells.join(" | ") + " |";
  });

  if (caption) {
    lines.push(`\n${caption}\n`);
  }
  lines.push(headerLine);
  lines.push(sepLine);
  lines.push(...dataLines);

  return lines.join("\n");
}

// ─── Normalize ──────────────────────────────────────────────────────────

/**
 * Parsea una tabla markdown existente en datos estructurados.
 * Detecta el encabezado, separador, filas y alineación automáticamente.
 */
export function parseTable(markdown: string): TableData | null {
  const lines = markdown.split("\n");

  // Encontrar la línea del separador (|---| pattern)
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|[\s\-:]+\|/.test(lines[i]!.trim())) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx === -1) return null;

  const sepLine = lines[sepIdx]!;
  const headerLine = lines[sepIdx - 1];
  if (!headerLine) return null;

  // Extraer celdas del separador para detectar columnas y alineación
  const sepParts = sepLine
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const columns: TableColumn[] = sepParts.map((part) => {
    const align = detectAlign(part);
    // Tomar el nombre del header correspondiente
    return { header: "", align };
  });

  // Extraer headers
  const headerParts = headerLine
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  columns.forEach((col, i) => {
    col.header = headerParts[i] ?? `Col${i + 1}`;
  });

  // Extraer filas de datos (después del separador)
  const rows: string[][] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || /^[\s\-*_]{3,}$/.test(t)) continue; // skip empty or hr lines
    if (t.startsWith("|")) {
      const cells = t
        .split("|")
        .map((s) => s.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1); // strip leading/trailing empty
      if (cells.length > 0 && cells.some((c) => c.length > 0)) {
        rows.push(cells.map((c) => c.replace(/\\\|/g, "|")));
      }
    }
  }

  if (columns.length === 0) return null;

  return { columns, rows };
}

/**
 * Normaliza una tabla markdown existente — detecta y corrige:
 * - Línea en blanco después del separador
 * - Separador sin alignment o mal formado
 * - Columnas desalineadas en ancho
 * - Filas vacías
 * - Pipes inconsistentes
 *
 * @returns La tabla normalizada como string markdown, o el input original si no se pudo parsear.
 */
export function normalizeTable(raw: string): string {
  const parsed = parseTable(raw);
  if (!parsed) return raw;

  // Intentar detectar caption
  const lines = raw.split("\n");
  const sepIdx = lines.findIndex((l) => /^\|[\s\-:]+\|/.test(l.trim()));
  let caption: string | undefined;
  if (sepIdx >= 2) {
    const beforeHeader = lines.slice(0, sepIdx - 1).filter((l) => l.trim());
    if (beforeHeader.length > 0) {
      caption = beforeHeader.join("\n");
    }
  }

  return generateTable({
    columns: parsed.columns,
    rows: parsed.rows,
    caption,
  });
}

/**
 * Encuentra y normaliza TODAS las tablas markdown en un texto.
 * Útil para procesar documentos completos generados por LLMs.
 */
export function normalizeAllTables(document: string): string {
  // Split por líneas
  const lines = document.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Buscar inicio de tabla (línea que empieza con | y contiene al menos 2 pipes)
    if (/^\|.+\|.*$/.test(lines[i]!)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i]!)) {
        tableLines.push(lines[i]!);
        i++;
      }
      // Si el separador está presente (mínimo 3 líneas: header, sep, 1 row)
      if (tableLines.length >= 2) {
        const normalized = normalizeTable(tableLines.join("\n"));
        result.push(normalized);
        if (i < lines.length && lines[i]!.trim()) result.push("");
      } else {
        result.push(...tableLines);
      }
      // Saltar líneas en blanco entre tabla y siguiente contenido
      while (i < lines.length && !lines[i]!.trim()) {
        i++;
      }
    } else {
      result.push(lines[i]!);
      i++;
    }
  }

  return result.join("\n");
}

/** Fila GFM con al menos dos celdas (`| a | b |`). */
function looksLikeGfmTableRow(text: string): boolean {
  const row = text.trim();
  if (!row.startsWith("|")) return false;
  const cells = row
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  return cells.length >= 2;
}

/**
 * Separa prosa/heading/blockquote pegados al inicio de una fila de tabla en la misma línea.
 * Ej.: `### Título > cita | FR | Módulo |` → líneas independientes antes del `|`.
 */
function splitProsePrefixFromTableLine(line: string): string {
  const trimmed = line.trimStart();
  const indent = line.slice(0, line.length - trimmed.length);
  if (trimmed.startsWith("|")) return line;

  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx <= 0) return line;

  const prefix = trimmed.slice(0, pipeIdx).trimEnd();
  const tablePart = trimmed.slice(pipeIdx).trimStart();
  if (!prefix || !looksLikeGfmTableRow(tablePart)) return line;

  return `${indent}${prefix}\n${indent}${tablePart}`;
}

/** Separa blockquote pegado a la fila cabecera de una tabla. */
function splitBlockquoteFromGluedTableLine(line: string): string {
  const trimmed = line.trimStart();
  const indent = line.slice(0, line.length - trimmed.length);
  if (!/^>\s/.test(trimmed)) return line;

  const match = trimmed.match(/^>\s*(.+?)\s+(\|.+\|)\s*$/);
  if (!match || !looksLikeGfmTableRow(match[2]!)) return line;

  return `${indent}> ${match[1]!.trim()}\n\n${indent}${match[2]!.trim()}`;
}

/**
 * Despega prosa, headings o blockquotes del primer `|` de una fila de tabla GFM.
 * Complementa `repairCollapsedPipeTables` cuando la cabecera queda en la misma línea que el texto previo.
 */
export function repairProseGluedTableLines(document: string): string {
  if (!document?.trim()) return document ?? "";
  return document
    .split("\n")
    .map((line) => splitBlockquoteFromGluedTableLine(splitProsePrefixFromTableLine(line)))
    .join("\n");
}

/**
 * Expande tablas markdown colapsadas en una sola línea
 * (`| H1 | H2 | | :--- | :--- | | fila | datos |` → filas reales).
 * Típico del Clarifier/Architect en §1 (tabla de dolores) y matriz FR §1 MDD.
 */
export function repairCollapsedPipeTables(document: string): string {
  if (!document?.trim()) return document ?? "";
  const expanded = document
    .split("\n")
    .map((line) => {
      const pipeCount = (line.match(/\|/g) ?? []).length;
      if (pipeCount < 8) return line;
      if (!/\|\s*\|/.test(line)) return line;

      const firstPipe = line.indexOf("|");
      const prefix = firstPipe > 0 ? line.slice(0, firstPipe) : "";
      const tablePart = line.slice(firstPipe);
      const rows = tablePart.split(/(?<=\|)\s*(?=\|)/).map((chunk) => {
        let s = chunk.trim();
        if (!s.startsWith("|")) s = `| ${s}`;
        if (!s.endsWith("|")) s = `${s} |`;
        return s.replace(/\|\s+\|/g, "| |").replace(/^\|\s+\|/, "|");
      });
      if (rows.length < 2) return line;
      return prefix + rows.join("\n");
    })
    .join("\n");
  return repairProseGluedTableLines(expanded);
}
