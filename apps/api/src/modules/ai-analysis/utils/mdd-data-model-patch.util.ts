/**
 * @fileoverview F4 — patch quirúrgico §3 cuando critic reporta tablas faltantes.
 */

import { regenerateErDiagramFromSql } from "./mdd-diagram-suggestions.js";
import { extractSection3Body, replaceMddSection3Body } from "./mdd-sanitize.js";

/** Preposiciones/artículos ES que el split por espacios confundía con nombres de tabla. */
export const SPANISH_TABLE_STOPWORDS = new Set([
  "en",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "para",
  "por",
  "con",
  "un",
  "una",
  "al",
  "ddl",
  "modelo",
  "datos",
  "tabla",
  "tablas",
  "faltan",
  "falta",
  "y",
  "e",
  "o",
  "u",
]);

const MISSING_TABLES_DDL_RE =
  /faltan?\s+(?:las\s+)?tablas?\s+(?:en\s+el\s+)?(?:ddl|modelo(?:\s+de\s+datos)?)\s*[:\-]\s*([^\n.]+)/i;
const MISSING_TABLES_LIST_RE =
  /faltan?\s+(?:las\s+)?tablas?\s+[`'"]?([a-z0-9_,\s'".`-]+)/i;
const MISSING_TABLES_EN_RE = /missing\s+tables?\s*[:\-]\s*([^\n.]+)/i;

/** True si parece identificador SQL (snake_case o nombre citado), no stopword ES. */
export function isValidSqlTableName(name: string): boolean {
  const t = (name ?? "").trim().toLowerCase();
  if (!t || SPANISH_TABLE_STOPWORDS.has(t)) return false;
  if (!/^[a-z][a-z0-9_]*$/i.test(t)) return false;
  if (t.includes("_")) return true;
  return t.length >= 3;
}

/** Extrae identificadores tipo tabla del fragmento de feedback/LLM. */
export function extractSqlLikeTableNames(text: string): string[] {
  const source = (text ?? "").replace(/[`'"]/g, " ").replace(/\s+y\s+/gi, ", ");
  const names: string[] = [];

  for (const m of source.matchAll(/\b([a-z][a-z0-9_]*(?:_[a-z0-9_]+)+)\b/gi)) {
    const n = m[1]!.toLowerCase();
    if (isValidSqlTableName(n)) names.push(n);
  }
  for (const part of source.split(/[,;]+/)) {
    const token = part.trim().replace(/^[\s\-:]+|[\s\-:.]+$/g, "");
    if (isValidSqlTableName(token)) names.push(token.toLowerCase());
  }

  return [...new Set(names)];
}

/** Extrae nombres de tablas de gaps tipo «faltan tablas X, Y, Z» o «en el DDL: …». */
export function parseMissingTablesFromCriticFeedback(feedback: string): string[] | null {
  const text = (feedback ?? "").trim();
  if (!text) return null;

  for (const re of [MISSING_TABLES_DDL_RE, MISSING_TABLES_LIST_RE, MISSING_TABLES_EN_RE]) {
    const m = text.match(re);
    if (m?.[1]) {
      const tables = extractSqlLikeTableNames(m[1]);
      if (tables.length) return tables;
    }
  }

  if (/faltan?\s+(?:las\s+)?tablas?/i.test(text)) {
    const tables = extractSqlLikeTableNames(text);
    if (tables.length) return tables;
  }
  return null;
}

/** Nombres de tablas en bloques CREATE TABLE del DDL generado. */
export function extractCreateTableNamesFromSql(sql: string): string[] {
  const names: string[] = [];
  for (const m of (sql ?? "").matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([a-z][a-z0-9_.]*))/gi,
  )) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    const base = raw.split(".").pop()?.trim().toLowerCase() ?? "";
    if (isValidSqlTableName(base)) names.push(base);
  }
  return [...new Set(names)];
}

/** False si el patch solo crearía tablas basura (en/el) o no coincide con lo pedido. */
export function isUsableDataModelPatchSql(sql: string, expectedTables: string[]): boolean {
  const created = extractCreateTableNamesFromSql(sql);
  if (!created.length) return false;
  if (created.every((t) => SPANISH_TABLE_STOPWORDS.has(t))) return false;
  const expected = expectedTables.filter(isValidSqlTableName);
  if (expected.some((t) => created.includes(t))) return true;
  return created.some((t) => isValidSqlTableName(t) && t.length >= 4);
}

/** Gap solo tablas → patch; gaps estructurales → regen completa §3. */
export function isTableOnlyCriticGap(feedback: string, gaps?: string[]): boolean {
  const combined = [feedback, ...(gaps ?? [])].filter(Boolean).join("\n");
  if (/estructur|diagrama\s*er|integridad\s+referencial|rediseñ|reescribir\s+§?3|sql\s+inválido/i.test(combined)) {
    return false;
  }
  return parseMissingTablesFromCriticFeedback(combined) !== null;
}

/** Añade bloques SQL al cuerpo §3 existente (sin reemplazar tablas previas). */
export function appendSqlTablesToSection3Body(currentBody: string, newSqlBlocks: string): string {
  const sqlMatch = currentBody.match(/```sql\s*([\s\S]*?)```/i);
  const incoming = (newSqlBlocks ?? "").trim();
  if (!incoming) return currentBody;

  if (sqlMatch) {
    const mergedSql = `${sqlMatch[1]!.trim()}\n\n${incoming.replace(/^```sql|```$/gi, "").trim()}`.trim();
    return currentBody.replace(sqlMatch[0], `\`\`\`sql\n${mergedSql}\n\`\`\``);
  }
  return `${currentBody.trim()}\n\n\`\`\`sql\n${incoming}\n\`\`\``;
}

/** Aplica patch SQL a draft completo y regenera ER desde SQL. */
export function applyDataModelPatchToDraft(draft: string, appendedSql: string): string {
  const section3 = extractSection3Body(draft);
  if (!section3) return draft;
  const patchedBody = appendSqlTablesToSection3Body(section3, appendedSql);
  const withSection3 = replaceMddSection3Body(draft, patchedBody);
  return regenerateErDiagramFromSql(withSection3) ?? withSection3;
}
