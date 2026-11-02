import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairLooseMermaidTextAndJsonCommas } from "./persist-pipeline.js";

const ER_FENCE = "```mermaid\nerDiagram\n    ORDERS ||--|{ ORDER_ITEMS : contains\n    USERS ||--o{ ORDERS : places\n```";
const FLOW_FENCE = "```mermaid\nflowchart TD\n    B -->|Sí| D\n    C -->|No| E\n```";
const SQL_FENCE = "```sql\nCREATE TABLE t (\n  a jsonb DEFAULT '{,}',\n  b text,\n);\n```";

describe("repairLooseMermaidTextAndJsonCommas", () => {
  it("no toca el contenido de fences mermaid (ER y flowchart) ni sql", () => {
    const doc = `## 3. Modelo\n\n${ER_FENCE}\n\n${FLOW_FENCE}\n\n${SQL_FENCE}\n\nFin`;
    assert.equal(repairLooseMermaidTextAndJsonCommas(doc), doc);
  });

  it("quita `text` extraviado solo dentro de ```mermaid, no en prosa ni en otros fences", () => {
    const doc = "Ver [nota]text aquí\n\n```mermaid\nflowchart TD\n  A[Inicio]text --> B[Fin]\n```\n\n```ts\nconst x = arr[i]text;\n```";
    const out = repairLooseMermaidTextAndJsonCommas(doc);
    assert.ok(out.includes("A[Inicio] --> B[Fin]"), out);
    assert.ok(out.includes("Ver [nota]text aquí"), out);
    assert.ok(out.includes("const x = arr[i]text;"), out);
  });

  it("`]text` solo se quita como palabra completa: `A[Ver]textos` no pierde letras", () => {
    const doc = "```mermaid\nflowchart TD\n  A[Ver]textos --> B[Fin]text\n  B --> C[Ok]text_x\n```";
    const out = repairLooseMermaidTextAndJsonCommas(doc);
    assert.ok(out.includes("A[Ver]textos --> B[Fin]\n"), out);
    assert.ok(out.includes("C[Ok]text_x"), out);
    assert.equal(repairLooseMermaidTextAndJsonCommas(out), out);
  });

  it("repara comas sueltas de JSON en fences json y en texto fuera de fences", () => {
    const doc = '```json\n{\n  "a": [,\n    1,\n  ],\n  "b": 2,\n}\n```\n\nSuelto: { , "k": 1 }';
    const out = repairLooseMermaidTextAndJsonCommas(doc);
    assert.ok(out.includes('"a": [\n'), out);
    assert.ok(out.includes('"b": 2}'), out);
    assert.ok(/Suelto: \{\s*"k"/.test(out), out);
    assert.ok(!/\{\s*,/.test(out), out);
  });

  it("un fence sin cierre se trata como fence hasta el final del documento", () => {
    const doc = "Texto\n\n```mermaid\nerDiagram\n    ORDERS ||--|{ ORDER_ITEMS : contains";
    assert.equal(repairLooseMermaidTextAndJsonCommas(doc), doc);
  });

  it("es idempotente y devuelve vacío para vacío", () => {
    const doc = `${ER_FENCE}\n\n\`\`\`json\n{ "a": [,\n 1 ] }\n\`\`\``;
    const once = repairLooseMermaidTextAndJsonCommas(doc);
    assert.equal(repairLooseMermaidTextAndJsonCommas(once), once);
    assert.equal(repairLooseMermaidTextAndJsonCommas(""), "");
  });
});
