/**
 * @fileoverview Lint determinista previo al Auditor LLM.
 *
 * Antes, el Auditor exponía `validate_mdd_structure`, `validate_sql_syntax` y
 * `validate_json_payloads` como tools cuyo único argumento era `mdd_draft` (el
 * documento completo). Eso obligaba al modelo a re-emitir 40-60 KB de markdown
 * como argumento de tool: el proveedor truncaba en su límite de salida, la tool
 * validaba un documento incompleto y reportaba secciones faltantes / sin payloads
 * que luego hundían el score. Aquí se ejecuta la misma validación en código, sobre
 * el borrador real del estado, y el resultado se inyecta al prompt como texto.
 */

import { extractJsonBlocks, extractSqlBlocks, lintSql } from "./linters.js";
import type { ValidateMddStructureResult } from "./mdd-sanitize.js";

/** Tope de errores listados por categoría para no inflar el prompt. */
const MAX_LISTED_ERRORS = 12;

export type DeterministicMddLint = {
  structure: ValidateMddStructureResult;
  sqlBlocks: number;
  sqlErrors: string[];
  jsonBlocks: number;
  jsonErrors: string[];
};

function lintJsonBlocks(blocks: string[]): string[] {
  const errors: string[] = [];
  blocks.forEach((json, index) => {
    try {
      JSON.parse(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const snippet = json.replace(/\s+/g, " ").slice(0, 80);
      errors.push(`JSON inválido en bloque #${index + 1}: ${message}. Fragmento: "${snippet}${json.length > 80 ? "…" : ""}"`);
    }
  });
  return errors;
}

/** Ejecuta estructura + SQL + JSON sobre el borrador real (nunca lanza). */
export function runDeterministicMddLint(
  draft: string,
  validation: ValidateMddStructureResult,
): DeterministicMddLint {
  const md = draft ?? "";
  const sqlBlocks = extractSqlBlocks(md);
  const jsonBlocks = extractJsonBlocks(md);
  let sqlErrors: string[] = [];
  try {
    sqlErrors = sqlBlocks.flatMap((sql) => lintSql(sql).errors);
  } catch (err) {
    sqlErrors = [`No se pudo validar el SQL: ${err instanceof Error ? err.message : String(err)}`];
  }
  return {
    structure: validation,
    sqlBlocks: sqlBlocks.length,
    sqlErrors,
    jsonBlocks: jsonBlocks.length,
    jsonErrors: lintJsonBlocks(jsonBlocks),
  };
}

function listOrNone(items: string[], none: string): string {
  if (items.length === 0) return `- ${none}`;
  const shown = items.slice(0, MAX_LISTED_ERRORS).map((e) => `- ${e}`);
  if (items.length > MAX_LISTED_ERRORS) shown.push(`- … y ${items.length - MAX_LISTED_ERRORS} más`);
  return shown.join("\n");
}

/**
 * Bloque markdown con los resultados deterministas para el prompt del Auditor.
 * Sustituye a las tools: el modelo recibe hechos, no tiene que pedirlos ni re-emitir el documento.
 */
export function formatDeterministicLintForPrompt(lint: DeterministicMddLint): string {
  const s = lint.structure;
  const structureLines = [
    `- Secciones canónicas faltantes: ${s.missingSections.length > 0 ? s.missingSections.join(", ") : "ninguna"}`,
    `- Orden de secciones correcto: ${s.sectionOrderCorrect ? "sí" : "no"}`,
    `- §4 con endpoints y payloads detectables: ${s.section3HasPayloads ? "sí" : "no"}`,
    `- Bloque TechnicalMetadata presente: ${s.hasTechnicalMetadata ? "sí" : "no"}`,
  ];
  const issues = s.issues.length > 0 ? listOrNone(s.issues, "") : "- sin observaciones";
  return [
    "",
    "---",
    "**Lint determinista (ejecutado en código sobre el borrador completo; NO hay herramientas que invocar):**",
    "",
    "Estructura:",
    ...structureLines,
    "",
    "Observaciones de estructura:",
    issues,
    "",
    `SQL (${lint.sqlBlocks} bloque(s) \`\`\`sql):`,
    listOrNone(lint.sqlErrors, lint.sqlBlocks === 0 ? "no hay bloques SQL" : "sintaxis válida (PostgreSQL)"),
    "",
    `JSON (${lint.jsonBlocks} bloque(s) \`\`\`json):`,
    listOrNone(lint.jsonErrors, lint.jsonBlocks === 0 ? "no hay bloques JSON" : "todos los payloads son JSON válido"),
    "",
    "Usa estos hechos para `syntax_errors` y como evidencia en `critical_gaps`. Son informativos: tú decides el `auditorScore`.",
    "---",
    "",
  ].join("\n");
}

/** Errores de sintaxis objetivos (SQL/JSON) para fusionar en `auditorGaps.syntax_errors`. */
export function deterministicLintSyntaxErrors(lint: DeterministicMddLint): string[] {
  return [
    ...lint.sqlErrors.map((e) => `SQL §3: ${e}`),
    ...lint.jsonErrors.map((e) => `§4: ${e}`),
  ];
}
