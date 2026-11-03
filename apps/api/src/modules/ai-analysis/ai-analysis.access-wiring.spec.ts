/**
 * Cableado de `@ProjectScoped` / `@ProjectAccessExempt` en los controllers que reciben el proyecto por
 * body o query (ai-analysis, ai-orchestrator) y en los de ruta con :projectId migrados (supervisor,
 * change-log, documentation-gap). Lee la metadata real de Nest.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METHOD_METADATA } from "@nestjs/common/constants.js";
import {
  PROJECT_ACCESS_EXEMPT_KEY,
  PROJECT_SCOPED_KEY,
  type ProjectScopedSpec,
} from "../../common/access/project-scoped.decorator.js";
import { AiAnalysisController } from "./ai-analysis.controller.js";
import { AiOrchestratorController } from "../ai-orchestrator/ai-orchestrator.controller.js";
import { AgentSupervisorController } from "../agent-supervisor/agent-supervisor.controller.js";
import { ChangeLogController } from "../change-log/change-log.controller.js";
import { DocumentationGapController } from "../documentation-gap/documentation-gap.controller.js";
import { AgentSessionLogController } from "../documentation-gap/agent-session-log.controller.js";

type Ctor = { prototype: Record<string, unknown> };

function scoped(cls: Ctor, method: string): ProjectScopedSpec[] | undefined {
  const handler = cls.prototype[method] as object;
  const own = Reflect.getMetadata(PROJECT_SCOPED_KEY, handler) as ProjectScopedSpec[] | undefined;
  return own ?? (Reflect.getMetadata(PROJECT_SCOPED_KEY, cls) as ProjectScopedSpec[] | undefined);
}

function exemptReason(cls: Ctor, method: string): string | undefined {
  return Reflect.getMetadata(PROJECT_ACCESS_EXEMPT_KEY, cls.prototype[method] as object) as string | undefined;
}

function single(cls: Ctor, method: string): ProjectScopedSpec {
  const specs = scoped(cls, method);
  assert.ok(specs && specs.length === 1, `${method} debe tener un @ProjectScoped`);
  return specs[0];
}

describe("AiAnalysisController: niveles por ruta", () => {
  it("streams y generación MDD: spend con projectId del body", () => {
    for (const m of [
      "streamMdd",
      "streamMddManager",
      "streamMddRegenerateSection",
      "streamMddResume",
      "enqueueMddJob",
      "reviewMdd",
      "auditMdd",
      "suggestGovernancePatterns",
      "suggestTraceabilityFix",
      "startPhase0",
      "answerPhase0",
    ]) {
      const s = single(AiAnalysisController, m);
      assert.equal(s.level, "spend", m);
      assert.equal(s.from, "body", m);
      assert.equal(s.key, "projectId", m);
      assert.notEqual(s.optional, true, m);
    }
  });

  it("start y stream de DBGA: spend con projectId del body opcional", () => {
    for (const m of ["startAnalysis", "streamAnalysis"]) {
      const s = single(AiAnalysisController, m);
      assert.equal(s.level, "spend", m);
      assert.equal(s.from, "body", m);
      assert.equal(s.optional, true, m);
    }
  });

  it("lecturas: read con projectId de la query", () => {
    for (const m of [
      "getEstimation",
      "getAdrs",
      "getMddThread",
      "getMddUpstreamSyncAnalysis",
      "getTokenUsage",
      "listTokenUsageEvents",
      "getPhase0Question",
      "getPhase0State",
    ]) {
      const s = single(AiAnalysisController, m);
      assert.equal(s.level, "read", m);
      assert.equal(s.from, "query", m);
      assert.equal(s.key, "projectId", m);
    }
  });

  it("escrituras sin LLM: contribute (body o query según la ruta)", () => {
    const body = ["postEstimation", "clearEstimationDraft", "recordGovernancePatternAdrs", "syncPhase0Markdown"];
    for (const m of body) {
      const s = single(AiAnalysisController, m);
      assert.equal(s.level, "contribute", m);
      assert.equal(s.from, "body", m);
    }
    for (const m of ["acceptMddUpstreamBaseline", "clearDbgaCheckpoint"]) {
      const s = single(AiAnalysisController, m);
      assert.equal(s.level, "contribute", m);
      assert.equal(s.from, "query", m);
    }
  });

  it("la etapa del request, si viene, se verifica contra el proyecto", () => {
    assert.deepEqual(single(AiAnalysisController, "streamMdd").stage, {
      from: "body",
      key: "stageId",
      optional: true,
    });
    assert.deepEqual(single(AiAnalysisController, "getEstimation").stage, {
      from: "query",
      key: "stageId",
      optional: true,
    });
  });

  it("jobs: exentos con motivo (la autorización va en el handler vía getJobAccessRef)", () => {
    for (const m of ["getMddJobStatus", "streamMddJobEvents"]) {
      assert.equal(scoped(AiAnalysisController, m), undefined, m);
      assert.match(exemptReason(AiAnalysisController, m) ?? "", /getJobAccessRef/, m);
    }
  });

  it("todas las rutas tienen @ProjectScoped o exención, salvo mdd/config", () => {
    const unguarded: string[] = [];
    for (const name of Object.getOwnPropertyNames(AiAnalysisController.prototype)) {
      const handler = AiAnalysisController.prototype[name as keyof AiAnalysisController] as unknown as object;
      if (typeof handler !== "function" || !Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
      if (!scoped(AiAnalysisController, name) && !exemptReason(AiAnalysisController, name)) unguarded.push(name);
    }
    assert.deepEqual(unguarded, ["getMddConfig"]);
  });
});

describe("AiOrchestratorController", () => {
  it("chat y stream: spend; welcome: spend (genera con LLM); clear-chat: contribute", () => {
    for (const [m, level] of [
      ["chat", "spend"],
      ["chatStream", "spend"],
      ["welcome", "spend"],
      ["clearChat", "contribute"],
    ] as const) {
      const s = single(AiOrchestratorController, m);
      assert.equal(s.level, level, m);
      assert.equal(s.from, "body", m);
      assert.equal(s.key, "projectId", m);
    }
  });
});

describe("Controllers con :projectId en la ruta", () => {
  it("episodic y change-log: read sobre :projectId", () => {
    const sup = single(AgentSupervisorController, "getEpisodic");
    assert.deepEqual([sup.level, sup.key], ["read", "projectId"]);
    const log = single(ChangeLogController, "list");
    assert.deepEqual([log.level, log.key], ["read", "projectId"]);
  });

  it("agent-session-log: read con etapa de la ruta", () => {
    const s = single(AgentSessionLogController, "list");
    assert.equal(s.level, "read");
    assert.deepEqual(s.stage, { key: "stageId" });
  });

  it("documentation-gap: list read, report/reject contribute, approve spend; todos con etapa", () => {
    for (const [m, level] of [
      ["listGaps", "read"],
      ["reportGap", "contribute"],
      ["approveGap", "spend"],
      ["rejectGap", "contribute"],
    ] as const) {
      const s = single(DocumentationGapController, m);
      assert.equal(s.level, level, m);
      assert.equal(s.key, "projectId", m);
      assert.deepEqual(s.stage, { key: "stageId" }, m);
    }
  });
});
