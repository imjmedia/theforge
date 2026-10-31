import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import {
  buildMddPlan,
  expandSectionsToRun,
  getFullPipelineNodeSequence,
  planWillAutoApprove,
} from "./manager-plan.js";

describe("manager-plan", () => {
  const prevTailParallel = process.env.MDD_TAIL_PARALLEL;

  afterEach(() => {
    if (prevTailParallel === undefined) delete process.env.MDD_TAIL_PARALLEL;
    else process.env.MDD_TAIL_PARALLEL = prevTailParallel;
  });

  describe("getFullPipelineNodeSequence", () => {
    it("incluye tail_parallel cuando MDD_TAIL_PARALLEL está activo (default)", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const seq = getFullPipelineNodeSequence();
      assert.ok(seq.includes("tail_parallel"));
      assert.equal(seq.includes("security"), false);
      assert.equal(seq.includes("integration"), false);
      assert.deepEqual(seq.slice(0, 4), [
        "clarifier",
        "software_architect",
        "architect_critic",
        "format_after_architect",
      ]);
    });

    it("HIGH usa pipeline dividido stack→data→critic→api", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const seq = getFullPipelineNodeSequence("HIGH");
      assert.deepEqual(seq.slice(1, 5), [
        "stack_architect",
        "data_model",
        "architect_critic",
        "api_contracts",
      ]);
      assert.equal(seq.includes("software_architect"), false);
    });

    it("usa security+integration cuando MDD_TAIL_PARALLEL=0", () => {
      process.env.MDD_TAIL_PARALLEL = "0";
      const seq = getFullPipelineNodeSequence();
      assert.ok(seq.includes("security"));
      assert.ok(seq.includes("integration"));
      assert.equal(seq.includes("tail_parallel"), false);
    });
  });

  describe("buildMddPlan full_pipeline", () => {
    it("genera plan con tail_parallel por defecto", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const plan = buildMddPlan("full_pipeline");
      const nodes = plan.map((s) => s.node);
      assert.ok(nodes.includes("tail_parallel"));
      assert.equal(nodes.filter((n) => n === "tail_parallel").length, 1);
      assert.equal(nodes.includes("security"), false);
      assert.equal(nodes.includes("integration"), false);
    });

    it("genera plan legacy security+integration cuando tail parallel desactivado", () => {
      process.env.MDD_TAIL_PARALLEL = "0";
      const plan = buildMddPlan("full_pipeline");
      const nodes = plan.map((s) => s.node);
      assert.ok(nodes.includes("security"));
      assert.ok(nodes.includes("integration"));
      assert.equal(nodes.includes("tail_parallel"), false);
    });
  });

  describe("expandSectionsToRun", () => {
    it("colapsa security+integration en tail_parallel cuando aplica", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const expanded = expandSectionsToRun(["software_architect", "security", "integration"]);
      assert.ok(expanded.includes("tail_parallel"));
      assert.ok(expanded.includes("architect_critic"));
      assert.equal(expanded.includes("security"), false);
      assert.equal(expanded.includes("integration"), false);
      assert.ok(expanded.indexOf("format_after_architect") < expanded.indexOf("tail_parallel"));
    });

    it("HIGH expande software_architect a pipeline dividido", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const expanded = expandSectionsToRun(["software_architect", "security", "integration"], {
        complexity: "HIGH",
      });
      assert.ok(expanded.includes("stack_architect"));
      assert.ok(expanded.includes("data_model"));
      assert.ok(expanded.includes("api_contracts"));
      assert.equal(expanded.includes("software_architect"), false);
    });

    it("conserva section5 aislado sin tail_parallel", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const expanded = expandSectionsToRun(["section5"]);
      assert.deepEqual(expanded, ["section5", "format_after_redactor", "diagram_injector", "auditor"]);
    });

    it("conserva security aislado sin tail_parallel", () => {
      delete process.env.MDD_TAIL_PARALLEL;
      const expanded = expandSectionsToRun(["security"]);
      assert.deepEqual(expanded, ["security", "format_after_redactor", "diagram_injector", "auditor"]);
    });
  });
});

describe("planWillAutoApprove", () => {
  const step = (node: string) => ({ step_id: node, node, task_description: node });

  it("1 paso → auto-aprobado sea cual sea el target", () => {
    assert.equal(planWillAutoApprove([step("auditor")], "sections"), true);
    assert.equal(planWillAutoApprove([step("clarifier")], "full_pipeline"), true);
  });

  it("autoApprove explícito → auto-aprobado aunque sea full_pipeline", () => {
    const plan = [step("clarifier"), step("software_architect"), step("auditor")];
    assert.equal(planWillAutoApprove(plan, "full_pipeline", true), true);
    assert.equal(planWillAutoApprove(plan, "full_pipeline"), false);
  });

  it("sections con un solo escritor (+ formato/auditor) → auto-aprobado", () => {
    const plan = [step("integration"), step("format_after_redactor"), step("diagram_injector"), step("auditor")];
    assert.equal(planWillAutoApprove(plan, "sections"), true);
  });

  it("sections con dos escritores → requiere aprobación", () => {
    const plan = [step("software_architect"), step("security"), step("auditor")];
    assert.equal(planWillAutoApprove(plan, "sections"), false);
  });

  it("clarifier_only (clarifier + merge) → requiere aprobación", () => {
    const plan = [step("clarifier"), step("merge_section1_only")];
    assert.equal(planWillAutoApprove(plan, "clarifier_only"), false);
  });
});
