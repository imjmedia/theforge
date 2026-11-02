/**
 * @fileoverview F2 — §4 en chunks paralelos por tablas §3.
 */

import {
  extractSection3Body,
} from "./mdd-sanitize/section-merge.js";
import { parseModeloDatosFromSection3Markdown } from "./mdd-sanitize/section-structured.js";

const CREATE_TABLE_BLOCK_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)\s*\([\s\S]*?\)\s*;/gi;

const ENDPOINT_HEADING_RE = /^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/gim;

const COMMON_ROUTE_RE = /\/(health|status|auth\/|login|register|refresh)/i;

/**
 * Meta-comentario del LLM sobre el propio chunking (ej. «Los siguientes chunks
 * documentarán…», «continuará en la siguiente parte»). Sobrevive pegado al cuerpo
 * del último endpoint del chunk porque `mergeApiContractsChunkBodies` solo separa
 * por heading `### MÉTODO /ruta`, no limpia el texto final de cada bloque — y como
 * la tabla resumen ya sale completa (construida en código desde todos los chunks),
 * la nota queda contradiciendo lo que el propio documento ya muestra.
 */
const CHUNK_META_COMMENTARY_RE =
  /\n{1,2}(?:[-*]\s*)?(?:los?\s+(?:siguientes|próximos|demás)\s+chunks?|(?:the\s+)?(?:following|next|remaining)\s+chunks?|continuar[áa]\s+en\s+(?:la\s+)?siguiente\s+(?:parte|chunk)|se\s+document(?:ar[áa]n?|a)\s+en\s+(?:el\s+)?(?:siguiente|próximo)s?\s+chunks?)[^\n]*$/gi;

/** Quita meta-comentario sobre el chunking pegado al final de un bloque de endpoint. */
export function stripChunkMetaCommentary(block: string): string {
  return block.replace(CHUNK_META_COMMENTARY_RE, "").trimEnd();
}

/**
 * K = min(4, ceil(tables / 4)).
 *
 * Con divisor 7, 16 tablas → 3 chunks (~5-6 tablas y ~16 endpoints por llamada);
 * con modelos flash el presupuesto de salida se agota y el LLM degrada a tabla-resumen
 * sin request/response por endpoint (auditoría KMS job: catálogo 8/10, specs 4/10).
 * Divisor 4 fuerza más chunks con menos tablas cada uno → más profundidad por endpoint.
 */
export function computeApiContractsChunkCount(tableCount: number): number {
  if (tableCount <= 0) return 1;
  return Math.min(4, Math.ceil(tableCount / 4));
}

/** Nombres de tabla en orden de aparición (dedupe). */
export function extractSqlTableNames(sql: string): string[] {
  const names: string[] = [];
  for (const m of (sql ?? "").matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)/gi)) {
    const name = m[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Bloques CREATE TABLE indexados por nombre. */
export function extractCreateTableBlocks(sql: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const m of (sql ?? "").matchAll(CREATE_TABLE_BLOCK_RE)) {
    const full = m[0]?.trim();
    const name = m[1];
    if (full && name) blocks.set(name, full);
  }
  return blocks;
}

export type ApiContractsTableChunk = {
  index: number;
  tables: string[];
  sqlFragment: string;
};

/** Reparte tablas en K chunks (ceil división). */
export function splitTablesIntoApiContractsChunks(sql: string, k: number): ApiContractsTableChunk[] {
  const tableNames = extractSqlTableNames(sql);
  const chunkCount = Math.max(1, Math.min(k, tableNames.length || 1));
  if (tableNames.length === 0) {
    return [{ index: 0, tables: [], sqlFragment: sql.trim() }];
  }

  const blocks = extractCreateTableBlocks(sql);
  const chunks: ApiContractsTableChunk[] = [];
  const perChunk = Math.ceil(tableNames.length / chunkCount);

  for (let i = 0; i < chunkCount; i++) {
    const tables = tableNames.slice(i * perChunk, (i + 1) * perChunk);
    if (tables.length === 0) continue;
    const sqlFragment = tables
      .map((t) => blocks.get(t))
      .filter((b): b is string => !!b)
      .join("\n\n");
    chunks.push({ index: i, tables, sqlFragment });
  }
  return chunks.length ? chunks : [{ index: 0, tables: tableNames, sqlFragment: sql.trim() }];
}

export type ParsedEndpointHeading = {
  method: string;
  route: string;
};

/** Headings `### MÉTODO /ruta` en cuerpo §4. */
export function extractEndpointHeadingsFromContratosBody(body: string): ParsedEndpointHeading[] {
  const out: ParsedEndpointHeading[] = [];
  const seen = new Set<string>();
  for (const m of (body ?? "").matchAll(ENDPOINT_HEADING_RE)) {
    const method = (m[1] ?? "GET").toUpperCase();
    const route = (m[2] ?? "").replace(/[),.;]+$/, "");
    const key = route.toLowerCase();
    if (!route || seen.has(key)) continue;
    seen.add(key);
    out.push({ method, route });
  }
  return out;
}

/** Tabla «Resumen de endpoints» generada en código (no LLM). */
export function buildContratosSummaryTableFromHeadings(headings: ParsedEndpointHeading[]): string {
  if (!headings.length) {
    return "| Método | Ruta | Descripción | Auth |\n|--------|------|-------------|------|\n| GET | /health | Healthcheck | No |";
  }
  const rows = headings.map((h) => {
    const auth = COMMON_ROUTE_RE.test(h.route) ? "No" : "JWT";
    return `| ${h.method} | ${h.route} | | ${auth} |`;
  });
  return ["| Método | Ruta | Descripción | Auth |", "|--------|------|-------------|------|", ...rows].join("\n");
}

/** Elimina endpoints comunes en chunks > 0 y dedupe por ruta. */
export function stripCommonRoutesFromChunkBody(body: string, chunkIndex: number): string {
  if (chunkIndex === 0) return body.trim();
  const parts = body.split(/\n(?=###\s+(?:GET|POST|PUT|DELETE|PATCH)\s+)/i);
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
    if (m && COMMON_ROUTE_RE.test(m[2] ?? "")) continue;
    kept.push(trimmed);
  }
  return kept.join("\n\n").trim();
}

const ENDPOINT_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

/** `#### GET /ruta` … `###### GET /ruta` (heading más profundo que el canónico). */
const DEEP_HEADING_ENDPOINT_LINE_RE = /^#{4,6}\s+(GET|POST|PUT|DELETE|PATCH)\s+`?(\/[^\s`]*)`?(.*)$/;
/** `**GET /ruta**` o `**`GET /ruta`**`, con descripción opcional tras el cierre. */
const BOLD_WHOLE_ENDPOINT_LINE_RE = /^\*\*`?(GET|POST|PUT|DELETE|PATCH)\s+`?(\/[^\s`*]*)`?\*\*(.*)$/;
/** `**GET** /ruta` o `**GET** \`/ruta\``; también como ítem de lista (`- **GET** /ruta`). */
const BOLD_METHOD_ENDPOINT_LINE_RE = /^\*\*(GET|POST|PUT|DELETE|PATCH)\*\*\s+`?(\/[^\s`*]*)`?(.*)$/;
/** `` `GET /ruta` `` como línea suelta; solo si lo que sigue es vacío o un separador (—, –, :, -). */
const CODE_ENDPOINT_LINE_RE = /^`(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s`]*)`(\s*(?:[—–:-].*)?)$/;
/** `GET \`/ruta\`` como línea suelta; mismo criterio de cola que la variante anterior. */
const PLAIN_METHOD_CODE_LINE_RE = /^(GET|POST|PUT|DELETE|PATCH)\s+`(\/[^\s`]*)`(\s*(?:[—–:-].*)?)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_CELL_RE = /^:?-{2,}:?$/;

/** Convierte una línea de endpoint no canónica en `### MÉTODO /ruta` (+ descripción en línea propia). */
function endpointFromLine(line: string): string[] | null {
  const trimmed = line.trim().replace(/^[-*+]\s+/, "");
  const m =
    trimmed.match(DEEP_HEADING_ENDPOINT_LINE_RE) ??
    trimmed.match(BOLD_WHOLE_ENDPOINT_LINE_RE) ??
    trimmed.match(BOLD_METHOD_ENDPOINT_LINE_RE) ??
    trimmed.match(CODE_ENDPOINT_LINE_RE) ??
    trimmed.match(PLAIN_METHOD_CODE_LINE_RE);
  if (!m) return null;
  const method = m[1] ?? "";
  const route = m[2] ?? "";
  const desc = (m[3] ?? "").replace(/^\s*[—–:-]+\s*/, "").trim();
  return desc ? [`### ${method} ${route}`, desc] : [`### ${method} ${route}`];
}

function splitTableRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map((c) => c.trim());
}

/** Fila GFM con método en la primera celda y ruta `/…` en la segunda. */
function endpointFromTableCells(
  cells: string[],
): { method: string; route: string; desc: string } | null {
  const method = (cells[0] ?? "").replace(/[*`]/g, "").trim();
  const route = (cells[1] ?? "").replace(/[*`]/g, "").trim();
  if (!ENDPOINT_METHODS.has(method) || !route.startsWith("/")) return null;
  const desc = cells
    .slice(2)
    .filter((c) => c && !TABLE_SEPARATOR_CELL_RE.test(c))
    .join(" · ");
  return { method, route, desc };
}

/**
 * Bloque de tabla GFM: si contiene filas de endpoint, cada fila pasa a `### MÉTODO /ruta`
 * y se descartan separador y cabecera; si no, el bloque queda intacto.
 */
function convertTableBlock(rows: string[]): string[] {
  const parsed = rows.map((raw) => ({ raw, cells: splitTableRow(raw) }));
  if (!parsed.some((row) => endpointFromTableCells(row.cells))) return rows;

  const out: string[] = [];
  let seenEndpoint = false;
  for (const row of parsed) {
    const ep = endpointFromTableCells(row.cells);
    if (ep) {
      seenEndpoint = true;
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`### ${ep.method} ${ep.route}`);
      if (ep.desc) out.push(ep.desc);
      continue;
    }
    if (row.cells.every((c) => TABLE_SEPARATOR_CELL_RE.test(c))) continue;
    if (!seenEndpoint) continue;
    out.push(row.raw);
  }
  return out;
}

/**
 * Normaliza headings de endpoint de chunks a la forma canónica `### MÉTODO /ruta`.
 * Cubre `#### GET /ruta`, `**GET /ruta**`, `**GET** \`/ruta\``, `- **GET** /ruta`,
 * `` `GET /ruta` `` suelta y filas GFM `| GET | /ruta | … |`. No toca contenido dentro de
 * bloques ``` (p. ej. ```json). Idempotente: la salida canónica no vuelve a cambiar.
 */
export function normalizeEndpointHeadingsForChunkMerge(body: string): string {
  const lines = (body ?? "").split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }
    if (TABLE_ROW_RE.test(line)) {
      const start = i;
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? "")) i++;
      out.push(...convertTableBlock(lines.slice(start, i)));
      continue;
    }
    out.push(...(endpointFromLine(line) ?? [line]));
    i++;
  }
  return out.join("\n");
}

/**
 * Fusiona cuerpos §4 de chunks: dedupe rutas, tabla resumen determinista al inicio.
 */
export function mergeApiContractsChunkBodies(chunkBodies: string[]): string {
  const routeToBlock = new Map<string, string>();
  const headings: ParsedEndpointHeading[] = [];

  for (let i = 0; i < chunkBodies.length; i++) {
    const body = stripCommonRoutesFromChunkBody(chunkBodies[i] ?? "", i);
    for (const block of body.split(/\n(?=###\s+(?:GET|POST|PUT|DELETE|PATCH)\s+)/i)) {
      const t = block.trim();
      if (!t.startsWith("###")) continue;
      const m = t.match(/^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
      if (!m?.[1] || !m[2]) continue;
      const method = m[1].toUpperCase();
      const route = m[2].replace(/[),.;]+$/, "");
      const routeKey = route.toLowerCase();
      if (routeToBlock.has(routeKey)) continue;
      routeToBlock.set(routeKey, stripChunkMetaCommentary(t));
      headings.push({ method, route });
    }
  }

  const summary = buildContratosSummaryTableFromHeadings(headings);
  const details = [...routeToBlock.values()].join("\n\n");
  return `## 4. Contratos de API\n\n### Resumen de endpoints\n\n${summary}\n\n${details}`.trim();
}

/** Prompt extra por chunk para el arquitecto §4. */
export function apiContractsChunkPromptBlock(chunk: ApiContractsTableChunk, totalChunks: number): string {
  const tables = chunk.tables.length ? chunk.tables.join(", ") : "(todas las tablas §3)";
  const commonRule =
    chunk.index === 0
      ? "Este chunk **incluye** endpoints comunes: `/health` o `/status` y rutas `auth`/`login` si aplican."
      : "**PROHIBIDO** documentar `/health`, `/status`, `/auth/*`, `/login`, `/register` — ya los cubre el chunk 1.";
  return (
    `**Chunk §4 (${chunk.index + 1}/${totalChunks}):** Genera endpoints **solo** para tablas: ${tables}.\n` +
    `${commonRule}\n` +
    "No generes la tabla «Resumen de endpoints»; el pipeline la construye en código.\n" +
    "Responde solo con bloques `### MÉTODO /ruta` y payloads JSON (sin tabla GFM)."
  );
}

export { mergeApiContractsBodyIntoDraft, repairMergeBaselineBeforeApiContractsMerge } from "./mdd-api-contracts-merge.util.js";

/** Planifica chunks desde el draft actual (§3). */
export function planApiContractsChunksFromDraft(draft: string): {
  chunkCount: number;
  chunks: ApiContractsTableChunk[];
} {
  const section3 = extractSection3Body(draft);
  const parsed = section3 ? parseModeloDatosFromSection3Markdown(section3) : null;
  const sql = parsed?.sql ?? "";
  const tableNames = extractSqlTableNames(sql);
  const chunkCount = computeApiContractsChunkCount(tableNames.length);
  const chunks = splitTablesIntoApiContractsChunks(sql, chunkCount);
  return { chunkCount, chunks };
}

/** True si conviene fan-out paralelo (más de 7 tablas). */
export function shouldUseApiContractsChunkParallel(draft: string): boolean {
  const { chunkCount } = planApiContractsChunksFromDraft(draft);
  return chunkCount > 1;
}
