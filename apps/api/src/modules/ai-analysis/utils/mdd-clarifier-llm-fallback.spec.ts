import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dbgaSnippetForClarifierFallback,
  shouldPreserveClarifierDraftOnLlmFailure,
} from "./mdd-clarifier-llm-fallback.util.js";

describe("mdd-clarifier-llm-fallback", () => {
  it("dbgaSnippetForClarifierFallback elimina stamp theforge-doc del BRD", () => {
    const stamped =
      "## Contexto — BRD (negocio, KPIs, alcance)\n\n" +
      "<!-- theforge-doc:created=2026-07-17T00:29:17.585Z|updated=2026-07-17T00:29:17.585Z -->\n" +
      "> 📅 Creado: 17 de julio de 2026\n\n" +
      "Objetivo del copiloto multiempresa con KPIs de adopción.";
    const snippet = dbgaSnippetForClarifierFallback(stamped, 500);
    assert.doesNotMatch(snippet, /theforge-doc:created=/);
    assert.doesNotMatch(snippet, /📅 Creado:/);
    assert.match(snippet, /Objetivo del copiloto/i);
  });

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
