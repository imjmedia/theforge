import { describe, it } from "node:test";
import assert from "node:assert";
import {
  applySection1OnlyResult,
  buildClarifierFormatBlock,
  buildDraftOutline,
  buildSection1OnlyPromptBlock,
  canUseSection1OnlyMode,
  parseClarifierDelimitedOutput,
  CLARIFIER_DRAFT_MARKER,
  CLARIFIER_SCOPE_MARKER,
  CLARIFIER_SECTION1_MARKER,
} from "./mdd-clarifier-section1-only.util.js";

const SUBSTANTIAL_DRAFT = `# Master Design Document

## 1. Contexto

${"Contexto previo del proyecto de gestión de identidades. ".repeat(12)}

## 2. Arquitectura y Stack

${"NestJS con PostgreSQL y React en el frontend. ".repeat(10)}

## 3. Modelo de Datos

${Array.from({ length: 10 }, (_, i) => `- Tabla_${i}: columnas UUID y timestamps.`).join("\n")}

## 4. Contratos de API

${"POST /auth/login devuelve un token JWT. ".repeat(10)}
`;

describe("canUseSection1OnlyMode", () => {
  it("es false cuando el borrador no es sustancial", () => {
    assert.strictEqual(canUseSection1OnlyMode(SUBSTANTIAL_DRAFT, false), false);
  });

  it("es false con borrador vacío o mínimo", () => {
    assert.strictEqual(canUseSection1OnlyMode("", true), false);
    assert.strictEqual(canUseSection1OnlyMode("## 1. Contexto\n\ncorto", true), false);
  });

  it("es true con borrador sustancial y §1 localizable", () => {
    assert.strictEqual(canUseSection1OnlyMode(SUBSTANTIAL_DRAFT, true), true);
  });

  it("es false si §1 no es localizable (no se podría reinyectar)", () => {
    const sinSection1 = `# Doc\n\n${"Texto suelto sin encabezados canónicos. ".repeat(20)}`;
    assert.strictEqual(canUseSection1OnlyMode(sinSection1, true), false);
  });
});

describe("buildDraftOutline", () => {
  it("lista encabezados con una línea de resumen y no incluye el cuerpo entero", () => {
    const outline = buildDraftOutline(SUBSTANTIAL_DRAFT);
    assert.ok(String(outline).includes("2. Arquitectura y Stack"));
    assert.ok(String(outline).includes("4. Contratos de API"));
    assert.ok(outline.length < SUBSTANTIAL_DRAFT.length / 2);
  });

  it("respeta el tope de chars", () => {
    const many = Array.from({ length: 200 }, (_, i) => `## ${i}. Sección\n\ncuerpo ${i}`).join("\n\n");
    assert.ok(buildDraftOutline(many, 500).length <= 540);
  });
});

describe("buildSection1OnlyPromptBlock", () => {
  it("incluye §1 y el índice, pero no el cuerpo de §3", () => {
    const block = buildSection1OnlyPromptBlock(SUBSTANTIAL_DRAFT);
    assert.ok(String(block).includes("MODO SECCIÓN 1"));
    assert.ok(String(block).includes("Contexto previo del proyecto"));
    assert.ok(String(block).includes("3. Modelo de Datos"));
    // Del cuerpo de §3 sólo entra la primera línea (resumen del índice), no las 10.
    assert.ok(String(block).includes("Tabla_0"));
    assert.ok(!String(block).includes("Tabla_9"));
  });

  it("es mucho más corto que volcar el borrador entero", () => {
    assert.ok(buildSection1OnlyPromptBlock(SUBSTANTIAL_DRAFT).length < SUBSTANTIAL_DRAFT.length);
  });
});

describe("buildClarifierFormatBlock", () => {
  it("modo section1-only pide scope + §1 y prohíbe otros encabezados", () => {
    const block = buildClarifierFormatBlock("section1-only");
    assert.ok(String(block).includes(CLARIFIER_SCOPE_MARKER));
    assert.ok(String(block).includes(CLARIFIER_SECTION1_MARKER));
    assert.ok(!String(block).includes(CLARIFIER_DRAFT_MARKER));
    assert.ok(String(block).includes("§2–§7 se conservan intactas"));
  });

  it("modo full pide scope + documento completo", () => {
    const block = buildClarifierFormatBlock("full");
    assert.ok(String(block).includes(CLARIFIER_DRAFT_MARKER));
    assert.ok(!String(block).includes(CLARIFIER_SECTION1_MARKER));
  });
});

describe("parseClarifierDelimitedOutput", () => {
  it("devuelve null sin delimitadores (deja pasar al parser JSON)", () => {
    assert.strictEqual(parseClarifierDelimitedOutput('{"clarifiedScope":"a","mddDraft":"b"}'), null);
    assert.strictEqual(parseClarifierDelimitedOutput(""), null);
  });

  it("parsea modo §1-only", () => {
    const raw = `${CLARIFIER_SCOPE_MARKER}\nEntidades: users, apps.\n${CLARIFIER_SECTION1_MARKER}\n### Propósito\n\nTexto de §1.`;
    const parsed = parseClarifierDelimitedOutput(raw);
    assert.strictEqual(parsed?.clarifiedScope, "Entidades: users, apps.");
    assert.ok(String(parsed?.section1Body).includes("### Propósito"));
    assert.strictEqual(parsed?.mddDraft, null);
  });

  it("parsea modo full conservando markdown crudo con comillas y saltos", () => {
    const draft = '# Master Design Document\n\n## 1. Contexto\n\nUsa "comillas" y \\barras.';
    const raw = `${CLARIFIER_SCOPE_MARKER}\nScope.\n${CLARIFIER_DRAFT_MARKER}\n${draft}`;
    const parsed = parseClarifierDelimitedOutput(raw);
    assert.strictEqual(parsed?.mddDraft, draft);
    assert.strictEqual(parsed?.section1Body, null);
  });

  it("tolera preámbulo del modelo antes del primer delimitador", () => {
    const raw = `Claro, aquí tienes:\n\n${CLARIFIER_SCOPE_MARKER}\nScope.\n${CLARIFIER_SECTION1_MARKER}\nCuerpo §1.`;
    assert.strictEqual(parseClarifierDelimitedOutput(raw)?.clarifiedScope, "Scope.");
  });
});

describe("applySection1OnlyResult", () => {
  it("reinyecta §1 preservando §2–§4", () => {
    const nuevaSection1 = "Nuevo contexto ampliado. ".repeat(20);
    const merged = applySection1OnlyResult(SUBSTANTIAL_DRAFT, nuevaSection1);
    assert.notStrictEqual(merged, null);
    assert.ok(String(merged).includes("Nuevo contexto ampliado"));
    assert.ok(String(merged).includes("## 3. Modelo de Datos"));
    assert.ok(String(merged).includes("POST /auth/login"));
    assert.ok(!String(merged).includes("Contexto previo del proyecto"));
  });

  it("tolera que el modelo repita el encabezado `## 1. Contexto`", () => {
    const conHeading = `## 1. Contexto\n\n${"Cuerpo nuevo suficientemente largo. ".repeat(15)}`;
    const merged = applySection1OnlyResult(SUBSTANTIAL_DRAFT, conHeading);
    assert.notStrictEqual(merged, null);
    assert.strictEqual(merged!.match(/##\s*1\.\s*Contexto/g)?.length, 1);
  });

  it("devuelve null si la §1 generada es insustancial", () => {
    assert.strictEqual(applySection1OnlyResult(SUBSTANTIAL_DRAFT, "(Pendiente)"), null);
    assert.strictEqual(applySection1OnlyResult(SUBSTANTIAL_DRAFT, ""), null);
  });
});
