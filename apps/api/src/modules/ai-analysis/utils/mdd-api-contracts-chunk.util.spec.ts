import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeApiContractsChunkCount,
  extractSqlTableNames,
  mergeApiContractsChunkBodies,
  splitTablesIntoApiContractsChunks,
  stripCommonRoutesFromChunkBody,
} from "./mdd-api-contracts-chunk.util.js";

const SQL_15_TABLES = Array.from({ length: 15 }, (_, i) =>
  `CREATE TABLE t${i + 1} (id UUID PRIMARY KEY);`,
).join("\n\n");

describe("mdd-api-contracts-chunk.util", () => {
  it("computeApiContractsChunkCount usa min(4, ceil(n/7))", () => {
    assert.strictEqual(computeApiContractsChunkCount(7), 1);
    assert.strictEqual(computeApiContractsChunkCount(8), 2);
    assert.strictEqual(computeApiContractsChunkCount(28), 4);
    assert.strictEqual(computeApiContractsChunkCount(40), 4);
  });

  it("splitTablesIntoApiContractsChunks reparte tablas", () => {
    const names = extractSqlTableNames(SQL_15_TABLES);
    assert.strictEqual(names.length, 15);
    const k = computeApiContractsChunkCount(names.length);
    const chunks = splitTablesIntoApiContractsChunks(SQL_15_TABLES, k);
    assert.strictEqual(chunks.length, 3);
    const allTables = chunks.flatMap((c) => c.tables);
    assert.strictEqual(allTables.length, 15);
  });

  it("stripCommonRoutesFromChunkBody elimina /health en chunk > 0", () => {
    const body = "### GET /health\n\nok\n\n### GET /api/items\n\nitems";
    assert.ok(!stripCommonRoutesFromChunkBody(body, 1).includes("/health"));
    assert.ok(stripCommonRoutesFromChunkBody(body, 1).includes("/api/items"));
    assert.ok(stripCommonRoutesFromChunkBody(body, 0).includes("/health"));
  });

  it("mergeApiContractsChunkBodies dedupe rutas y genera tabla resumen", () => {
    const c0 = "### GET /health\n\n```json\n{}\n```\n\n### GET /api/users\n\n```json\n{}\n```";
    const c1 = "### GET /health\n\n```json\n{}\n```\n\n### GET /api/orders\n\n```json\n{}\n```";
    const merged = mergeApiContractsChunkBodies([c0, c1]);
    assert.ok(merged.includes("### Resumen de endpoints"));
    assert.ok(merged.includes("| GET | /health |"));
    assert.ok(merged.includes("| GET | /api/users |"));
    assert.ok(merged.includes("| GET | /api/orders |"));
    assert.strictEqual((merged.match(/### GET \/health/g) ?? []).length, 1);
  });
});
