/**
 * Design-First paso 5: contrato SQL idempotente (CL-24) para enum, designSpec y UserFigmaCredential.
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

describe("migraciones Design-First paso 5", () => {
  const enumSql = readSql("migrations/20261104100000_project_type_design_first/migration.sql");
  const specSql = readSql("migrations/20261104110000_design_first_spec_figma/migration.sql");
  const safeSyncSql = readSql("scripts/safe-schema-sync.sql");

  it("migración A solo añade DESIGN_FIRST al enum", () => {
    assert.match(enumSql, /ADD VALUE IF NOT EXISTS 'DESIGN_FIRST'/);
    assert.ok(!enumSql.match(/designSpec/i));
  });

  it("migración B+C usa IF NOT EXISTS en columnas, tabla e índice", () => {
    for (const col of ["designSpec", "designSpecRevision"]) {
      assert.match(specSql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
      assert.match(safeSyncSql, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`));
    }
    assert.match(specSql, /CREATE TABLE IF NOT EXISTS "UserFigmaCredential"/);
    assert.match(specSql, /CREATE UNIQUE INDEX IF NOT EXISTS "UserFigmaCredential_userId_key"/);
    assert.match(safeSyncSql, /CREATE TABLE IF NOT EXISTS "UserFigmaCredential"/);
    assert.match(safeSyncSql, /ADD VALUE IF NOT EXISTS 'DESIGN_FIRST'/);
  });
});
