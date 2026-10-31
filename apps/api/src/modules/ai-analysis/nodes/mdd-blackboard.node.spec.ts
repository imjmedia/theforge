import { describe, it } from "node:test";
import assert from "node:assert";
import { createMddBlackboardNode, filterBlackboardImpactedNodes } from "./mdd-blackboard.node.js";

class FakeLlm {
  constructor(private readonly response: string) {}
  async invoke(_messages: unknown[]): Promise<unknown> {
    return { content: this.response };
  }
}

const llmJson = (impacted: string[]) =>
  JSON.stringify({ resolution: "Usar Argon2id", reasoning: "coherente", impacted_nodes: impacted });

describe("filterBlackboardImpactedNodes", () => {
  it("mapea alias y descarta nodos desconocidos sin duplicados", () => {
    assert.deepStrictEqual(
      filterBlackboardImpactedNodes(["stack_architect", "data_model", "Integration Engineer", "foo", "security"]),
      ["software_architect", "integration", "security"],
    );
  });
  it("devuelve [] con entrada vacía o inválida", () => {
    assert.deepStrictEqual(filterBlackboardImpactedNodes(["manager", "executor", ""]), []);
    assert.deepStrictEqual(filterBlackboardImpactedNodes(undefined), []);
  });
});

describe("createMddBlackboardNode", () => {
  it("filtra impacted_nodes antes de fijar sectionsToRun", async () => {
    const node = createMddBlackboardNode(new FakeLlm(llmJson(["api_contracts", "bogus", "security"])) as never);
    const out = await node({ auditorGaps: { critical_gaps: [] } } as never);
    assert.deepStrictEqual(out.sectionsToRun, ["software_architect", "security"]);
    assert.strictEqual(out.delegateTarget, "sections");
  });

  it("no fija sectionsToRun ni delegateTarget si nada es válido (ruta cae al manager)", async () => {
    const node = createMddBlackboardNode(new FakeLlm(llmJson(["bogus", "executor"])) as never);
    const out = await node({ auditorGaps: { critical_gaps: [] } } as never);
    assert.ok(!("sectionsToRun" in out));
    assert.ok(!("delegateTarget" in out));
    assert.ok(out.acceptedProposalDirective);
  });
});
