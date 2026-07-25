import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGovernancePatternPromptStats,
  buildGovernancePatternSelectionPrompt,
  buildGovernancePatternShortlist,
  suggestGovernancePatternIdsWithoutDocs,
} from "./suggest-mdd-governance-patterns.util.js";
import { extractGovernancePatternDocContext } from "./suggest-mdd-governance-patterns-context.util.js";

const SAMPLE_FINTECH_DOCS = {
  dbgaContent: `## 3. Integración\nMicroservicio WebSocket con Redis para indicadores en RAM.\nPostgreSQL multi-tenant con Prisma.\nIntegración broker Alpaca y LLM orquestador por tarea.\nCircuit breaker en APIs externas.`,
  phase0SummaryContent:
    "Alpha Engine desacoplado, batch semanal, multi-tenant estricto, Redis VWAP/EMA, WebSocket tiempo real.",
  brdContent: `## 4. Diagramas\n\`\`\`mermaid\nflowchart TB\n  BROKER[Alpaca]\n  REDIS[Redis]\n\`\`\``,
};

describe("suggest-mdd-governance-patterns.util", () => {
  it("suggestGovernancePatternIdsWithoutDocs devuelve vacío sin documentos", () => {
    const result = suggestGovernancePatternIdsWithoutDocs({
      dbgaContent: "",
      phase0SummaryContent: "",
      brdContent: "",
    });
    assert.ok(result);
    assert.deepEqual(result.patternIds, []);
  });

  it("suggestGovernancePatternIdsWithoutDocs no responde cuando hay documentos", () => {
    const result = suggestGovernancePatternIdsWithoutDocs(SAMPLE_FINTECH_DOCS);
    assert.equal(result, null);
  });

  it("shortlist acota catálogo y prompt es más pequeño que el legacy", () => {
    const stats = buildGovernancePatternPromptStats(SAMPLE_FINTECH_DOCS);
    assert.ok(stats.shortlistSize >= 18);
    assert.ok(stats.shortlistSize <= 28);
    assert.ok(stats.docContextChars <= 7_500);
    assert.ok(stats.promptChars < stats.legacyCatalogChars + 20_000);
  });

  it("shortlist no incluye creacionales GoF por stopwords españoles", () => {
    const ids = buildGovernancePatternShortlist({
      dbgaContent:
        "El sistema proporciona interfaz para separar operaciones y define permisos al inversor.",
      phase0SummaryContent: "Permite configurar estrategia semanal de inversión.",
      brdContent: "",
    });
    assert.ok(!ids.includes("abstract-factory"));
    assert.ok(!ids.includes("builder"));
    assert.ok(!ids.includes("factory-method"));
    assert.ok(!ids.includes("prototype"));
  });

  it("prompt incluye reglas anti falsos positivos y contexto compacto", () => {
    const prompt = buildGovernancePatternSelectionPrompt(SAMPLE_FINTECH_DOCS);
    assert.match(prompt, /GoF creacionales/);
    assert.match(prompt, /Catálogo acotado/);
    assert.match(prompt, /Contexto del proyecto/);
    assert.match(prompt, /microservicio|redis|websocket/i);
  });

  it("extractGovernancePatternDocContext compacta secciones relevantes", () => {
    const ctx = extractGovernancePatternDocContext(SAMPLE_FINTECH_DOCS);
    assert.match(ctx, /Integraci/i);
    assert.match(ctx, /Alpha Engine|multi-tenant/i);
    assert.ok(ctx.length <= 7_500);
  });
});
