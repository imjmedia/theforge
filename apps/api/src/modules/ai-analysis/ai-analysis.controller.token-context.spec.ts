/**
 * Contexto de coste (`TokenUsage`) en handlers request/response del controller: el servicio llamado debe
 * ver `getActiveTokenUsageContext()` con el proyecto autorizado y el documentField correcto.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiAnalysisController } from "./ai-analysis.controller.js";
import {
  getActiveTokenUsageContext,
  runWithTokenUsageContext,
  type TokenUsageContextPayload,
} from "./token-usage/token-usage.context.js";

function buildController(seen: { ctx: TokenUsageContextPayload | null }) {
  const capture = async () => {
    seen.ctx = getActiveTokenUsageContext();
    return { ok: true };
  };
  const phase0 = { start: capture };
  const audit = { audit: capture };
  const traceability = { suggestFix: capture };
  const controller = new AiAnalysisController(
    {} as never, // aiAnalysis
    {} as never, // estimationService
    phase0 as never,
    audit as never,
    traceability as never,
    {} as never, // prisma
    {} as never, // generationGuard
    {} as never, // mddQueue
    {} as never, // mddUpstreamSync
    {} as never, // tokenUsage
    {} as never, // mddJobEvents
    {} as never, // access
  );
  return controller;
}

describe("AiAnalysisController: contexto de coste en handlers request/response", () => {
  it("phase0/start abre contexto dbgaContent/initial con el projectId", async () => {
    const seen = { ctx: null as TokenUsageContextPayload | null };
    await buildController(seen).startPhase0({ idea: "una idea", projectId: " p1 " });
    assert.equal(seen.ctx?.projectId, "p1");
    assert.equal(seen.ctx?.documentField, "dbgaContent");
    assert.equal(seen.ctx?.context, "initial");
    assert.equal(seen.ctx?.stageId, null);
    assert.equal(getActiveTokenUsageContext(), null);
  });

  it("mdd/audit abre contexto mddContent/regenerate con projectId y stageId", async () => {
    const seen = { ctx: null as TokenUsageContextPayload | null };
    await buildController(seen).auditMdd({ projectId: "p2", stageId: "s2" });
    assert.equal(seen.ctx?.projectId, "p2");
    assert.equal(seen.ctx?.stageId, "s2");
    assert.equal(seen.ctx?.documentField, "mddContent");
    assert.equal(seen.ctx?.context, "regenerate");
  });

  it("traceability/suggest-fix abre contexto mddContent/regenerate", async () => {
    const seen = { ctx: null as TokenUsageContextPayload | null };
    await buildController(seen).suggestTraceabilityFix({
      projectId: "p3",
      stageId: "s3",
    } as never);
    assert.equal(seen.ctx?.projectId, "p3");
    assert.equal(seen.ctx?.stageId, "s3");
    assert.equal(seen.ctx?.documentField, "mddContent");
    assert.equal(seen.ctx?.context, "regenerate");
  });

  it("conserva el contexto externo activo en vez de crear otro", async () => {
    const seen = { ctx: null as TokenUsageContextPayload | null };
    const external: TokenUsageContextPayload = {
      projectId: "externo",
      stageId: "se",
      documentField: "specContent",
      context: "initial",
      jobId: "j1",
    };
    await runWithTokenUsageContext(external, () =>
      buildController(seen).auditMdd({ projectId: "p2", stageId: "s2" }),
    );
    assert.deepEqual(seen.ctx, external);
  });
});
