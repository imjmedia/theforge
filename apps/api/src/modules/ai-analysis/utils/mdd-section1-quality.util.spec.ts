import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildHydratedSection1Body,
  draftMeetsSection1Quality,
  evaluateSection1BodyQuality,
  minSection1BodyLength,
} from "./mdd-section1-quality.util.js";

const THIN_S1 = `### Propósito del sistema

El Asistente Inteligente Multiempresa es una plataforma conversacional unificada que integra CRM, ERP y SaaS vía WhatsApp, con aislamiento por inquilino y guardrails de costo LLM.`;

const FULL_S1 = `${THIN_S1}

### Alcance y fronteras

- **Core:** asistente conversacional multiempresa.
- **Integraciones:** CRM, ERP, WhatsApp.
- **Fuera de alcance:** funciones no descritas en BRD.

### Mapa de contextos delimitados (DDD)

- **En alcance del MDD:** copiloto unificado y mensajería.
- **Colindantes:** sistemas SaaS conectados.
- **Fuera de alcance:** billing externo.

### Actores del documento

- **Stakeholder de decisión:** producto.
- **Dueños de implementación:** equipo backend.
- **Audiencia técnica:** desarrolladores fullstack.

### Glosario de dominio

- **Inquilino:** unidad de aislamiento multiempresa.
- **Copiloto:** asistente conversacional del canal WhatsApp.`;

describe("evaluateSection1BodyQuality", () => {
  it("rechaza §1 de un solo párrafo en MEDIUM/HIGH", () => {
    const medium = evaluateSection1BodyQuality(THIN_S1, "MEDIUM");
    assert.equal(medium.ok, false);
    assert.ok(medium.blockers.some((b) => /estructura constitución incompleta/i.test(b)));

    const high = evaluateSection1BodyQuality(THIN_S1, "HIGH");
    assert.equal(high.ok, false);
  });

  it("acepta §1 constitucional completa en MEDIUM", () => {
    const q = evaluateSection1BodyQuality(FULL_S1, "MEDIUM");
    assert.equal(q.ok, true);
    assert.ok(q.bodyLen >= minSection1BodyLength("MEDIUM"));
  });

  it("LOW tolera propósito + fronteras breves", () => {
    const lowBody = `${THIN_S1}\n\n### Alcance y fronteras\n\nCore: copiloto. Fuera: billing.`;
    assert.equal(evaluateSection1BodyQuality(lowBody, "LOW").ok, true);
  });
});

describe("buildHydratedSection1Body", () => {
  it("expande §1 mínima con subsecciones desde DBGA grande", () => {
    const scope = "A".repeat(400);
    const dbga = "Benchmark multi-tenant WhatsApp CRM ERP. ".repeat(300);
    const out = buildHydratedSection1Body({
      existingBody: THIN_S1,
      clarifiedScope: scope,
      dbgaContent: dbga,
      complexity: "MEDIUM",
    });
    assert.match(out, /### Propósito del sistema/);
    assert.match(out, /### Alcance y fronteras/);
    assert.match(out, /### Mapa de contextos/);
    assert.match(out, /### Actores del documento/);
    assert.ok(evaluateSection1BodyQuality(out, "MEDIUM").ok);
  });
});

describe("draftMeetsSection1Quality", () => {
  it("evalúa sobre borrador markdown completo", () => {
    const draft = `# MDD\n\n## 1. Contexto\n\n${FULL_S1}\n\n## 2. Arquitectura\n\nx\n`;
    assert.equal(draftMeetsSection1Quality(draft, "MEDIUM"), true);
  });
});
