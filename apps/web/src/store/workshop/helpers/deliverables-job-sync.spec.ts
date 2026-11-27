import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pollDeliverablesJobInBackground, refreshAfterDeliverablesRun } from "./deliverables-job-sync.js";

/** Crea un `get` simulado que registra el orden de las llamadas. */
function makeGet(opts: { conformanceFails?: boolean } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const get = () =>
    ({
      fetchProject: async (...a: unknown[]) => {
        calls.push(["fetchProject", ...a]);
        return { id: "p1" };
      },
      fetchConformance: async (...a: unknown[]) => {
        calls.push(["fetchConformance", ...a]);
        if (opts.conformanceFails) throw new Error("boom");
      },
      fetchEstimation: async (...a: unknown[]) => {
        calls.push(["fetchEstimation", ...a]);
      },
      fetchGenerationStatus: async (...a: unknown[]) => {
        calls.push(["fetchGenerationStatus", ...a]);
      },
      bumpDocumentationGapsRefresh: () => {
        calls.push(["bump"]);
      },
    }) as never;
  return { get, calls };
}

describe("refreshAfterDeliverablesRun", () => {
  it("pide conformidad con isRepair=false y no fuerza preferServerMdd", async () => {
    const { get, calls } = makeGet();
    const p = await refreshAfterDeliverablesRun(get, "p1", { isRepair: false });
    assert.deepEqual(calls[0], ["fetchProject", "p1", undefined]);
    assert.ok(calls.some((c) => c[0] === "fetchConformance" && c[1] === "p1"));
    assert.deepEqual(p, { id: "p1" });
  });

  it("pide conformidad con isRepair=true y usa preferServerMdd", async () => {
    const { get, calls } = makeGet();
    await refreshAfterDeliverablesRun(get, "p1", { isRepair: true });
    assert.deepEqual(calls[0], ["fetchProject", "p1", { preferServerMdd: true }]);
    assert.ok(calls.some((c) => c[0] === "fetchConformance"));
  });

  it("un fallo de conformidad no corta el resto del refresco", async () => {
    const { get, calls } = makeGet({ conformanceFails: true });
    await refreshAfterDeliverablesRun(get, "p1");
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["fetchProject", "fetchConformance", "fetchEstimation", "fetchGenerationStatus", "bump"],
    );
  });
});

describe("pollDeliverablesJobInBackground (reparación)", () => {
  const realFetch = globalThis.fetch;
  const realStorage = (globalThis as { localStorage?: unknown }).localStorage;

  function setup(loadingReason: string, result: unknown) {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "completed", result }), { status: 200 })) as typeof fetch;
    const state: Record<string, unknown> = { loadingReason, project: { complexity: "HIGH" }, agentProgress: [] };
    const { get: getCalls } = makeGet();
    const base = getCalls() as unknown as Record<string, unknown>;
    const get = () => ({ ...base, ...state }) as never;
    const set = (p: unknown) => {
      Object.assign(state, typeof p === "function" ? (p as (s: unknown) => object)(state) : p);
    };
    return { get, set: set as never, state };
  }

  function restore() {
    globalThis.fetch = realFetch;
    (globalThis as { localStorage?: unknown }).localStorage = realStorage;
  }

  it("al completar un job repair-sdd-gaps guarda lastRepairSummary", async () => {
    const { get, set, state } = setup("repair-sdd-gaps", {
      repair: { fixed: ["g"], remaining: { auto: 0, llm: 0, human: 1 }, errors: [], stoppedReason: "human_only" },
    });
    try {
      await pollDeliverablesJobInBackground("p-repair", "j-repair", get, set);
    } finally {
      restore();
    }
    assert.deepEqual(state.lastRepairSummary, {
      fixed: ["g"],
      remaining: { auto: 0, llm: 0, human: 1 },
      errors: [],
      stoppedReason: "human_only",
    });
  });

  it("en una cascada normal no toca lastRepairSummary", async () => {
    const { get, set, state } = setup("deliverables-cascade", { repair: { fixed: ["g"] } });
    try {
      await pollDeliverablesJobInBackground("p-casc", "j-casc", get, set);
    } finally {
      restore();
    }
    assert.equal("lastRepairSummary" in state, false);
  });
});
