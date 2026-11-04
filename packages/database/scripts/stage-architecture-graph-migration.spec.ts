/**
 * Paso Design-First 2: contrato SQL idempotente (CL-24). La idempotencia en BD real se verifica con psql en TASKS.md.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readSql(relativeFromDatabase: string): string {
  return readFileSync(join(repoRoot, "packages/database", relativeFromDatabase), "utf8");
}

describe("migración Stage.architectureGraph (20261104090000)", () => {
  const migrationSql = readSql("migrations/20261104090000_stage_architecture_graph/migration.sql");
  const safeSyncSql = readSql("scripts/safe-schema-sync.sql");

  it("usa ADD COLUMN IF NOT EXISTS para ambas columnas", () => {
    for (const col of ["architectureGraph", "architectureGraphSourceHash"]) {
      assert.match(migrationSql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
      assert.match(safeSyncSql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
    }
  });

  it("backfill copia documentAst solo cuando tiene clave endpoints y no modifica documentAst", () => {
    const backfill =
      /UPDATE "Stage"\s+SET "architectureGraph" = "documentAst"\s+WHERE "architectureGraph" IS NULL[\s\S]*"documentAst" \? 'endpoints'/;
    assert.match(migrationSql, backfill);
    assert.match(safeSyncSql, backfill);
    assert.ok(!migrationSql.match(/SET "documentAst"/));
    assert.ok(!safeSyncSql.match(/SET "documentAst"/));
  });
});
