/**
 * Guard anti-regresión: evita reintroducir literales `"NEW"` / uniones `"NEW" | "LEGACY"`
 * en código de producción de la API (contexto projectType).
 *
 * Excepciones: solo archivos listados en ALLOWLIST_REL (comentar el motivo).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const apiSrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Rutas relativas a `apps/api/src` permitidas temporalmente (vacío = tolerancia cero). */
const ALLOWLIST_REL: readonly string[] = [
  // Ninguna — paso 4b sustituye ai, orquestador y supervisor.
];

const FORBIDDEN_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: '=== "NEW"', re: /===\s*["']NEW["']/ },
  { label: '!== "NEW"', re: /!==\s*["']NEW["']/ },
  { label: '"NEW" | "LEGACY" union', re: /["']NEW["']\s*\|\s*["']LEGACY["']/ },
  { label: 'ternary default "NEW"', re: /\?\s*["']LEGACY["']\s*:\s*["']NEW["']/ },
  { label: '?? "NEW"', re: /\?\?\s*["']NEW["']/ },
];

function isAllowlisted(relPosix: string): boolean {
  return ALLOWLIST_REL.some((entry) => relPosix === entry || relPosix.endsWith(`/${entry}`));
}

function shouldScanFile(name: string): boolean {
  if (!name.endsWith(".ts")) return false;
  if (name.endsWith(".spec.ts")) return false;
  if (name.endsWith(".d.ts")) return false;
  return true;
}

function collectProductionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...collectProductionTsFiles(full));
      continue;
    }
    if (entry.isFile() && shouldScanFile(entry.name)) out.push(full);
  }
  return out;
}

describe("project-type-literals guard (paso 4b)", () => {
  it("no reintroduce literales NEW ni uniones NEW|LEGACY en apps/api/src", () => {
    const violations: string[] = [];
    for (const abs of collectProductionTsFiles(apiSrcRoot)) {
      const rel = path.relative(apiSrcRoot, abs).split(path.sep).join("/");
      if (isAllowlisted(rel)) continue;
      const lines = readFileSync(abs, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { label, re } of FORBIDDEN_PATTERNS) {
          if (re.test(line)) {
            violations.push(`${rel}:${i + 1} (${label}) → ${line.trim()}`);
          }
        }
      }
    }
    assert.equal(
      violations.length,
      0,
      `Usa helpers de @theforge/shared-types/project-type.ts:\n${violations.join("\n")}`,
    );
  });
});
