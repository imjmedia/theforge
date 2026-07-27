import { describe, it } from "node:test";
import assert from "node:assert";
import {
  finalizeClarifierDraft,
  MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT,
} from "./mdd-clarifier-draft.util.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";

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
});
