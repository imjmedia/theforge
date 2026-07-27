import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMddUpstreamChanges,
  buildMddUpstreamBaseline,
  hashUpstreamDocumentBody,
} from "./mdd-upstream-sync-node.js";
import { expandMddSectionsForSync } from "./mdd-upstream-sync.js";

describe("mdd-upstream-sync", () => {
  it("expandMddSectionsForSync añade §4 cuando cambia §3", () => {
    assert.deepEqual(expandMddSectionsForSync([3]), [3, 4]);
  });

  it("detecta cambio en BRD y recomienda §1", () => {
    const baseline = buildMddUpstreamBaseline({
      dbgaContent: "dbga v1",
      brdContent: "brd v1",
      benchmarkContent: "bench v1",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    const analysis = analyzeMddUpstreamChanges({
      baseline,
      dbgaContent: "dbga v1",
      brdContent: "brd v2 con nuevo KPI de conversión",
      benchmarkContent: "bench v1",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    assert.ok(analysis.changedSources.includes("brd"));
    assert.ok(analysis.recommendedSections.includes(1));
    assert.equal(analysis.pendingSync, true);
  });

  it("ignora cabecera de fechas al comparar upstream (sin pendingSync por stamp)", () => {
    const body = "# DBGA\n\nContenido estable del benchmark.";
    const stampedV1 = `<!-- theforge-doc:created=2024-01-01T00:00:00.000Z|updated=2024-06-01T00:00:00.000Z -->\n> 📅 Creado: 1 de enero de 2024 · Última modificación: 1 de junio de 2024\n\n---\n\n${body}`;
    const stampedV2 = `<!-- theforge-doc:created=2024-01-01T00:00:00.000Z|updated=2025-07-01T00:00:00.000Z -->\n> 📅 Creado: 1 de enero de 2024 · Última modificación: 1 de julio de 2025\n\n---\n\n${body}`;
    const baseline = buildMddUpstreamBaseline({
      dbgaContent: stampedV1,
      brdContent: "brd",
      benchmarkContent: "bench",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    const analysis = analyzeMddUpstreamChanges({
      baseline,
      dbgaContent: stampedV2,
      brdContent: "brd",
      benchmarkContent: "bench",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    assert.equal(analysis.pendingSync, false);
    assert.deepEqual(analysis.changedSources, []);
  });

  it("no marca pendingSync con JSON benchmark reordenado (mismo contenido)", () => {
    const benchmarkV1 = JSON.stringify({ z: 1, a: { y: 2, x: 3 } });
    const benchmarkV2 = JSON.stringify({ a: { x: 3, y: 2 }, z: 1 });
    const baseline = buildMddUpstreamBaseline({
      dbgaContent: "dbga",
      brdContent: "brd",
      benchmarkContent: benchmarkV1,
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    const analysis = analyzeMddUpstreamChanges({
      baseline,
      dbgaContent: "dbga",
      brdContent: "brd",
      benchmarkContent: benchmarkV2,
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    assert.equal(analysis.pendingSync, false);
    assert.deepEqual(analysis.changedSources, []);
  });

  it("hash estable para mismo contenido", () => {
    assert.equal(hashUpstreamDocumentBody(" a \n"), hashUpstreamDocumentBody("a"));
  });

  it("no marca pendingSync si el hash baseline es legacy pero el cuerpo DBGA no cambió", () => {
    const body = "# DBGA\n\nContenido estable.";
    const baseline = buildMddUpstreamBaseline({
      dbgaContent: body,
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    const legacyHash = "deadbeef".padEnd(64, "0");
    const legacyBaseline = { ...baseline, dbgaContentHash: legacyHash };
    const analysis = analyzeMddUpstreamChanges({
      baseline: legacyBaseline,
      dbgaContent: body,
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    assert.equal(analysis.pendingSync, false);
    assert.deepEqual(analysis.changedSources, []);
  });

  it("no marca pendingSync con snapshot legacy con stamp si el cuerpo DBGA no cambió", () => {
    const body = "# DBGA\n\nContenido estable del proyecto.";
    const stamped = `<!-- theforge-doc:created=2024-01-01T00:00:00.000Z|updated=2024-06-01T00:00:00.000Z -->\n> 📅 Creado: 1 de enero de 2024\n\n---\n\n${body}`;
    const legacyBaseline = buildMddUpstreamBaseline({
      dbgaContent: stamped,
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    // Simula baseline capturado con algoritmo anterior (hash incoherente con cuerpo actual).
    legacyBaseline.dbgaContentHash = "legacy".padEnd(64, "0");
    const analysis = analyzeMddUpstreamChanges({
      baseline: legacyBaseline,
      dbgaContent: body,
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    assert.equal(analysis.pendingSync, false);
  });

  it("no marca pendingSync en DBGA grande si solo cambió el algoritmo de hash", () => {
    const prefix = "# DBGA\n\n" + "Línea de contenido estable.\n".repeat(1200);
    const baseline = buildMddUpstreamBaseline({
      dbgaContent: prefix,
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: "# MDD\n\n## 1. Contexto\n\nx".repeat(30),
    });
    baseline.dbgaContentHash = "legacy-large".padEnd(64, "0");
    const analysis = analyzeMddUpstreamChanges({
      baseline,
      dbgaContent: prefix,
      brdContent: "brd",
      benchmarkContent: "{}",
      mddContent: "# MDD\n\n## 1. Contexto\n\n" + "y".repeat(30),
    });
    assert.equal(analysis.pendingSync, false);
  });
});
