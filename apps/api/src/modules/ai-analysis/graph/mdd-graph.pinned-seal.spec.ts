import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { projectArchitectureGraphSchema } from "@theforge/shared-types";
import {
  sealDesignFirstMddSection3,
  sealDesignFirstMddSection4,
  wrapDesignFirstMddSectionsForHarness,
} from "../utils/design-first-mdd-sections.util.js";
import {
  filterCrossConsistencyPatchesForPinned,
  hashMddSectionBody,
  injectDesignFirstSealedSectionsIntoDraft,
  logPinnedSectionDriftMetric,
  pinnedStackArchitectRouteTarget,
  reimposeDesignFirstPinnedSections,
  redirectPinnedDeliveryGateFixTarget,
} from "../utils/design-first-pinned.util.js";
import { extractSection3Body, replaceMddSection3Body } from "../utils/mdd-sanitize.js";
import { createMddGraph } from "./mdd-graph.js";
import type { AIFactory } from "../../ai/ai.factory.js";
import type { UserLLMRuntime } from "../../ai/providers/llm-runtime.types.js";

const FIXTURE = join(
  import.meta.dirname,
  "../../../../../../packages/shared-types/src/design-first/__fixtures__/three-screens.pag.json",
);

const STUB_RUNTIME: UserLLMRuntime = {
  providerId: "openai",
  apiKey: "test-key-not-real",
  baseURL: "http://localhost:0",
  chatModel: "test-model",
  chatModelFallbacks: [],
  embeddingModel: null,
  embeddingDimension: null,
  embeddingsEnabled: false,
  sttModel: null,
  visionModel: "test-model",
  imageModel: null,
};

const STUB_FACTORY = {
  resolveRuntime: async () => STUB_RUNTIME,
  resolveAuditorRuntime: async () => STUB_RUNTIME,
  resolveHighComplexityRuntime: async () => STUB_RUNTIME,
} as unknown as AIFactory;

function loadPag() {
  return projectArchitectureGraphSchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));
}

describe("design-first pinned §3/§4 seal", () => {
  const pag = loadPag();
  const s3 = sealDesignFirstMddSection3(pag);
  const s4 = sealDesignFirstMddSection4(pag);
  const pin = { s3, s4, pagHash: "abc123", pinnedSections: [3, 4] as (3 | 4)[] };

  it("reimpone §3/§4 byte a byte tras parche LLM simulado", () => {
    const base = wrapDesignFirstMddSectionsForHarness(s3, s4);
    const tampered = replaceMddSection3Body(base, "CREATE TABLE evil (id int PRIMARY KEY);");
    const { draft, drifts } = reimposeDesignFirstPinnedSections(tampered, { designFirstPinned: pin });
    assert.ok(drifts.length >= 1);
    assert.equal(extractSection3Body(draft)?.trimEnd(), s3.trimEnd());
    assert.equal(hashMddSectionBody(extractSection3Body(draft) ?? ""), hashMddSectionBody(s3));
  });

  it("registra métrica pinned_section_drift", () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      logPinnedSectionDriftMetric([{ section: 3, expectedHash: "aa", actualHash: "bb" }]);
      assert.ok(logs.some((l) => l.includes("pinned_section_drift")));
    } finally {
      console.log = original;
    }
  });

  it("descarta parches cross-consistency sobre §3/§4", () => {
    const filtered = filterCrossConsistencyPatchesForPinned(
      [{ find: "## 3. Modelo de Datos\n\nCREATE TABLE evil", replace: "hack" }],
      { designFirstPinned: pin },
    );
    assert.equal(filtered.length, 0);
  });

  it("stack_architect en pinned salta data_model hacia section5 o post_critic_parallel", () => {
    assert.equal(
      pinnedStackArchitectRouteTarget({ designFirstPinned: pin } as never, { usePostCriticParallel: false }),
      "section5",
    );
    assert.equal(
      pinnedStackArchitectRouteTarget({ designFirstPinned: pin } as never, { usePostCriticParallel: true }),
      "post_critic_parallel",
    );
  });

  it("prepare_output fix targets data_model/api_contracts redirigen a clarifier", () => {
    assert.equal(redirectPinnedDeliveryGateFixTarget("data_model", { designFirstPinned: pin }), "clarifier");
    assert.equal(redirectPinnedDeliveryGateFixTarget("api_contracts", { designFirstPinned: pin }), "clarifier");
    assert.equal(redirectPinnedDeliveryGateFixTarget("section5", { designFirstPinned: pin }), "section5");
  });

  it("injectDesignFirstSealedSectionsIntoDraft es idempotente", () => {
    const draft = wrapDesignFirstMddSectionsForHarness("placeholder s3", "placeholder s4");
    const once = injectDesignFirstSealedSectionsIntoDraft(draft, pin);
    const twice = injectDesignFirstSealedSectionsIntoDraft(once, pin);
    assert.equal(once, twice);
  });
});

describe("topología pinned (one-shot)", () => {
  it("stack_architect expone rutas section5 y post_critic_parallel", async () => {
    const graph = await createMddGraph(STUB_FACTORY, "user-test", { preflightRuntime: STUB_RUNTIME });
    const g = graph.getGraph() as { edges: Array<{ source: string; target: string; conditional?: boolean }> };
    const fromStack = g.edges.filter((e) => e.source === "stack_architect" && e.conditional);
    const targets = new Set(fromStack.map((e) => e.target));
    assert.ok(targets.has("section5"));
    assert.ok(targets.has("post_critic_parallel"));
    assert.ok(targets.has("data_model"));
  });
});
