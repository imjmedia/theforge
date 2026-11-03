import { describe, it } from "node:test";
import assert from "node:assert";
import {
  NODE_CACHE_MAX_ENTRIES,
  NodeCacheService,
  isCacheableNodeOutput,
  runWithNodeCacheDisabled,
  stableStringify,
} from "./node-cache.service.js";
import { crossConsistencyInput, securityInput, softwareArchitectInput } from "./node-input-hash.js";
import { scopeNodeCacheToModels, wrapCache } from "../graph/mdd-graph.js";
import { describeLlmModelChain } from "../llm/create-dbga-llm.js";
import { buildNodeCacheKey } from "./node-cache-key.js";
import { MDD_PROMPT_VERSION } from "../prompts/prompt-version.js";

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

describe("NodeCacheService: clave con modelos y promptVersion", () => {
  it("misma entrada y mismos modelos dan la misma clave; otro modelo da otra", () => {
    const c = makeCache();
    const a = c.scoped("openrouter:m1>m2");
    const a2 = c.scoped("openrouter:m1>m2");
    const b = c.scoped("openrouter:m3>m2");
    assert.strictEqual(a.key("n", "p", { x: 1 }), a2.key("n", "p", { x: 1 }));
    assert.notStrictEqual(a.key("n", "p", { x: 1 }), b.key("n", "p", { x: 1 }));
    assert.notStrictEqual(a.key("n", "p", { x: 1 }), c.key("n", "p", { x: 1 }));
  });

  it("MDD_PROMPT_VERSION es un string de fecha y forma parte de la clave", () => {
    assert.match(MDD_PROMPT_VERSION, /^\d{4}-\d{2}-\d{2}/);
    const c = makeCache();
    const expected = buildNodeCacheKey({
      node: "n",
      input: { projectId: "p", x: 1 },
      models: "",
      promptVersion: MDD_PROMPT_VERSION,
    });
    assert.strictEqual(c.key("n", "p", { x: 1 }), expected);
    assert.notStrictEqual(
      c.key("n", "p", { x: 1 }),
      buildNodeCacheKey({ node: "n", input: { projectId: "p", x: 1 }, models: "", promptVersion: "1999-01-01" }),
    );
  });

  it("un HIT no cruza modelos: cambiar el modelo del grafo vuelve a ejecutar el nodo", async () => {
    const cache = makeCache();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return okOutput;
    };
    const state = { mddDraft: "a", projectId: "p" } as never;
    const fnA = wrapCache(cache.scoped("openai:m1"), "n", (s) => ({ d: s.mddDraft }), run);
    const fnB = wrapCache(cache.scoped("openai:m2"), "n", (s) => ({ d: s.mddDraft }), run);
    await fnA(state);
    await fnA(state);
    assert.strictEqual(calls, 1);
    await fnB(state);
    assert.strictEqual(calls, 2, "otro modelo no reutiliza la salida");
  });

  it("describeLlmModelChain / scopeNodeCacheToModels usan la cadena de modelos del LLM", () => {
    const llmA = { providerId: "openrouter", modelChain: ["m1", "m2"] } as never;
    const llmB = { providerId: "openrouter", modelChain: ["m1", "m3"] } as never;
    assert.strictEqual(describeLlmModelChain(llmA), "openrouter:m1>m2");
    const cache = makeCache();
    const ka = scopeNodeCacheToModels(cache, [llmA, null, llmA])!.key("n", "p", {});
    const kb = scopeNodeCacheToModels(cache, [llmB])!.key("n", "p", {});
    assert.notStrictEqual(ka, kb);
    assert.strictEqual(scopeNodeCacheToModels(null, [llmA]), null);
  });
});

describe("NodeCacheService: LRU y stats", () => {
  it("evicta la menos usada recientemente al superar el tope", () => {
    const c = makeCache();
    for (let i = 0; i < NODE_CACHE_MAX_ENTRIES; i++) c.set(`k${i}`, okOutput);
    assert.strictEqual(c.size, NODE_CACHE_MAX_ENTRIES);
    // k0 se usa: pasa a ser la más reciente, así que la más antigua es k1
    assert.ok(c.get("k0"));
    c.set("nueva", okOutput);
    assert.strictEqual(c.size, NODE_CACHE_MAX_ENTRIES);
    assert.strictEqual(c.get("k1"), undefined, "k1 era la menos usada");
    assert.ok(c.get("k0"), "k0 sobrevive por haberse usado");
    assert.ok(c.get("nueva"));
    assert.strictEqual(c.stats().evictions, 1);
  });

  it("reescribir una clave existente no cuenta como evicción ni crece el tamaño", () => {
    const c = makeCache();
    c.set("a", okOutput);
    c.set("a", okOutput);
    assert.strictEqual(c.size, 1);
    assert.strictEqual(c.stats().evictions, 0);
  });

  it("stats cuenta hits, misses y evicciones", () => {
    const c = makeCache();
    assert.deepStrictEqual(
      { h: c.stats().hits, m: c.stats().misses, e: c.stats().evictions, size: c.stats().size },
      { h: 0, m: 0, e: 0, size: 0 },
    );
    c.set("a", okOutput);
    c.get("a");
    c.get("a");
    c.get("zzz");
    const st = c.stats();
    assert.strictEqual(st.hits, 2);
    assert.strictEqual(st.misses, 1);
    assert.strictEqual(st.size, 1);
    assert.strictEqual(st.maxEntries, NODE_CACHE_MAX_ENTRIES);
  });
});

describe("wrapCache dentro de runWithNodeCacheDisabled (eval)", () => {
  it("no lee ni escribe: cada llamada ejecuta el nodo", async () => {
    const cache = makeCache();
    let calls = 0;
    const fn = wrapCache(cache, "n", (s) => ({ d: s.mddDraft }), async () => {
      calls += 1;
      return okOutput;
    });
    const state = { mddDraft: "a", projectId: "p" } as never;
    await runWithNodeCacheDisabled(async () => {
      await fn(state);
      await fn(state);
    });
    assert.strictEqual(calls, 2);
    assert.strictEqual(cache.size, 0);
    await fn(state); // fuera del bypass vuelve a cachear
    await fn(state);
    assert.strictEqual(calls, 3);
    assert.strictEqual(cache.size, 1);
  });
});
