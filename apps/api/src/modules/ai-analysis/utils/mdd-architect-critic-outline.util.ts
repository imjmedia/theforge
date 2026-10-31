/**
 * @fileoverview Esquema compacto (outline) de §3 y §4 para el Architect Critic.
 *
 * Antes el crítico juzgaba `fragment.slice(0, 6000)`: una §3 con ~15 tablas ya superaba el
 * recorte, así que el LLM reportaba "falta tabla/endpoint X" para ítems que sí existían pero
 * quedaban fuera del corte, disparando regeneraciones innecesarias. El outline lista TODAS las
 * tablas (solo nombres de columna) y TODOS los endpoints (método + ruta + descripción corta) y,
 * si hay que recortar, descarta ítems completos con la nota "+N más" — nunca parte uno a medias.
 */

export const ARCHITECT_CRITIC_OUTLINE_MAX_CHARS = 12_000;

/** Tope de columnas listadas por tabla (cada tabla es UNA línea; se resume el resto). */
const MAX_COLUMNS_PER_TABLE = 24;
const MAX_ENDPOINT_DESC_CHARS = 90;

const CONSTRAINT_START_RE = /^(?:primary|foreign|unique|constraint|check|index|key|exclude|like)\b/i;
const HTTP_METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

type CreateTableInfo = { name: string; columns: string[]; extraColumns: number };

/** Parte `s` por comas de nivel 0 (ignora comas dentro de paréntesis, p. ej. `numeric(10,2)`). */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === "(") {
      depth += 1;
      cur += ch;
    } else if (ch === ")") {
      depth -= 1;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Cuerpo entre el paréntesis de apertura en `openIdx` y su cierre balanceado (o hasta el final). */
function balancedBody(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

/** Todas las `CREATE TABLE` de §3 con nombres de columna (y referencias FK `col→tabla`). */
export function parseCreateTables(section3: string): CreateTableInfo[] {
  const out: CreateTableInfo[] = [];
  const seen = new Set<string>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w]+"?\.)?"?([A-Za-z_]\w*)"?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section3)) !== null) {
    const name = m[1]!;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const openIdx = m.index + m[0].length - 1;
    const body = balancedBody(section3, openIdx);
    const cols: string[] = [];
    for (const raw of splitTopLevelCommas(body)) {
      const part = raw.replace(/--[^\n]*/g, "").trim();
      if (!part || CONSTRAINT_START_RE.test(part)) continue;
      const colName = part.match(/^"?([A-Za-z_]\w*)"?/)?.[1];
      if (!colName) continue;
      const ref = part.match(/\bREFERENCES\s+(?:"?[\w]+"?\.)?"?([A-Za-z_]\w*)"?/i)?.[1];
      cols.push(ref ? `${colName}→${ref}` : colName);
    }
    out.push({
      name,
      columns: cols.slice(0, MAX_COLUMNS_PER_TABLE),
      extraColumns: Math.max(0, cols.length - MAX_COLUMNS_PER_TABLE),
    });
  }
  return out;
}

function tableOutlineLine(t: CreateTableInfo): string {
  const cols = t.columns.join(", ") + (t.extraColumns > 0 ? `, +${t.extraColumns} cols` : "");
  return `- ${t.name}(${cols})`;
}

/** Entidades y relaciones del/los bloque(s) `erDiagram` (sin atributos). */
export function parseErDiagram(section3: string): { entities: string[]; relations: string[] } {
  const entities: string[] = [];
  const relations: string[] = [];
  const idx = section3.search(/\berDiagram\b/);
  if (idx < 0) return { entities, relations };
  const rest = section3.slice(idx);
  // Termina en el fence de cierre del bloque mermaid (si existe).
  const end = rest.indexOf("```");
  const block = end >= 0 ? rest.slice(0, end) : rest;
  for (const m of block.matchAll(/^\s*"?([A-Za-z_]\w*)"?\s*\{/gm)) {
    const n = m[1]!;
    if (!entities.includes(n)) entities.push(n);
  }
  for (const m of block.matchAll(/^\s*"?([A-Za-z_]\w*)"?\s+[|}o{.\-]+\s+"?([A-Za-z_]\w*)"?\s*(?::|$)/gm)) {
    const rel = `${m[1]}–${m[2]}`;
    if (!relations.includes(rel)) relations.push(rel);
    for (const n of [m[1]!, m[2]!]) if (!entities.includes(n)) entities.push(n);
  }
  return { entities, relations };
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

type EndpointInfo = { method: string; path: string; description: string };

/** Endpoints de §4: filas de tabla `| METHOD | /ruta | desc |` y headings `### METHOD /ruta`. */
export function parseEndpoints(section4: string): EndpointInfo[] {
  const byKey = new Map<string, EndpointInfo>();
  const add = (method: string, path: string, desc: string): void => {
    const p = path.replace(/[`),.;]+$/, "");
    if (!p.startsWith("/")) return;
    const key = `${method.toUpperCase()} ${p.toLowerCase()}`;
    const description = oneLine(desc, MAX_ENDPOINT_DESC_CHARS);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.description && description) existing.description = description;
      return;
    }
    byKey.set(key, { method: method.toUpperCase(), path: p, description });
  };

  let inFence = false;
  for (const line of section4.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Tabla con columnas separadas: | GET | /ruta | desc |
    const sep = line.match(
      new RegExp(`^\\s*\\|\\s*\`?(${HTTP_METHODS})\`?\\s*\\|\\s*\`?(/[^|\\s\`]*)\`?\\s*\\|([^\\n]*)$`, "i"),
    );
    if (sep) {
      const desc = (sep[3] ?? "").split("|")[0] ?? "";
      add(sep[1]!, sep[2]!, desc);
      continue;
    }
    // Tabla con celda combinada: | `GET /ruta` | desc |
    const combined = line.match(
      new RegExp(`^\\s*\\|\\s*\`?(${HTTP_METHODS})\\s+(/[^|\\s\`]*)\`?\\s*\\|([^\\n]*)$`, "i"),
    );
    if (combined) {
      add(combined[1]!, combined[2]!, (combined[3] ?? "").split("|")[0] ?? "");
      continue;
    }
    // Heading: ### 4.1 POST /ruta — descripción
    const heading = line.match(
      new RegExp(`^#{2,6}\\s*(?:\\d+(?:\\.\\d+)*\\.?\\s*)?\`?(${HTTP_METHODS})\\s+(/[^\\s\`]*)\`?\\s*(?:[-—–:]\\s*(.*))?$`, "i"),
    );
    if (heading) add(heading[1]!, heading[2]!, heading[3] ?? "");
  }
  return [...byKey.values()];
}

/** Cuenta bloques ```json en el cuerpo de §4. */
export function countJsonExamples(section4: string): number {
  return (section4.match(/^\s*```json\b/gim) ?? []).length;
}

/** Añade ítems completos mientras quepan en `budget`; el resto se resume como "+N más". */
function fitItems(items: string[], budget: number, noun: string): string[] {
  const total = items.reduce((n, l) => n + l.length + 1, 0);
  if (total <= budget) return items;
  const out: string[] = [];
  let used = 0;
  const reserve = `- +${items.length} más ${noun} (omitidas por tamaño)`.length + 1;
  for (const line of items) {
    if (used + line.length + 1 + reserve > budget) break;
    out.push(line);
    used += line.length + 1;
  }
  out.push(`- +${items.length - out.length} más ${noun} (omitidas por tamaño; NO las des por ausentes)`);
  return out;
}

export type ArchitectCriticOutlineInput = {
  section3?: string | null;
  section4?: string | null;
  /** Default `ARCHITECT_CRITIC_OUTLINE_MAX_CHARS`. */
  maxChars?: number;
};

/**
 * Outline compacto para el crítico. Nunca corta una tabla/endpoint a la mitad: si no cabe,
 * descarta ítems enteros y deja "+N más". Cada tabla/endpoint ocupa exactamente una línea.
 */
export function buildArchitectCriticOutline(input: ArchitectCriticOutlineInput): string {
  const maxChars = input.maxChars ?? ARCHITECT_CRITIC_OUTLINE_MAX_CHARS;
  const s3 = (input.section3 ?? "").trim();
  const s4 = (input.section4 ?? "").trim();

  const s3Items: string[] = [];
  const s3Tail: string[] = [];
  if (s3) {
    const tables = parseCreateTables(s3);
    if (tables.length === 0) s3Items.push("- (no se detectó ningún CREATE TABLE en §3)");
    for (const t of tables) s3Items.push(tableOutlineLine(t));
    const er = parseErDiagram(s3);
    s3Tail.push(
      er.entities.length > 0
        ? `- erDiagram entidades (${er.entities.length}): ${er.entities.join(", ")}`
        : "- erDiagram: no detectado",
    );
    if (er.relations.length > 0) {
      const shown = er.relations.slice(0, 60);
      s3Tail.push(
        `- erDiagram relaciones (${er.relations.length}): ${shown.join(", ")}${er.relations.length > shown.length ? ", …" : ""}`,
      );
    }
    const metaIdx = s3.search(/TechnicalMetadata/i);
    if (metaIdx >= 0) {
      const tags = [...new Set([...s3.slice(metaIdx).matchAll(/\[([a-z0-9_]+)\]/gi)].map((x) => x[1]!))].slice(0, 12);
      s3Tail.push(`- TechnicalMetadata: presente${tags.length ? ` [${tags.join(", ")}]` : ""}`);
    } else {
      s3Tail.push("- TechnicalMetadata: ausente");
    }
  }

  const s4Items: string[] = [];
  const s4Tail: string[] = [];
  if (s4) {
    const eps = parseEndpoints(s4);
    if (eps.length === 0) s4Items.push("- (no se detectó ningún endpoint en §4)");
    for (const e of eps) s4Items.push(`- ${e.method} ${e.path}${e.description ? ` — ${e.description}` : ""}`);
    s4Tail.push(`- Ejemplos JSON en §4: ${countJsonExamples(s4)}`);
  }

  const headerOverhead = 400;
  const tailLen = [...s3Tail, ...s4Tail].reduce((n, l) => n + l.length + 1, 0);
  const avail = Math.max(1_000, maxChars - headerOverhead - tailLen);
  const s3Total = s3Items.reduce((n, l) => n + l.length + 1, 0);
  const s4Total = s4Items.reduce((n, l) => n + l.length + 1, 0);
  let s3Budget = avail;
  let s4Budget = avail;
  if (s3 && s4) {
    if (s3Total + s4Total <= avail) {
      s3Budget = s3Total;
      s4Budget = s4Total;
    } else {
      const half = Math.floor(avail / 2);
      s3Budget = s3Total <= half ? s3Total : Math.max(half, avail - Math.min(s4Total, half));
      s4Budget = avail - Math.min(s3Total, s3Budget);
    }
  }

  const parts: string[] = [];
  if (s3) {
    parts.push(
      `### §3 Modelo de Datos — esquema compacto (${s3Items.length} ítem(s); solo nombres de columna, \`col→tabla\` = FK)`,
      ...fitItems(s3Items, s3Budget, "tablas"),
      ...s3Tail,
    );
  }
  if (s4) {
    if (parts.length) parts.push("");
    parts.push(
      `### §4 Contratos de API — endpoints detectados`,
      ...fitItems(s4Items, s4Budget, "endpoints"),
      ...s4Tail,
    );
  }
  return parts.join("\n");
}
