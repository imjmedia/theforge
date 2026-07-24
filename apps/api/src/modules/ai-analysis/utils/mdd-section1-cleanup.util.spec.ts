import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripBrdPasteNoiseFromSection1 } from "./mdd-section1-cleanup.util.js";

describe("stripBrdPasteNoiseFromSection1", () => {
  it("elimina líneas Auto-trazabilidad BRD", () => {
    const raw = `KMS corporativo para claves y secretos.

*(Auto-trazabilidad BRD: 2.3 / Requisitos funcionales)*

API REST y CLI sin panel web.`;
    const out = stripBrdPasteNoiseFromSection1(raw);
    assert.match(out, /KMS corporativo/);
    assert.doesNotMatch(out, /Auto-trazabilidad/);
    assert.match(out, /API REST y CLI/);
  });

  it("elimina stub BRD truncado a mitad de palabra", () => {
    const raw = `Sistema de gestión de claves.

BRD — Requisitos de auditoría y retención de logs por cin
Operadores usan CLI y SDK.`;
    const out = stripBrdPasteNoiseFromSection1(raw);
    assert.doesNotMatch(out, /^BRD\s*[—–-]/m);
    assert.match(out, /Operadores usan CLI/);
  });

  it("conserva línea BRD completa con puntuación", () => {
    const raw = `BRD — Alcance KMS: claves, secretos y certificados SAT.`;
    const out = stripBrdPasteNoiseFromSection1(raw);
    assert.match(out, /certificados SAT/);
  });
});
