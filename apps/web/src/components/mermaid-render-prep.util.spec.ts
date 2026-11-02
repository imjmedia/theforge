import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proposeMermaidRepairs } from "@theforge/shared-types/mermaid-oracle";
import {
  proposeExtendedMermaidRepairs,
  prepareMermaidForRender,
} from "./mermaid-render-prep.util.js";

describe("prepareMermaidForRender", () => {
  it("convierte NBSP y espacios Unicode en espacios ASCII", () => {
    const raw = "flowchart TD\n\u00A0\u00A0A[Uno]\u2007-->\u202FB[Dos]\u3000";
    assert.equal(prepareMermaidForRender(raw), "flowchart TD\n  A[Uno] --> B[Dos]");
  });

  it("convierte CRLF y CR en LF", () => {
    assert.equal(prepareMermaidForRender("flowchart TD\r\n  A --> B\r\n  B --> C"), "flowchart TD\n  A --> B\n  B --> C");
    assert.equal(prepareMermaidForRender("flowchart TD\r  A --> B"), "flowchart TD\n  A --> B");
  });

  it("quita envoltorios de fence que el LLM dejó dentro del cuerpo", () => {
    assert.equal(
      prepareMermaidForRender("```mermaid\nflowchart TD\n  A --> B\n```"),
      "flowchart TD\n  A --> B",
    );
  });

  it("deja intacto un sequenceDiagram con autonumber/activate/par/and", () => {
    const src = [
      "sequenceDiagram",
      "  autonumber",
      "  participant A",
      "  participant B",
      "  activate A",
      "  par Rama 1",
      "    A->>B: uno",
      "  and Rama 2",
      "    A->>B: dos",
      "  end",
      "  deactivate A",
    ].join("\n");
    assert.equal(prepareMermaidForRender(src), src);
  });

  it("no inventa sequenceDiagram ni convierte flechas en un bloque que empieza por participant", () => {
    const src = "participant A\nA --> B: msg";
    assert.equal(prepareMermaidForRender(src), src);
  });

  it("deja intacto un mindmap con indentación de 3 espacios", () => {
    const src = "mindmap\n   root((Raíz))\n      Hijo A\n         Nieto\n      Hijo B";
    assert.equal(prepareMermaidForRender(src), src);
  });

  it("deja intacta una flecha '-->' dentro del texto de un mensaje", () => {
    const src = "sequenceDiagram\n  A->>B: texto con --> flecha";
    assert.equal(prepareMermaidForRender(src), src);
  });

  it("es idempotente", () => {
    const raw = "```mermaid\r\nflowchart TD\r\n\u00A0\u00A0A --> B\r\n```";
    const once = prepareMermaidForRender(raw);
    assert.equal(prepareMermaidForRender(once), once);
  });
});

describe("proposeExtendedMermaidRepairs", () => {
  it("ofrece el cuerpo preparado cuando hay un fence suelto con prosa y no repite los candidatos automáticos", () => {
    const body = "flowchart TD\n  A --> B\n```\ntexto";
    const extended = proposeExtendedMermaidRepairs(body);
    assert.deepEqual(extended, ["flowchart TD\n  A --> B"]);
    for (const candidate of extended) {
      assert.ok(!proposeMermaidRepairs(body).includes(candidate));
      assert.notEqual(candidate, body);
    }
  });

  it("está deduplicado, sin vacíos y nunca devuelve el original", () => {
    for (const body of ["flowchart TD\n  A --> B", "", "   ", "```mermaid\nflowchart TD\n  A --> B\n```\n\nPorque..."]) {
      const out = proposeExtendedMermaidRepairs(body);
      assert.equal(new Set(out).size, out.length);
      assert.ok(out.every((c) => c.trim() && c !== body));
    }
  });

  it("un cuerpo ya limpio no genera candidatos", () => {
    assert.deepEqual(proposeExtendedMermaidRepairs("flowchart TD\n  A --> B"), []);
  });
});
