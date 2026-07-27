import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClarifierDbgaBrief,
  buildDbgaHydrationSource,
  DEFAULT_CLARIFIER_DBGA_BRIEF_MAX_CHARS,
} from "./mdd-clarifier-dbga-brief.util.js";

const LARGE_DBGA = `
# Domain Benchmark

## Objetivo

Sistema KMS para gestión de conocimiento empresarial con búsqueda semántica y workflows de aprobación.

## Alcance

Incluye repositorio documental, taxonomías, roles por área y auditoría de cambios.

## Fuera de alcance

No incluye ERP ni facturación.

## Capacidades

### Gestión de documentos
Carga, versionado y publicación con flujo de aprobación dual.

### Búsqueda semántica
Embeddings y ranking por relevancia.

## Entidades principales

- documents
- taxonomies
- approval_workflows
- users
`.repeat(80);

describe("buildClarifierDbgaBrief", () => {
  it("returns full DBGA when under budget", () => {
    const small = "## Objetivo\n\nKMS simple.";
    const out = buildClarifierDbgaBrief({ dbgaContent: small });
    assert.equal(out.brief, small);
    assert.equal(out.usedFullDbga, true);
  });

  it("extracts narrative head and structural signals for large DBGA", () => {
    const out = buildClarifierDbgaBrief({ dbgaContent: LARGE_DBGA });
    assert.equal(out.usedFullDbga, false);
    assert.ok(out.briefChars <= DEFAULT_CLARIFIER_DBGA_BRIEF_MAX_CHARS + 50);
    assert.match(out.brief, /Objetivo/i);
    assert.match(out.brief, /Alcance/i);
    assert.match(out.brief, /Señales estructurales|Capacidades|Gestión de documentos/i);
    assert.ok(out.brief.length < LARGE_DBGA.length);
  });

  it("does not use blind slice as sole strategy", () => {
    const filler = "x".repeat(50_000);
    const out = buildClarifierDbgaBrief({ dbgaContent: filler });
    assert.equal(out.usedFullDbga, false);
    assert.ok(!out.brief.startsWith("xxxx"));
  });
});

describe("buildDbgaHydrationSource", () => {
  it("prefers substantial clarifiedScope", () => {
    const scope = "A".repeat(400);
    const out = buildDbgaHydrationSource({
      clarifiedScope: scope,
      dbgaContent: LARGE_DBGA,
    });
    assert.equal(out, scope);
  });

  it("falls back to brief extract when scope is short", () => {
    const out = buildDbgaHydrationSource({
      clarifiedScope: "corto",
      dbgaContent: LARGE_DBGA,
    });
    assert.ok(out.length > 200);
    assert.match(out, /Objetivo|KMS|Alcance/i);
    assert.ok(out.length < LARGE_DBGA.length);
  });
});
