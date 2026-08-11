import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  repairCollapsedPipeTables,
  repairProseGluedTableLines,
} from "./markdown-table.js";
import { formatDocumentMarkdown } from "./format-document-markdown.js";

describe("repairCollapsedPipeTables", () => {
  it("expande tabla de dolores en una sola línea", () => {
    const raw =
      "| Dolor | Quién lo siente | Impacto | Workaround actual | | :--- | :--- | :--- | :--- | | Fragmentación de información | Usuarios Autorizados | Baja productividad | Consulta manual |";
    const out = repairCollapsedPipeTables(raw);
    const lines = out.split("\n").filter((l) => l.includes("|"));
    assert.ok(lines.length >= 3, out);
    assert.match(lines[0]!, /Dolor/);
    assert.match(lines[1]!, /:?-{3,}/);
    assert.match(lines[2]!, /Fragmentación/);
  });

  it("despega matriz FR §1 MDD pegada a heading y blockquote", () => {
    const raw =
      "### Trazabilidad BRD → MDD (FR → módulo → §§) > Matriz canónica para el checker MaxPrime. | FR BRD | Módulo | MDD §1 | MDD §4 (API / contrato) | MDD §5 (reglas) | Notas | | :----- | :----- | :----- | :---------------------- | :-------------- | :---- | | FR-01 | M01 | Catálogo webhook | POST /api/v1/webhook/cost-catalog | Idempotencia | Must | | FR-02 | M01 | Catálogo | Feedback webhook | Idempotencia catálogo | Must |";
    const out = formatDocumentMarkdown(raw);
    assert.match(out, /### Trazabilidad BRD → MDD \(FR → módulo → §§\)/);
    assert.match(out, />\s+Matriz canónica/);
    assert.doesNotMatch(out, /§§\)\s+\| FR BRD/);
    assert.doesNotMatch(out, /explícitos\.\s+\| FR BRD/);
    const tableLines = out.split("\n").filter((l) => /^\|/.test(l.trim()));
    assert.ok(tableLines.length >= 4, `expected table rows, got:\n${tableLines.join("\n")}`);
    assert.match(tableLines[0]!, /FR BRD/);
    assert.match(tableLines[1]!, /:?-{3,}/);
    assert.match(tableLines[2]!, /FR-01/);
  });
});

describe("repairProseGluedTableLines", () => {
  it("separa prosa del encabezado de tabla en la misma línea", () => {
    const raw = "Texto introductorio. | Col A | Col B |";
    const out = repairProseGluedTableLines(raw);
    assert.equal(out, "Texto introductorio.\n| Col A | Col B |");
  });
});
