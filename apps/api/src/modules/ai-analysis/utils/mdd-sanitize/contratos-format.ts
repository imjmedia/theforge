/** Reparación JSON y formateo de la sección §4 Contratos de API. */

/** Repara contenido interno de un bloque ```json (fences anidados, blockquote, pretty-print). */
function fixSingleNestedArrayWrappers(value: unknown): unknown {
  if (Array.isArray(value)) {
    const fixed = value.map(fixSingleNestedArrayWrappers);
    if (fixed.length === 1 && Array.isArray(fixed[0])) return fixed[0];
    return fixed;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = fixSingleNestedArrayWrappers(v);
    }
    return out;
  }
  return value;
}

function repairJsonCodeBlockInner(inner: string): string {
  let cleaned = inner.replace(/^>\s?/gm, "");
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned
      .replace(/^\s*```json\s*[\r]?\n/gim, "")
      .replace(/^\s*```\s*[\r]?\n/gm, "")
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "");
  }
  cleaned = cleaned.trim();
  if (!cleaned) return inner.trim();
  try {
    const parsed = fixSingleNestedArrayWrappers(JSON.parse(cleaned) as unknown);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned;
  }
}

/**
 * Desanida fences ```json dentro de bloques JSON (típico en §4 cuando el LLM formatea arrays).
 */
export function repairNestedJsonFencesInDraft(draft: string): string {
  if (!draft) return draft;
  const lower = draft.toLowerCase();
  let result = "";
  let i = 0;
  while (i < draft.length) {
    const open = lower.indexOf("```json", i);
    if (open === -1) {
      result += draft.slice(i);
      break;
    }
    result += draft.slice(i, open);
    let cursor = open + 7;
    if (draft[cursor] === "\r") cursor++;
    if (draft[cursor] === "\n") cursor++;
    const contentStart = cursor;
    let depth = 1;
    let closed = false;
    while (cursor < draft.length && depth > 0) {
      const fence = draft.indexOf("```", cursor);
      if (fence === -1) {
        result += draft.slice(open);
        return result;
      }
      if (lower.startsWith("```json", fence)) {
        depth++;
        cursor = fence + 7;
        if (draft[cursor] === "\r") cursor++;
        if (draft[cursor] === "\n") cursor++;
        continue;
      }
      depth--;
      if (depth === 0) {
        const inner = draft.slice(contentStart, fence);
        result += "```json\n" + repairJsonCodeBlockInner(inner) + "\n```";
        cursor = fence + 3;
        closed = true;
        break;
      }
      cursor = fence + 3;
    }
    if (!closed) {
      result += draft.slice(open);
      break;
    }
    i = cursor;
  }
  return result;
}

/** Saldo de llaves `{`/`}` fuera de strings JSON. Positivo = faltan cierres. */
function countJsonBraceDelta(text: string): number {
  let delta = 0;
  let inString = false;
  let escape = false;
  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") delta++;
    if (ch === "}") delta--;
  }
  return delta;
}

/**
 * Recupera llaves `}` desplazadas tras el fence de un bloque ```json en §4.
 * Típico: el JSON cierra el fence sin `}` y el cierre aparece tras la descripción del siguiente endpoint.
 */
export function repairDisplacedJsonBracesInContratos(body: string): string {
  if (!body?.trim()) return body;
  let out = body;
  const openRe = /```json\s*\n/gi;
  const openIndices: number[] = [];
  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(body)) !== null) {
    openIndices.push(openMatch.index);
  }
  for (let i = openIndices.length - 1; i >= 0; i--) {
    const openIdx = openIndices[i];
    const openTag = out.slice(openIdx).match(/^```json\s*\n/i)?.[0];
    if (!openTag) continue;
    const contentStart = openIdx + openTag.length;
    const closeIdx = out.indexOf("```", contentStart);
    if (closeIdx === -1) continue;
    const inner = out.slice(contentStart, closeIdx);
    let delta = countJsonBraceDelta(inner);
    if (delta <= 0) continue;

    const tail = out.slice(closeIdx + 3);
    const braceLine = tail.match(/\n\}\s*\n(?:```[ \t]*\n)?/);
    if (!braceLine || braceLine.index === undefined) continue;

    const newInner = `${inner.trimEnd()}\n}\n`;
    const repairedInner = repairJsonCodeBlockInner(newInner);
    const newBlock = `\`\`\`json\n${repairedInner}\n\`\`\``;
    const removeStart = closeIdx + 3 + braceLine.index;
    const removeEnd = closeIdx + 3 + braceLine.index + braceLine[0].length;
    const preserved = out.slice(closeIdx + 3, removeStart);
    out = out.slice(0, openIdx) + newBlock + preserved + out.slice(removeEnd);
  }
  return out;
}

const CONTRATOS_PLACEHOLDER =
  "\n\n## 4. Contratos de API\n\n(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco; en la siguiente iteración se deben completar los contratos.)\n\n";


const CONTRATOS_BODY_FALTA =
  "(Falta: definir endpoints con request/response en JSON. El Auditor ha detectado este hueco; en la siguiente iteración se deben completar los contratos.)";

/** Cuerpo de sección 3 que es solo el placeholder perezoso (con o sin paréntesis). */
const PENDIENTE_CONTRATOS_REGEX = /^\s*\(?\s*Pendiente:\s*definir\s+endpoints[\s\S]*?\)?\s*$/i;

/** Longitud mínima del cuerpo de §4 para considerarlo candidato a “sustancial”. */
export const MIN_CONTRATOS_LENGTH = 150;

/** Detecta endpoints reales: método+ruta, heading `### MÉTODO`, tabla markdown o bloque ```json. */
export const CONTRATOS_HAS_ENDPOINTS =
  /\b(POST|GET|PUT|DELETE|PATCH)\s+[\"']?\/|```json|###\s+(POST|GET|PUT|DELETE|PATCH)|\|\s*(POST|GET|PUT|DELETE|PATCH)\s*\|/i;

/** Placeholder explícito del pipeline / Auditor (inicio del cuerpo). */
export const CONTRATOS_IS_PLACEHOLDER =
  /^\s*\(?\s*(Pendiente|Falta):\s*definir\s+endpoints/i;

/** Párrafo completo del placeholder de §4 (Auditor / ensureContratosSection). */
const CONTRATOS_LEADING_PLACEHOLDER_PARAGRAPH =
  /^\s*\(?\s*(?:Pendiente|Falta):\s*definir\s+endpoints[\s\S]*?\)?\s*(?:\n|$)/i;

/**
 * Quita el párrafo "(Falta|Pendiente): definir endpoints…" del inicio de §4 cuando
 * hay contenido real debajo (tabla, rutas, ```json). Evita que el placeholder bloquee
 * validación y merge cuando el Arquitecto ya generó contratos parciales.
 */
export function stripLeadingContratosPlaceholder(body: string): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed || !CONTRATOS_IS_PLACEHOLDER.test(trimmed)) return trimmed;
  const rest = trimmed.replace(CONTRATOS_LEADING_PLACEHOLDER_PARAGRAPH, "").trim();
  if (!rest || rest.length < 40) return trimmed;
  return rest;
}

const SECTION4_CONTRATOS_HEADING_REGEX =
  /##\s*4\.\s*Contratos\s+de\s+API|##\s*3\.\s*Contratos\s+de\s+API|##\s*Contratos\s+de\s+API/i;

/** Extrae el cuerpo de §4 Contratos de API (sin el heading). */
export function extractContratosSectionBody(draft: string): string | null {
  const t = (draft ?? "").trim();
  const match = t.match(SECTION4_CONTRATOS_HEADING_REGEX);
  if (!match) return null;
  const start = t.indexOf(match[0]) + match[0].length;
  const rest = t.slice(start).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  return (nextH2 !== -1 ? rest.slice(0, nextH2) : rest).trim() || null;
}

/** True si el cuerpo es placeholder o carece de endpoints/JSON reales. */
export function isContratosPlaceholder(body: string | null | undefined): boolean {
  const trimmed = (body ?? "").trim();
  if (!trimmed || trimmed.length < MIN_CONTRATOS_LENGTH) return true;
  const hasJsonContracts = /```json/i.test(trimmed);
  // Stub del Auditor al inicio: sigue siendo placeholder aunque haya tabla journey debajo.
  if (CONTRATOS_IS_PLACEHOLDER.test(trimmed) && !hasJsonContracts) return true;
  const normalized = stripLeadingContratosPlaceholder(trimmed);
  if (!normalized || normalized.length < MIN_CONTRATOS_LENGTH) return true;
  if (CONTRATOS_IS_PLACEHOLDER.test(normalized)) return true;
  return !CONTRATOS_HAS_ENDPOINTS.test(normalized);
}

/** True si §4 tiene contratos usables (endpoints + JSON request/response y no es placeholder). */
export function isContratosSubstantial(body: string | null | undefined): boolean {
  if (!body || isContratosPlaceholder(body)) return false;
  if (!CONTRATOS_HAS_ENDPOINTS.test(body)) return false;
  if (!/```json/i.test(body)) return false;
  return true;
}

/** Cuenta filas de endpoint (método + ruta) en §4. */
export function countContratosEndpointRows(body: string | null | undefined): number {
  if (!body?.trim()) return 0;
  const direct = body.match(/\b(POST|GET|PUT|DELETE|PATCH)\s+["']?\//gi) ?? [];
  const table = body.match(/\|\s*(POST|GET|PUT|DELETE|PATCH)\s*\|/gi) ?? [];
  return direct.length + table.length;
}

/** Baseline sustancial cuya longitud activa la protección anti-regresión. */
export const MIN_CONTRATOS_BASELINE_FOR_REGRESSION_GUARD = 1_200;

/** Ratio mínimo (nuevo/baseline) para aceptar un merge quirúrgico de §4. */
export const CONTRATOS_REGRESSION_LENGTH_RATIO = 0.75;

/** Ratio mínimo de filas endpoint (candidato/baseline) cuando baseline ≥ 6. */
export const CONTRATOS_REGRESSION_ENDPOINT_RATIO = 0.8;

/**
 * True si el candidato es sustancial pero claramente peor que el baseline
 * (p. ej. merge quirúrgico o SSOT repair que trunca el catálogo API).
 */
export function isContratosSectionRegression(
  baselineBody: string | null | undefined,
  candidateBody: string | null | undefined,
): boolean {
  const baseline = (baselineBody ?? "").trim();
  const candidate = (candidateBody ?? "").trim();
  if (!baseline || !candidate) return false;
  if (!isContratosSubstantial(baseline)) return false;
  if (!isContratosSubstantial(candidate)) return true;
  if (baseline.length < MIN_CONTRATOS_BASELINE_FOR_REGRESSION_GUARD) return false;
  const ratio = candidate.length / baseline.length;
  if (ratio < CONTRATOS_REGRESSION_LENGTH_RATIO) return true;
  const baselineEndpoints = countContratosEndpointRows(baseline);
  const candidateEndpoints = countContratosEndpointRows(candidate);
  if (
    baselineEndpoints >= 6 &&
    candidateEndpoints < Math.ceil(baselineEndpoints * CONTRATOS_REGRESSION_ENDPOINT_RATIO)
  ) {
    return true;
  }
  return false;
}

/**
 * Asegura que el MDD tenga la sección "## 4. Contratos de API" antes de "## 6. Seguridad".
 * Si falta, la inserta con un placeholder. Si existe pero el cuerpo es solo "Pendiente: definir endpoints...", lo reemplaza por el texto "Falta: ...".
 */
export function ensureContratosSection(draft: string): string {
  const trimmed = (draft || "").trim();
  if (!trimmed) return draft;
  const contratosMatch = trimmed.match(/##\s*4\.\s*Contratos de API|##\s*3\.\s*Contratos de API|##\s*Contratos de API/i);
  if (contratosMatch) {
    const idx = trimmed.indexOf(contratosMatch[0]);
    const afterHeading = trimmed.slice(idx + contratosMatch[0].length).replace(/^\s*\n+/, "");
    const nextH2 = afterHeading.search(/\n##\s+/);
    const body = (nextH2 !== -1 ? afterHeading.slice(0, nextH2) : afterHeading).trim();
    if (body && PENDIENTE_CONTRATOS_REGEX.test(body)) {
      const sectionStart = idx + contratosMatch[0].length;
      const bodyStart = trimmed.indexOf(body, sectionStart);
      const bodyEnd = bodyStart + body.length;
      return (
        trimmed.slice(0, bodyStart) +
        "\n\n" +
        CONTRATOS_BODY_FALTA +
        "\n\n" +
        trimmed.slice(bodyEnd)
      ).trim();
    }
    return draft;
  }
  const seguridadIdx = trimmed.search(/\n##\s+(?:6\.\s+)?Seguridad/i);
  if (seguridadIdx !== -1) {
    return trimmed.slice(0, seguridadIdx) + CONTRATOS_PLACEHOLDER + trimmed.slice(seguridadIdx);
  }
  const integracionIdx = trimmed.search(/\n##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b/i);
  if (integracionIdx !== -1) {
    return trimmed.slice(0, integracionIdx) + CONTRATOS_PLACEHOLDER + trimmed.slice(integracionIdx);
  }
  return trimmed + CONTRATOS_PLACEHOLDER.trim();
}

/** Extrae el primer objeto/array JSON de una línea (desde { o [ hasta el cierre balanceado). */
function extractJsonFromLine(line: string): { json: string; start: number; end: number } | null {
  const open = line.indexOf("{");
  const openBracket = line.indexOf("[");
  const start = open === -1 ? openBracket : openBracket === -1 ? open : Math.min(open, openBracket);
  if (start === -1) return null;
  const openChar = line[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < line.length; i++) {
    if (line[i] === openChar) depth++;
    else if (line[i] === closeChar) {
      depth--;
      if (depth === 0) return { json: line.slice(start, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

/** Asegura que la fila de tabla cierre con | (evita errores de parseo en Backstage y otros). */
function ensureTrailingTablePipe(row: string): string {
  const t = row.trimEnd();
  return t.endsWith("|") ? t : t + " |";
}

/**
 * Solo parte en límites de fila: | seguido de | y luego --- (separador), POST/GET/etc, o /ruta (datos).
 * No parte en | | que sea una celda vacía dentro de la misma fila.
 */
const TABLE_ROW_BOUNDARY = /\|\s*\|(?=\s*(?:-{2,}|(?:POST|GET|PUT|DELETE|PATCH)\s*\||\/))/gi;

/**
 * Colapsa líneas en blanco entre fila de cabecera de tabla (| ... |) y fila separador (|---|).
 * Muchos renderers rompen la tabla si hay línea vacía entre ambas.
 */
function collapseBlankBetweenTableHeaderAndSeparator(body: string): string {
  return body.replace(
    /(\|[^\n]+)\n(\s*\n)+(\|\s*[-|\s]+\|[^\n]*)/g,
    "$1\n$3"
  );
}

/** Parte una línea con varias filas de tabla concatenadas (ej. 8 celdas en tabla de 4 columnas) en una fila por línea. */
function splitConcatenatedTableRows(line: string, colCount = 4): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.includes("|")) return [line];
  const parts = trimmed.split("|").map((p) => p.trim());
  const cells =
    parts.length >= 2 && parts[0] === "" && parts[parts.length - 1] === "" ? parts.slice(1, -1) : parts;
  if (cells.length <= colCount || cells.length % colCount !== 0) return [line];
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += colCount) {
    rows.push("| " + cells.slice(i, i + colCount).join(" | ") + " |");
  }
  return rows;
}

/**
 * Si una línea parece tabla Markdown pero tiene filas concatenadas en una sola línea,
 * separa cada fila en su propia línea (solo en límites de fila, no en cada celda).
 * También quita el pipe final de cada fila para evitar columna vacía en el render.
 */
function fixMarkdownTableRows(body: string): string {
  const collapsed = collapseBlankBetweenTableHeaderAndSeparator(body);
  const lines = collapsed.split(/\n/);
  const out: string[] = [];
  let lastWasTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const hasDoublePipe = /\|\s*\|/.test(trimmed);
    const looksLikeTable = trimmed.includes("|") && (trimmed.includes("---") || /\|[^|]+\|[^|]+\|/.test(trimmed));
    const concatenatedRows = splitConcatenatedTableRows(trimmed, 4);
    if (concatenatedRows.length > 1) {
      if (lastWasTable === false && out.length > 0) out.push("");
      for (const row of concatenatedRows) out.push(ensureTrailingTablePipe(row));
      lastWasTable = true;
      continue;
    }
    if ((looksLikeTable || trimmed.startsWith("|")) && hasDoublePipe) {
      const fixed = trimmed.replace(TABLE_ROW_BOUNDARY, "|\n|").trim();
      const rows = fixed.split("\n");
      if (lastWasTable === false && out.length > 0) out.push("");
      for (const row of rows) out.push(ensureTrailingTablePipe(row.trim()));
      lastWasTable = true;
    } else if (trimmed.startsWith("|") && looksLikeTable) {
      lastWasTable = true;
      out.push(ensureTrailingTablePipe(trimmed));
    } else {
      lastWasTable = false;
      out.push(line);
    }
  }
  return out.join("\n");
}

/**
 * Convierte un bloque de viñetas con pipes (ej. "*   **POST** | `/path` | desc | Auth") en tabla Markdown válida
 * (encabezado + separador + filas con pipes). Así el renderer muestra tabla y no texto plano.
 */
function convertListWithPipesToMarkdownTable(body: string): string {
  const lines = body.split("\n");
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const hasPipes = bulletMatch && bulletMatch[1].includes("|");
    if (!bulletMatch || !hasPipes) {
      result.push(line);
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      const m = l.match(/^\s*[-*]\s+(.+)$/);
      if (!m || !m[1].includes("|")) break;
      block.push(m[1].trim());
      i++;
    }
    if (block.length === 0) {
      i++;
      continue;
    }
    const parseCells = (row: string): string[] =>
      row
        .split("|")
        .map((c) => c.replace(/\*\*([^*]+)\*\*/, "$1").trim())
        .filter((cell, idx, arr) => idx < arr.length - 1 || cell.trim().length > 0);
    const rows = block.map(parseCells);
    const colCount = Math.max(...rows.map((r) => r.length), 2);
    const headers =
      colCount >= 4 ? ["Método", "Ruta", "Descripción", "Auth"] : Array.from({ length: colCount }, (_, j) => `Col${j + 1}`);
    const headerRow = "| " + headers.slice(0, colCount).join(" | ") + " |";
    const sepRow = "|" + Array(colCount).fill(":---").join("|") + "|";
    result.push("", headerRow, sepRow);
    for (const cells of rows) {
      const padded = [...cells];
      while (padded.length < colCount) padded.push("");
      result.push("| " + padded.slice(0, colCount).join(" | ") + " |");
    }
    result.push("");
  }
  return result.join("\n");
}

/**
 * Si la cabecera y el separador están en la misma línea (ej. "| Método | Ruta |---|---|---"),
 * los separa en dos líneas para que la tabla renderice bien.
 */
function splitHeaderAndSeparatorOnSameLine(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const sepRun = trimmed.match(/\|\s*\-{2,}(\|\s*\-{2,})*\s*\|?\s*$/);
    if (sepRun && /[a-zA-Z\u00C0-\u024F]/.test(trimmed) && trimmed.includes("|")) {
      const sepStart = trimmed.length - sepRun[0].length;
      const headerPart = trimmed.slice(0, sepStart).trim();
      const colCount = Math.max(
        1,
        headerPart
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean).length,
      );
      const sepRow = "|" + Array(colCount).fill(":---").join("|") + "|";
      const headerNormalized = headerPart.endsWith("|") ? headerPart : headerPart + " |";
      out.push(headerNormalized, sepRow);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Normaliza el texto de la tabla de §4 (contratos): limpia separadores duplicados, convierte viñetas con pipes
 * en tabla Markdown válida y asegura un solo separador bajo el encabezado.
 */
export function normalizeContratosTableSummary(body: string): string {
  let out = splitHeaderAndSeparatorOnSameLine(body);
  out = deduplicateTableSeparators(out);
  out = convertListWithPipesToMarkdownTable(out);
  out = ensureTableSeparatorAfterHeader(out);
  return out;
}

/** True si la línea es la fila separadora de una tabla (solo |, - y espacios; trailing | opcional). */
function isTableSeparatorLine(trimmed: string): boolean {
  const withoutSpaces = trimmed.replace(/\s/g, "");
  if (
    (withoutSpaces.length > 0 &&
      /^[\|\-\:]+$/.test(withoutSpaces) &&
      trimmed.includes("|") &&
      (trimmed.includes("-") || trimmed.includes(":"))) ||
    /^\|[\-\:|]+\|?$/.test(withoutSpaces) ||
    /^[\-\:]+\|/.test(withoutSpaces)
  ) {
    return true;
  }
  if (!trimmed.startsWith("|") || !trimmed.includes("|")) return false;
  const cells = trimmed.split("|").map((c) => c.trim());
  return (
    cells.length >= 2 &&
    cells.some((c) => /-/.test(c)) &&
    cells.every((c) => c === "" || /^[\s\-:]+$/.test(c))
  );
}

/**
 * Elimina separadores duplicados o intercalados: deja solo una fila separadora justo después de la cabecera.
 * Omite líneas en blanco entre cabecera y separador/datos; si llega una fila de datos sin separador, lo inserta.
 */
function deduplicateTableSeparators(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let inTable = false;
  let headerDone = false;
  let separatorDone = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isSeparator = isTableSeparatorLine(trimmed);
    const isTableRow = /^\|\s*.+\s*\|?/.test(trimmed) && trimmed.includes("|");
    if (isTableRow && !isSeparator) {
      if (!inTable) {
        inTable = true;
        headerDone = false;
        separatorDone = false;
      }
      if (inTable && headerDone && !separatorDone) {
        const headerLine = out[out.length - 1];
        const colCount = headerLine
          ? Math.max(
            1,
            headerLine
              .trim()
              .split("|")
              .map((c) => c.trim())
              .filter(Boolean).length,
          )
          : 4;
        out.push("|" + Array(colCount).fill(":---").join("|") + "|");
        separatorDone = true;
      }
      out.push(line);
      if (!headerDone) headerDone = true;
      continue;
    }
    if (isSeparator) {
      if (inTable && headerDone && !separatorDone) {
        out.push(line);
        separatorDone = true;
      }
      continue;
    }
    if (trimmed === "" && inTable) {
      continue;
    }
    inTable = false;
    headerDone = false;
    separatorDone = false;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Añade línea separadora bajo la primera fila con pipes si falta (solo tras la cabecera real, no tras cada fila).
 * Si hay líneas en blanco entre cabecera y la primera fila de datos, no las emite y inserta el separador.
 */
function ensureTableSeparatorAfterHeader(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let i = 0;
  let lastPushedIsHeader = false;
  let separatorPushed = false;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const currentIsSeparator = isTableSeparatorLine(trimmed);
    const looksLikeHeaderRow =
      !currentIsSeparator &&
      /^\|\s*.+\s*\|?/.test(trimmed) &&
      trimmed.includes("|") &&
      /[a-zA-Z\u00C0-\u024F]/.test(trimmed);
    const isDataRow = /^\|\s*.+\s*\|?/.test(trimmed) && trimmed.includes("|") && !currentIsSeparator;

    if (trimmed === "" && lastPushedIsHeader && !separatorPushed) {
      i++;
      continue;
    }
    if (currentIsSeparator) {
      if (separatorPushed) {
        i++;
        continue;
      }
      separatorPushed = true;
    }
    if ((isDataRow || looksLikeHeaderRow) && !separatorPushed) lastPushedIsHeader = true;
    else if (isDataRow || looksLikeHeaderRow) lastPushedIsHeader = false;
    else if (trimmed !== "") {
      lastPushedIsHeader = false;
      separatorPushed = false;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

/** Repara fences ``` huérfanos entre filas de tabla §4 y ``` pegados al final de una fila. */
export function repairStrayFencesInContratosTable(body: string): string {
  if (!body?.trim()) return body;
  const lines = body.split("\n");
  const out: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const isSeparator = isTableSeparatorLine(trimmed);
    const isTableRow = trimmed.startsWith("|") && trimmed.includes("|") && !isSeparator;
    const isFenceOnly = /^```\s*$/.test(trimmed);

    if (isTableRow) {
      inTable = true;
      const fenceInRow = trimmed.match(/^(\|.+)\s+```(?:json)?\s*$/);
      if (fenceInRow) {
        out.push(fenceInRow[1]!.trimEnd());
        out.push("```json");
        continue;
      }
      out.push(line);
      continue;
    }

    if (inTable && isFenceOnly) {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === "") j++;
      const next = (lines[j] ?? "").trim();
      if (next.startsWith("|") || /^```json/i.test(next)) {
        continue;
      }
      inTable = false;
    }

    if (trimmed && !isTableRow && !isSeparator) {
      inTable = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Envuelve JSON minificado (líneas largas sin saltos) en bloques ```json con pretty-print.
 */
export function formatContratosBody(body: string): string {
  let normalized = stripLeadingContratosPlaceholder(body);
  normalized = repairStrayFencesInContratosTable(normalized);
  normalized = splitHeaderAndSeparatorOnSameLine(normalized);
  normalized = deduplicateTableSeparators(normalized);
  normalized = convertListWithPipesToMarkdownTable(normalized);
  normalized = ensureTableSeparatorAfterHeader(normalized);
  normalized = fixMarkdownTableRows(normalized);
  // Muchos renderers de markdown requieren línea en blanco antes de la tabla
  if (normalized.trimStart().startsWith("|")) {
    normalized = "\n" + normalized.trimStart();
  }
  const lines = normalized.split(/\n/);
  const result: string[] = [];
  for (const line of lines) {
    if (line.includes("```json") || line.trim().startsWith("```")) {
      result.push(line);
      continue;
    }
    if (line.length < 40 || (!line.includes("{") && !line.includes("["))) {
      result.push(line);
      continue;
    }
    const extracted = extractJsonFromLine(line);
    if (!extracted) {
      result.push(line);
      continue;
    }
    try {
      const parsed = JSON.parse(extracted.json) as unknown;
      const pretty = JSON.stringify(parsed, null, 2);
      const before = line.slice(0, extracted.start).trimEnd();
      const after = line.slice(extracted.end).trimStart();
      if (before) result.push(before);
      result.push("```json", pretty, "```");
      if (after) result.push(after);
    } catch {
      result.push(line);
    }
  }
  return result.join("\n");
}
