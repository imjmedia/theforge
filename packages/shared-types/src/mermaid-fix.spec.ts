import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessMermaidFixStrategy,
  isMermaidDiagramHeaderLine,
  looksLikeMermaidDiagramBody,
  normalizeMermaidInDocument,
  repairMermaidBlockBody,
  resolveMermaidBlockForRender,
  splitMermaidPreamble,
  validateMermaid,
} from "./mermaid.js";

describe("assessMermaidFixStrategy — license portal fixture", () => {
  it("repara localmente par ticipant y ends huérfanos sin pedir LLM", () => {
    const broken = `sequenceDiagram
    par ticipant User as Cliente
  end
User->>Web: Selecciona tier`;
    const assessment = assessMermaidFixStrategy(broken);
    assert.equal(assessment.strategy, "repair");
    assert.ok(assessment.reasons.includes("participant_keyword_split"));
    const repaired = repairMermaidBlockBody(broken);
    assert.match(repaired, /participant User/i);
    assert.doesNotMatch(repaired, /par ticipant/i);
  });
});

describe("resolveMermaidBlockForRender", () => {
  it("inyecta sequenceDiagram si faltaba la cabecera", () => {
    const out = resolveMermaidBlockForRender(`participant A as Alice\nA->>B: hi`);
    assert.match(out, /^sequenceDiagram\b/im);
    assert.match(out, /participant A/i);
  });
});

// ─── 1A.3 regla 14: una sola lista de cabeceras de Mermaid 11 ───────────────────────────────

const HEADER_SAMPLES = [
  "flowchart TD",
  "graph LR",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie showData",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "kanban",
  "architecture-beta",
  "radar-beta",
  "treemap-beta",
];

describe("isMermaidDiagramHeaderLine — una sola lista para todos los tipos", () => {
  it("reconoce la cabecera de todos los tipos de Mermaid 11", () => {
    for (const header of HEADER_SAMPLES) {
      assert.equal(isMermaidDiagramHeaderLine(header), true, header);
      assert.equal(isMermaidDiagramHeaderLine(`  ${header}  `), true, `${header} con espacios`);
    }
  });

  it("no confunde prosa con una cabecera", () => {
    for (const prose of ["### Flujo", "Este block de código", "- timelines largos", "packet de datos", "%%{init: {}}%%", ""]) {
      assert.equal(isMermaidDiagramHeaderLine(prose), false, prose);
    }
  });

  it("looksLikeMermaidDiagramBody y validateMermaid usan la misma lista", () => {
    for (const header of HEADER_SAMPLES) {
      assert.equal(looksLikeMermaidDiagramBody(`${header}\n  x`), true, header);
      assert.doesNotMatch(validateMermaid(`${header}\n  x`).join(" "), /Unknown diagram type/, header);
    }
    assert.equal(looksLikeMermaidDiagramBody("### Flujo\ntexto"), false);
    assert.match(validateMermaid("### Flujo\ntexto").join(" "), /Unknown diagram type/);
  });

  it("el front-matter y las directivas init no cuentan como primera línea", () => {
    const body = "---\ntitle: T\n---\n%%{init: {}}%%\nC4Context\n  title X";
    assert.equal(looksLikeMermaidDiagramBody(body), true);
    assert.deepEqual(splitMermaidPreamble(body), {
      preamble: "---\ntitle: T\n---\n%%{init: {}}%%",
      rest: "C4Context\n  title X",
    });
    assert.doesNotMatch(validateMermaid(body).join(" "), /Unknown diagram type/);
  });

  it("normalizeMermaidInDocument conserva el fence de C4, sankey, block, architecture, packet, zenuml, kanban, radar y treemap", () => {
    for (const header of ["C4Context", "sankey-beta", "block-beta", "architecture-beta", "packet-beta", "zenuml", "kanban", "radar-beta", "treemap-beta"]) {
      const doc = `## Diagrama\n\n\`\`\`mermaid\n${header}\n  x\n\`\`\`\n`;
      const out = normalizeMermaidInDocument(doc);
      assert.equal((out.match(/```mermaid/g) ?? []).length, 1, header);
      assert.match(out, new RegExp(`^${header}$`, "m"), header);
    }
  });
});
