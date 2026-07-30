import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDocumentCompleteness } from "../completeness.util.js";

describe("computeDocumentCompleteness", () => {
  it("returns 100 when all docs have >=300 chars", () => {
    const fill = (n: number) => "x".repeat(n);
    const docs = {
      mddContent: fill(300),
      brdContent: fill(300),
      toBeManualContent: fill(300),
      asIsManualContent: fill(300),
      specContent: fill(300),
      architectureContent: fill(300),
      useCasesContent: fill(300),
      userStoriesContent: fill(300),
      blueprintContent: fill(300),
      apiContractsContent: fill(300),
      logicFlowsContent: fill(300),
      infraContent: fill(300),
      tasksContent: fill(300),
    };
    const r = computeDocumentCompleteness(docs);
    assert.equal(r.overall, 100);
    for (const [k, v] of Object.entries(r)) {
      if (k !== "overall") assert.equal(v, 100);
    }
  });

  it("returns 0 when no docs have content", () => {
    const r = computeDocumentCompleteness({});
    assert.equal(r.overall, 0);
    assert.equal(r.brdContent, 0);
  });

  it("returns partial scores for mixed content", () => {
    const docs = {
      brdContent: "x".repeat(500),
      specContent: "x".repeat(100),
      tasksContent: "",
    };
    const r = computeDocumentCompleteness(docs);
    assert.equal(r.overall, 29);
    assert.equal(r.brdContent, 100);
    assert.equal(r.specContent, 50);
    assert.equal(r.tasksContent, 0);
    assert.equal(r.infraContent, 0);
  });

  it("scores 10 for minimal content (< 80 chars)", () => {
    const docs = { brdContent: "Hola mundo" };
    const r = computeDocumentCompleteness(docs);
    assert.equal(r.brdContent, 10);
    assert.equal(r.overall, 2); // 0.22 * 0.10 ≈ 2%
  });

  it("scores 50 for partial content (80-299 chars)", () => {
    const docs = { brdContent: "x".repeat(80) };
    const r = computeDocumentCompleteness(docs);
    assert.equal(r.brdContent, 50);
    assert.equal(r.overall, 11);
  });

  it("scores thin ProcessInventory use cases at 100 when processes have steps", () => {
    const thin = `# Casos de uso (thin — ProcessInventory)

Documento generado sin prosa literaria (PLAN-CASCADE-90). Cada proceso = journey Spec.

## CU-proc-cap-4: Captura de leads
- **Trigger:** user.request
- **Pasos:**
  1. Validar formulario
  2. Persistir lead
- **Entidades:** leads
`;
    const r = computeDocumentCompleteness({ useCasesContent: thin });
    assert.equal(r.useCasesContent, 100);
  });

  it("caps stub thin ProcessInventory use cases at 50 even when long", () => {
    const thin = `# Casos de uso (thin — ProcessInventory)\n${"x".repeat(400)}`;
    const r = computeDocumentCompleteness({ useCasesContent: thin });
    assert.equal(r.useCasesContent, 50);
  });

  it("scores empty use cases at 0", () => {
    const r = computeDocumentCompleteness({ useCasesContent: "" });
    assert.equal(r.useCasesContent, 0);
  });

  it("scores literary use cases at 100 when long enough", () => {
    const literary = `# Casos de uso\n\n## CU-001: Login\nActor: usuario\n${"Flujo principal detallado. ".repeat(30)}`;
    const r = computeDocumentCompleteness({ useCasesContent: literary });
    assert.equal(r.useCasesContent, 100);
  });

  it("scores thin ProcessInventory with empty inventory message low", () => {
    const thin = `# Casos de uso (thin — ProcessInventory)

_Sin procesos en inventario; regenerar BRD/MDD._
`;
    const r = computeDocumentCompleteness({ useCasesContent: thin });
    assert.ok(r.useCasesContent <= 50);
  });
});
