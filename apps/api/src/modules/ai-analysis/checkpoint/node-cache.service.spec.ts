import { describe, it } from "node:test";
import assert from "node:assert";
import { NodeCacheService, isCacheableNodeOutput, stableStringify } from "./node-cache.service.js";
import { crossConsistencyInput, securityInput, softwareArchitectInput } from "./node-input-hash.js";
import { wrapCache } from "../graph/mdd-graph.js";

function makeCache(): NodeCacheService {
  const cache = new NodeCacheService();
  // evita que el interval mantenga vivo el proceso de test
  (cache as unknown as { cleanupTimer: ReturnType<typeof setInterval> | null }).cleanupTimer?.unref?.();
  return cache;
}

const okOutput = { mddDraft: "# MDD\n## 1. Contexto\ncontenido" };

describe("isCacheableNodeOutput", () => {
  it("rechaza vacíos, fallos y salidas sin contenido", () => {
    assert.strictEqual(isCacheableNodeOutput({}), false);
    assert.strictEqual(isCacheableNodeOutput(undefined), false);
    assert.strictEqual(isCacheableNodeOutput({ lastStepFailed: { node: "x", error: "e" } }), false);
    assert.strictEqual(
      isCacheableNodeOutput({ mddDraft: "ok", lastStepFailed: { node: "x", error: "e" } }),
      false,
    );
    assert.strictEqual(isCacheableNodeOutput({ mddDraft: "   " }), false);
    assert.strictEqual(isCacheableNodeOutput({ managerQuestions: ["a"] } as never), false);
  });
  it("acepta salidas con mddDraft/mddStructured/secciones", () => {
    assert.strictEqual(isCacheableNodeOutput(okOutput), true);
    assert.strictEqual(isCacheableNodeOutput({ securitySectionMd: "## 6" }), true);
    assert.strictEqual(isCacheableNodeOutput({ integrationSectionMd: "## 7" }), true);
    assert.strictEqual(isCacheableNodeOutput({ mddStructured: { seguridad: [] } } as never), true);
  });
});

describe("NodeCacheService.key", () => {
  it("distingue proyectos y es estable ante el orden de claves", () => {
    const c = makeCache();
    assert.notStrictEqual(c.key("n", "p1", { a: 1 }), c.key("n", "p2", { a: 1 }));
    assert.strictEqual(c.key("n", "p1", { a: 1, b: 2 }), c.key("n", "p1", { b: 2, a: 1 }));
    assert.notStrictEqual(c.key("n", "p1", { a: { x: 1 } }), c.key("n", "p1", { a: { x: 2 } }));
    assert.strictEqual(stableStringify({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
  });
});

describe("input hashes", () => {
  it("el draft completo cambia la clave aunque la edición esté más allá de 20k chars", () => {
    const big = "x".repeat(30_000);
    const a = { mddDraft: `${big}A` } as never;
    const b = { mddDraft: `${big}B` } as never;
    for (const fn of [softwareArchitectInput, securityInput, crossConsistencyInput]) {
      assert.notDeepStrictEqual(fn(a), fn(b));
    }
  });
  it("campos leídos por el arquitecto cambian la clave", () => {
    const base = { mddDraft: "d" } as Record<string, unknown>;
    for (const [k, v] of Object.entries({
      auditorFeedback: "fix",
      currentStepGoal: "goal",
      deliveryGateFixTarget: "section5",
      deliveryGateLoopActive: true,
      userInputAccumulated: "u",
      lastUserMessage: "m",
      brdContent: "brd",
      stackArchitectAttempt: 2,
    })) {
      assert.notDeepStrictEqual(
        softwareArchitectInput(base as never),
        softwareArchitectInput({ ...base, [k]: v } as never),
        `campo ${k} debe afectar la clave`,
      );
    }
  });
});

describe("wrapCache", () => {
  it("cachea éxitos y sirve el hit sin re-ejecutar", async () => {
    const cache = makeCache();
    let calls = 0;
    const fn = wrapCache(cache, "n", (s) => ({ d: s.mddDraft }), async () => {
      calls += 1;
      return okOutput;
    });
    const state = { mddDraft: "a", projectId: "p" } as never;
    await fn(state);
    const second = await fn(state);
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(second, okOutput);
    assert.strictEqual(cache.size, 1);
  });

  it("nunca guarda {} ni lastStepFailed: un reintento vuelve a llamar al nodo", async () => {
    const cache = makeCache();
    let calls = 0;
    const outputs: Array<Record<string, unknown>> = [
      {},
      { lastStepFailed: { node: "integration", error: "e" } },
      okOutput,
    ];
    const fn = wrapCache(cache, "n", (s) => ({ d: s.mddDraft }), async () => outputs[calls++] as never);
    const state = { mddDraft: "a", projectId: "p" } as never;
    assert.deepStrictEqual(await fn(state), {});
    assert.strictEqual(cache.size, 0);
    assert.ok((await fn(state)).lastStepFailed);
    assert.strictEqual(cache.size, 0);
    assert.deepStrictEqual(await fn(state), okOutput);
    assert.strictEqual(calls, 3);
    assert.strictEqual(cache.size, 1);
  });

  it("bypass total con deliveryGateLoopActive: ni lee ni escribe", async () => {
    const cache = makeCache();
    let calls = 0;
    const fn = wrapCache(cache, "n", (s) => ({ d: s.mddDraft }), async () => {
      calls += 1;
      return okOutput;
    });
    const normal = { mddDraft: "a", projectId: "p" } as never;
    await fn(normal); // llena el cache
    assert.strictEqual(cache.size, 1);
    const loop = { mddDraft: "a", projectId: "p", deliveryGateLoopActive: true } as never;
    await fn(loop);
    await fn(loop);
    assert.strictEqual(calls, 3, "en gate loop cada llamada ejecuta el nodo");
    assert.strictEqual(cache.size, 1);
  });

  it("sin cache devuelve el nodo tal cual", () => {
    const f = async () => ({});
    assert.strictEqual(wrapCache(null, "n", () => ({}), f), f);
  });
});
