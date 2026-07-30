import { describe, it } from "node:test";
import assert from "node:assert";
import {
  appendSqlTablesToSection3Body,
  canonicalizeTableName,
  extractCreateTableNamesFromSql,
  extractSqlLikeTableNames,
  filterActuallyMissingTables,
  isTableOnlyCriticGap,
  isUsableDataModelPatchSql,
  isValidSqlTableName,
  parseMissingTablesFromCriticFeedback,
} from "./mdd-data-model-patch.util.js";

describe("mdd-data-model-patch.util", () => {
  it("parseMissingTablesFromCriticFeedback extrae nombres", () => {
    const tables = parseMissingTablesFromCriticFeedback("faltan tablas orders, order_items y payments");
    assert.ok(tables);
    assert.deepStrictEqual([...tables!].sort(), ["order_items", "orders", "payments"]);
  });

  it("ignora preposiciones ES en feedback «en el DDL»", () => {
    assert.deepStrictEqual(
      parseMissingTablesFromCriticFeedback("Faltan tablas en el DDL: key_versions, certificates"),
      ["key_versions", "certificates"],
    );
    assert.deepStrictEqual(extractSqlLikeTableNames("en el ddl key_versions"), ["key_versions"]);
    assert.strictEqual(isValidSqlTableName("en"), false);
    assert.strictEqual(isValidSqlTableName("el"), false);
  });

  it("isUsableDataModelPatchSql rechaza DDL basura en/el", () => {
    const junk = "CREATE TABLE en (id UUID PRIMARY KEY);\nCREATE TABLE el (id UUID PRIMARY KEY);";
    assert.strictEqual(isUsableDataModelPatchSql(junk, ["key_versions"]), false);
    assert.deepStrictEqual(extractCreateTableNamesFromSql(junk), []);
  });

  it("isUsableDataModelPatchSql acepta tablas esperadas", () => {
    const sql =
      "CREATE TABLE key_versions (id UUID PRIMARY KEY);\nCREATE TABLE certificates (id UUID PRIMARY KEY);";
    assert.strictEqual(isUsableDataModelPatchSql(sql, ["key_versions", "certificates"]), true);
  });

  it("isTableOnlyCriticGap distingue estructural vs tablas", () => {
    assert.strictEqual(isTableOnlyCriticGap("faltan tablas tenants, channels"), true);
    assert.strictEqual(isTableOnlyCriticGap("rediseñar diagrama ER completo"), false);
  });

  it("appendSqlTablesToSection3Body concatena dentro del fence sql", () => {
    const body = "```sql\nCREATE TABLE users (id UUID PRIMARY KEY);\n```";
    const out = appendSqlTablesToSection3Body(body, "CREATE TABLE orders (id UUID PRIMARY KEY);");
    assert.ok(out.includes("CREATE TABLE users"));
    assert.ok(out.includes("CREATE TABLE orders"));
  });

  it("appendSqlTablesToSection3Body no duplica tablas existentes", () => {
    const body = "```sql\nCREATE TABLE audit_log (id UUID PRIMARY KEY);\n```";
    const out = appendSqlTablesToSection3Body(
      body,
      "CREATE TABLE audit_log (id UUID PRIMARY KEY, action TEXT);\nCREATE TABLE events (id UUID PRIMARY KEY);",
    );
    assert.strictEqual((out.match(/CREATE TABLE audit_log/gi) ?? []).length, 1);
    assert.ok(out.includes("CREATE TABLE events"));
  });

  describe("canonicalizeTableName — falso positivo singular/plural del Critic", () => {
    it("normaliza plural simple", () => {
      assert.strictEqual(canonicalizeTableName("audit_logs"), "audit_log");
      assert.strictEqual(canonicalizeTableName("audit_log"), "audit_log");
    });

    it("no toca palabras terminadas en doble s", () => {
      assert.strictEqual(canonicalizeTableName("access"), "access");
    });

    it("normaliza -ies → -y y -ses (doble s) → -s", () => {
      assert.strictEqual(canonicalizeTableName("categories"), "category");
      assert.strictEqual(canonicalizeTableName("addresses"), "address");
      assert.strictEqual(canonicalizeTableName("classes"), "class");
    });
  });

  describe("filterActuallyMissingTables — job KMS: Critic dice «falta audit_logs», ya existe audit_log", () => {
    const sql = "CREATE TABLE audit_log (id UUID PRIMARY KEY);\nCREATE TABLE keys (id UUID PRIMARY KEY);";

    it("filtra la tabla ya presente aunque el Critic la nombre en plural", () => {
      assert.deepStrictEqual(filterActuallyMissingTables(["audit_logs"], sql), []);
    });

    it("mantiene tablas que de verdad faltan", () => {
      assert.deepStrictEqual(filterActuallyMissingTables(["audit_logs", "certificates"], sql), ["certificates"]);
    });

    it("appendSqlTablesToSection3Body también dedupe plural/singular al fusionar", () => {
      const body = "```sql\nCREATE TABLE audit_log (id UUID PRIMARY KEY);\n```";
      const out = appendSqlTablesToSection3Body(
        body,
        "CREATE TABLE audit_logs (id UUID PRIMARY KEY, action TEXT);\nCREATE TABLE events (id UUID PRIMARY KEY);",
      );
      assert.strictEqual((out.match(/CREATE TABLE audit_log/gi) ?? []).length, 1);
      assert.ok(!out.includes("CREATE TABLE audit_logs"));
      assert.ok(out.includes("CREATE TABLE events"));
    });
  });
});
