import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadGatewayException } from "@nestjs/common";
import { AiService } from "./ai.service.js";
import { registerTokenUsageRecorder, recordTokenUsageFromContext } from "./utils/token-usage-recorder.js";
import { runWithTokenUsageContext } from "../ai-analysis/token-usage/token-usage.context.js";
import { runWithRequestUser } from "../../common/request-user.store.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("AiService.extractScreenSpecFromImages", () => {
  const events: Array<Record<string, unknown>> = [];

  function visionFactory(responseFn: (...args: unknown[]) => Promise<string>) {
    return {
      createForUser: () => ({
        generateResponse: async () => "{}",
        generateResponseStream: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
        parseChecklist: async () => ({ ok: true, items: [] }),
        generateEmbedding: async () => [],
      }),
      createForVisionUser: async () => ({
        generateResponse: responseFn,
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

  function serviceWithVision(responseFn: (...args: unknown[]) => Promise<string>): AiService {
    registerTokenUsageRecorder({
      recordAsync: (e) => void events.push(e as unknown as Record<string, unknown>),
      recordEstimatedAsync: async () => {},
    });
    return new AiService(visionFactory(responseFn), { buildContextFromText: async () => null } as any, null, {
      normalizeMermaid: async (s: string) => s,
    } as any);
  }

  it("CL-07: imágenes ilegibles → propuesta vacía con issues", async () => {
    const service = serviceWithVision(async () =>
      JSON.stringify({ issues: ["Captura borrosa"], screens: [] }),
    );
    const out = await runWithRequestUser("user-test", () =>
      service.extractScreenSpecFromImages({
        projectId: "p1",
        stageId: "s1",
        images: [{ mimeType: "image/png", base64: tinyPngBase64 }],
        deadlineMs: 30_000,
      }),
    );
    assert.equal(out.screens.length, 0);
    assert.ok(out.issues.some((i) => i.includes("borrosa")));
  });

  it("CL-09: salida inválida tras reparación → 502 ERR_DESIGN_EXTRACT_INVALID y TokenUsage", async () => {
    events.length = 0;
    let calls = 0;
    const service = serviceWithVision(async () => {
      calls++;
      recordTokenUsageFromContext("openrouter", "gpt-4o", 10, 5, 15);
      return JSON.stringify({
        screens: [{ name: "Home", sourceImageIndex: 0, confidence: 2, components: [] }],
      });
    });
    await assert.rejects(
      () =>
        runWithRequestUser("user-test", () =>
          runWithTokenUsageContext(
            {
              projectId: "p1",
              stageId: "s1",
              documentField: "designScreenSpec",
              context: "design_first",
            },
            () =>
              service.extractScreenSpecFromImages({
                projectId: "p1",
                stageId: "s1",
                images: [{ mimeType: "image/png", base64: tinyPngBase64 }],
                deadlineMs: 30_000,
              }),
          ),
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadGatewayException);
        const body = err.getResponse() as { code?: string };
        assert.equal(body.code, "ERR_DESIGN_EXTRACT_INVALID");
        return true;
      },
    );
    assert.equal(calls, 2);
    assert.ok(events.length >= 1);
    assert.equal(events[0]!.documentField, "designScreenSpec");
    assert.equal(events[0]!.context, "design_first");
  });

  it("CL-10: deadline aborta sin reintento extra", async () => {
    let calls = 0;
    const service = serviceWithVision(async (_p, _h, opts) => {
      calls++;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 200);
        opts?.abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            const err = new Error("Visión abortada o fuera de plazo");
            err.name = "AbortError";
            reject(err);
          },
          { once: true },
        );
      });
      return JSON.stringify({ issues: [], screens: [] });
    });
    await assert.rejects(
      () =>
        runWithRequestUser("user-test", () =>
          service.extractScreenSpecFromImages({
            projectId: "p1",
            stageId: "s1",
            images: [{ mimeType: "image/png", base64: tinyPngBase64 }],
            deadlineMs: 5,
          }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, "AbortError");
        return true;
      },
    );
    assert.equal(calls, 1);
  });
});
