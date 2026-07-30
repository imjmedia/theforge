import { describe, it } from "node:test";
import assert from "node:assert";
import {
  assembleClarifierMddDraft,
  finalizeClarifierDraft,
  MIN_DBGA_LEN_FOR_STRICT_CLARIFIER_DRAFT,
  stripClarifierGovernanceFromDraft,
} from "./mdd-clarifier-draft.util.js";
import { preserveValidatedSectionsIfSubstantial } from "./mdd-section-preserve.util.js";
import { getMddTemplatePlaceholder } from "../state/mdd-structured.schema.js";
import { evaluateSection1BodyQuality } from "./mdd-section1-quality.util.js";
import { MDD_GOVERNANCE_WIZARD_BODY } from "@theforge/shared-types/mdd-governance-patterns";

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
      mddComplexity: "HIGH",
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

describe("stripClarifierAgentBriefFromSection1", () => {
  it("elimina bloque Resumen para agentes (Clarified Scope) embebido en §1", async () => {
    const { stripClarifierAgentBriefFromSection1 } = await import("./mdd-clarifier-draft.util.js");
    const draft = `# MDD\n\n## 1. Contexto y alcance\n\n### Propósito\n\nSistema CRM.\n\n## Resumen para agentes (Clarified Scope)\n\nDecisiones para §6.\n\n## 2. Arquitectura y Stack\n\nNestJS.`;
    const out = stripClarifierAgentBriefFromSection1(draft);
    assert.match(out, /Sistema CRM/);
    assert.doesNotMatch(out, /Resumen para agentes/i);
    assert.match(out, /## 2\. Arquitectura/);
  });
});

describe("isSafeClarifierMergeBaseline", () => {
  it("rechaza baseline con headings duplicados", async () => {
    const { isSafeClarifierMergeBaseline } = await import("./mdd-clarifier-draft.util.js");
    const duped = `# MDD\n## 1. Contexto y alcance\n${"x".repeat(300)}\n## 3. Modelo de Datos\nA\n## 3. Modelo de Datos\nB\n`;
    assert.equal(isSafeClarifierMergeBaseline(duped, "y".repeat(500)), false);
  });

  it("rechaza merge cuando newDraft > 3× baseline", async () => {
    const { isSafeClarifierMergeBaseline } = await import("./mdd-clarifier-draft.util.js");
    const baseline = `# MDD\n## 1. Contexto y alcance\n${"x".repeat(300)}\n## 3. Modelo de Datos\n${"CREATE TABLE t (id INT); ".repeat(20)}\n`;
    assert.equal(isSafeClarifierMergeBaseline(baseline, "z".repeat(baseline.length * 4)), false);
  });
});
