/**
 * Cableado de `@ProjectScoped` / `@ProjectAccessExempt` en los controllers del paso 7 y 9 (jobs):
 * legacy-flow, entrevista de cambio, plugins, ui-screens, `ai/preferences` y `theforge`.
 * Lee la metadata real de Nest (sin levantar la app).
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import {
  PROJECT_ACCESS_EXEMPT_KEY,
  PROJECT_SCOPED_KEY,
  type ProjectScopedSpec,
} from "../../common/access/project-access.metadata.js";
import { ProjectAccessGuard } from "../../common/access/project-access.guard.js";
import { LegacyFlowController } from "./legacy-flow.controller.js";
import { ChangeInterviewController } from "./change-interview.controller.js";
import { PluginsController } from "../plugins/plugins.controller.js";
import { UiScreensController } from "../ui-mcp/ui-screens.controller.js";
import { AiController } from "../ai/ai.controller.js";
import { TheForgeController } from "../theforge/theforge.controller.js";

type Ctor = { prototype: Record<string, unknown> };

function specsOf(ctrl: Ctor, method: string): ProjectScopedSpec[] {
  const handler = ctrl.prototype[method] as object;
  const specs = Reflect.getMetadata(PROJECT_SCOPED_KEY, handler) as ProjectScopedSpec[] | undefined;
  assert.ok(specs, `${method} sin @ProjectScoped`);
  const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
  assert.ok(guards.includes(ProjectAccessGuard), `${method} sin ProjectAccessGuard`);
  return specs;
}

function single(ctrl: Ctor, method: string): ProjectScopedSpec {
  const specs = specsOf(ctrl, method);
  assert.equal(specs.length, 1, `${method}: se esperaba un solo spec`);
  return specs[0]!;
}

const STAGE_BODY = { from: "body", key: "stageId", optional: true };

describe("LegacyFlowController: acceso por proyecto", () => {
  it("generate-mdd es spend, con projectId de la ruta y stageId del body", () => {
    const s = single(LegacyFlowController, "generateMdd");
    assert.equal(s.level, "spend");
    assert.equal(s.key, "projectId");
    assert.equal(s.from ?? "param", "param");
    assert.deepEqual(s.stage, STAGE_BODY);
  });

  it("niveles por handler", () => {
    const expected: Record<string, string> = {
      transitionStatus: "read",
      executeTransition: "contribute",
      resolveChangeToFiles: "contribute",
      checkNavigationImpact: "contribute",
      resolveIndexSddConflict: "contribute",
      updateCodebaseDoc: "contribute",
      answer: "contribute",
      start: "spend",
      generateCodebaseDoc: "spend",
      generateMdd: "spend",
      suggestBrdFromCodebaseDoc: "spend",
      generateDeliverables: "spend",
      generateFromCodebase: "spend",
      getLegacyMddJobStatus: "read",
      getLegacyDeliverablesJobStatus: "read",
    };
    for (const [method, level] of Object.entries(expected)) {
      const s = single(LegacyFlowController, method);
      assert.equal(s.level, level, `${method}: nivel`);
      assert.equal(s.key, "projectId", `${method}: key`);
    }
  });

  it("los handlers que reciben stageId en el body lo atan al proyecto", () => {
    const withStage = [
      "resolveChangeToFiles",
      "checkNavigationImpact",
      "resolveIndexSddConflict",
      "updateCodebaseDoc",
      "start",
      "answer",
      "generateCodebaseDoc",
      "generateMdd",
      "suggestBrdFromCodebaseDoc",
      "generateDeliverables",
      "generateFromCodebase",
    ];
    for (const method of withStage) {
      assert.deepEqual(single(LegacyFlowController, method).stage, STAGE_BODY, `${method}: stage`);
    }
    for (const method of ["transitionStatus", "executeTransition", "getLegacyMddJobStatus", "getLegacyDeliverablesJobStatus"]) {
      assert.equal(single(LegacyFlowController, method).stage, undefined, `${method}: sin stage`);
    }
  });

  it("los jobs son read sin stage (la pertenencia del job se verifica en el handler)", () => {
    for (const method of ["getLegacyMddJobStatus", "getLegacyDeliverablesJobStatus"]) {
      const s = single(LegacyFlowController, method);
      assert.deepEqual({ key: s.key, level: s.level, stage: s.stage }, { key: "projectId", level: "read", stage: undefined });
    }
  });

  it("suggest-brd: el alias apilado comparte handler y queda decorado (Nest solo registra el superior)", () => {
    const s = single(LegacyFlowController, "suggestBrdFromCodebaseDoc");
    assert.equal(s.level, "spend");
  });
});

describe("ChangeInterviewController: acceso por proyecto", () => {
  it("start es spend con stageId del body; chat spend; confirm/cancel contribute; status read", () => {
    const start = single(ChangeInterviewController, "start");
    assert.equal(start.level, "spend");
    assert.deepEqual(start.stage, STAGE_BODY);
    assert.equal(single(ChangeInterviewController, "chat").level, "spend");
    assert.equal(single(ChangeInterviewController, "confirm").level, "contribute");
    assert.equal(single(ChangeInterviewController, "cancel").level, "contribute");
    assert.equal(single(ChangeInterviewController, "status").level, "read");
    for (const m of ["start", "chat", "confirm", "cancel", "status"]) {
      assert.equal(single(ChangeInterviewController, m).key, "projectId", `${m}: key`);
    }
  });
});

describe("PluginsController (rutas de proyecto): acceso", () => {
  it("generate es spend con stageId del body; plugin-data GET read, PUT contribute; export read", () => {
    const gen = single(PluginsController, "generatePluginArtifact");
    assert.equal(gen.level, "spend");
    assert.equal(gen.key ?? "id", "id");
    assert.deepEqual(gen.stage, STAGE_BODY);
    assert.equal(single(PluginsController, "getPluginData").level, "read");
    assert.equal(single(PluginsController, "setPluginData").level, "contribute");
    assert.equal(single(PluginsController, "exportPluginArtifact").level, "read");
  });
});

describe("UiScreensController: acceso", () => {
  it("sync es contribute (determinista, sin LLM)", () => {
    const s = single(UiScreensController, "sync");
    assert.equal(s.level, "contribute");
    assert.equal(s.key ?? "id", "id");
  });
});

describe("AiController: acceso", () => {
  it("learn-from-mdd: projectId opcional en el body, spend (llama al LLM)", () => {
    const s = single(AiController, "learnFromMdd");
    assert.deepEqual(
      { from: s.from, key: s.key, level: s.level, optional: s.optional },
      { from: "body", key: "projectId", level: "spend", optional: true },
    );
  });
});

describe("TheForgeController: acceso", () => {
  it("resolve-forge-project-for-ariadne está exenta con motivo", () => {
    const reason = Reflect.getMetadata(
      PROJECT_ACCESS_EXEMPT_KEY,
      TheForgeController.prototype.resolveForgeProjectForAriadne,
    ) as string | undefined;
    assert.ok(reason && reason.trim().length > 0);
    assert.equal(
      Reflect.getMetadata(PROJECT_SCOPED_KEY, TheForgeController.prototype.resolveForgeProjectForAriadne),
      undefined,
    );
  });

  it("create-stage-from-ariadne-change-pack: forgeProjectId del body, spend (puede arrancar legacy start), stageId del body", () => {
    const s = single(TheForgeController, "createStageFromAriadneChangePack");
    assert.deepEqual(
      { from: s.from, key: s.key, level: s.level, optional: s.optional },
      { from: "body", key: "forgeProjectId", level: "spend", optional: undefined },
    );
    assert.deepEqual(s.stage, STAGE_BODY);
  });
});
