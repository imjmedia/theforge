/**
 * @fileoverview F4 — patch quirúrgico §3 cuando critic reporta tablas faltantes.
 */

import { regenerateErDiagramFromSql } from "./mdd-diagram-suggestions.js";
import { extractSection3Body, replaceMddSection3Body } from "./mdd-sanitize.js";

const MISSING_TABLES_RE =
  /faltan?\s+(?:las\s+)?tablas?\s+[`'"]?([a-zA-Z0-9_`,\s'"]+)[`'"]?(?:\s|$|\.)/i;

/** Extrae nombres de tablas de gaps tipo «faltan tablas X, Y, Z». */
export function parseMissingTablesFromCriticFeedback(feedback: string): string[] | null {
  const text = (feedback ?? "").trim();
  if (!text) return null;
  const m = text.match(MISSING_TABLES_RE);
  if (!m?.[1]) return null;
  const raw = m[1].replace(/[`'"]/g, "").replace(/\s+y\s+/gi, ", ");
  const tables = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z][a-z0-9_]*$/i.test(t));
  return tables.length ? [...new Set(tables)] : null;
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
