import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDocumentMarkdown } from "./format-document-markdown.js";

const ER = [
  "```mermaid",
  "erDiagram",
  "  ORDERS ||--|{ ORDER_ITEMS : contains",
  "  ORDERS {",
  "    uuid id PK",
  "  }",
  "```",
].join("\n");

const SEQUENCE = [
  "```mermaid",
  "sequenceDiagram",
  "  autonumber",
  "  participant A",
  "  participant B",
  "  activate A",
  "  par Rama 1",
  "    A->>B: texto con --> flecha",
  "  and Rama 2",
  "    A->>B: otro",
  "  end",
  "  deactivate A",
  "```",
].join("\n");

const MINDMAP = ["```mermaid", "mindmap", "   root((Raíz))", "      Hijo A", "      Hijo B", "```"].join(
  "\n",
);

const FLOWCHART = ["```mermaid", "flowchart TD", "  A[Inicio] --> B{¿Ok?}", "  B{¿Ok?}", "```"].join(
  "\n",
);

const COLLAPSED_TABLE = "| Col A | Col B | |---|---| | uno | dos | | tres | cuatro |";

function doc(...blocks: string[]): string {
  return ["# Título", "", "Texto previo.", "", ...blocks.flatMap((b) => [b, ""])].join("\n");
}

describe("formatDocumentMarkdown mermaid: preserve", () => {
  for (const [name, block] of [
    ["ER con ||--|{", ER],
    ["sequence con autonumber/activate/par/and", SEQUENCE],
    ["mindmap con indentación de 3", MINDMAP],
    ["flowchart con B{¿Ok?} en línea propia", FLOWCHART],
  ] as const) {
    it(`deja ${name} byte a byte igual`, () => {
      const out = formatDocumentMarkdown(doc(block), { mermaid: "preserve" });
      assert.ok(out.includes(block), `el bloque cambió:\n${out}`);
    });
  }

  it("conserva todos los bloques a la vez y en su orden", () => {
    const out = formatDocumentMarkdown(doc(ER, SEQUENCE, MINDMAP, FLOWCHART), { mermaid: "preserve" });
    const positions = [ER, SEQUENCE, MINDMAP, FLOWCHART].map((b) => out.indexOf(b));
    assert.ok(positions.every((p) => p >= 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });

  it("sigue formateando el resto del documento (tabla colapsada vecina)", () => {
    const input = ["# Título", "", COLLAPSED_TABLE, "", SEQUENCE, ""].join("\n");
    const out = formatDocumentMarkdown(input, { mermaid: "preserve" });
    assert.ok(out.includes(SEQUENCE));
    assert.notEqual(out.split("\n").find((l) => l.includes("Col A")), COLLAPSED_TABLE);
    assert.match(out, /^\|\s*Col A\s*\|\s*Col B\s*\|$/m);
  });

  it("un documento sin mermaid da lo mismo con preserve que sin opción", () => {
    const input = ["# Título", "", COLLAPSED_TABLE, ""].join("\n");
    assert.equal(
      formatDocumentMarkdown(input, { mermaid: "preserve" }),
      formatDocumentMarkdown(input),
    );
  });

  it("no deja marcadores internos en la salida", () => {
    const out = formatDocumentMarkdown(doc(ER, FLOWCHART), { mermaid: "preserve" });
    assert.doesNotMatch(out, /[\uE000\uE001]|FORGE_MERMAID/);
  });
});

describe("formatDocumentMarkdown sin opción (regresión)", () => {
  it("default equivale a mermaid: 'normalize'", () => {
    const input = doc(ER, SEQUENCE, FLOWCHART);
    assert.equal(formatDocumentMarkdown(input), formatDocumentMarkdown(input, { mermaid: "normalize" }));
  });

  it("sigue normalizando mermaid (ER con 'PK, FK' pasa a 'PK')", () => {
    const input = [
      "# Título",
      "",
      "```mermaid",
      "erDiagram",
      "  USERS {",
      "    uuid user_id PK, FK",
      "  }",
      "```",
      "",
    ].join("\n");
    const out = formatDocumentMarkdown(input);
    assert.match(out, /uuid user_id PK\n/);
    assert.doesNotMatch(out, /PK, FK/);
    // Con preserve, en cambio, el bloque queda como llegó.
    assert.match(formatDocumentMarkdown(input, { mermaid: "preserve" }), /uuid user_id PK, FK/);
  });
});

describe("formatDocumentMarkdown mermaid: preserve — marcador solo en el cuerpo", () => {
  const FLOW = ["```mermaid", "flowchart TD", "  A[Inicio] --> B[Fin]", "```"].join("\n");

  it("`1.` justo antes del fence: el diagrama no se pega al `1.` ni se promueve a heading", () => {
    const input = ["## 1. Flujo", "", "1.", FLOW, "", "Texto posterior.", ""].join("\n");
    const out = formatDocumentMarkdown(input, { mermaid: "preserve" });
    assert.ok(out.includes(FLOW), `el bloque cambió o se perdió:\n${out}`);
    assert.doesNotMatch(out, /[]|FORGE_MERMAID/);
    assert.match(out, /^## 1\. Flujo$/m);
    assert.equal((out.match(/```mermaid/g) ?? []).length, 1);
  });

  it("fence exterior ````markdown: el diagrama interior sobrevive byte a byte", () => {
    const input = ["````markdown", "## 1. Flujo", "", FLOW, "", "Texto.", "````", ""].join("\n");
    const out = formatDocumentMarkdown(input, { mermaid: "preserve" });
    assert.ok(out.includes(FLOW), `el bloque cambió o se perdió:\n${out}`);
    assert.doesNotMatch(out, /[]|FORGE_MERMAID/);
  });

  it("DBGA duplicado: la deduplicación sigue funcionando y el diagrama no se pierde", () => {
    const block = (extra: string) =>
      [
        "# Domain Benchmark & Gap Analysis",
        "",
        "## 3. Reglas de Negocio",
        "",
        extra,
        "",
        FLOW,
        "",
      ].join("\n");
    const raw = [
      block("- Regla incompleta"),
      block("- Regla completa con suficiente detalle para pasar el filtro de truncado."),
    ].join("\n");
    const out = formatDocumentMarkdown(raw, { mermaid: "preserve" });
    assert.equal((out.match(/^# Domain Benchmark/gm) ?? []).length, 1);
    assert.match(out, /Regla completa/);
    assert.ok(out.includes(FLOW), `el diagrama se perdió:\n${out}`);
    assert.doesNotMatch(out, /[]|FORGE_MERMAID/);
  });

  it("un marcador que el formateo descarta no pierde el bloque: se reinserta al final y se avisa", () => {
    // El preámbulo anterior al primer H1/H2 se recorta; el diagrama vive ahí.
    const input = ["Preámbulo suelto", "", FLOW, "", "# Título", "", "Cuerpo.", ""].join("\n");
    const reinserted: Array<{ index: number; block: string }> = [];
    const out = formatDocumentMarkdown(input, {
      mermaid: "preserve",
      onMermaidReinserted: (info) => reinserted.push(info),
    });
    assert.ok(out.includes(FLOW), `el bloque se perdió:\n${out}`);
    assert.ok(out.indexOf(FLOW) > out.indexOf("# Título"), "debe quedar al final del documento");
    assert.equal(reinserted.length, 1);
    assert.equal(reinserted[0]!.block, FLOW);
    assert.doesNotMatch(out, /[]|FORGE_MERMAID/);
  });

  it("los cuatro bloques previos siguen byte a byte con la línea `1.` antes de cada uno", () => {
    const input = [
      "## 1. Flujos",
      "",
      ...[ER, SEQUENCE, MINDMAP, FLOWCHART].flatMap((b) => ["1.", b, ""]),
    ].join("\n");
    const out = formatDocumentMarkdown(input, { mermaid: "preserve" });
    for (const b of [ER, SEQUENCE, MINDMAP, FLOWCHART]) {
      assert.ok(out.includes(b), `el bloque cambió:\n${out}`);
    }
  });
});
