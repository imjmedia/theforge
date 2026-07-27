import { describe, it } from "node:test";
import assert from "node:assert";
import {
  assembleClarifierMddDraft,
  finalizeClarifierDraft,
  MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT,
  stripClarifierGovernanceFromDraft,
} from "./mdd-clarifier-draft.util.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { MDD_GOVERNANCE_WIZARD_BODY } from "@theforge/shared-types/mdd-governance-patterns";

const longScope = "A".repeat(250);

describe("finalizeClarifierDraft", () => {
  it("preserva baseline cuando el LLM devuelve §1 insustancial", () => {
    const baseline = getMddTemplatePlaceholder("baseline");
    const baselineWithS1 = baseline.replace(
      /(\n##\s*1\.\s*Contexto[^\n]*\n+)/i,
      `$1${"Contexto sustancial del producto. ".repeat(20)}\n`,
    );
    const thinLlm = getMddTemplatePlaceholder("(Pendiente)");

    const out = finalizeClarifierDraft({
      llmDraft: thinLlm,
      previousDraft: baselineWithS1,
      clarifiedScope: longScope,
      dbgaContent: "x".repeat(MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT),
    });

    assert.match(out, /Contexto sustancial del producto/);
    assert.ok(out.length > thinLlm.length);
  });

  it("hidrata §1 desde scope cuando DBGA es grande y no hay baseline", () => {
    const thinLlm = getMddTemplatePlaceholder("(vacío)");
    const out = finalizeClarifierDraft({
      llmDraft: thinLlm,
      previousDraft: "",
      clarifiedScope: longScope,
      dbgaContent: "d".repeat(20_000),
    });

    assert.ok(out.includes(longScope.slice(0, 100)));
    assert.ok(out.length >= 250);
  });

  it("acepta draft LLM sustancial sin cambios", () => {
    const substantial = `# MDD\n\n## 1. Contexto y alcance\n\n${"x".repeat(300)}\n\n## 2. Arquitectura y Stack\n\n${"NestJS ".repeat(40)}\n\n## 3. Modelo de Datos\n\n${"CREATE TABLE foo (id INT); ".repeat(15)}\n`;
    const out = finalizeClarifierDraft({
      llmDraft: substantial,
      previousDraft: "",
      clarifiedScope: longScope,
      dbgaContent: "d".repeat(1000),
    });
    assert.equal(out.trim(), substantial.trim());
  });

  it("hidrata §1 desde brief DBGA (no slice ciego) cuando scope es corto", () => {
    const largeDbga = `
## Objetivo
KMS empresarial con taxonomías y workflows.

## Alcance
Gestión documental y búsqueda semántica.

## Capacidades
### Documentos
Versionado y aprobación.
`.repeat(120);

    const thinLlm = getMddTemplatePlaceholder("(vacío)");
    const out = finalizeClarifierDraft({
      llmDraft: thinLlm,
      previousDraft: "",
      clarifiedScope: "corto",
      dbgaContent: largeDbga,
    });

    assert.match(out, /Objetivo|KMS|Gestión documental/i);
    assert.ok(out.length >= 250);
  });

  it("stripClarifierGovernanceFromDraft quita sección inmutable", () => {
    const withGov = `# Master Design Document\n\n${MDD_GOVERNANCE_WIZARD_BODY}\n\n## 1. Contexto\n\nTexto.\n`;
    const out = stripClarifierGovernanceFromDraft(withGov);
    assert.ok(!out.includes("[ARQUITECTURA - SECCIÓN INMUTABLE]"));
    assert.match(out, /## 1\. Contexto/);
  });

  it("assembleClarifierMddDraft arma plantilla cuando LLM solo devuelve §1", () => {
    const onlyS1 = `# Master Design Document\n\n## 1. Contexto\n\n${"Contexto detallado. ".repeat(30)}\n`;
    const out = assembleClarifierMddDraft(onlyS1);
    assert.match(out, /## 2\. Arquitectura y Stack/);
    assert.match(out, /\(Pendiente\)/);
    assert.match(out, /Contexto detallado/);
  });

  it("assembleClarifierMddDraft preserva borrador sustancial de refinamiento", () => {
    const substantial = `# Master Design Document\n\n## 1. Contexto\n\nCorto.\n\n## 2. Arquitectura y Stack\n\n${"NestJS stack detallado. ".repeat(80)}\n\n## 3. Modelo de Datos\n\n${"CREATE TABLE foo (id INT); ".repeat(20)}\n`;
    const out = assembleClarifierMddDraft(substantial);
    assert.match(out, /NestJS stack detallado/);
    assert.match(out, /CREATE TABLE foo/);
  });
});
