/**
 * Job 84: fence ```sql de §3 sin cerrar ⇒ §3 absorbe §4–§7 (20k→69k→99k) y §4 queda invisible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  closeSection3FenceBeforeNextCanonicalH2,
  getSectionBody,
} from "./section-fence.util.js";
import { extractSection3Body, extractSection4Body } from "./section-merge.js";
import { applyDataModelPatchToDraft, appendSqlTablesToSection3Body } from "../mdd-data-model-patch.util.js";

const S3_UNCLOSED_DRAFT = [
  "# MDD",
  "",
  "## 3. Modelo de Datos",
  "",
  "```sql",
  "CREATE TABLE certificates (id uuid PRIMARY KEY, name text NOT NULL);",
  "",
  "## 4. Contratos de API",
  "",
  "### GET /health",
  "",
  "```json",
  '{ "status": "ok" }',
  "```",
  "",
  "## 5. Lógica y Edge Cases",
  "",
  "- Validar expiración de certificado antes de firmar.",
  "",
  "## 6. Seguridad",
  "",
  "- TLS 1.3 obligatorio.",
].join("\n");

describe("closeSection3FenceBeforeNextCanonicalH2", () => {
  it("cierra el fence §3 antes del siguiente H2 canónico", () => {
    const fixed = closeSection3FenceBeforeNextCanonicalH2(S3_UNCLOSED_DRAFT);
    const s3 = extractSection3Body(fixed);
    assert.ok(String(s3).includes("CREATE TABLE certificates"));
    assert.ok(!String(s3).includes("## 4. Contratos de API"));
    assert.ok(!String(s3).includes("## 6. Seguridad"));
  });

  it("expone §4 y §5 como secciones reales tras el cierre", () => {
    const fixed = closeSection3FenceBeforeNextCanonicalH2(S3_UNCLOSED_DRAFT);
    assert.ok(String(extractSection4Body(fixed)).includes("GET /health"));
    assert.ok(String(getSectionBody(fixed, /##\s*5\.\s*Lógica/i)).includes("expiración"));
  });

  it("es idempotente y no toca drafts con fences equilibrados", () => {
    const fixed = closeSection3FenceBeforeNextCanonicalH2(S3_UNCLOSED_DRAFT);
    assert.equal(closeSection3FenceBeforeNextCanonicalH2(fixed), fixed);
  });

  it("no altera un draft sin §3", () => {
    const draft = "## 1. Contexto\n\ntexto\n";
    assert.equal(closeSection3FenceBeforeNextCanonicalH2(draft), draft);
  });
});

describe("applyDataModelPatchToDraft con fence §3 abierto", () => {
  it("no sepulta §4–§6 dentro del cuerpo §3 al añadir tablas", () => {
    const patched = applyDataModelPatchToDraft(
      S3_UNCLOSED_DRAFT,
      "CREATE TABLE audit_log (id uuid PRIMARY KEY, action text NOT NULL);",
    );
    const s3 = extractSection3Body(patched);
    assert.ok(String(s3).includes("audit_log"));
    assert.ok(!String(s3).includes("## 4. Contratos de API"));
    assert.ok(String(extractSection4Body(patched)).includes("GET /health"));
    assert.ok(String(patched).includes("## 6. Seguridad"));
  });

  it("no duplica una tabla ya presente en el DDL", () => {
    const patched = applyDataModelPatchToDraft(
      S3_UNCLOSED_DRAFT,
      "CREATE TABLE certificates (id uuid PRIMARY KEY);",
    );
    assert.equal((patched.match(/CREATE TABLE certificates/gi) ?? []).length, 1);
  });
});

describe("appendSqlTablesToSection3Body", () => {
  it("no reenvuelve un ```json posterior como SQL", () => {
    const body = [
      "```sql",
      "CREATE TABLE certificates (id uuid PRIMARY KEY);",
      "```",
      "",
      "```json",
      '{ "note": "no soy SQL" }',
      "```",
    ].join("\n");
    const out = appendSqlTablesToSection3Body(
      body,
      "CREATE TABLE audit_log (id uuid PRIMARY KEY);",
    );
    assert.ok(String(out).includes("```json"));
    assert.ok(String(out).includes('{ "note": "no soy SQL" }'));
    assert.ok(!String(out.slice(out.indexOf("```json"))).includes("audit_log"));
    assert.ok(String(out).includes("audit_log"));
  });

  it("cierra el fence impar antes de añadir en vez de anidar ```sql", () => {
    const body = ["```sql", "CREATE TABLE certificates (id uuid PRIMARY KEY);"].join("\n");
    const out = appendSqlTablesToSection3Body(
      body,
      "CREATE TABLE audit_log (id uuid PRIMARY KEY);",
    );
    assert.equal((out.match(/```sql/gi) ?? []).length, 1);
    assert.equal((out.match(/```/g) ?? []).length % 2, 0);
    assert.ok(String(out).includes("audit_log"));
  });
});
