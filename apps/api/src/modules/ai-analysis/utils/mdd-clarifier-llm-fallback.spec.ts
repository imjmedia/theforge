import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldPreserveClarifierDraftOnLlmFailure } from "./mdd-clarifier-llm-fallback.util.js";

describe("mdd-clarifier-llm-fallback", () => {
  it("preserva borrador con §2 sustancial", () => {
    const draft =
      "# MDD\n\n## 1. Contexto\n\n" +
      "x".repeat(400) +
      "\n\n## 2. Arquitectura\n\nNestJS + React con detalle suficiente para scoped repair.\n\n## 3. Modelo\n\nCREATE TABLE t (id uuid primary key);\n\n## 4. Contratos\n\nGET /api/v1/health";
    assert.equal(shouldPreserveClarifierDraftOnLlmFailure(draft), true);
  });

  it("no preserva borrador vacío o solo placeholder", () => {
    assert.equal(shouldPreserveClarifierDraftOnLlmFailure(""), false);
    assert.equal(shouldPreserveClarifierDraftOnLlmFailure("## 1. Contexto\n\n(Pendiente)"), false);
  });
});
