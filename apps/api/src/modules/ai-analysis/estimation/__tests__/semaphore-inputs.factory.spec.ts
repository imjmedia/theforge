import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConformanceService } from "../../../engine/conformance.service.js";
import { buildSemaphoreInputsFromLoaded } from "../semaphore-inputs.factory.js";

describe("buildSemaphoreInputsFromLoaded", () => {
  const conformance = new ConformanceService();

  it("CL-14: derivados partial → pre_cascade y nota cascada incompleta", () => {
    const mdd = "# MDD\n".padEnd(200, "x");
    const built = buildSemaphoreInputsFromLoaded(conformance, {
      projectId: "p1",
      content: mdd,
      source: "persisted",
      complexity: "HIGH",
      documents: {
        mddContent: mdd,
        blueprintContent: "x".repeat(100),
        apiContractsContent: undefined,
        logicFlowsContent: undefined,
        infraContent: undefined,
      },
    });
    assert.equal(built.verdict.derivativesState, "partial");
    assert.equal(built.verdict.phase, "pre_cascade");
    assert.ok(built.verdict.notes.some((n) => n.includes("cascada incompleta")));
  });

  it("CL-21: MEDIUM con 3 de 5 derivados → partial", () => {
    const mdd = "MDD ".padEnd(150, "·");
    const built = buildSemaphoreInputsFromLoaded(conformance, {
      projectId: "p2",
      content: mdd,
      source: "persisted",
      complexity: "MEDIUM",
      documents: {
        mddContent: mdd,
        specContent: "s".repeat(100),
        apiContractsContent: "a".repeat(100),
        userStoriesContent: "u".repeat(100),
        tasksContent: undefined,
        logicFlowsContent: undefined,
      },
    });
    assert.equal(built.verdict.derivativesState, "partial");
  });
});
