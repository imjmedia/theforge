import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripMermaidComments,
  sanitizeFlowchartNodeIds,
  quoteFlowchartChineseLabels,
  classifyMermaidErrors,
  normalizeSequenceActivation,
  normalizeErCardinalityNotation,
  normalizeClassDiagramVisibility,
  guardFlowchartSelfEdges,
  assessMermaidFixStrategy,
  normalizeMermaidDiagramBody,
  resolveMermaidBlockForRender,
  validateMermaid,
  stripFlowchartTrailingTextGarbage,
  quoteFlowchartSpacedLabels,
  repairErDiagramDuplicateAttributeTypes,
  splitErDiagramEntityBlocksOnSameLine,
} from "./mermaid.js";

describe("stripMermaidComments", () => {
  it("strips %% comment lines from diagram body", () => {
    const input = `flowchart TD
  %% This is a comment
  A --> B
  %% Another comment
  B --> C`;
    const out = stripMermaidComments(input);
    assert.doesNotMatch(out, /%%/);
    assert.match(out, /A --> B/);
    assert.match(out, /B --> C/);
  });

  it("preserves empty lines for diagram spacing", () => {
    const input = `flowchart TD
  A --> B

  B --> C`;
    const out = stripMermaidComments(input);
    assert.match(out, /A --> B\n+\s*B --> C/);
  });

  it("handles empty input", () => {
    assert.equal(stripMermaidComments(""), "");
    assert.equal(stripMermaidComments("  "), "  ");
  });
});

describe("sanitizeFlowchartNodeIds", () => {
  it("sanitizes node IDs with invalid characters", () => {
    const input = `flowchart TD
  A-1[Label] --> B-2[Label]`;
    const out = sanitizeFlowchartNodeIds(input);
    // A-1 → A_1, B-2 → B_2
    assert.match(out, /A_1/);
    assert.match(out, /B_2/);
  });

  it("does not modify subgraph lines", () => {
    const input = `flowchart TD
  subgraph MyGraph["Title"]
    A --> B
  end`;
    const out = sanitizeFlowchartNodeIds(input);
    assert.match(out, /subgraph MyGraph/);
  });

  it("handles node IDs starting with digits", () => {
    const input = `flowchart TD
  1node[Label] --> 2node[Label]`;
    const out = sanitizeFlowchartNodeIds(input);
    assert.match(out, /_1node/);
    assert.match(out, /_2node/);
  });

  it("handles empty input", () => {
    assert.equal(sanitizeFlowchartNodeIds(""), "");
  });

  it("ignores non-flowchart diagrams", () => {
    const input = `sequenceDiagram
  participant A
  A->>B: Hello`;
    assert.equal(sanitizeFlowchartNodeIds(input), input);
  });
});

describe("quoteFlowchartChineseLabels", () => {
  it("quotes node labels containing Chinese characters", () => {
    const input = `flowchart TD
  A[用户管理] --> B[角色管理]`;
    const out = quoteFlowchartChineseLabels(input);
    assert.match(out, /A\["用户管理"\]/);
    assert.match(out, /B\["角色管理"\]/);
  });

  it("quotes edge labels containing Chinese characters", () => {
    const input = `flowchart TD
  A -->|分配| B`;
    const out = quoteFlowchartChineseLabels(input);
    assert.match(out, /\|"分配"\|/);
  });

  it("does not double-quote already quoted labels", () => {
    const input = `flowchart TD
  A["用户管理"] --> B`;
    const out = quoteFlowchartChineseLabels(input);
    assert.doesNotMatch(out, /A\[""用户管理""\]/);
  });

  it("ignores non-flowchart diagrams", () => {
    const input = `sequenceDiagram
  participant A
  A->>B: 用户操作`;
    assert.equal(quoteFlowchartChineseLabels(input), input);
  });
});

describe("classifyMermaidErrors", () => {
  it("classifies empty diagram", () => {
    const errors = classifyMermaidErrors("");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.category, "empty");
  });

  it("classifies orphan end lines as structure error", () => {
    const input = `flowchart TD
  A --> B
  end`;
    const errors = classifyMermaidErrors(input);
    assert.ok(errors.some((e) => e.category === "structure" && /orphan.*end/i.test(e.message)));
  });

  it("classifies unclosed subgraph as structure error", () => {
    const input = `flowchart TD
  subgraph MyGraph["Title"]
    A --> B`;
    const errors = classifyMermaidErrors(input);
    assert.ok(errors.some((e) => e.category === "structure" && /unclosed subgraph/i.test(e.message)));
  });

  it("classifies split participant keyword as syntax error", () => {
    const input = `sequenceDiagram
  par ticipant User as Cliente`;
    const errors = classifyMermaidErrors(input);
    assert.ok(errors.some((e) => e.category === "syntax" && /participant/i.test(e.message)));
  });

  it("returns empty array for valid diagram", () => {
    const input = `flowchart TD
  A --> B
  B --> C`;
    const errors = classifyMermaidErrors(input);
    assert.equal(errors.length, 0);
  });
});

describe("normalizeSequenceActivation", () => {
  it("pairs orphaned activate/deactivate", () => {
    const input = `sequenceDiagram
  participant A
  participant B
  A->>B: Request
  activate B
  B-->>A: Response
  deactivate B`;
    const out = normalizeSequenceActivation(input);
    assert.match(out, /activate B/);
    assert.match(out, /deactivate B/);
  });

  it("closes unclosed activations", () => {
    const input = `sequenceDiagram
  participant A
  participant B
  A->>B: Request
  activate B
  B-->>A: Response`;
    const out = normalizeSequenceActivation(input);
    assert.match(out, /activate B/);
    assert.match(out, /deactivate B/);
  });

  it("skips duplicate activate for same actor", () => {
    const input = `sequenceDiagram
  participant A
  activate A
  activate A
  A->>B: Hello`;
    const out = normalizeSequenceActivation(input);
    const activates = (out.match(/^\s*activate A\s*$/gm) ?? []).length;
    assert.equal(activates, 1);
  });

  it("ignores non-sequence diagrams", () => {
    const input = `flowchart TD
  A --> B`;
    assert.equal(normalizeSequenceActivation(input), input);
  });
});

describe("normalizeErCardinalityNotation", () => {
  it("normalizes malformed cardinality to valid pattern", () => {
    const input = `erDiagram
  USER ||--o{ ORDER : places`;
    const out = normalizeErCardinalityNotation(input);
    assert.match(out, /\|\|--o\{/);
  });

  it("preserves valid cardinality patterns", () => {
    const input = `erDiagram
  USER ||--o{ ORDER : places
  ORDER }o--|| PRODUCT : contains`;
    const out = normalizeErCardinalityNotation(input);
    assert.match(out, /\|\|--o\{/);
    assert.match(out, /\}o--\|\|/);
  });

  it("does not modify entity definition lines", () => {
    const input = `erDiagram
  USER {
    string name
    int age
  }`;
    const out = normalizeErCardinalityNotation(input);
    assert.match(out, /string name/);
    assert.match(out, /int age/);
  });

  it("ignores non-erDiagram diagrams", () => {
    const input = `flowchart TD
  A --> B`;
    assert.equal(normalizeErCardinalityNotation(input), input);
  });
});

describe("normalizeClassDiagramVisibility", () => {
  it("adds + prefix to bare members", () => {
    const input = `classDiagram
  class User {
    string name
    getAge()
  }`;
    const out = normalizeClassDiagramVisibility(input);
    assert.match(out, /\+string name/);
    assert.match(out, /\+getAge\(\)/);
  });

  it("preserves existing visibility prefixes", () => {
    const input = `classDiagram
  class User {
    -string name
    +getAge()
  }`;
    const out = normalizeClassDiagramVisibility(input);
    assert.match(out, /-string name/);
    assert.match(out, /\+getAge\(\)/);
  });

  it("skips class/namespace declarations", () => {
    const input = `classDiagram
  class User {
    string name
  }`;
    const out = normalizeClassDiagramVisibility(input);
    assert.doesNotMatch(out, /\+class User/);
  });

  it("ignores non-classDiagram diagrams", () => {
    const input = `flowchart TD
  A --> B`;
    assert.equal(normalizeClassDiagramVisibility(input), input);
  });
});

describe("guardFlowchartSelfEdges", () => {
  it("comments out self-referencing edges", () => {
    const input = `flowchart TD
  A --> B
  A --> A
  B --> C`;
    const out = guardFlowchartSelfEdges(input);
    assert.doesNotMatch(out, /^\s*A\s*-->\s*A\s*$/m);
    assert.match(out, /%% self-edge removed: A --> A/);
  });

  it("preserves normal edges", () => {
    const input = `flowchart TD
  A --> B
  B --> C`;
    const out = guardFlowchartSelfEdges(input);
    assert.match(out, /A --> B/);
    assert.match(out, /B --> C/);
  });

  it("ignores non-flowchart diagrams", () => {
    const input = `sequenceDiagram
  participant A
  A->>B: Hello`;
    assert.equal(guardFlowchartSelfEdges(input), input);
  });
});

describe("assessMermaidFixStrategy — classifiedErrors", () => {
  it("returns classifiedErrors array", () => {
    const input = `flowchart TD
  A --> B`;
    const assessment = assessMermaidFixStrategy(input);
    assert.ok(Array.isArray(assessment.classifiedErrors));
  });

  it("classifies empty diagram as empty category", () => {
    const assessment = assessMermaidFixStrategy("");
    assert.equal(assessment.classifiedErrors[0]!.category, "empty");
  });

  it("classifies structure errors for unclosed subgraph", () => {
    const input = `flowchart TD
  subgraph MyGraph["Title"]
    A --> B`;
    const assessment = assessMermaidFixStrategy(input);
    assert.ok(assessment.classifiedErrors.some((e) => e.category === "structure"));
  });
});

describe("normalizeMermaidDiagramBody — integration", () => {
  it("strips comments before normalization", () => {
    const input = `flowchart TD
  %% This comment should be removed
  A --> B`;
    const out = normalizeMermaidDiagramBody(input);
    assert.doesNotMatch(out, /%%/);
    assert.match(out, /A --> B/);
  });

  it("sanitizes node IDs in flowchart", () => {
    const input = `flowchart TD
  A-1[Label] --> B-2[Label]`;
    const out = normalizeMermaidDiagramBody(input);
    assert.match(out, /A_1/);
    assert.match(out, /B_2/);
  });

  it("quotes Chinese labels in flowchart", () => {
    const input = `flowchart TD
  A[用户管理] --> B[角色管理]`;
    const out = normalizeMermaidDiagramBody(input);
    assert.match(out, /A\["用户管理"\]/);
    assert.match(out, /B\["角色管理"\]/);
  });

  it("pairs orphaned activate/deactivate in sequence", () => {
    const input = `sequenceDiagram
  participant A
  participant B
  A->>B: Request
  activate B
  B-->>A: Response`;
    const out = normalizeMermaidDiagramBody(input);
    assert.match(out, /activate B/);
    assert.match(out, /deactivate B/);
  });

  it("guards self-edges in flowchart", () => {
    const input = `flowchart TD
  A --> B
  A --> A`;
    const out = normalizeMermaidDiagramBody(input);
    assert.doesNotMatch(out, /^\s*A\s*-->\s*A\s*$/m);
    assert.match(out, /%% self-edge removed: A --> A/);
  });

  it("normalizes class diagram member visibility", () => {
    const input = `classDiagram
  class User {
    string name
    getAge()
  }`;
    const out = normalizeMermaidDiagramBody(input);
    assert.match(out, /\+string name/);
    assert.match(out, /\+getAge\(\)/);
  });
});

describe("micro-tutorials MDD fixture repairs", () => {
  const brokenFlowchart = `flowchart TD
    Client[Cliente Web - React + kreo-ui] -->|HTTPS /api/v1| Gateway[API Gateway - Express]
Gateway -->|"JWT + Tenant Context"| TenantsModule[Módulo Tenants]text
Gateway -->|"JWT + Tenant Context"| UsersModule[Módulo Usuarios]
Scripting -->|"Strategy Pattern"| OpenRouter[OpenRouter API]text`;

  it("stripFlowchartTrailingTextGarbage removes ]text and splits ]textGateway", () => {
    const joined =
      'Gateway -->|"JWT + Tenant Context"| TenantsModule[Módulo Tenants]textGateway -->|"JWT + Tenant Context"| UsersModule[Módulo Usuarios]';
    const out = stripFlowchartTrailingTextGarbage(
      `flowchart TD\n${joined}\nOpenRouter[OpenRouter API]text`,
    );
    assert.doesNotMatch(out, /\]text/i);
    assert.match(out, /TenantsModule\[Módulo Tenants\]/);
    assert.match(out, /Gateway -->/);
  });

  it("quoteFlowchartSpacedLabels quotes accent labels", () => {
    const out = quoteFlowchartSpacedLabels(brokenFlowchart);
    assert.match(out, /TenantsModule\["Módulo Tenants"\]/);
    assert.match(out, /UsersModule\["Módulo Usuarios"\]/);
  });

  it("flowchart fixture validates after full repair pipeline", () => {
    const repaired = resolveMermaidBlockForRender(brokenFlowchart);
    assert.doesNotMatch(repaired, /\]text/i);
    assert.equal(validateMermaid(repaired).length, 0);
    assert.equal(assessMermaidFixStrategy(brokenFlowchart).strategy, "repair");
  });

  const brokenEr = `erDiagram
  tutorials {
    uuid id PK
    string original_request string
    bool downloadable
    datetime created_at
  } llm_configs {
    uuid id PK
  }`;

  it("repairErDiagramDuplicateAttributeTypes fixes duplicate type tokens", () => {
    const out = repairErDiagramDuplicateAttributeTypes(brokenEr);
    assert.match(out, /text original_request/);
    assert.doesNotMatch(out, /original_request string/);
  });

  it("splitErDiagramEntityBlocksOnSameLine splits entity headers", () => {
    const out = splitErDiagramEntityBlocksOnSameLine(brokenEr);
    assert.match(out, /}\n  llm_configs \{/);
  });

  it("erDiagram fixture validates after full repair pipeline", () => {
    const repaired = resolveMermaidBlockForRender(brokenEr);
    assert.match(repaired, /string original_request/);
    assert.doesNotMatch(repaired, /original_request string/);
    assert.match(repaired, /llm_configs \{/);
    assert.equal(validateMermaid(repaired).length, 0);
  });
});
