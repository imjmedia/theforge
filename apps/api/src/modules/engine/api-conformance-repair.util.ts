import {
  checkApiVsMdd,
  extractTableEndpoints,
  extractMddSection4EndpointsForConformance,
  normEp,
  apiEndpointsMatch,
  type ApiConformanceResult,
} from "./conformance.service.js";
import { unifyApiContractsPrefix } from "./api-prefix-unify.util.js";

/**
 * Chequeo de conformidad API↔MDD usado por el bucle de reparación/reintento de los generadores.
 * Solo considera filas de tablas GFM (misma vara que {@link reconcileApiContractsToMdd}), de modo que
 * secciones de detalle por endpoint (`### DELETE /x`) o prosa no disparan reintentos LLM que no convergen.
 */
export function runApiConformanceCheck(
  mddContent: string,
  apiContent: string,
): ApiConformanceResult {
  return checkApiVsMdd(mddContent, apiContent, { tablesOnly: true });
}

/** Feedback conciso para reintento LLM. */
export function buildApiRetryFeedback(result: ApiConformanceResult): string {
  const parts: string[] = [];
  if (result.missingInApi.length > 0) {
    parts.push(
      `Faltan ${result.missingInApi.length} endpoint(s) del MDD §4 en el documento API. ` +
        `DEBES añadir UNA fila por endpoint en la tabla markdown (Método | Ruta | …): ` +
        result.missingInApi.slice(0, 12).join(", ") +
        (result.missingInApi.length > 12 ? ", …" : ""),
    );
  }
  if (result.extraInApi.length > 0) {
    parts.push(
      `Elimina o alinea ${result.extraInApi.length} endpoint(s) no declarados en MDD §4: ` +
        result.extraInApi.slice(0, 8).join(", ") +
        (result.extraInApi.length > 8 ? ", …" : ""),
    );
  }
  return parts.join("\n\n");
}

/** Fila generada por defecto por el reparador (sin información real del documento). */
function isDefaultApiRow(row: string): boolean {
  return row.split("|").some((c) => c.trim() === "MDD §4");
}

/**
 * Indexa las filas de tabla por endpoint normalizado. Ante duplicados prefiere la fila con contenido
 * real (distinta de la fila por defecto) para no perder descripciones al colapsar bloques repetidos.
 */
function indexApiTableRowsByNorm(apiContent: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of apiContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|\s*[-:]+\s*\|/.test(trimmed)) continue;
    const eps = extractTableEndpoints(trimmed);
    if (eps.length !== 1) continue;
    const key = normEp(eps[0]!);
    const prev = map.get(key);
    if (prev === undefined || (isDefaultApiRow(prev) && !isDefaultApiRow(trimmed))) {
      map.set(key, trimmed);
    }
  }
  return map;
}

function findRowForMddEndpoint(norm: string, rowByNorm: Map<string, string>): string | undefined {
  if (rowByNorm.has(norm)) return rowByNorm.get(norm);
  for (const [key, row] of rowByNorm) {
    if (apiEndpointsMatch(norm, key)) return row;
  }
  return undefined;
}

function defaultApiTableRow(ep: { method: string; path: string }): string {
  const path = ep.path.replace(/`/g, "").trim();
  return `| ${ep.method.toUpperCase()} | \`${path}\` | MDD §4 | Bearer | auto |`;
}

/** Encabezado del bloque que el reparador añade cuando no hay tabla de endpoints. */
const API_BLOCK_HEADING = "## Contratos API (MDD §4)";

/**
 * Índice de línea donde termina el preámbulo del documento: la primera línea `## ` posterior al H1 o
 * el primer encabezado `### GET /x`. Si no hay ninguno, el preámbulo es todo el documento.
 */
function findApiDocPreambleEnd(lines: string[]): number {
  let seenH1 = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (/^#{1,3}\s+\**(GET|POST|PUT|PATCH|DELETE)\**\s+\//i.test(trimmed)) return i;
    if (/^#\s+/.test(trimmed)) seenH1 = true;
    else if (seenH1 && /^##\s+/.test(trimmed)) return i;
  }
  return lines.length;
}

/**
 * Quita todos los bloques `## Contratos API (MDD §4)` (del encabezado al siguiente `## ` o fin).
 * `lines` es el documento resultante; `insertAt` es la posición (en `lines`) donde estaba el primer
 * bloque eliminado, o `null` si no había ninguno.
 */
function stripApiContractBlocks(content: string): { lines: string[]; insertAt: number | null } {
  const out: string[] = [];
  let skipping = false;
  let insertAt: number | null = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === API_BLOCK_HEADING) {
      skipping = true;
      if (insertAt === null) insertAt = out.length;
      continue;
    }
    if (skipping && /^##\s/.test(trimmed)) skipping = false;
    if (!skipping) out.push(line);
  }
  return { lines: out, insertAt };
}

const isSeparatorRow = (line: string): boolean => /^\|\s*:?-+/.test(line.trim());

/** Aplica `fn` a cada tabla GFM (líneas consecutivas que empiezan por `|`); el resto pasa intacto. */
function mapTableBlocks(lines: string[], fn: (block: string[]) => string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.trim().startsWith("|")) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.trim().startsWith("|")) j++;
    out.push(...fn(lines.slice(i, j)));
    i = j;
  }
  return out;
}

/** Tabla GFM de endpoints: rango de filas (`start` = primera fila de endpoint, `end` exclusivo) y cabecera. */
type EndpointTable = { start: number; end: number; header: string[] };

/** Cabecera (nombres + separador) de una tabla: líneas hasta el separador inclusive, o `[]` si no hay. */
function tableHeaderOf(block: string[]): string[] {
  const sep = block.findIndex(isSeparatorRow);
  return sep >= 1 ? block.slice(0, sep + 1) : [];
}

/**
 * Localiza la primera tabla GFM de endpoints: cabecera con columnas Método y Ruta (o sin cabecera) y al menos una fila
 * cuyo método+ruta estén en celdas de tabla (una tabla «Convenciones» con rutas en prosa no cuenta).
 */
function findFirstEndpointTable(lines: string[]): EndpointTable | null {
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.trim().startsWith("|")) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.trim().startsWith("|")) j++;
    const block = lines.slice(i, j);
    const header = tableHeaderOf(block);
    // Sin cabecera (filas sueltas) se acepta; con cabecera, debe declarar Método y Ruta.
    if (header.length === 0 || hasMethodPathHeader(header)) {
      const first = block.findIndex((l, k) => k >= header.length && extractTableEndpoints(l.trim()).length > 0);
      if (first >= 0) return { start: i + first, end: j, header: [...lines.slice(i, i + header.length)] };
    }
    i = j;
  }
  return null;
}

const splitCells = (row: string): string[] =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** Índices de las columnas Método (`m`) y Ruta (`r`) en una fila de nombres de cabecera (-1 si faltan). */
function methodPathIdx(names: string[]): { m: number; r: number } {
  return {
    m: names.findIndex((n) => /^\**\s*(m[eé]todo|method|verbo)\b/i.test(n)),
    r: names.findIndex((n) => /^\**\s*(ruta|path|endpoint|url)\b/i.test(n)),
  };
}

/** `true` si la cabecera (nombres + separador) declara columnas Método y Ruta. */
function hasMethodPathHeader(header: string[]): boolean {
  if (header.length < 2) return false;
  const { m, r } = methodPathIdx(splitCells(header[header.length - 2]!));
  return m >= 0 && r >= 0;
}

/** `true` si Método y Ruta son las dos primeras columnas de la cabecera (catálogo de endpoints). */
function isEndpointCatalogHeader(header: string[]): boolean {
  if (header.length < 2) return false;
  const { m, r } = methodPathIdx(splitCells(header[header.length - 2]!));
  return m >= 0 && r >= 0 && m + r === 1;
}

/** Posición de las columnas Método y Ruta según la fila de cabecera (por defecto 0 y 1). */
function resolveColumnLayout(header: string[]): { columns: number; methodIdx: number; pathIdx: number } {
  const sep = header[header.length - 1];
  // Tabla sin cabecera (solo filas): no se fuerza el número de columnas.
  if (!sep) return { columns: 0, methodIdx: 0, pathIdx: 1 };
  const columns = splitCells(sep).length;
  const names = header.length >= 2 ? splitCells(header[header.length - 2]!) : [];
  const { m, r } = methodPathIdx(names);
  return { columns, methodIdx: m >= 0 ? m : 0, pathIdx: r >= 0 ? r : m === 1 ? 0 : 1 };
}

/**
 * Ajusta una fila por defecto (`| M | ruta | MDD §4 | Bearer | auto |`) a las columnas de la cabecera,
 * colocando Método y Ruta en sus columnas y rellenando el resto en orden con el valor por defecto o «—».
 */
function fitRowToColumns(
  row: string,
  layout: { columns: number; methodIdx: number; pathIdx: number },
): string {
  if (layout.columns <= 0) return row;
  const [method, path, ...rest] = splitCells(row);
  const cells: string[] = Array.from({ length: layout.columns }, () => "—");
  cells[layout.methodIdx] = method ?? "—";
  if (layout.pathIdx !== layout.methodIdx) cells[layout.pathIdx] = path ?? "—";
  let k = 0;
  for (let c = 0; c < layout.columns; c++) {
    if (c === layout.methodIdx || c === layout.pathIdx) continue;
    if (k < rest.length) cells[c] = rest[k++]!;
  }
  return `| ${cells.join(" | ")} |`;
}

/**
 * Quita las filas por defecto (`MDD §4`) cuyo endpoint ya tiene una fila real en otra parte del documento.
 * Si una tabla se queda sin filas de datos, se elimina entera. Sin duplicados no cambia nada.
 */
function dedupeDefaultRowsWithRealTwin(content: string): string {
  const lines = content.split(/\r?\n/);
  const realNorms = new Set<string>();
  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith("|") || isSeparatorRow(t) || isDefaultApiRow(t)) continue;
    const eps = extractTableEndpoints(t);
    if (eps.length === 1) realNorms.add(normEp(eps[0]!));
  }
  let changed = false;
  const out = mapTableBlocks(lines, (block) => {
    const kept = block.filter((l) => {
      const t = l.trim();
      if (isSeparatorRow(t) || !isDefaultApiRow(t)) return true;
      const eps = extractTableEndpoints(t);
      return !(eps.length === 1 && realNorms.has(normEp(eps[0]!)));
    });
    if (kept.length === block.length) return block;
    changed = true;
    const header = tableHeaderOf(kept);
    return kept.length > header.length ? kept : [];
  });
  return changed ? out.join("\n") : content;
}

/**
 * Reconstruye la tabla API según MDD §4 (SSOT): sin extras, con filas faltantes.
 * - «Conforme» se decide solo por filas de tablas GFM (la prosa y los `### GET /x` se respetan).
 * - Un documento conforme con a lo sumo un bloque «Contratos API (MDD §4)» sale intacto (sin perder
 *   descripciones reales) salvo que una fila por defecto duplique un endpoint que ya tiene fila real
 *   (se descarta la por defecto); con N>1 bloques se colapsa a uno conservando las filas con contenido real.
 * - Los endpoints extra se eliminan fila a fila solo de tablas con columnas Método/Ruta; las filas sin
 *   endpoint y las demás tablas (Errores, Ejemplos…) se conservan.
 * - Sin tabla de endpoints se inserta el bloque nuevo en el lugar del bloque eliminado (o tras el
 *   preámbulo) y el resto del documento se conserva íntegro.
 * Idempotente: f(f(x)) = f(x).
 */
export function reconcileApiContractsToMdd(mddContent: string, apiContent: string): string {
  const { content: prefixed } = unifyApiContractsPrefix(mddContent, apiContent ?? "");
  // Misma extracción que el chequeo (tabla primero, prosa solo sin tabla) para no añadir filas «extra».
  const mddEps = extractMddSection4EndpointsForConformance(mddContent);
  if (mddEps.length === 0) return prefixed;

  const bloques = prefixed.split(/\r?\n/).filter((l) => l.trim() === API_BLOCK_HEADING).length;
  if (bloques <= 1 && checkApiVsMdd(mddContent, prefixed, { tablesOnly: true }).ok) {
    return `${dedupeDefaultRowsWithRealTwin(prefixed).trimEnd()}\n`;
  }

  // Las filas reales se indexan ANTES de quitar los bloques para no perder descripciones.
  const rowByNorm = indexApiTableRowsByNorm(prefixed);
  const stripped = stripApiContractBlocks(prefixed);
  const sinBloques = stripped.insertAt === null ? prefixed : `${stripped.lines.join("\n").trimEnd()}\n`;
  if (bloques > 1 && checkApiVsMdd(mddContent, sinBloques, { tablesOnly: true }).ok) {
    return `${sinBloques.trimEnd()}\n`;
  }

  const rowsFor = (layout: { columns: number; methodIdx: number; pathIdx: number }): string[] =>
    mddEps.map((ep) => {
      const existing = findRowForMddEndpoint(normEp(ep), rowByNorm);
      return existing ?? fitRowToColumns(defaultApiTableRow(ep), layout);
    });

  const mddNorms = mddEps.map(normEp);
  const isExtraRow = (line: string): boolean => {
    const t = line.trim();
    if (!t.startsWith("|") || isSeparatorRow(t)) return false;
    const eps = extractTableEndpoints(t);
    return (
      eps.length > 0 &&
      eps.every((e) => {
        const n = normEp(e);
        return !mddNorms.some((m) => m === n || apiEndpointsMatch(m, n));
      })
    );
  };
  /**
   * Elimina filas extra solo en tablas de catálogo de endpoints: cabecera con Método y Ruta como las dos
   * primeras columnas (en cualquier orden). Tablas como «Código | Método | Ruta ejemplo» no se tocan.
   */
  const dropExtras = (ls: string[]): string[] =>
    mapTableBlocks(ls, (block) => {
      const header = tableHeaderOf(block);
      if (header.length > 0 && !isEndpointCatalogHeader(header)) return block;
      return block.filter((l, k) => k < header.length || !isExtraRow(l));
    });

  const lines = sinBloques.split(/\r?\n/);
  const table = findFirstEndpointTable(lines);
  if (table) {
    const layout = resolveColumnLayout(table.header);
    // Filas sin endpoint dentro del rango se conservan; las de endpoint se sustituyen por las del MDD.
    const kept = lines.slice(table.start, table.end).filter((l) => extractTableEndpoints(l.trim()).length === 0);
    const before = dropExtras(lines.slice(0, table.start));
    const after = dropExtras(lines.slice(table.end));
    const merged = [...before, ...rowsFor(layout), ...kept, ...after];
    return `${merged.join("\n").trimEnd()}\n`;
  }

  // Sin tabla de endpoints: el bloque nuevo ocupa el sitio del eliminado (o va tras el preámbulo) y
  // el resto del documento (Autenticación, §2 Esquemas, §3 Códigos…) se conserva íntegro.
  const docLines = stripped.insertAt === null ? lines : stripped.lines;
  const at = stripped.insertAt ?? findApiDocPreambleEnd(docLines);
  const block =
    `${API_BLOCK_HEADING}\n\n` +
    `| Método | Ruta | Descripción | Auth | Notas |\n|--------|------|-------------|------|-------|\n` +
    rowsFor({ columns: 5, methodIdx: 0, pathIdx: 1 }).join("\n");
  const head = docLines.slice(0, at).join("\n").trimEnd();
  const tail = docLines.slice(at).join("\n").trim();
  return `${[head.length > 0 ? head : "# Contratos API", block, tail].filter((x) => x.length > 0).join("\n\n")}\n`;
}

/** Añade filas de tabla para endpoints §4 ausentes (conformidad determinista). */
export function injectMissingApiEndpoints(mddContent: string, apiContent: string): string {
  return reconcileApiContractsToMdd(mddContent, apiContent);
}

/** Reparación post-IA: tabla API = MDD §4 (prefijo unificado, sin endpoints extra). */
export function repairApiProgrammaticGaps(mddContent: string, apiContent: string): string {
  return reconcileApiContractsToMdd(mddContent, apiContent);
}
