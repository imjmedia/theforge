import { describe, it } from "node:test";
import assert from "node:assert";
import {
  deterministicLintSyntaxErrors,
  formatDeterministicLintForPrompt,
  runDeterministicMddLint,
} from "./mdd-auditor-lint.util.js";
import type { ValidateMddStructureResult } from "./mdd-sanitize.js";

const validationOk: ValidateMddStructureResult = {
  section3HasPayloads: true,
  missingSections: [],
  hasTechnicalMetadata: true,
  sectionOrderCorrect: true,
  issues: [],
} as unknown as ValidateMddStructureResult;

describe("mdd-auditor-lint.util", () => {
  it("SQL y JSON válidos → sin errores y bloque de prompt con conteos", () => {
    const draft = [
      "## 3. Modelo de Datos",
      "```sql",
      "CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);",
      "```",
      "## 4. Contratos de API",
      "```json",
      '{ "email": "a@b.c" }',
      "```",
    ].join("\n");
    const lint = runDeterministicMddLint(draft, validationOk);
    assert.equal(lint.sqlBlocks, 1);
    assert.equal(lint.jsonBlocks, 1);
    assert.deepEqual(lint.sqlErrors, []);
    assert.deepEqual(lint.jsonErrors, []);
    const block = formatDeterministicLintForPrompt(lint);
    assert.ok(block.includes("SQL (1 bloque(s)"));
    assert.ok(block.includes("JSON (1 bloque(s)"));
    assert.ok(block.includes("NO hay herramientas que invocar"));
    assert.deepEqual(deterministicLintSyntaxErrors(lint), []);
  });

  it("JSON roto y SQL inválido → errores listados y prefijados por sección", () => {
    const draft = [
      "```sql",
      "CREATE TABLEX broken (;",
      "```",
      "```json",
      '{ "a": 1, }',
      "```",
    ].join("\n");
    const lint = runDeterministicMddLint(draft, validationOk);
    assert.ok(lint.sqlErrors.length >= 1);
    assert.equal(lint.jsonErrors.length, 1);
    const errors = deterministicLintSyntaxErrors(lint);
    assert.ok(errors.some((e) => e.startsWith("SQL §3:")));
    assert.ok(errors.some((e) => e.startsWith("§4: JSON inválido")));
  });

  it("sin bloques → mensajes 'no hay bloques' y nunca lanza", () => {
    const lint = runDeterministicMddLint("# MDD\n\n## 1. Contexto\n\nTexto.", validationOk);
    assert.equal(lint.sqlBlocks, 0);
    assert.equal(lint.jsonBlocks, 0);
    const block = formatDeterministicLintForPrompt(lint);
    assert.ok(block.includes("no hay bloques SQL"));
    assert.ok(block.includes("no hay bloques JSON"));
  });

  it("secciones faltantes e issues de estructura aparecen en el bloque", () => {
    const validation = {
      ...validationOk,
      missingSections: ["## 6. Seguridad"],
      section3HasPayloads: false,
      issues: ["Sección 4. Contratos de API: debe incluir tabla de endpoints."],
    } as unknown as ValidateMddStructureResult;
    const block = formatDeterministicLintForPrompt(runDeterministicMddLint("", validation));
    assert.ok(block.includes("faltantes: ## 6. Seguridad"));
    assert.ok(block.includes("payloads detectables: no"));
    assert.ok(block.includes("debe incluir tabla de endpoints"));
  });
});
