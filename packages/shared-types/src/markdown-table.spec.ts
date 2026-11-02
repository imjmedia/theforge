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

describe("reparaciones de tabla respetan fences de código", () => {
  const ER_FENCE = "```mermaid\nerDiagram\n    ORDERS ||--|{ ORDER_ITEMS : contains\n    USERS ||--o{ ORDERS : places\n```";
  const FLOW_FENCE = "```mermaid\nflowchart TD\n    A --> B{¿Ok?}\n    B -->|Sí| D\n    C -->|No| E\n```";
  const SQL_FENCE = "```sql\n-- | id | | nombre | | email | | rol | | fecha |\nSELECT 1;\n```";
  const COLLAPSED = "| H1 | H2 | | :--- | :--- | | a | b |";

  it("repairProseGluedTableLines deja intactos fences mermaid (ER y flowchart) y sql", () => {
    for (const fence of [ER_FENCE, FLOW_FENCE, SQL_FENCE]) {
      assert.equal(repairProseGluedTableLines(`Intro\n\n${fence}\n\nFin`), `Intro\n\n${fence}\n\nFin`);
    }
  });

  it("repairCollapsedPipeTables deja intactos los fences pero repara la tabla colapsada de fuera", () => {
    const doc = `${ER_FENCE}\n\n${FLOW_FENCE}\n\n${SQL_FENCE}\n\n${COLLAPSED}`;
    const out = repairCollapsedPipeTables(doc);
    const head = `${ER_FENCE}\n\n${FLOW_FENCE}\n\n${SQL_FENCE}\n\n`;
    assert.ok(out.startsWith(head), out);
    const tail = out.slice(head.length).split("\n");
    assert.deepEqual(tail, ["| H1 | H2 |", "| :--- | :--- |", "| a | b |"]);
  });

  it("repara una tabla pegada a prosa fuera del fence y no toca la de dentro", () => {
    const out = repairProseGluedTableLines(`Texto previo. | Col A | Col B |\n\n${FLOW_FENCE}`);
    assert.equal(out, `Texto previo.\n| Col A | Col B |\n\n${FLOW_FENCE}`);
  });

  it("un fence de 4 acentos graves o tildes también protege su contenido", () => {
    const outer = "````markdown\nC -->|No| E\nORDERS ||--|{ ITEMS : has\n```\nC -->|No| E\n````";
    assert.equal(repairProseGluedTableLines(outer), outer);
    const tilde = "~~~\nORDERS ||--|{ ITEMS : has\n~~~";
    assert.equal(repairProseGluedTableLines(tilde), tilde);
  });

  it("un fence sin cierre protege hasta el final; el contenido previo sí se repara", () => {
    const doc = "Texto. | A | B |\n```mermaid\nC -->|No| E";
    assert.equal(repairProseGluedTableLines(doc), "Texto.\n| A | B |\n```mermaid\nC -->|No| E");
  });

  it("formatDocumentMarkdown es idempotente con flowchart y ER en fences", () => {
    const doc = `# Doc\n\n${FLOW_FENCE}\n\n${ER_FENCE}\n`;
    const once = formatDocumentMarkdown(doc);
    assert.match(once, /B -->\|"?Sí"?\| D/);
    assert.ok(once.includes("C -->|No| E"), once);
    assert.ok(once.includes("ORDERS ||--|{ ORDER_ITEMS : contains"), once);
    assert.equal(formatDocumentMarkdown(once), once);
  });
});
