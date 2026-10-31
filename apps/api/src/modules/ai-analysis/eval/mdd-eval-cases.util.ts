/**
 * @fileoverview Carga de los casos del eval de MDDs desde `eval/mdd/cases/<id>.json`,
 * validados con `mddEvalCaseSchema` (contrato en `mdd-eval.types.ts`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MDD_EVAL_CASES_DIR, mddEvalCaseSchema, type MddEvalCase } from "./mdd-eval.types.js";

/**
 * Directorio por defecto de los casos: `<cwd>/eval/mdd/cases` si existe; si no, sube desde
 * este archivo hasta encontrar una carpeta que contenga `eval/mdd/cases` (paquete apps/api).
 */
export function resolveDefaultMddEvalCasesDir(): string {
  const fromCwd = path.resolve(process.cwd(), MDD_EVAL_CASES_DIR);
  if (existsSync(fromCwd)) return fromCwd;

  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, MDD_EVAL_CASES_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `No se encontró ${MDD_EVAL_CASES_DIR} desde ${process.cwd()} ni subiendo desde ${__dirname}`,
  );
}

function readCaseFile(file: string): MddEvalCase {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Caso MDD inválido en ${file}: JSON no legible (${reason})`);
  }

  const parsed = mddEvalCaseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Caso MDD inválido en ${file}: ${issues}`);
  }

  const expectedId = path.basename(file, ".json");
  if (parsed.data.id !== expectedId) {
    throw new Error(
      `Caso MDD inválido en ${file}: el id "${parsed.data.id}" no coincide con el nombre del archivo "${expectedId}"`,
    );
  }
  return parsed.data;
}

/** Lee y valida todos los `*.json` del directorio; devuelve los casos ordenados por id. */
export function loadMddEvalCases(dir?: string): MddEvalCase[] {
  const root = dir ?? resolveDefaultMddEvalCasesDir();
  if (!existsSync(root)) {
    throw new Error(`Directorio de casos MDD inexistente: ${root}`);
  }
  const files = readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(root, name));
  return files
    .map(readCaseFile)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Devuelve el caso con ese id; lanza si no existe en el directorio. */
export function loadMddEvalCase(id: string, dir?: string): MddEvalCase {
  const found = loadMddEvalCases(dir).find((evalCase) => evalCase.id === id);
  if (!found) {
    throw new Error(`No existe el caso MDD "${id}" en ${dir ?? MDD_EVAL_CASES_DIR}`);
  }
  return found;
}
