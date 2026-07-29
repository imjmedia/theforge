import { describe, it } from "node:test";
import assert from "node:assert";
import {
  finalizeClarifierDraft,
  MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT,
} from "./mdd-clarifier-draft.util.js";
import { preserveValidatedSectionsIfSubstantial } from "./mdd-section-preserve.util.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { evaluateSection1BodyQuality } from "./mdd-section1-quality.util.js";

const longScope = "A".repeat(250);

const THIN_S1_BODY = `### Propósito del sistema

El producto es un copiloto multiempresa vía WhatsApp con integraciones CRM/ERP y aislamiento por inquilino, rate limiting y escalación humana.`;

function constitutionSection1(repeat = 40): string {
  return `${THIN_S1_BODY}

### Alcance y fronteras

- **Core:** copiloto unificado.
- **Integraciones:** CRM, ERP, WhatsApp.
- **Fuera de alcance:** billing externo.

### Mapa de contextos delimitados (DDD)

- **En alcance del MDD:** ${"canal único ".repeat(repeat)}
- **Colindantes:** SaaS conectados.
- **Fuera de alcance:** no descrito en BRD.

### Actores del documento

- **Stakeholder:** producto.
- **Implementación:** equipo fullstack.

### Glosario de dominio

- **Inquilino:** aislamiento multiempresa.
- **Copiloto:** asistente del canal.`;
}

describe("finalizeClarifierDraft", () => {
  it("preserva baseline cuando el LLM devuelve §1 insustancial", () => {
    const baseline = getMddTemplatePlaceholder("baseline");
    const baselineWithS1 = baseline.replace(
      /(\n##\s*1\.\s*Contexto[^\n]*\n+)/i,
      `$1${constitutionSection1(5)}\n`,
    );
    const thinLlm = getMddTemplatePlaceholder("(Pendiente)");

    const out = finalizeClarifierDraft({
      llmDraft: thinLlm,
      previousDraft: baselineWithS1,
      clarifiedScope: longScope,
      dbgaContent: "x".repeat(MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT),
      mddComplexity: "HIGH",
    });

    assert.match(out, /Mapa de contextos/);
    assert.ok(out.length > thinLlm.length);
  });

  it("hidrata §1 desde scope cuando DBGA es grande y no hay baseline", () => {
    const thinLlm = getMddTemplatePlaceholder("(vacío)");
    const out = finalizeClarifierDraft({
      llmDraft: thinLlm,
      previousDraft: "",
      clarifiedScope: longScope,
      dbgaContent: "d".repeat(20_000),
      mddComplexity: "MEDIUM",
    });

    assert.ok(out.includes(longScope.slice(0, 100)) || /### Alcance y fronteras/.test(out));
    const body = out.match(/##\s*1\.\s*Contexto[\s\S]*?(?=\n##\s)/i)?.[0] ?? out;
    assert.ok(evaluateSection1BodyQuality(body, "MEDIUM").ok || out.length >= 600);
  });

  it("hidrata §1 mínima del LLM cuando DBGA es grande (un solo párrafo)", () => {
    const thinDraft = `# MDD\n\n## 1. Contexto\n\n${THIN_S1_BODY}\n\n## 2. Arquitectura\n\n(Pendiente)\n`;
    const out = finalizeClarifierDraft({
      llmDraft: thinDraft,
      previousDraft: "",
      clarifiedScope: longScope,
      dbgaContent: "Benchmark ".repeat(2_000),
      mddComplexity: "MEDIUM",
    });
    assert.match(out, /### Mapa de contextos/);
    assert.match(out, /### Actores del documento/);
  });

  it("acepta draft LLM con constitución completa sin cambios", () => {
    const substantial = `# MDD\n\n## 1. Contexto y alcance\n\n${constitutionSection1()}\n\n## 2. Arquitectura y Stack\n\n${"NestJS ".repeat(40)}\n\n## 3. Modelo de Datos\n\n${"CREATE TABLE foo (id INT); ".repeat(15)}\n`;
    const out = finalizeClarifierDraft({
      llmDraft: substantial,
      previousDraft: "",
      clarifiedScope: longScope,
      dbgaContent: "d".repeat(1000),
      mddComplexity: "HIGH",
    });
    assert.equal(out.trim(), substantial.trim());
  });

  it("preserva §2 del baseline cuando el LLM devuelve placeholder de pipeline", () => {
    const s2Body = `${"NestJS + PostgreSQL + Redis. ".repeat(30)}`;
    const baseline = `# MDD\n\n## 1. Contexto\n\n${constitutionSection1(3)}\n\n## 2. Arquitectura y Stack\n\n${s2Body}\n\n## 6. Seguridad\n\n${"OAuth2 ".repeat(40)}\n`;
    const llmWiped = `# MDD\n\n## 1. Contexto\n\n(Pendiente: Clarificador — contexto y alcance del sistema.)\n\n## 2. Arquitectura y Stack\n\n(Pendiente: Arquitecto de Software — stack y arquitectura.)\n\n## 6. Seguridad\n\n${"OAuth2 ".repeat(40)}\n`;
    const out = preserveValidatedSectionsIfSubstantial(baseline, llmWiped);
    assert.match(out, /NestJS \+ PostgreSQL/);
    assert.match(out, /Mapa de contextos/);
    assert.doesNotMatch(out, /Pendiente: Arquitecto de Software/);
  });
});
