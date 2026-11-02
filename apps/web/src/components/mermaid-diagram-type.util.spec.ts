import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultMermaidViewMode,
  detectMermaidDiagramType,
  flowchartHasSubgraphs,
  isExcalidrawSupported,
  isMermaidCodeBlock,
  isNativeExcalidraw,
  looksLikeMermaidSyntax,
  mermaidDiagramHeaderLine,
} from "./mermaid-diagram-type.util.js";

describe("mermaidDiagramHeaderLine", () => {
  it("returns first non-empty line", () => {
    assert.equal(mermaidDiagramHeaderLine("flowchart\n  A --> B"), "flowchart");
  });
});

describe("detectMermaidDiagramType", () => {
  it("detects flowchart without direction", () => {
    assert.equal(detectMermaidDiagramType("flowchart\n  A --> B"), "flowchart");
  });

  it("detects flowchart with direction", () => {
    assert.equal(detectMermaidDiagramType("flowchart TD\n  A --> B"), "flowchart");
    assert.equal(detectMermaidDiagramType("flowchart LR\n  A --> B"), "flowchart");
  });

  it("detects graph with direction as flowchart", () => {
    assert.equal(detectMermaidDiagramType("graph TD;\n  A-->B"), "flowchart");
  });

  it("detects ER, sequence, class, state diagrams", () => {
    assert.equal(
      detectMermaidDiagramType("erDiagram\n  USER ||--o{ ORDER : places"),
      "erDiagram",
    );
    assert.equal(detectMermaidDiagramType("sequenceDiagram\n  A->>B: hi"), "sequenceDiagram");
    assert.equal(detectMermaidDiagramType("classDiagram\n  class Foo"), "classDiagram");
    assert.equal(detectMermaidDiagramType("stateDiagram-v2\n  [*] --> Idle"), "stateDiagram");
  });

  it("returns unsupported for gantt and bare graph", () => {
    assert.equal(detectMermaidDiagramType("gantt\n  title Plan"), "unsupported");
    assert.equal(detectMermaidDiagramType("graph\n  A --> B"), "unsupported");
  });
});

describe("isExcalidrawSupported", () => {
  it("ofrece el toggle para flowchart (con o sin subgraph, graph incluido)", () => {
    for (const src of [
      "flowchart TD\n  A --> B",
      "graph LR\n  A --> B",
      "flowchart TD\n  subgraph G\n    A --> B\n  end",
    ]) {
      assert.equal(isExcalidrawSupported(detectMermaidDiagramType(src)), true, src);
    }
  });

  it("ofrece el toggle para sequence, ER y class (alcance previo a la Fase 1)", () => {
    for (const src of [
      "sequenceDiagram\n  A->>B: hi",
      "erDiagram\n  USER ||--o{ ORDER : places",
      "classDiagram\n  class Foo",
    ]) {
      assert.equal(isExcalidrawSupported(detectMermaidDiagramType(src)), true, src);
    }
  });

  it("no ofrece el toggle para state, gantt ni mindmap", () => {
    for (const src of [
      "stateDiagram-v2\n  [*] --> Idle",
      "gantt\n  title Plan",
      "mindmap\n  root((x))",
    ]) {
      assert.equal(isExcalidrawSupported(detectMermaidDiagramType(src)), false, src);
    }
  });
});

describe("isNativeExcalidraw", () => {
  it("es true para flowchart y sequence", () => {
    assert.equal(isNativeExcalidraw("flowchart"), true);
    assert.equal(isNativeExcalidraw("sequenceDiagram"), true);
    assert.equal(isNativeExcalidraw("erDiagram"), false);
  });
});

describe("looksLikeMermaidSyntax", () => {
  it("matches flowchart without direction", () => {
    assert.equal(looksLikeMermaidSyntax("flowchart\n  A --> B"), true);
  });

  it("does not match prose or graph-internal paths", () => {
    assert.equal(looksLikeMermaidSyntax("graph-internal/foo"), false);
    assert.equal(looksLikeMermaidSyntax("Not a diagram"), false);
  });

  it("matches graph with direction", () => {
    assert.equal(looksLikeMermaidSyntax("graph LR\n  A --> B"), true);
  });
});

describe("isMermaidCodeBlock", () => {
  it("accepts language-mermaid class even with odd body", () => {
    assert.equal(isMermaidCodeBlock("some text", "language-mermaid"), true);
  });

  it("accepts syntax without mermaid class", () => {
    assert.equal(isMermaidCodeBlock("sequenceDiagram\n  A->>B: x"), true);
  });
});

describe("flowchartHasSubgraphs", () => {
  it("detects subgraph blocks", () => {
    assert.equal(
      flowchartHasSubgraphs("flowchart TD\n  subgraph A\n    X --> Y\n  end"),
      true,
    );
    assert.equal(flowchartHasSubgraphs("flowchart TD\n  A --> B"), false);
  });
});

describe("defaultMermaidViewMode", () => {
  it("es siempre svg (Excalidraw es solo un toggle)", () => {
    assert.equal(defaultMermaidViewMode(), "svg");
  });
});
