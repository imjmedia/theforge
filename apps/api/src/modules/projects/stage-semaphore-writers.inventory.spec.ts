/**
 * P9a — inventario de escrituras de documentos de etapa y semáforo persistido.
 * Falla si aparece un `stage.update` / `updateMany` con campos sensibles fuera de esta lista.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MODULE_ROOT = path.resolve(fileURLToPath(import.meta.url), "..");

/** Archivos que pueden escribir mddContent / brdContent / specContent en Stage (o reset inicial). */
const ALLOWED_DOC_WRITERS = new Set([
  "project-mdd-persist.service.ts",
  "project-brd.service.ts",
  "project-stage.service.ts",
  "project-clone.util.ts",
  "project-notion-import.util.ts",
  "project-notion-portability.service.ts",
  "deliverables-cascade.service.ts",
  "project-merge.service.ts",
  "sdd-integration.service.ts",
  "stage-deliverable-persist.util.ts",
  "mdd-manual-audit.service.ts",
  "document-clarify.util.ts",
]);

/** Único escritor de `Stage.status` / `precisionScore` por evaluación del núcleo. */
const ALLOWED_SEMAPHORE_STATUS_WRITERS = new Set([
  "stage-semaphore-sync.service.ts",
  "project-stage.service.ts",
  "project-clone.util.ts",
  "project-notion-import.util.ts",
  "project-notion-portability.service.ts",
  "project-merge.service.ts",
]);

const STAGE_UPDATE_BLOCK_RE =
  /\bstage\.(?:update|updateMany)\(\s*\{[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?\})?\s*\)/g;
const DOC_FIELD_RE = /\b(mddContent|brdContent|specContent)\s*:/;
const SEMAPHORE_FIELD_RE = /\b(status|precisionScore)\s*:/;

function stageWritesField(text: string, fieldRe: RegExp): boolean {
  for (const m of text.matchAll(STAGE_UPDATE_BLOCK_RE)) {
    if (fieldRe.test(m[0])) return true;
  }
  return false;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "legacy-flow") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".spec.ts") || name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("stage-semaphore-writers inventory (P9a)", () => {
  it("CL-29: no hay escritores de documentos o semáforo fuera de la lista permitida", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(MODULE_ROOT)) {
      const base = path.basename(file);
      const text = readFileSync(file, "utf8");
      const writesDoc = stageWritesField(text, DOC_FIELD_RE);
      const writesSemaphore = stageWritesField(text, SEMAPHORE_FIELD_RE);
      if (!writesDoc && !writesSemaphore) continue;

      if (writesDoc && !ALLOWED_DOC_WRITERS.has(base)) {
        offenders.push(`${base}: escribe documentos de etapa sin estar en inventario`);
      }
      if (writesSemaphore && !ALLOWED_SEMAPHORE_STATUS_WRITERS.has(base)) {
        offenders.push(`${base}: escribe status/precisionScore sin estar en inventario`);
      }
    }
    assert.deepEqual(offenders, [], offenders.join("\n"));
  });

  it("CL-15: convergencia de cascada no sincroniza semáforo a mitad del bucle", () => {
    const src = readFileSync(path.join(MODULE_ROOT, "deliverables-cascade.service.ts"), "utf8");
    const loopIdx = src.indexOf("private async runCascadeConvergenceLoop");
    assert.ok(loopIdx >= 0);
    const loopSlice = src.slice(loopIdx, loopIdx + 12000);
    assert.ok(!loopSlice.includes("syncFromPersisted"), "sync dentro de convergencia");
    assert.ok(!loopSlice.includes("refreshStageSemaphoreFromProject"), "refresh dentro de convergencia");
  });
});
