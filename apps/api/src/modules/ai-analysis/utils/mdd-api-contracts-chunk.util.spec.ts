import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeApiContractsChunkCount,
  extractSqlTableNames,
  mergeApiContractsChunkBodies,
  splitTablesIntoApiContractsChunks,
  stripChunkMetaCommentary,
  stripCommonRoutesFromChunkBody,
} from "./mdd-api-contracts-chunk.util.js";

const SQL_15_TABLES = Array.from({ length: 15 }, (_, i) =>
  `CREATE TABLE t${i + 1} (id UUID PRIMARY KEY);`,
).join("\n\n");

describe("mdd-api-contracts-chunk.util", () => {
  it("computeApiContractsChunkCount usa min(4, ceil(n/4))", () => {
    assert.strictEqual(computeApiContractsChunkCount(4), 1);
    assert.strictEqual(computeApiContractsChunkCount(5), 2);
    assert.strictEqual(computeApiContractsChunkCount(16), 4);
    assert.strictEqual(computeApiContractsChunkCount(40), 4);
  });

  it("splitTablesIntoApiContractsChunks reparte tablas (16 tablas KMS-like → 4 chunks)", () => {
    const sql16 = Array.from({ length: 16 }, (_, i) => `CREATE TABLE t${i + 1} (id UUID PRIMARY KEY);`).join("\n\n");
    const names = extractSqlTableNames(sql16);
    assert.strictEqual(names.length, 16);
    const k = computeApiContractsChunkCount(names.length);
    assert.strictEqual(k, 4);
    const chunks = splitTablesIntoApiContractsChunks(sql16, k);
    assert.strictEqual(chunks.length, 4);
    const allTables = chunks.flatMap((c) => c.tables);
    assert.strictEqual(allTables.length, 16);
    // Cada chunk trae ≤4 tablas — menos tablas por llamada = más presupuesto de salida
    // por endpoint (job KMS: 3 chunks con ~5-6 tablas degradaba a tabla-resumen sin schema).
    for (const c of chunks) assert.ok(c.tables.length <= 4);
  });

  it("splitTablesIntoApiContractsChunks con 15 tablas (caso previo, ahora 4 chunks no 3)", () => {
    const names = extractSqlTableNames(SQL_15_TABLES);
    assert.strictEqual(names.length, 15);
    const k = computeApiContractsChunkCount(names.length);
    const chunks = splitTablesIntoApiContractsChunks(SQL_15_TABLES, k);
    assert.strictEqual(chunks.length, 4);
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

  describe("stripChunkMetaCommentary — job KMS: nota de chunking contradice el documento", () => {
    it("quita la nota en español pegada al final del último endpoint del chunk", () => {
      const block =
        "### GET /v1/certificates\n\n```json\n{}\n```\n\nLos siguientes chunks documentarán el resto de tablas.";
      const out = stripChunkMetaCommentary(block);
      assert.ok(!out.includes("siguientes chunks"));
      assert.ok(out.includes("### GET /v1/certificates"));
    });

    it("quita variantes: próximos chunks, continuará en la siguiente parte, inglés", () => {
      assert.ok(!stripChunkMetaCommentary("cuerpo\n\nLos próximos chunks cubrirán auth.").includes("próximos"));
      assert.ok(!stripChunkMetaCommentary("cuerpo\n\nContinuará en la siguiente parte.").includes("Continuará"));
      assert.ok(!stripChunkMetaCommentary("cuerpo\n\nThe following chunks will document the rest.").includes("following"));
    });

    it("no toca el resto del bloque, solo la nota final", () => {
      const block = "### POST /v1/keys\n\n**Request:**\n\n```json\n{ \"alg\": \"AES-256\" }\n```\n\nLos siguientes chunks documentarán tokens.";
      const out = stripChunkMetaCommentary(block);
      assert.ok(out.includes('"alg": "AES-256"'));
      assert.ok(!out.includes("Los siguientes"));
    });

    it("no toca bloques sin meta-comentario", () => {
      const block = "### GET /v1/keys\n\n```json\n{}\n```";
      assert.strictEqual(stripChunkMetaCommentary(block), block);
    });

    it("mergeApiContractsChunkBodies no arrastra la nota al documento final", () => {
      const c0 = "### GET /v1/keys\n\n```json\n{}\n```";
      const c1 = "### GET /v1/certificates\n\n```json\n{}\n```\n\nLos siguientes chunks documentarán el resto de tablas.";
      const merged = mergeApiContractsChunkBodies([c0, c1]);
      assert.ok(!merged.includes("siguientes chunks"));
      assert.ok(merged.includes("### GET /v1/certificates"));
    });
  });
});
