import { describe, it } from "node:test";
import assert from "node:assert";
import {
  appendSqlTablesToSection3Body,
  isTableOnlyCriticGap,
  parseMissingTablesFromCriticFeedback,
} from "./mdd-data-model-patch.util.js";

describe("mdd-data-model-patch.util", () => {
  it("parseMissingTablesFromCriticFeedback extrae nombres", () => {
    assert.deepStrictEqual(
      parseMissingTablesFromCriticFeedback("faltan tablas orders, order_items y payments"),
      ["orders", "order_items", "payments"],
    );
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
