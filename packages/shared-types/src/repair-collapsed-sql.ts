/**
 * SQL pegado en una sola línea (chat/Word) → bloque ```sql multilínea.
 */

const SQL_GLUE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/DEFAULT_NOW\(\)/gi, "DEFAULT NOW()"],
  [/DEFAULT_gen_random_uuid\(\)/gi, "DEFAULT gen_random_uuid()"],
  [/NOT_NULL_REFERENCES/gi, "NOT NULL REFERENCES"],
  [/UUID\s+NOT\s+NULL_REFERENCES/gi, "UUID NOT NULL REFERENCES"],
  [/UUID_REFERENCES/gi, "UUID REFERENCES"],
  [/REFERENCES_([a-z_]+)/gi, "REFERENCES $1"],
  [/([a-z])_(VARCHAR|TEXT|JSONB|BOOLEAN|INTEGER|BIGINT|DECIMAL|TIMESTAMPTZ|INET)\b/gi, "$1 $2"],
  [/(?<![a-z])_(UUID)\b/g, " UUID"],
  [/_(NOT\s+NULL)\b/gi, " $1"],
  [/_(ON\s+DELETE)\b/gi, " $1"],
  [/_(PRIMARY\s+KEY)\b/gi, " $1"],
  [/_(REFERENCES)([a-z_])/gi, " REFERENCES$2"],
  [/_(REFERENCES)\b/gi, " REFERENCES"],
  [/([a-z_])_(ON|DEFAULT)\b/gi, "$1 $2"],
  [/\bON_(DELETE|UPDATE|CASCADE|RESTRICT|SET|NO\s+ACTION)\b/gi, "ON $1"],
  [/regiON\s+estado\s*\(/gi, "region_estado("],
  [/^_(CREATE|INDEX)\b/gim, "$1"],
];

function normalizeGluedSqlTokens(sql: string): string {
  let out = sql;
  for (const [re, rep] of SQL_GLUE_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out.replace(/idx_[a-z0-9_]+_ON_/gi, (m) => m.replace(/_ON_/, "_ON "));
}

export interface SqlCreateStatement {
  comment?: string;
  name: string;
  body: string;
}

const NEXT_COL_RE =
  /^[a-z_][\w]*\s+(?:UUID|VARCHAR|TEXT|INTEGER|BOOLEAN|BIGINT|JSONB|TIMESTAMPTZ|DECIMAL|CHECK|REFERENCES|UNIQUE|PRIMARY|FOREIGN|CONSTRAINT)/i;

function skipInlineSqlComment(inner: string, start: number, depth: number): number {
  let i = start + 2;
  while (i < inner.length) {
    const ch = inner[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) {
      const rest = inner.slice(i + (ch === "," ? 1 : 0)).trimStart();
      if (NEXT_COL_RE.test(rest)) {
        return ch === "," ? i + 1 : i;
      }
    }
    if (ch === "," && depth === 0) {
      const rest = inner.slice(i + 1).trimStart();
      if (NEXT_COL_RE.test(rest)) return i + 1;
    }
    i++;
  }
  return i;
}

/** Quita comentarios `--` inline antes de la siguiente columna. */
export function stripInlineSqlComments(body: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    if (body.slice(i, i + 2) === "--" && depth === 0) {
      i = skipInlineSqlComment(body, i, depth);
      continue;
    }
    const ch = body[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    out += ch;
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Parte el interior de CREATE TABLE (…) respetando paréntesis y comentarios `--` inline. */
export function splitSqlColumnDefs(inner: string): string[] {
  const normalized = stripInlineSqlComments(inner);
  const cols: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      const part = normalized.slice(start, i).trim();
      if (part) cols.push(part);
      start = i + 1;
    }
    i++;
  }
  const last = normalized.slice(start).trim();
  if (last) cols.push(last);
  return cols;
}

/**
 * Comentario SQL (`-- …`) pegado justo antes de un `CREATE`. Texto colapsado en una sola línea:
 * el comentario es lo que queda tras el último `;` del bloque previo (no se mira dentro de otra sentencia).
 */
function readTableCommentBeforeCreate(before: string): string | undefined {
  const tail = before.slice(before.lastIndexOf(";") + 1);
  const idx = tail.search(/--(?!-)/);
  if (idx < 0) return undefined;
  let comment = tail.slice(idx + 2).trim();
  const cut = comment.search(/\sCREATE (?:TABLE|INDEX)\s/i);
  if (cut > 0) comment = comment.slice(0, cut).trim();
  return comment || undefined;
}

/** Extrae CREATE TABLE … ); de texto colapsado (espacios/newlines arbitrarios). */
export function extractCreateStatements(sql: string): SqlCreateStatement[] {
  const s = sql.replace(/\s+/g, " ").trim();
  const results: SqlCreateStatement[] = [];
  const createRe = /CREATE TABLE\s+(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(s)) !== null) {
    const name = m[1]!;
    const open = m.index + m[0].length;
    let depth = 1;
    let i = open;
    while (i < s.length && depth > 0) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      i++;
    }
    const body = s.slice(open, i - 1).trim();
    const before = s.slice(0, m.index).trimEnd();
    const comment = readTableCommentBeforeCreate(before);
    results.push({ comment, name, body });
  }
  return results;
}

export function extractCreateIndexStatements(sql: string): string[] {
  const s = sql.replace(/\s+/g, " ").trim();
  const re = /CREATE INDEX\s+(\S+)\s+ON\s+(\S+)\s*\([^)]+\)\s*;?/gi;
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const stmt = m[0].trim();
    lines.push(stmt.endsWith(";") ? stmt : `${stmt};`);
  }
  return lines;
}

export function formatCreateStatement(stmt: SqlCreateStatement): string {
  const cols = splitSqlColumnDefs(stmt.body);
  const lines: string[] = [];
  if (stmt.comment) lines.push(`-- ${stmt.comment}`);
  lines.push(`CREATE TABLE ${stmt.name} (`);
  cols.forEach((col, idx) => {
    lines.push(`  ${col}${idx < cols.length - 1 ? "," : ""}`);
  });
  lines.push(");");
  return lines.join("\n");
}

export function expandCollapsedSqlText(raw: string): string | null {
  if (!/CREATE TABLE/i.test(raw)) return null;
  const normalized = normalizeGluedSqlTokens(raw.replace(/\s+/g, " ").trim());
  const stmts = extractCreateStatements(normalized);
  if (stmts.length === 0) return null;
  const blocks = stmts.map(formatCreateStatement);
  const indexes = extractCreateIndexStatements(normalized);
  if (indexes.length > 0) {
    blocks.push(indexes.join("\n"));
  }
  return blocks.join("\n\n");
}

export function lineLooksCollapsedSql(t: string): boolean {
  if (!/CREATE TABLE/i.test(t)) return false;
  return (
    t.length > 100 ||
    /--\s*[^\n]*CREATE TABLE/i.test(t) ||
    (t.match(/CREATE TABLE/gi)?.length ?? 0) > 1 ||
    /\)\s*;\s*--/.test(t) ||
    /CREATE INDEX\s+\S+\s+ON\s+\S+\([^)]+\)/i.test(t) ||
    /nombre_VARCHAR|NOT NULL_REFERENCES|REFERENCES_\w|DEFAULT_NOW/i.test(t)
  );
}

/** Separa título "Esquema SQL …" del SQL pegado en la misma línea. */
export function splitEsquemaSqlHeadingFromPayload(line: string): {
  heading: string;
  rest: string;
} | null {
  const t = line.trim();
  if (!/\bEsquema SQL\b/i.test(t)) return null;
  const payloadIdx = t.search(
    /\s+(?=(?:--(?!-)|CREATE\s+(?:TABLE|INDEX)\b))/i,
  );
  if (payloadIdx <= 0) return null;
  const heading = t.slice(0, payloadIdx).trim();
  const rest = t.slice(payloadIdx).trim();
  if (!/^Esquema SQL/i.test(heading.replace(/^#{1,4}\s+/, ""))) return null;
  if (!rest || !/CREATE\s+(TABLE|INDEX)/i.test(rest)) return null;
  return { heading, rest };
}

function formatEsquemaHeading(heading: string): string {
  const h = heading.trim();
  return /^#{1,4}\s/.test(h) ? h : `### ${h}`;
}

function emitSqlChunk(out: string[], chunkParts: string[]): boolean {
  if (chunkParts.length === 0) return false;
  const joined = chunkParts.join(" ");
  const expanded = expandCollapsedSqlText(joined);
  if (!expanded) return false;
  out.push("");
  out.push("```sql");
  out.push(expanded);
  out.push("```");
  out.push("");
  return true;
}

function collectCollapsedSqlChunk(
  lines: string[],
  startIdx: number,
): { chunk: string[]; nextIdx: number; nestedHeading?: string } {
  const chunk: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const lt = lines[i]!.trim();
    if (!lt) {
      i++;
      continue;
    }
    if (/^```/.test(lt)) break;

    const innerSplit = splitEsquemaSqlHeadingFromPayload(lt);
    if (innerSplit) {
      if (chunk.length > 0) {
        return { chunk, nextIdx: i, nestedHeading: innerSplit.heading };
      }
      return {
        chunk: [innerSplit.rest],
        nextIdx: i + 1,
        nestedHeading: innerSplit.heading,
      };
    }

    if (/^#{1,6}\s/.test(lt) && !/^Esquema SQL/i.test(lt)) break;
    if (
      lineLooksCollapsedSql(lt) ||
      /^--(?!-)\s*\S/.test(lt) ||
      /^CREATE (TABLE|INDEX)\b/i.test(lt)
    ) {
      chunk.push(lt);
      i++;
    } else if (chunk.length > 0) {
      break;
    } else {
      i++;
    }
  }
  return { chunk, nextIdx: i };
}

/**
 * Secciones "Esquema SQL …" y párrafos con CREATE colapsado → ```sql.
 */
export function repairCollapsedSqlParagraphs(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();

    if (/^```/.test(t)) {
      inFence = t !== "```";
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const headingSplit = splitEsquemaSqlHeadingFromPayload(t);
    const isEsquemaHeading = /^(#{1,4}\s+)?Esquema SQL\b/i.test(t);
    const isCollapsed = lineLooksCollapsedSql(t);

    if (!headingSplit && !isEsquemaHeading && !isCollapsed) {
      out.push(line);
      continue;
    }

    if (headingSplit) {
      out.push(formatEsquemaHeading(headingSplit.heading));
      let collected = collectCollapsedSqlChunk(lines, i + 1);
      const chunk = [headingSplit.rest, ...collected.chunk];
      if (!emitSqlChunk(out, chunk)) out.push(headingSplit.rest);
      i = collected.nextIdx - 1;
      while (collected.nestedHeading) {
        out.push(formatEsquemaHeading(collected.nestedHeading));
        collected = collectCollapsedSqlChunk(lines, i + 1);
        if (!emitSqlChunk(out, collected.chunk) && collected.chunk.length > 0) {
          out.push(...collected.chunk);
        }
        i = collected.nextIdx - 1;
      }
      continue;
    }

    if (isEsquemaHeading) {
      out.push(formatEsquemaHeading(t));
      i++;
      let collected = collectCollapsedSqlChunk(lines, i);
      if (!emitSqlChunk(out, collected.chunk) && collected.chunk.length > 0) {
        out.push(...collected.chunk);
      }
      i = collected.nextIdx - 1;
      while (collected.nestedHeading) {
        out.push(formatEsquemaHeading(collected.nestedHeading));
        collected = collectCollapsedSqlChunk(lines, i + 1);
        if (!emitSqlChunk(out, collected.chunk) && collected.chunk.length > 0) {
          out.push(...collected.chunk);
        }
        i = collected.nextIdx - 1;
      }
      continue;
    }

    let collected = collectCollapsedSqlChunk(lines, i);
    if (!emitSqlChunk(out, collected.chunk) && collected.chunk.length > 0) {
      out.push(...collected.chunk);
    }
    i = collected.nextIdx - 1;
  }

  return out.join("\n");
}

/** Expande SQL colapsado dentro de bloques ```sql existentes. */
export function repairCollapsedSqlInsideFences(text: string): string {
  return text.replace(/```sql\n([\s\S]*?)```/gi, (match, body: string) => {
    const collapsed = body.replace(/\s+/g, " ").trim();
    if (!lineLooksCollapsedSql(collapsed)) return match;
    const expanded = expandCollapsedSqlText(collapsed);
    if (!expanded) return match;
    return `\`\`\`sql\n${expanded}\n\`\`\``;
  });
}

function fenceBodyLooksLikeSql(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (/[┌┐└┘├──│]/.test(t) && !/\bCREATE\s+(?:TABLE|INDEX)\b/i.test(t)) return false;
  return (
    /\bCREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b/i.test(t) ||
    /^--\s/m.test(t) ||
    /^\s{2,}\w+\s+(?:UUID|VARCHAR|TEXT|BOOLEAN|INTEGER|TIMESTAMPTZ|JSONB|VECTOR)/m.test(t)
  );
}

/** Quita `###` erróneo delante de `CREATE TABLE` / `CREATE INDEX` incrustado en el esquema. */
export function demoteSqlPseudoHeadings(text: string): string {
  return text.replace(
    /^#{1,6}\s+(CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b[^\n]*)$/gim,
    "$1",
  );
}

/** True when the next non-empty line after `offset` starts SQL DDL. */
function nextNonEmptyLineLooksLikeSqlDdl(text: string, offset: number): boolean {
  const rest = text.slice(offset).replace(/^\s*\n+/, "");
  return /^(?:CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)|--\s)/i.test(rest);
}

/**
 * Open fence language immediately before a lone ``` line (null = none / already closed).
 * Used to avoid eating ``` that closes ```mermaid before a CREATE TABLE block.
 */
export function openFenceLangBeforeCloseLine(text: string, closeLineOffset: number): string | null {
  const before = text.slice(0, closeLineOffset);
  let openLang: string | null = null;
  for (const line of before.split("\n")) {
    const m = line.trim().match(/^```(\w*)$/);
    if (!m) continue;
    if (openLang === null) openLang = m[1] ?? "";
    else openLang = null;
  }
  return openLang;
}

/**
 * Removes orphan bare ``` lines immediately before SQL DDL, but keeps closers for typed fences
 * (e.g. ```mermaid) so CREATE TABLE is not absorbed into the diagram block.
 */
export function stripOrphanFenceLinesBeforeSqlDdl(text: string): string {
  return text.replace(/```[ \t]*\r?\n/g, (match, offset: number) => {
    if (!nextNonEmptyLineLooksLikeSqlDdl(text, offset + match.length)) return match;
    const openLang = openFenceLangBeforeCloseLine(text, offset);
    if (openLang != null && openLang !== "" && openLang !== "sql") return match;
    if (openLang === "sql") return match;
    return "\n";
  });
}

/** Drops a bare ``` line before ```sql when it is not closing a typed fence (e.g. ```mermaid). */
function stripBareFenceBeforeSqlOpen(text: string): string {
  return text.replace(/```[ \t]*\r?\n+```sql[ \t]*\r?\n/gi, (match, offset: number) => {
    const openLang = openFenceLangBeforeCloseLine(text, offset);
    if (openLang != null && openLang !== "" && openLang !== "sql") return match;
    return "```sql\n";
  });
}

/**
 * Une fences ```sql / ```text rotos y headings SQL falsos en un bloque coherente.
 * Típico del Architect cuando parte el esquema relacional en varios fences.
 */
export function repairFragmentedSqlFences(text: string): string {
  let out = demoteSqlPseudoHeadings(text);

  out = out.replace(/```text\s*\n([\s\S]*?)```/gi, (match, body: string) => {
    if (!fenceBodyLooksLikeSql(body)) return match;
    return `\`\`\`sql\n${body.trim()}\n\`\`\`\n\n`;
  });

  out = stripOrphanFenceLinesBeforeSqlDdl(out);

  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/```sql\s*\n([\s\S]*?)```\s*\n+```sql\s*\n/gi, "```sql\n$1\n");
    out = stripBareFenceBeforeSqlOpen(out);
  }

  out = out.replace(/```\s*\n+```\s*\n/g, "\n");
  return out;
}
