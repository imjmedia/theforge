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
  normalizeSequenceDiagramSyntax,
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

  it("no renombra ids que el parser acepta (`A-1`, `1node`): el pipeline ya no llama a sanitizeFlowchartNodeIds", () => {
    const input = `flowchart TD
  A-1[Label] --> B-2[Label]
  1node[Label] --> 2node[Label]`;
    const out = normalizeMermaidDiagramBody(input);
    assert.equal(out, input);
    assert.equal(normalizeMermaidDiagramBody(out), out);
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

  it("conserva la arista a sí mismo `A --> A` (válida en Mermaid 11) en el pipeline", () => {
    const input = `flowchart TD
  A --> B
  A --> A`;
    const out = normalizeMermaidDiagramBody(input);
    assert.equal(out, input);
    assert.doesNotMatch(out, /self-edge removed/);
  });

  it("conserva la palabra `class` en classDiagram y no añade `+` a los miembros", () => {
    const input = `classDiagram
  class User {
    string name
    getAge()
  }`;
    const out = normalizeMermaidDiagramBody(input);
    // La entrada ya es válida: debe seguir empezando el bloque por `class User {`.
    assert.match(out, /^\s*class\s+User\s*\{/m);
    // Y no se reescriben los miembros (el parser de Mermaid los acepta tal cual).
    assert.match(out, /^\s*string name$/m);
  });

  it("classDiagram válido (class sin cuerpo, stereotype, genéricos, miembros con `:`) sale byte a byte igual", () => {
    const input = `classDiagram
  class Repo
  class Animal {
    +String name
    +eat() void
  }
  class Shape {
    <<interface>>
  }
  class List~T~
  Repo : +find()
  Animal <|-- Dog`;
    const out = normalizeMermaidDiagramBody(input);
    assert.equal(out, input);
    assert.equal(normalizeMermaidDiagramBody(out), out);
  });

  it("`Class Foo` con mayúscula (que el parser rechaza) se pasa a minúscula, no se elimina la palabra", () => {
    const out = normalizeMermaidDiagramBody("classDiagram\n  Class Foo {\n    +int x\n  }");
    assert.match(out, /^\s*class Foo \{$/m);
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

// ─── 1A.3: sequenceDiagram y erDiagram — entradas válidas salen intactas e idempotentes ────────

describe("1A.3 reglas 8, 9, 17 y 18: sequenceDiagram válido no se reescribe", () => {
  it("regla 8: `participant Servicio Facturación` (nombre con espacios) no pasa a `Servicio: \"…\"`", () => {
    const input = `sequenceDiagram
    participant Servicio Facturación
    participant Cliente
    Cliente->>Servicio Facturación: Pedir factura`;
    const out = normalizeMermaidDiagramBody(input);
    assert.equal(out, input);
  });

  it("regla 9: `create participant B` / `destroy B` no duplican la declaración de B", () => {
    const input = `sequenceDiagram
    participant A
    create participant B
    A->>B: Crear
    destroy B
    B-->>A: Adiós`;
    const out = normalizeMermaidDiagramBody(input);
    assert.equal(out, input);
    assert.equal((out.match(/participant B/g) ?? []).length, 1);
  });

  it("regla 17: `par A a B` no gana un espacio por pasada", () => {
    const input = `sequenceDiagram
    participant A
    participant B
    participant C
    par A a B
        A->>B: Hola B
    and A a C
        A->>C: Hola C
    end`;
    const out1 = normalizeMermaidDiagramBody(input);
    assert.equal(out1, input);
    assert.equal(normalizeMermaidDiagramBody(out1), input);
  });

  it("regla 18: `Note over X` se conserva y la reparación de `**Nota:**` es idempotente", () => {
    const valid = `sequenceDiagram
    participant A
    Note over A: Aviso`;
    assert.equal(normalizeMermaidDiagramBody(valid), valid);

    const glued = `sequenceDiagram
    participant API
    participant Frontend
    API-->>Frontend: Respuesta**Nota:** Solo visible para superadmins.`;
    const out1 = normalizeMermaidDiagramBody(glued);
    assert.match(out1, /^Note over Frontend: Solo visible para superadmins\.$/m);
    assert.equal(normalizeMermaidDiagramBody(out1), out1);
  });
});

describe("1A.3 regla 10: normalizeErCardinalityNotation no reescribe notaciones válidas", () => {
  it("`|o--o{`, `}|--|{`, `|o--||`, `||--o{`, `}o--o{` y `o|` salen byte a byte iguales", () => {
    const input = `erDiagram
  A |o--o{ B : x
  C }|--|{ D : y
  E |o--|| F : z
  G ||--o{ H : w
  I }o--o{ J : v
  K ||--o| L : u`;
    assert.equal(normalizeErCardinalityNotation(input), input);
    assert.equal(normalizeMermaidDiagramBody(input), input);
  });

  it("sigue corrigiendo lo que el parser rechaza (espacios dentro de la notación)", () => {
    const out = normalizeErCardinalityNotation("erDiagram\n  A || -- o{ B : x");
    assert.match(out, /A \|\|--o\{ B : x/);
  });
});

describe("normalizeSequenceDiagramSyntax: palabras clave de bloque exigen separador", () => {
  const ids = [
    "AltaService",
    "Optimizador",
    "BreakerSvc",
    "ElseHandler",
    "CriticalJob",
    "LoopRunner",
    "ParService",
  ];

  it("ids que empiezan con alt/opt/break/else/critical/loop/par no se parten ni ganan `end`", () => {
    const input = `sequenceDiagram
    participant AltaService
    participant Optimizador
    participant BreakerSvc
    participant ElseHandler
    participant CriticalJob
    participant LoopRunner
    participant ParService
    AltaService->>Optimizador: pide
    Optimizador-->>AltaService: ok
    BreakerSvc->>ElseHandler: corta
    ElseHandler->>CriticalJob: sigue
    CriticalJob->>LoopRunner: itera
    LoopRunner->>ParService: paralelo
    ParService-->>AltaService: fin`;
    assert.equal(normalizeSequenceDiagramSyntax(input), input);
    assert.equal(normalizeMermaidDiagramBody(input), input);
    for (const id of ids) assert.ok(normalizeMermaidDiagramBody(input).includes(id));
  });

  it("las palabras clave reales siguen normalizándose (alt/else/opt/critical/break/par)", () => {
    const input = `sequenceDiagram
    participant A
    participant B
    ALT  cond
    A->>B: x
    ELSE otra
    B->>A: y
    end
    OPT  extra
    A->>B: z
    end`;
    const out = normalizeSequenceDiagramSyntax(input);
    assert.match(out, /^ {4}alt cond$/m);
    assert.match(out, /^ {4}else otra$/m);
    assert.match(out, /^ {4}opt extra$/m);
    assert.equal(normalizeSequenceDiagramSyntax(out), out);
  });
});
