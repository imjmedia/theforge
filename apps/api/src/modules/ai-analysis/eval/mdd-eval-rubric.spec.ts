import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  extractMddSectionBody,
  extractRouteTokensFromSection4,
  scoreMddAgainstCase,
} from "./mdd-eval-rubric.js";
import {
  MDD_EVAL_DIMENSION_WEIGHTS,
  MDD_EVAL_FORBIDDEN_PENALTY_MAX,
  mddEvalCaseSchema,
  type MddEvalCase,
  type MddEvalDimensionKey,
} from "./mdd-eval.types.js";

const specDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(specDir, "../../../../eval/mdd/fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function loadCase(): MddEvalCase {
  return mddEvalCaseSchema.parse(JSON.parse(readFixture("ecommerce-tienda-basica.json")));
}

function caseWith(expect: Partial<MddEvalCase["expect"]>): MddEvalCase {
  const base = loadCase();
  return { ...base, expect: { ...base.expect, ...expect } };
}

function dimensionScore(markdown: string, evalCase: MddEvalCase, key: MddEvalDimensionKey): number {
  const dim = scoreMddAgainstCase(markdown, evalCase).dimensions.find((d) => d.key === key);
  return dim?.score ?? -1;
}

const FILLER =
  "Este apartado describe el sistema con el detalle suficiente para la prueba, en español claro, con frases completas que explican el alcance, las decisiones principales y los límites de la solución propuesta.";

const SECTION_TITLES = [
  "Contexto",
  "Arquitectura y Stack",
  "Modelo de Datos",
  "Contratos de API",
  "Lógica y Edge Cases",
  "Seguridad",
  "Infraestructura",
];

/** MDD mínimo válido: 7 secciones con prosa en español. Sobrescribe o omite secciones por número. */
function buildMdd(options: { overrides?: Record<number, string>; omit?: number[] } = {}): string {
  const overrides = options.overrides ?? {};
  const omit = options.omit ?? [];
  return SECTION_TITLES.map((title, index) => {
    const number = index + 1;
    if (omit.includes(number)) return "";
    const body = overrides[number] ?? FILLER;
    return `## ${number}. ${title}\n\n${body}\n`;
  })
    .filter((section) => section !== "")
    .join("\n");
}

function sqlBlock(...tables: string[]): string {
  const statements = tables.map((table) => `CREATE TABLE ${table} (\n  id UUID PRIMARY KEY\n);`);
  return ["```sql", statements.join("\n\n"), "```"].join("\n");
}

describe("scoreMddAgainstCase fixtures", () => {
  it("good fixture scores >= 85 and passes without failures", () => {
    const score = scoreMddAgainstCase(readFixture("good-ecommerce-tienda-basica.md"), loadCase());
    assert.ok(score.total >= 85, `total ${score.total} < 85`);
    assert.equal(score.passed, true);
    assert.deepEqual(score.forbiddenHits, []);
    assert.equal(score.forbiddenPenalty, 0);
    assert.deepEqual(score.failures, []);
  });

  it("bad fixture scores < 50, fails and reports the expected gaps", () => {
    const score = scoreMddAgainstCase(readFixture("bad-ecommerce-tienda-basica.md"), loadCase());
    assert.ok(score.total < 50, `total ${score.total} >= 50`);
    assert.equal(score.passed, false);
    assert.deepEqual(score.forbiddenHits, ["whatsapp", "(pendiente)"]);
    assert.equal(score.forbiddenPenalty, 10);

    const expectedFragments = [
      "estructura: falta la sección §6 (Seguridad)",
      "estructura: falta la sección §7 (Infraestructura)",
      "estructura: la sección §2 tiene 11 caracteres",
      'entidades: falta "categories" en §3',
      'entidades: falta "payments" en §3',
      'capacidades: falta "Autenticación de usuarios" en §4',
      'capacidades: falta "Pagos" en §4',
      'seguridad: falta "jwt" en §6',
      'infra: falta "docker" en §7',
      'contexto: §1 no menciona "tienda"',
      "idioma: prosa de §1 y §5 con poco español",
      "diagramas: falta un bloque mermaid erDiagram",
      'prohibido presente: "whatsapp"',
    ];
    for (const fragment of expectedFragments) {
      assert.ok(
        score.failures.some((failure) => failure.includes(fragment)),
        `falta el fallo que contiene: ${fragment}`,
      );
    }
  });
});

describe("entity matching", () => {
  it("accepts singular and plural table names and quoted schema-qualified names", () => {
    const md = buildMdd({
      overrides: {
        3: `${sqlBlock('"public"."orders"', "order", "address")}\n\n${FILLER}`,
      },
    });
    const evalCase = caseWith({ entities: ["orders", "addresses"], entitySynonyms: {} });
    assert.equal(dimensionScore(md, evalCase, "entities"), 100);
    assert.equal(scoreMddAgainstCase(md, evalCase).failures.filter((f) => f.startsWith("entidades")).length, 0);
    const missing = caseWith({ entities: ["users"], entitySynonyms: {} });
    assert.equal(dimensionScore(md, missing, "entities"), 0);
  });

  it("accepts entitySynonyms as alternative table names", () => {
    const md = buildMdd({ overrides: { 3: `${sqlBlock("payment_intents")}\n\n${FILLER}` } });
    const evalCase = caseWith({
      entities: ["payments"],
      entitySynonyms: { payments: ["payment_intents"] },
    });
    assert.equal(dimensionScore(md, evalCase, "entities"), 100);
  });

  it("falls back to erDiagram entities when SQL is missing", () => {
    const erBlock = [
      "```mermaid",
      "erDiagram",
      "    USERS ||--o{ ORDERS : places",
      "    ORDER_ITEMS {",
      "        int id PK",
      "    }",
      "```",
    ].join("\n");
    const md = buildMdd({ overrides: { 3: `${erBlock}\n\n${FILLER}` } });
    const evalCase = caseWith({ entities: ["orders", "order_items", "users"], entitySynonyms: {} });
    const score = scoreMddAgainstCase(md, evalCase);
    const entities = score.dimensions.find((d) => d.key === "entities");
    assert.equal(entities?.score, 100);
    assert.ok(entities?.details.some((d) => d.includes("erDiagram")));
  });

  it("reports missing entities as failure lines", () => {
    const md = buildMdd({ overrides: { 3: `${sqlBlock("orders")}\n\n${FILLER}` } });
    const evalCase = caseWith({ entities: ["orders", "invoices"], entitySynonyms: {} });
    const score = scoreMddAgainstCase(md, evalCase);
    assert.equal(dimensionScore(md, evalCase, "entities"), 50);
    assert.ok(score.failures.includes('entidades: falta "invoices" en §3 (ni CREATE TABLE ni entidad erDiagram)'));
  });
});

describe("security and infra tokens", () => {
  it("passes a a|b token when any alternative is present", () => {
    const evalCase = caseWith({ security: ["argon2|bcrypt"] });
    const withBcrypt = buildMdd({ overrides: { 6: "Las contraseñas se guardan con bcrypt y sal única por usuario, sin texto plano en ningún caso." } });
    const withArgon = buildMdd({ overrides: { 6: "Las contraseñas se guardan con argon2id y parámetros revisados cada año, sin texto plano en ningún caso." } });
    const neither = buildMdd({ overrides: { 6: "Las contraseñas se guardan con un algoritmo de hash propio, sin texto plano en ningún caso, según el equipo." } });
    assert.equal(dimensionScore(withBcrypt, evalCase, "security"), 100);
    assert.equal(dimensionScore(withArgon, evalCase, "security"), 100);
    assert.equal(dimensionScore(neither, evalCase, "security"), 0);
    assert.ok(scoreMddAgainstCase(neither, evalCase).failures.includes('seguridad: falta "argon2|bcrypt" en §6'));
  });

  it("matches tokens accent-insensitively and case-insensitively", () => {
    const evalCase = caseWith({ security: ["autenticacion"] });
    const md = buildMdd({ overrides: { 6: "La AUTENTICACIÓN usa sesiones firmadas y revisión periódica de accesos del personal interno." } });
    assert.equal(dimensionScore(md, evalCase, "security"), 100);
  });

  it("checks infra tokens only inside section 7", () => {
    const evalCase = caseWith({ infra: ["docker"] });
    const inSection6Only = buildMdd({
      overrides: { 6: "Docker no se menciona aquí en la sección de seguridad, sino solo como ejemplo de texto libre sin relación." },
      omit: [7],
    });
    assert.equal(dimensionScore(inSection6Only, evalCase, "infra"), 0);
  });
});

describe("heading variants and section extraction", () => {
  it("matches numbering with or without trailing dot or parenthesis", () => {
    for (const heading of ["## 1 Contexto", "## 1. Contexto y Alcance", "## 1) Contexto", "## 1.   Contexto"]) {
      const md = `${heading}\n\nTexto de la sección uno.\n\n## 2. Otra\n\nTexto dos.\n`;
      assert.equal(extractMddSectionBody(md, 1), "Texto de la sección uno.", heading);
    }
  });

  it("does not confuse section 1 with section 10 and bounds bodies at the next heading", () => {
    const md = "## 10. Anexo\n\nAnexo largo.\n\n## 1. Contexto\n\nUno.\n\n## 2. Stack\n\nDos.\n";
    assert.equal(extractMddSectionBody(md, 1), "Uno.");
    assert.equal(extractMddSectionBody(md, 10), "Anexo largo.");
    assert.equal(extractMddSectionBody(md, 3), null);
  });

  it("ignores section-like headings inside fenced code blocks", () => {
    const md = "## 1. Contexto\n\n```md\n## 2. Falso\nno es real\n```\n\nFin del contexto.\n";
    assert.equal(extractMddSectionBody(md, 2), null);
    assert.ok(extractMddSectionBody(md, 1)?.includes("## 2. Falso"));
  });
});

describe("route extraction from section 4", () => {
  it("extracts routes from GFM table cells after a method cell", () => {
    const section4 = "| Método | Ruta | Descripción |\n|---|---|---|\n| POST | /Auth/Login | Inicio |\n| get | `/products/:id` | Detalle |";
    const routes = extractRouteTokensFromSection4(section4);
    assert.ok(routes.includes("/auth/login"));
    assert.ok(routes.includes("/products/:id"));
    assert.ok(!routes.includes("/método"));
  });

  it("extracts routes from ### METHOD /path headings", () => {
    const routes = extractRouteTokensFromSection4("### DELETE /cart/items/{id}\n\nQuita una línea.");
    assert.deepEqual(routes, ["/cart/items/{id}"]);
  });

  it("extracts routes from inline METHOD /path mentions", () => {
    const routes = extractRouteTokensFromSection4("Usa GET /orders/list para el historial de compras.");
    assert.deepEqual(routes, ["/orders/list"]);
  });

  it("does not count bare paths in prose as route tokens", () => {
    const routes = extractRouteTokensFromSection4("La ruta /orders no tiene método declarado en este texto.");
    assert.deepEqual(routes, []);
  });

  it("covers a capability through any endpoint hint", () => {
    const evalCase = caseWith({
      capabilities: [{ name: "Pagos", endpointHints: ["/payments", "/checkout"] }],
    });
    const md = buildMdd({ overrides: { 4: "| Método | Ruta |\n|---|---|\n| POST | /checkout |\n\nTexto suficiente para la sección de contratos del sistema y sus respuestas." } });
    assert.equal(dimensionScore(md, evalCase, "capabilities"), 100);
  });
});

describe("structure", () => {
  it("scores a complete document with no structural penalty", () => {
    const score = scoreMddAgainstCase(buildMdd(), caseWith({}));
    assert.equal(score.dimensions.find((d) => d.key === "structure")?.score, 100);
  });

  it("penalises each missing section by 14 points", () => {
    const score = scoreMddAgainstCase(buildMdd({ omit: [6, 7] }), caseWith({}));
    assert.equal(score.dimensions.find((d) => d.key === "structure")?.score, 72);
    assert.ok(score.failures.includes("estructura: falta la sección §6 (Seguridad)"));
  });

  it("penalises a short section by 7 points", () => {
    const score = scoreMddAgainstCase(buildMdd({ overrides: { 2: "(Pendiente)" } }), caseWith({}));
    assert.equal(score.dimensions.find((d) => d.key === "structure")?.score, 93);
  });

  it("penalises duplicated canonical headings by 20 points", () => {
    const md = `${buildMdd()}\n## 3. Modelo de Datos\n\n${FILLER}\n`;
    const score = scoreMddAgainstCase(md, caseWith({}));
    assert.equal(score.dimensions.find((d) => d.key === "structure")?.score, 80);
    assert.ok(score.failures.includes("estructura: encabezado canónico duplicado §3"));
  });

  it("penalises an unclosed code fence by 20 points", () => {
    const md = `${buildMdd()}\n\`\`\`sql\nCREATE TABLE x (id INT);\n`;
    const score = scoreMddAgainstCase(md, caseWith({}));
    assert.equal(score.dimensions.find((d) => d.key === "structure")?.score, 80);
    assert.ok(score.failures.includes("estructura: bloque de código sin cerrar (```)"));
  });
});

describe("language, context and diagrams", () => {
  it("scores Spanish prose as 100 and English prose as 0", () => {
    const spanish = buildMdd();
    const english = buildMdd({
      overrides: {
        1: "This system will allow the team to manage every order and the stock for the store with a clear flow.",
        5: "The workflow should handle retries and the system must keep the state for every payment that arrives.",
      },
    });
    assert.equal(dimensionScore(spanish, caseWith({}), "language"), 100);
    assert.equal(dimensionScore(english, caseWith({}), "language"), 0);
  });

  it("requires mustMentionInContext in section 1 and gives 100 when the list is empty", () => {
    const md = buildMdd({ overrides: { 1: `${FILLER} Incluye tienda y pedidos.` } });
    const partial = caseWith({ mustMentionInContext: ["tienda", "pagos"] });
    assert.equal(dimensionScore(md, partial, "context"), 50);
    assert.equal(dimensionScore(md, caseWith({ mustMentionInContext: [] }), "context"), 100);
  });

  it("gives 100 for erDiagram, 50 for other mermaid and 0 without mermaid", () => {
    const er = buildMdd({ overrides: { 3: `${sqlBlock("users")}\n\n\`\`\`mermaid\nerDiagram\n  USERS\n\`\`\`\n${FILLER}` } });
    const flow = buildMdd({ overrides: { 3: `${sqlBlock("users")}\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n${FILLER}` } });
    const none = buildMdd({ overrides: { 3: `${sqlBlock("users")}\n\n${FILLER}` } });
    assert.equal(dimensionScore(er, caseWith({}), "diagrams"), 100);
    assert.equal(dimensionScore(flow, caseWith({}), "diagrams"), 50);
    assert.equal(dimensionScore(none, caseWith({}), "diagrams"), 0);
  });
});

describe("forbidden tokens and totals", () => {
  it("caps the forbidden penalty at MDD_EVAL_FORBIDDEN_PENALTY_MAX", () => {
    assert.equal(MDD_EVAL_FORBIDDEN_PENALTY_MAX, 20);
    const tokens = ["whatsapp", "wasender", "denue", "bitrix", "odoo", "sap"];
    const clean = buildMdd();
    const leaky = buildMdd({ overrides: { 1: `${FILLER} ${tokens.join(" ")}` } });
    const evalCase = caseWith({ forbidden: tokens });
    const cleanScore = scoreMddAgainstCase(clean, evalCase);
    const leakyScore = scoreMddAgainstCase(leaky, evalCase);
    assert.equal(leakyScore.forbiddenHits.length, 6);
    assert.equal(leakyScore.forbiddenPenalty, MDD_EVAL_FORBIDDEN_PENALTY_MAX);
    assert.equal(leakyScore.total, cleanScore.total - MDD_EVAL_FORBIDDEN_PENALTY_MAX);
  });

  it("matches forbidden tokens case- and accent-insensitively", () => {
    const md = buildMdd({ overrides: { 2: `${FILLER} Pendiente: Arquitecto asignará la plataforma.` } });
    const score = scoreMddAgainstCase(md, caseWith({ forbidden: ["pendiente: arquitecto"] }));
    assert.deepEqual(score.forbiddenHits, ["pendiente: arquitecto"]);
    assert.equal(score.forbiddenPenalty, 5);
  });

  it("never returns a total below 0", () => {
    const tokens = ["whatsapp", "wasender", "denue", "bitrix", "odoo", "sap"];
    const md = tokens.join("\n");
    const score = scoreMddAgainstCase(md, caseWith({ forbidden: tokens }));
    assert.equal(score.total, 0);
    assert.equal(score.passed, false);
  });

  it("uses the contract weights for every dimension and they sum to 100", () => {
    const score = scoreMddAgainstCase(readFixture("good-ecommerce-tienda-basica.md"), loadCase());
    const keys = Object.keys(MDD_EVAL_DIMENSION_WEIGHTS).sort();
    assert.deepEqual(score.dimensions.map((d) => d.key).sort(), keys);
    for (const dim of score.dimensions) {
      assert.equal(dim.weight, MDD_EVAL_DIMENSION_WEIGHTS[dim.key], `peso de ${dim.key}`);
    }
    const sum = Object.values(MDD_EVAL_DIMENSION_WEIGHTS).reduce((acc, w) => acc + w, 0);
    assert.equal(sum, 100);
  });
});
