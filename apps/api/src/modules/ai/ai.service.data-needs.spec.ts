import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadGatewayException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { PROJECT_SCOPED_KEY } from "../../common/access/project-access.metadata.js";
import { parseDesignSpec } from "@theforge/shared-types";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AiService } from "./ai.service.js";
import { registerTokenUsageRecorder } from "./utils/token-usage-recorder.js";
import { runWithRequestUser } from "../../common/request-user.store.js";
import { collectDataNeedsQualityIssues } from "./utils/design-data-needs.util.js";
import { DesignFirstController } from "../design-first/design-first.controller.js";
import {
  DesignProposalService,
  type StoredDesignProposal,
} from "../design-first/design-proposal.service.js";
import type { AiService as AiServiceType } from "./ai.service.js";
import type { DesignSpecReader, DesignSpecService } from "../design-first/design-spec.service.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/shared-types/src/design-first/__fixtures__/three-screens.json",
);

describe("design data-needs propose", () => {
  const spec = parseDesignSpec(JSON.parse(readFileSync(fixturePath, "utf8")));
  const events: Array<Record<string, unknown>> = [];

  function llmFactory(responseFn: () => Promise<string>) {
    return {
      createForUser: async () => ({
        generateResponse: responseFn,
        generateResponseStream: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
        parseChecklist: async () => ({ ok: true, items: [] }),
        generateEmbedding: async () => [],
      }),
      createForVisionUser: async () => ({
        generateResponse: async () => "{}",
      }),
      resolveRuntime: async () => ({
        providerId: "openai",
        chatModel: "gpt-4o",
        apiKey: "test",
      }),
      resolveAuditorRuntime: async () => ({
        providerId: "openai",
        chatModel: "gpt-4o",
        apiKey: "test",
      }),
    } as any;
  }

  function serviceWithLlm(responseFn: () => Promise<string>): AiService {
    registerTokenUsageRecorder({
      recordAsync: (e) => void events.push(e as unknown as Record<string, unknown>),
      recordEstimatedAsync: async () => {},
    });
    return new AiService(llmFactory(responseFn), { buildContextFromText: async () => null } as any, null, {
      normalizeMermaid: async (s: string) => s,
    } as any);
  }

  it("CL-14: detecta tipos contradictorios en la propuesta", () => {
    const issues = collectDataNeedsQualityIssues([
      {
        screenId: "order-list",
        states: [],
        components: [
          {
            componentId: "orders-table",
            needs: [
              {
                id: "n1",
                name: "rows",
                type: "Order[]",
                origin: "entity",
                action: "order",
                provenance: "heuristic",
              },
              {
                id: "n2",
                name: "rows",
                type: "string",
                origin: "derived",
                action: "order",
                provenance: "llm",
              },
            ],
          },
        ],
      },
    ]);
    assert.ok(issues.some((i) => i.includes("CL-14")));
  });

  it("CL-09: salida inválida tras reparación → 502 ERR_DESIGN_EXTRACT_INVALID", async () => {
    events.length = 0;
    let calls = 0;
    const service = serviceWithLlm(async () => {
      calls++;
      return "{not-json";
    });
    await runWithRequestUser("u1", async () => {
      await assert.rejects(
        () =>
          service.proposeDataNeeds({
            projectId: "p1",
            stageId: "st1",
            spec,
            gaps: [{ screenId: "order-list", componentId: "btn-new-order", componentType: "Button" }],
            deadlineMs: 30_000,
          }),
        (e: unknown) => {
          assert.ok(e instanceof BadGatewayException);
          assert.equal((e.getResponse() as { code?: string }).code, "ERR_DESIGN_EXTRACT_INVALID");
          return true;
        },
      );
    });
    assert.equal(calls, 2);
  });

  it("CL-10: abort/deadline sin entries", async () => {
    const service = serviceWithLlm(
      () =>
        new Promise((_, reject) => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        }),
    );
    await runWithRequestUser("u1", async () => {
      await assert.rejects(
        () =>
          service.proposeDataNeeds({
            projectId: "p1",
            stageId: "st1",
            spec,
            gaps: [{ screenId: "order-list", componentId: "btn-new-order", componentType: "Button" }],
            deadlineMs: 1,
          }),
        (e: unknown) => e instanceof Error && e.name === "AbortError",
      );
    });
  });

  it("procedencia llm en needs filtrados", async () => {
    const service = serviceWithLlm(async () =>
      JSON.stringify({
        issues: [],
        entries: [
          {
            screenId: "order-list",
            componentId: "btn-new-order",
            needs: [
              {
                id: "need-nav",
                name: "target",
                type: "string",
                origin: "input",
                action: "order",
              },
            ],
          },
        ],
      }),
    );
    await runWithRequestUser("u1", async () => {
      const out = await service.proposeDataNeeds({
        projectId: "p1",
        stageId: "st1",
        spec,
        gaps: [{ screenId: "order-list", componentId: "btn-new-order", componentType: "Button" }],
        deadlineMs: 30_000,
      });
      assert.equal(out.entries[0]!.components[0]!.needs[0]!.provenance, "llm");
    });
  });

  it("CL-30: data-needs/propose exige nivel spend", () => {
    const handler = DesignFirstController.prototype.proposeDataNeeds;
    const level = Reflect.getMetadata(PROJECT_SCOPED_KEY, handler)?.[0]?.level;
    assert.equal(level, "spend");
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), "data-needs/propose");
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), 1);
  });

  it("accept dataNeeds propuesta llama updateDataNeeds y recalcula gates", async () => {
    const stored: StoredDesignProposal = {
      proposalId: "prop-dn",
      projectId: "p1",
      stageId: "st1",
      baseRevision: 0,
      kind: "dataNeeds",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      diff: {
        add: { screens: [], navigation: [] },
        update: { screens: [], navigation: [] },
        remove: { screenIds: [], navigationIds: [] },
        dataNeeds: spec.dataNeeds,
      },
      issues: [],
    };

    let updateCalls = 0;
    const memRedis = {
      eval: async () => null,
      set: async () => "OK",
      del: async () => 1,
      get: async () => JSON.stringify(stored),
    };

    const reader = {
      loadPrimaryStage: async () => ({
        project: { projectType: "DESIGN_FIRST" },
        stage: { id: "st1", designSpecRevision: 0, designSpec: spec },
      }),
    } as unknown as DesignSpecReader;

    const designSpec = {
      updateDataNeeds: async () => {
        updateCalls++;
        return { gates: { phase2: { ok: true, issues: [] } } };
      },
    } as unknown as DesignSpecService;

    const svc = DesignProposalService.createForTest({
      env: { NODE_ENV: "test", DESIGN_FIRST_ENABLED: "true" },
      redis: memRedis,
    });
    svc.bindForTest({ ai: {} as AiServiceType, reader, designSpec });

    const res = await svc.acceptProposal("p1", "prop-dn", { revision: 0 });
    assert.equal(updateCalls, 1);
    assert.ok((res as { gates?: unknown }).gates);
  });
});
