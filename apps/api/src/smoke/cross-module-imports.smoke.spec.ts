/**
 * Smoke: resolución de imports y utilidades mínimas por área del API.
 * Falla en CI/local si una ruta relativa entre módulos está rota (p. ej. ../../ vs ../).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StageStatus } from "@theforge/database";
import { isAppRole } from "../common/roles.js";
import { isInsufficientDbgaIdea } from "../modules/ai-analysis/utils/dbga-idea-validation.util.js";
import { enrichMddWithUiUxDesignIntent } from "../modules/ai-analysis/utils/mdd-enrich-uiux-intent.js";
import { evaluateMddCoherenceFromMarkdown } from "../modules/engine/mdd-coherence/mdd-coherence.util.js";
import { PROVIDER_IDS } from "../modules/ai/providers/provider-catalog.js";
import { enrichBlueprintWithUiDesignSystem } from "../modules/engine/blueprint-enrich-ui-system.js";
import { pickPrimaryStage } from "../modules/projects/stage-helpers.js";
import { isValidUrl } from "../modules/scraper/url-utils.js";
import { ADMIN_ROLE } from "../modules/auth/auth.constants.js";
import { PROJECTS_ORCHESTRATOR_PORT } from "../modules/projects/projects-service.port.js";
import { THEFORGE_ORCHESTRATOR_PORT } from "../modules/theforge/theforge-service.port.js";

describe("smoke API: common", () => {
  it("roles exporta isAppRole", () => {
    assert.equal(isAppRole("super_admin"), true);
    assert.equal(isAppRole("guest"), false);
  });
});

describe("smoke API: auth", () => {
  it("auth.constants es importable", () => {
    assert.equal(ADMIN_ROLE, "admin");
  });
});

describe("smoke API: ai", () => {
  it("provider-catalog exporta proveedores", () => {
    assert.ok(PROVIDER_IDS.includes("openrouter"));
    assert.ok(PROVIDER_IDS.length >= 4);
  });
});

describe("smoke API: ai-analysis", () => {
  it("dbga-idea-validation responde", () => {
    assert.equal(isInsufficientDbgaIdea("Hola"), true);
  });

  it("mdd-enrich-uiux-intent es invocable", async () => {
    const out = await enrichMddWithUiUxDesignIntent("## 1. Contexto\n\nSolo contexto.\n");
    assert.match(out, /Contexto/);
  });

  it("mdd-coherence evalúa markdown §3/§4", () => {
    const mdd = `## 3. Modelo de Datos\n\n\`\`\`sql\nCREATE TABLE users (id UUID PRIMARY KEY);\n\`\`\`\n\n## 4. Contratos de API\n\nGET /users\n`;
    const health = evaluateMddCoherenceFromMarkdown(mdd);
    assert.equal(health.entityCount >= 1, true);
  });
});

describe("smoke API: engine ↔ ai-analysis", () => {
  it("blueprint-enrich resuelve mdd-sanitize (ruta ../ai-analysis)", async () => {
    const mdd = `## 3. Modelo de Datos\n\n\`\`\`sql\nCREATE TABLE orders (id UUID);\n\`\`\`\n`;
    const bp = "## 1. Visión\n\nBase.\n";
    const out = await enrichBlueprintWithUiDesignSystem(mdd, bp);
    assert.match(out, /UI Design System/);
    assert.match(out, /`orders`/);
  });
});

describe("smoke API: projects", () => {
  it("stage-helpers pickPrimaryStage prioriza ACTIVE", () => {
    const picked = pickPrimaryStage([
      { ordinal: 2, workflowStatus: StageStatus.PENDING },
      { ordinal: 1, workflowStatus: StageStatus.ACTIVE },
    ]);
    assert.equal(picked?.ordinal, 1);
  });

  it("tokens de orquestador son símbolos distintos", () => {
    assert.notEqual(PROJECTS_ORCHESTRATOR_PORT, THEFORGE_ORCHESTRATOR_PORT);
  });
});

describe("smoke API: scraper", () => {
  it("url-utils valida URLs", () => {
    assert.equal(isValidUrl("https://example.com/path"), true);
    assert.equal(isValidUrl("not-a-url"), false);
  });
});
