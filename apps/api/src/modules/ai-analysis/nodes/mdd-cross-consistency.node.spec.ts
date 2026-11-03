import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { runWithLlmAbortSignal } from "../utils/mdd-llm-retry.util.js";
import {
  createMddCrossConsistencyNode,
  crossConsistencyOutputSchema,
  extractCrossConsistencyJson,
} from "./mdd-cross-consistency.node.js";

const DRAFT = "# MDD\n\n## 1. Contexto\n\nNota con marcador-unico-aaa para el parche.\n";
const state = { mddDraft: DRAFT } as never;
const PATCH_JSON = '```json\n[{"find":"marcador-unico-aaa","replace":"marcador-corregido-bbb"}]\n```';

function fakeLlm(responses: string[]) {
  const calls: Array<Array<{ content: string }>> = [];
  const llm = {
    invoke: async (msgs: Array<{ content: string }>) => {
      calls.push(msgs);
      return { content: responses[Math.min(calls.length - 1, responses.length - 1)]! };
    },
  };
  return { llm: llm as never, calls };
}

describe("extractCrossConsistencyJson / schema", () => {
  it("OK_CONSISTENT se normaliza y valida", () => {
    const json = extractCrossConsistencyJson("OK_CONSISTENT");
    assert.ok(json);
    assert.equal(crossConsistencyOutputSchema.safeParse(JSON.parse(json)).success, true);
  });

  it("array de parches válido; parche mal formado invalida el array", () => {
    const ok = extractCrossConsistencyJson(PATCH_JSON)!;
    assert.equal(crossConsistencyOutputSchema.safeParse(JSON.parse(ok)).success, true);
    const bad = extractCrossConsistencyJson('[{"find":"abc"}]')!;
    assert.equal(crossConsistencyOutputSchema.safeParse(JSON.parse(bad)).success, false);
    assert.equal(extractCrossConsistencyJson("sin json aquí"), null);
  });
});

describe("createMddCrossConsistencyNode (pasada LLM)", () => {
  it("JSON válido => aplica el parche (1 llamada)", async () => {
    const { llm, calls } = fakeLlm([PATCH_JSON]);
    const out = await createMddCrossConsistencyNode(llm)(state);
    assert.equal(calls.length, 1);
    assert.ok(out.mddDraft?.includes("marcador-corregido-bbb"));
    assert.ok(!out.mddDraft?.includes("marcador-unico-aaa"));
  });

  it("OK_CONSISTENT => sin parches", async () => {
    const { llm, calls } = fakeLlm(["OK_CONSISTENT"]);
    const out = await createMddCrossConsistencyNode(llm)(state);
    assert.equal(calls.length, 1);
    assert.ok(!out.mddDraft || out.mddDraft.includes("marcador-unico-aaa"));
  });

  it("inválido => reparación => válido (2 llamadas, el error se re-inyecta)", async () => {
    const { llm, calls } = fakeLlm(["creo que hay que cambiar el marcador", PATCH_JSON]);
    const out = await createMddCrossConsistencyNode(llm)(state);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.length, 3, "prompt + salida previa + petición de reparación");
    assert.ok(out.mddDraft?.includes("marcador-corregido-bbb"));
  });

  it("dos salidas inválidas => draft sin parches inventados", async () => {
    const { llm, calls } = fakeLlm(['[{"find":"marcador-unico-aaa"}]']);
    const out = await createMddCrossConsistencyNode(llm)(state);
    assert.equal(calls.length, 2, "intento + una reparación");
    assert.ok(!out.mddDraft || out.mddDraft.includes("marcador-unico-aaa"));
    assert.ok(!out.mddDraft?.includes("marcador-corregido-bbb"));
  });

  it("abort => se propaga como AbortError", async () => {
    const { llm, calls } = fakeLlm([PATCH_JSON]);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      runWithLlmAbortSignal(ac.signal, () => createMddCrossConsistencyNode(llm)(state)),
      (err: Error) => err.name === "AbortError",
    );
    assert.equal(calls.length, 0);
  });
});

describe("createMddCrossConsistencyNode — presupuesto (LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS)", () => {
  it("presupuesto agotado con la llamada colgada => sin parches inventados, solo el paso determinista", async () => {
    const prev = process.env.LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS;
    process.env.LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS = "20000";
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let calls = 0;
      const llm = {
        invoke: (_m: unknown, opts: { signal: AbortSignal }) => {
          calls += 1;
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () => reject(new Error("llamada colgada")), { once: true });
          });
        },
      };
      const pending = createMddCrossConsistencyNode(llm as never)(state);
      mock.timers.tick(20_000);
      const out = await pending;
      assert.equal(calls, 1, "sin reparación tras agotar el presupuesto");
      // Solo el paso determinista (puede normalizar espacios): sin parche LLM, el marcador original sigue.
      assert.ok(!out.mddDraft || out.mddDraft.includes("marcador-unico-aaa"));
      assert.ok(!out.mddDraft?.includes("marcador-corregido-bbb"));
    } finally {
      mock.timers.reset();
      if (prev === undefined) delete process.env.LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS;
      else process.env.LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS = prev;
    }
  });
});
