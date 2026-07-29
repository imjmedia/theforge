import { describe, it } from "node:test";
import assert from "node:assert";
import {
  appendSqlTablesToSection3Body,
  extractCreateTableNamesFromSql,
  extractSqlLikeTableNames,
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
});
