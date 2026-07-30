import { indexOfNextH2OutsideFenced } from "./section-fence.util.js";

const SQL_DDL_STATEMENT =
  /^\s*(CREATE\s+TABLE|CREATE\s+INDEX|CREATE\s+UNIQUE|ALTER\s+TABLE|PARTITION\s+OF|FOR\s+VALUES|\)\s*;|\);|CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|REFERENCES\s+)/i;

const SQL_COLUMN_DEF =
  /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s+(UUID|VARCHAR|TEXT|INTEGER|INT|BIGINT|BOOLEAN|BOOL|TIMESTAMPTZ|TIMESTAMP|INET|JSONB|BYTEA|DATE|SMALLINT|NUMERIC|DECIMAL|CHAR|SERIAL|REAL|DOUBLE)/i;

/** Línea de prosa española incrustada en DDL (ej. «application_id o NULL para system»). */
function isSqlProseArtifactLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith("--")) return false;
  if (SQL_DDL_STATEMENT.test(t)) return false;
  if (SQL_COLUMN_DEF.test(t)) return false;
  if (/^\s*\)\s*;?\s*$/.test(t)) return false;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\s+o\s+(NULL|null)\b/i.test(t)) return true;
  if (/\b(para|cuando|mediante|debe|puede|sin)\b/i.test(t) && !SQL_COLUMN_DEF.test(t)) return true;
  return false;
}

function repairSqlProseArtifactLine(line: string): string {
  const t = line.trim();
  const appNull = /^application_id\s+o\s+NULL\s+para\s+(\w+)/i.exec(t);
  if (appNull) {
    return `  application_id UUID, -- NULL for ${appNull[1]} actors`;
  }
  const actorNull = /^actor_id\s+o\s+NULL\s+para\s+(\w+)/i.exec(t);
  if (actorNull) {
    return `  actor_id UUID, -- NULL for ${actorNull[1]} actors`;
  }
  return `  -- ${t}`;
}

function prevLineHasDanglingSqlComment(prev: string): boolean {
  return /--\s*[\w\s,]+$/.test(prev.trim()) && !SQL_COLUMN_DEF.test(prev.trim());
}

/** Fusiona comentarios SQL partidos en dos líneas (ej. `-- inmutable,` + `  particionado`). */
function repairSqlSplitCommentLines(sqlContent: string): string {
  const lines = sqlContent.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const prev = out[out.length - 1];
    if (
      prev?.trim().startsWith("--") &&
      /^[a-záéíóúñ(]/i.test(t) &&
      !t.startsWith("--") &&
      !SQL_DDL_STATEMENT.test(t) &&
      !SQL_COLUMN_DEF.test(t)
    ) {
      out[out.length - 1] = `${prev.trimEnd()} ${t}`;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Separa comentarios `--` pegados a DDL (`CREATE TABLE`, `CREATE EXTENSION`, funciones, etc.). */
function repairSqlCommentGluedToDdl(sqlContent: string): string {
  return sqlContent.replace(
    /^(\s*--[^\n]*?)\s+(CREATE\s+(?:OR\s+REPLACE\s+)?(?:SCHEMA|TABLE|INDEX|EXTENSION|TYPE(?:\s+AS\s+ENUM)?|FUNCTION|TRIGGER))/gim,
    "$1\n$2",
  );
}

/** Fusiona llamadas partidas en varias líneas (p. ej. `NOW(\n);` → `NOW());`). */
function repairSqlSplitFunctionBody(sqlContent: string): string {
  return sqlContent
    .replace(/(\b(?:NOW|CURRENT_TIMESTAMP|gen_random_uuid)\()\s*\n\s*\)\s*;/gi, "$1));")
    .replace(/(\b(?:NOW|CURRENT_TIMESTAMP|gen_random_uuid)\()\s*\n\s*\)/gi, "$1))")
    .replace(/DEFAULT\s+(\w+)\(\s*\n\s*\)/gi, "DEFAULT $1())");
}

export function sanitizeSqlBrokenCommentsAndProse(sqlContent: string): string {
  if (!sqlContent || typeof sqlContent !== "string") return sqlContent;
  const repaired = repairSqlSplitFunctionBody(repairSqlCommentGluedToDdl(sqlContent));
  const spaced = repairSqlSpacedColumnIdentifiers(repaired);
  const withoutStubs = stripMonthlyPartitionStubTables(spaced);
  const lines = repairSqlSplitCommentLines(withoutStubs).split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if (isSqlProseArtifactLine(line)) {
      const prev = out[out.length - 1];
      if (prev != null && prevLineHasDanglingSqlComment(prev)) {
        const repairedLine = repairSqlProseArtifactLine(line);
        if (SQL_COLUMN_DEF.test(repairedLine.trim())) {
          out[out.length - 1] = prev.replace(/\s*--\s*[\w\s,]+\s*$/, "").trimEnd();
          if (!out[out.length - 1]!.endsWith(",")) {
            out[out.length - 1] = out[out.length - 1]!.replace(/\s*$/, ",");
          }
          out.push(repairedLine);
          continue;
        }
      }
      out.push(repairSqlProseArtifactLine(line));
      continue;
    }
    out.push(line);
  }

  return stripIndexesOnCommentedSqlColumns(
    repairSqlProseInTableBodies(
      repairSqlDetachedCheckConstraints(repairSqlOrphanTokensAndSplitParens(out.join("\n"))),
    ),
  );
}

/**
 * Repara columnas con espacio en el identificador (`original text TEXT` → `original_text TEXT`).
 */
export function repairSqlSpacedColumnIdentifiers(sql: string): string {
  if (!sql?.trim()) return sql;
  return sql
    .split("\n")
    .map((line) => {
      const m = line.match(
        /^(\s*)([a-zA-Z_][\w]*)\s+([a-z][\w]*)\s+(UUID|VARCHAR|TEXT|INTEGER|INT|BIGINT|BOOLEAN|BOOL|TIMESTAMPTZ|TIMESTAMP|INET|JSONB|BYTEA|DATE|SMALLINT|NUMERIC|DECIMAL|CHAR|SERIAL|REAL|DOUBLE|VECTOR)\b(.*)$/i,
      );
      if (!m) return line;
      const mid = m[3]!;
      // `text`/`name`/… pueden ser tipos SQL y a la vez segunda palabra del identificador
      // (`original text TEXT`). Siempre fusionar id1+id2 cuando hay un tipo real después.
      return `${m[1]}${m[2]}_${mid} ${m[4]}${m[5]}`;
    })
    .join("\n");
}

/**
 * Elimina `CREATE TABLE foo_YYYY_MM` cuando ya existe `CREATE TABLE foo`
 * (stubs de partición materializados por error por el LLM).
 */
export function stripMonthlyPartitionStubTables(sql: string): string {
  if (!sql?.trim()) return sql;
  return sql.replace(
    /CREATE\s+TABLE\s+([a-zA-Z_][\w]*)_(\d{4})_(\d{2})\s*\([\s\S]*?\);/gi,
    (full, base: string, y: string, mo: string) => {
      const parentRe = new RegExp(`CREATE\\s+TABLE\\s+${base}\\b`, "i");
      if (!parentRe.test(sql)) return full;
      return `-- omitted partition stub ${base}_${y}_${mo} (use PARTITION OF)`;
    },
  );
}

/** Column name on a fully commented-out definition line (`-- embedding VECTOR(...)`). */
const SQL_COMMENTED_COLUMN_LINE = /^\s*--\s*,?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+/;

/**
 * Drops CREATE INDEX when it targets a column that only appears as a commented-out definition.
 * Typical LLM drift: `-- embedding VECTOR(1536)` left in CREATE TABLE but index on `embedding` kept.
 */
export function stripIndexesOnCommentedSqlColumns(sql: string): string {
  if (!sql?.trim()) return sql;

  const commentedColumns = new Set<string>();
  for (const line of sql.split("\n")) {
    const m = line.match(SQL_COMMENTED_COLUMN_LINE);
    if (m?.[1]) commentedColumns.add(m[1].toLowerCase());
  }
  if (commentedColumns.size === 0) return sql;

  const out: string[] = [];
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (/^CREATE\s+INDEX\b/i.test(trimmed)) {
      const parenMatch = trimmed.match(/\(([^)]+)\)/);
      if (parenMatch) {
        const indexCols = parenMatch[1]
          .split(/\s*,\s*/)
          .map((c) => c.trim().replace(/^[\w.]+\./, "").toLowerCase());
        if (indexCols.some((c) => commentedColumns.has(c))) continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Elimina prosa huérfana entre definiciones de columnas dentro de CREATE TABLE.
 */
export function repairSqlProseInTableBodies(sql: string): string {
  if (!sql?.trim()) return sql;
  const tableRe =
    /(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w.]+\s*\()([\s\S]*?)(\)\s*;)/gi;
  return sql.replace(tableRe, (_full, openPart: string, cols: string, close: string) => {
    const cleaned = cols
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        if (!t) return true;
        if (t.startsWith("--")) return true;
        if (SQL_DDL_STATEMENT.test(t)) return true;
        if (SQL_COLUMN_DEF.test(t)) return true;
        if (/^\s*\)\s*;?\s*$/.test(t)) return true;
        if (isSqlProseArtifactLine(line)) return false;
        return true;
      })
      .join("\n");
    return `${openPart}${cleaned}${close}`;
  });
}

/** Token suelto tras comentario `--` partido o columna de índice en línea siguiente. */
function isSqlOrphanEnumTokenLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith("--")) return false;
  if (SQL_DDL_STATEMENT.test(t)) return false;
  if (SQL_COLUMN_DEF.test(t)) return false;
  if (/^\s*\)\s*;?\s*$/.test(t)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*\s*$/.test(t);
}

function prevLineHasOpenParen(prev: string): boolean {
  const opens = (prev.match(/\(/g) ?? []).length;
  const closes = (prev.match(/\)/g) ?? []).length;
  return opens > closes;
}

/**
 * Segunda pasada SQL: fusiona tokens huérfanos (enum en comentario roto) y cierra paréntesis partidos en CREATE INDEX.
 */
function repairSqlOrphanTokensAndSplitParens(sql: string): string {
  const lines = sql.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const t = line.trim();

    if (isSqlOrphanEnumTokenLine(line) && out.length > 0) {
      const prev = out[out.length - 1]!;
      if (/--/.test(prev)) {
        out[out.length - 1] = `${prev.trimEnd()} ${t}`;
        continue;
      }
      if (prevLineHasOpenParen(prev) || /CREATE\s+INDEX/i.test(prev)) {
        const sep = prev.trimEnd().endsWith(",") ? " " : ", ";
        out[out.length - 1] = `${prev.trimEnd()}${sep}${t}`;
        continue;
      }
    }

    if (/^\s*\)\s*;?\s*$/.test(t) && out.length > 0) {
      const prev = out[out.length - 1]!;
      if (prevLineHasOpenParen(prev)) {
        const suffix = t.includes(";") ? ");" : ")";
        out[out.length - 1] = `${prev.trimEnd()}${suffix}`;
        continue;
      }
    }

    out.push(line);
  }

  return out
    .join("\n")
    .replace(/(CREATE\s+INDEX\s+[^\n]+\([^)\n]+)\n\s*\)\s*;/gi, "$1);");
}

/** Línea de definición de columna sin CHECK inline, antes de un CHECK en la línea siguiente. */
function isSqlColumnDefLineBeforeDetachedCheck(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith("--")) return false;
  if (SQL_DDL_STATEMENT.test(t)) return false;
  if (/\bCHECK\s*\(/i.test(t)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*\s+.+/i.test(t);
}

/**
 * PostgreSQL exige coma antes de CHECK en línea aparte dentro de CREATE TABLE.
 * Corrige: `col TYPE DEFAULT 'x'\n  CHECK (...)` → `col TYPE DEFAULT 'x',\n  CHECK (...)`.
 */
export function repairSqlDetachedCheckConstraints(sql: string): string {
  if (!sql?.trim()) return sql;
  const lines = sql.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    const nextTrim = lines[j]?.trim() ?? "";

    if (
      nextTrim &&
      /^\s*CHECK\s*\(/i.test(nextTrim) &&
      isSqlColumnDefLineBeforeDetachedCheck(line)
    ) {
      const trimmed = line.trimEnd();
      if (!trimmed.endsWith(",")) line = `${trimmed},`;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Normaliza indentación de CREATE INDEX tras formateo SQL. */
function dedentCreateIndexLines(sql: string): string {
  return sql.replace(/^\s+(CREATE\s+INDEX\b)/gim, "$1");
}

/** Sanitiza todos los bloques ```sql del borrador (no solo el primero). */
export function sanitizeAllSqlBlocksInDraft(draft: string): string {
  if (!draft) return draft;
  return draft.replace(/```sql\s*([\s\S]*?)```/gi, (_full, inner: string) => {
    let sanitized = sanitizeSqlBrokenCommentsAndProse(inner);
    sanitized = dedentCreateIndexLines(sanitized);
    if (sanitized !== inner) {
      return "```sql\n" + sanitized + "\n```";
    }
    return _full;
  });
}

/** True si algún bloque ```sql abrió fence sin cierre ``` antes del siguiente bloque o EOF. */
export function detectUnclosedSqlFences(draft: string): string | null {
  if (!draft) return null;
  const re = /```sql\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(draft)) !== null) {
    const contentStart = match.index + match[0].length;
    const rest = draft.slice(contentStart);
    const lines = rest.split(/\r?\n/);
    let offset = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "```") {
        break;
      }
      if (/^```\w+/.test(trimmed)) {
        return "Bloque ```sql sin cerrar: otro fence (```mermaid, ```TechnicalMetadata, etc.) antes del cierre.";
      }
      offset += line.length + 1;
    }
    if (offset >= rest.length || !/\n```[ \t]*(?:\r?\n|$)/.test(rest.slice(offset))) {
      return "Bloque ```sql sin cerrar con ``` antes del final del documento.";
    }
  }
  return null;
}

/**
 * Formatea un bloque SQL con saltos de línea legibles:
 * - Una columna por línea con indentación de 2 espacios.
 * - Sin líneas en blanco entre columna y columna.
 * - Cierre ); en línea propia.
 */
export function formatSqlBlockWithNewlines(sqlContent: string): string {
  if (!sqlContent || typeof sqlContent !== "string") return sqlContent;
  let out = sqlContent.trim();
  // Separar tablas: ); CREATE TABLE → ); \n\n CREATE TABLE
  out = out.replace(/\)\s*;\s*CREATE\s+TABLE/gi, ");\n\nCREATE TABLE");
  out = out.replace(/\)\s*;\s*\n\s*(?=CREATE\s+TABLE)/gi, "\n);\n\n");
  out = out.replace(/\s*\)\s*;\s*$/, "\n);\n");

  // Apertura: CREATE TABLE name ( → CREATE TABLE name (\n  (para que la primera columna quede en su línea)
  out = out.replace(
    /(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[a-zA-Z_][a-zA-Z0-9_]*\s*)\(\s*/gi,
    "$1(\n  ",
  );

  // Partir columnas que están en la misma línea: coma seguida de nombre de columna (identifier) → nueva línea + 2 espacios
  // Así no partimos tipos como decimal(10, 2) ni REFERENCES table(id).
  out = out.replace(/,\s*(?=[a-zA-Z_][a-zA-Z0-9_]*\s)/g, ",\n  ");

  // Quitar líneas en blanco entre columnas: ",\n\n" o ",\n  \n" → ",\n  "
  out = out.replace(/,\s*\n\s*\n+\s*/g, ",\n  ");

  // Asegurar 2 espacios antes de la primera columna tras (
  out = out.replace(/(\(\n)\s*([a-zA-Z_][a-zA-Z0-9_]*\s+)/g, "$1  $2");

  // Por línea: quitar líneas en blanco y normalizar columnas a "  " + contenido
  const lines = out.split("\n");
  const normalized: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") continue;
    if (t === ");" || /^CREATE\s+TABLE\s+/i.test(t)) {
      normalized.push(t);
    } else if (/^[a-zA-Z_][a-zA-Z0-9_]*\s+/.test(t)) {
      normalized.push("  " + t);
    } else {
      normalized.push(line);
    }
  }
  out = normalized.join("\n");

  // Cierre: ); en línea propia
  out = out.replace(/\s*\)\s*;/g, "\n);");
  return out;
}

/** True si el contenido interno de un bloque SQL contiene prosa inválida. */
export function sqlBlockContainsProseArtifact(sqlContent: string): boolean {
  for (const line of sqlContent.split("\n")) {
    if (isSqlProseArtifactLine(line)) return true;
  }
  return false;
}

/** Cierra ```sql en §3 cuando un ```json de §4 quedó absorbido por un fence sin cerrar. */
export function repairSection3SqlFenceBeforeJsonBlock(draft: string): string {
  const headingRe = /(?:^|\n)(##\s*3\.\s*Modelo\s+(?:de\s+)?datos)/im;
  const headingMatch = draft.match(headingRe);
  if (!headingMatch?.index && headingMatch?.index !== 0) return draft;
  const idx = headingMatch.index + (headingMatch[0].startsWith("\n") ? 1 : 0);
  const sectionStart = idx + headingMatch[1]!.length;
  const nextH2 = indexOfNextH2OutsideFenced(draft, sectionStart);
  const bodyEnd = nextH2 !== -1 ? nextH2 : draft.length;
  const body = draft.slice(sectionStart, bodyEnd);
  const sqlJsonMatch = body.match(/(```sql[\s\S]*?)(\n```json)/i);
  if (!sqlJsonMatch?.index && sqlJsonMatch?.index !== 0) return draft;
  const between = sqlJsonMatch[1] ?? "";
  // Si ya hay cierre ``` entre ```sql y ```json, no insertar otro (evita §4 dentro de fence).
  if (/\n```[ \t]*(?:\r?\n|$)/.test(between.slice(6))) return draft;
  const fixedBody = body.replace(/(```sql[\s\S]*?)(\n```json)/i, "$1\n```$2");
  if (fixedBody === body) return draft;
  return draft.slice(0, sectionStart) + fixedBody + draft.slice(bodyEnd);
}
