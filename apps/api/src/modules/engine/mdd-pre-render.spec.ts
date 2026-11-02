import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mermaidBlockHasUsableStructure,
  preRenderMddSanity,
  repairPrematureMermaidFenceClose,
  resolveReassembledFenceLines,
  sanitizeMermaidBlock,
  stripInvalidMermaidFences,
  sanitizeMermaidInDraft,
  validateMermaidSyntax,
} from "./mdd-pre-render.js";

describe("sanitizeMermaidBlock erDiagram PK/FK", () => {
  it("repara PK, FK con coma a un solo PK", () => {
    const raw = `erDiagram
  users {
    uuid user_id PK, FK
  }`;
    const out = sanitizeMermaidBlock(raw);
    assert.match(out, /user_id PK/);
    assert.doesNotMatch(out, /PK\s*,\s*FK/);
    assert.doesNotMatch(out, /\bPK\s+FK\b/i);
  });

  it("preRenderMddSanity acepta erDiagram reparado", () => {
    const draft = `# MDD

## 3. Modelo de Datos

\`\`\`mermaid
erDiagram
  agencies {
    uuid tenant_id PK, FK
    string name
  }
\`\`\`
`;
    assert.equal(preRenderMddSanity(draft).ok, true);
  });

  it("preRenderMddSanity acepta flowchart con subgraph", () => {
    const draft = `# MDD

## 2. Arquitectura

\`\`\`mermaid
flowchart TD
  subgraph fe_React["Frontend React"]
    UI[Panel] --> API[API Gateway]
  end
\`\`\`
`;
    assert.equal(preRenderMddSanity(draft).ok, true);
  });
});

describe("validateMermaidSyntax", () => {
  it("expone error distinto si falta tipo de diagrama", () => {
    const result = validateMermaidSyntax(`users {
  uuid id PK
}`);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /Unknown diagram type|inválido/i);
  });
});

describe("sanitizeMermaidInDraft / premature fence", () => {
  it("mermaidBlockHasUsableStructure es false sin aristas", () => {
    assert.equal(
      mermaidBlockHasUsableStructure(`flowchart TB
  subgraph ACTORES["Actores"]
  end`),
      false,
    );
  });

  it("reensambla nodos ### ID[...] fuera del fence tras cierre prematuro", () => {
    const raw = `### 2.8 Diagrama

\`\`\`mermaid
flowchart TB
  subgraph ACTORES["Actores de negocio"]
  end
\`\`\`

### USR["Usuario Autorizado (WhatsApp)"]

### ADM["Superadmin / Tenant Admin (Panel Web)"]

  subgraph INFRA["Infraestructura AWS"]
  WAF["AWS WAF + ALB"]
  end

USR -->|"Mensajes"| WAF
`;
    const out = sanitizeMermaidInDraft(raw);
    assert.match(out, /```mermaid/);
    assert.match(out, /USR\["Usuario Autorizado/);
    assert.match(out, /USR\s*-->/);
    assert.doesNotMatch(out, /### USR\[/);
  });

  it("repairPrematureMermaidFenceClose demote headings a nodos", () => {
    const raw = `\`\`\`mermaid
flowchart TB
  A[Start]
\`\`\`

### B["Next"]

A --> B
`;
    const out = repairPrematureMermaidFenceClose(raw);
    assert.match(out, /B\["Next"\]/);
    assert.doesNotMatch(out, /### B\[/);
  });
});

// ---------------------------------------------------------------------------
// 1A.5: los fences de diagramas válidos no se pierden
// ---------------------------------------------------------------------------

const SQL = "CREATE TABLE usuarios (\n  id INT PRIMARY KEY\n);";

/** Diagramas válidos que no usan flechas de flowchart (`-->`): antes perdían el fence. */
const DIAGRAMS_WITHOUT_FLOWCHART_ARROWS: Record<string, string> = {
  "sequence solo con ->>": "sequenceDiagram\n  participant A\n  participant B\n  A->>B: Hola\n  B->>A: Listo",
  classDiagram: "classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  class Dog\n  Animal <|-- Dog",
  pie: 'pie title Gastos\n  "Infraestructura" : 40\n  "Personal" : 60',
  gantt:
    "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Diseño\n  Análisis :a1, 2026-01-01, 10d\n  Prototipo :after a1, 7d",
  journey: "journey\n  title Compra\n  section Navegar\n    Buscar: 5: Cliente",
  mindmap: "mindmap\n  root((Producto))\n    Origen\n    Uso",
  timeline: "timeline\n  title Hitos\n  2026 : Lanzamiento\n  2027 : Escala",
  gitGraph: "gitGraph\n  commit\n  branch dev\n  checkout dev\n  commit\n  checkout main\n  merge dev",
  C4Context:
    'C4Context\n  title Contexto\n  Person(user, "Usuario", "Cliente")\n  System(sys, "Sistema", "Plataforma")\n  Rel(user, sys, "Usa")',
  "sankey-beta": "sankey-beta\n\nIngresos,Gastos,50\nIngresos,Ahorro,20",
  "block-beta": "block-beta\n  columns 2\n  a[\"A\"] b[\"B\"]",
  "architecture-beta": "architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api",
  "packet-beta": 'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"',
};

function mermaidFences(doc: string): string[] {
  return [...doc.matchAll(/```mermaid[ \t]*\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
}

function docWith(body: string): string {
  return `## 3. Modelo\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\n\`\`\`sql\n${SQL}\n\`\`\`\n`;
}

describe("sanitizeMermaidInDraft conserva el fence de diagramas sin flechas de flowchart", () => {
  for (const [name, body] of Object.entries(DIAGRAMS_WITHOUT_FLOWCHART_ARROWS)) {
    it(`${name}: un fence mermaid, cabecera intacta y SQL vecino intacto`, () => {
      const out = sanitizeMermaidInDraft(docWith(body));
      const fences = mermaidFences(out);
      assert.equal(fences.length, 1, out);
      assert.equal(fences[0]!.split("\n")[0], body.split("\n")[0]);
      assert.ok(out.includes(`\`\`\`sql\n${SQL}\n\`\`\``), out);
    });

    it(`${name}: mermaidBlockHasUsableStructure es true`, () => {
      assert.equal(mermaidBlockHasUsableStructure(body), true);
    });
  }

  it("respeta el front-matter y las directivas antes de la cabecera", () => {
    const body = '%%{init: {"theme": "dark"}}%%\npie title X\n  "a" : 1';
    assert.equal(mermaidBlockHasUsableStructure(body), true);
    assert.equal(mermaidFences(sanitizeMermaidInDraft(docWith(body))).length, 1);
  });

  it("flowchart sin aristas sigue sin contar como diagrama de componentes", () => {
    assert.equal(mermaidBlockHasUsableStructure("flowchart TB\n  subgraph A\n  end"), false);
  });

  it("un flowchart sin aristas conserva igualmente su fence en el borrador", () => {
    const out = sanitizeMermaidInDraft(docWith("flowchart TB\n  A[Solo nodo]"));
    assert.equal(mermaidFences(out).length, 1, out);
  });
});

describe("fences inválidos no dejan fences abiertos ni SQL huérfano", () => {
  it("prosa en ```mermaid seguida de ```sql: queda prosa y el SQL intacto", () => {
    const doc = `## 3.\n\n\`\`\`mermaid\nEsto es solo texto del LLM\n\`\`\`\n\n\`\`\`sql\n${SQL}\n\`\`\`\n`;
    const out = sanitizeMermaidInDraft(doc);
    assert.equal(mermaidFences(out).length, 0, out);
    assert.match(out, /Esto es solo texto del LLM/);
    assert.ok(out.includes(`\`\`\`sql\n${SQL}\n\`\`\``), out);
    assert.equal((out.match(/```/g) ?? []).length, 2, out);
  });

  it("fence mermaid sin cierre seguido de ```sql: se cierra solo, sin encabezados basura", () => {
    const doc = `## 3.\n\n\`\`\`mermaid\nsequenceDiagram\n  A->>B: hola\n\n\`\`\`sql\n${SQL}\n\`\`\`\n`;
    const out = sanitizeMermaidInDraft(doc);
    assert.equal(mermaidFences(out).length, 1, out);
    assert.ok(out.includes(`\`\`\`sql\n${SQL}\n\`\`\``), out);
    assert.equal((out.match(/```/g) ?? []).length, 4, out);
    assert.deepEqual(out.match(/^#{1,6}\s.*$/gm), ["## 3."], out);
  });

  it("fence inválido sin cierre seguido de ```sql: no deja la apertura del SQL huérfana", () => {
    const doc = `## 3.\n\n\`\`\`mermaid\nnota suelta\n\n\`\`\`sql\n${SQL}\n\`\`\`\n`;
    const out = sanitizeMermaidInDraft(doc);
    assert.ok(out.includes(`\`\`\`sql\n${SQL}\n\`\`\``), out);
    assert.equal((out.match(/```/g) ?? []).length % 2, 0, out);
  });

  it("repairPrematureMermaidFenceClose siempre emite el cierre aunque el cuerpo no sea diagrama", () => {
    const out = repairPrematureMermaidFenceClose(`\`\`\`mermaid\nnota suelta\n\`\`\`\n\ntexto\n`);
    assert.equal(out, `\`\`\`mermaid\nnota suelta\n\`\`\`\n\ntexto\n`);
  });

  it("stripInvalidMermaidFences elimina un fence vacío sin dejar backticks", () => {
    const out = stripInvalidMermaidFences("antes\n\n```mermaid\n```\n\ndespués");
    assert.doesNotMatch(out, /```/);
    assert.match(out, /antes/);
    assert.match(out, /después/);
  });

  it("no toca un ```mermaid escrito dentro de otro fence (```sql)", () => {
    const doc = "```sql\n-- ```mermaid\nSELECT 1;\n```\n";
    assert.equal(sanitizeMermaidInDraft(doc), doc);
  });
});

describe("sanitizeMermaidInDraft es idempotente", () => {
  const docs: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(DIAGRAMS_WITHOUT_FLOWCHART_ARROWS).map(([k, v]) => [k, docWith(v)]),
    ),
    "cierre prematuro con huérfanos": `\`\`\`mermaid\nflowchart TB\n  A[Start]\n\`\`\`\n\n### B["Next"]\n\nA --> B\n`,
    "prosa en fence": "```mermaid\nSolo texto\n```\n\n```sql\nSELECT 1;\n```\n",
    "sin cierre + sql": `\`\`\`mermaid\nsequenceDiagram\n  A->>B: hi\n\`\`\`sql\nSELECT 1;\n\`\`\`\n`,
  };
  for (const [name, doc] of Object.entries(docs)) {
    it(name, () => {
      const once = sanitizeMermaidInDraft(doc);
      assert.equal(sanitizeMermaidInDraft(once), once);
    });
  }
});

describe("resolveReassembledFenceLines (rama de respaldo del reensamblado)", () => {
  it("con cabecera válida emite el diagrama saneado", () => {
    assert.deepEqual(
      resolveReassembledFenceLines("flowchart TD\n  A --> B", ["flowchart TD"], ["  A --> B"]),
      ["flowchart TD", "  A --> B"],
    );
  });

  it("si el saneado perdió la cabecera conserva el cuerpo Y los huérfanos ya consumidos", () => {
    const out = resolveReassembledFenceLines(
      "A --> B",
      ["flowchart TD", "  A[\"a\"]"],
      ["", "  B[\"b\"]", "  A --> B"],
    );
    assert.deepEqual(out, ["flowchart TD", "  A[\"a\"]", "", "  B[\"b\"]", "  A --> B"]);
  });

  it("el reensamblado normal no pierde nodos huérfanos (regresión)", () => {
    const raw = "## 2.8 Diagrama\n\n```mermaid\nflowchart TB\n  subgraph A[\"a\"]\n  end\n```\n\n### U[\"Usuario\"]\n\nU --> W\n";
    const out = repairPrematureMermaidFenceClose(raw);
    assert.match(out, /U\["Usuario"\]/);
    assert.match(out, /U --> W/);
  });
});
