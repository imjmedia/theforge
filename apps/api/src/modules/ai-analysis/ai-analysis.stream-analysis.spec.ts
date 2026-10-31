import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWithRequestUserAsync } from "../../common/request-user.store.js";
import { AiAnalysisService } from "./ai-analysis.service.js";

const RECURSION_RAW =
  "Recursion limit of 25 reached without hitting a stop condition";

function createServiceWithMockGraph(): AiAnalysisService {
  return new AiAnalysisService(
    {} as never, // prisma
    { getCheckpointer: async () => null } as never, // checkpointerService
    { getPreferencesForContext: async () => undefined } as never, // preferences
    {} as never, // estimationService
    {} as never, // nodeCacheService
    {} as never, // projects
    {} as never, // theforge
    {} as never, // agentSupervisor
    {} as never, // ai
    {} as never, // discovery
    {
      resolveRuntime: async () => ({
        providerId: "openrouter",
        apiKey: "k",
        baseURL: "https://x",
        chatModel: "m",
        chatModelFallbacks: [],
        embeddingModel: null,
        embeddingDimension: null,
        embeddingsEnabled: false,
        sttModel: null,
        visionModel: "m",
      }),
    } as never, // aiFactory
    {} as never, // uiMcpClient
    {} as never, // uiMcp
    {} as never, // mddUpstreamSync
    {} as never, // threadLock
    async (_factory, _userId) =>
      ({
        stream: async () => {
          throw new Error(RECURSION_RAW);
        },
      }) as Awaited<ReturnType<typeof import("./graph/dbga-graph.js").createDbgaGraph>>,
  );
}

describe("AiAnalysisService.streamAnalysis", () => {
  it("yields error INSUFFICIENT_IDEA sin invocar el grafo para saludos", async () => {
    const service = createServiceWithMockGraph();
    const events: Array<{ type: string; message?: string; code?: string }> = [];
    await runWithRequestUserAsync("test-user", async () => {
      for await (const event of service.streamAnalysis("Hola")) {
        events.push(event);
      }
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.equal(events[0].code, "INSUFFICIENT_IDEA");
    assert.match(events[0].message ?? "", /Benchmark/i);
  });

  it("yields error cuando createDbgaGraph falla antes de graph.stream", async () => {
    const service = createServiceWithMockGraph();
    (service as unknown as { createDbgaGraphFn: () => Promise<never> }).createDbgaGraphFn =
      async () => {
        throw new Error("modelo no permitido en instancia PROD");
      };

    const events: Array<{ type: string; message?: string }> = [];
    await runWithRequestUserAsync("test-user", async () => {
      for await (const event of service.streamAnalysis("idea de prueba")) {
        events.push(event);
      }
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match(events[0].message ?? "", /modelo no permitido/i);
  });

  it("yields error NDJSON con mensaje español cuando graph.stream lanza recursion limit", async () => {
    assert.match(RECURSION_RAW, /25/);

    const service = createServiceWithMockGraph();
    const events: Array<{ type: string; message?: string }> = [];
    await runWithRequestUserAsync("test-user", async () => {
      for await (const event of service.streamAnalysis("plataforma B2B interna")) {
        events.push(event);
      }
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    const message = events[0].message ?? "";
    assert.match(message, /competidores directos/i);
    assert.match(message, /B2B/i);
    assert.doesNotMatch(message, /Recursion limit/i);
    assert.doesNotMatch(message, /recursion limit/i);
  });
});
