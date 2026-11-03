import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MDDStateType } from "../state/index.js";
import { shouldSkipAuditor } from "./mdd-graph.js";

const st = (patch: Partial<MDDStateType>): MDDStateType => patch as MDDStateType;

describe("shouldSkipAuditor (una pasada del Auditor por turno)", () => {
  it("sin pasada previa ni fallo de escritor: audita", () => {
    assert.equal(shouldSkipAuditor(st({})), false);
  });

  it("tras una pasada con nota (scored): no re-audita", () => {
    assert.equal(shouldSkipAuditor(st({ auditorRan: true, auditorOutcome: "scored" })), true);
  });

  it("Auditor caído (unavailable) deja auditorRan=true: no se re-ejecuta en bucle", () => {
    assert.equal(
      shouldSkipAuditor(st({ auditorRan: true, auditorOutcome: "unavailable", auditorScore: undefined })),
      true,
    );
  });

  it("unavailable heredado de un turno anterior (auditorRan reiniciado) no desactiva el Auditor del turno nuevo", () => {
    assert.equal(shouldSkipAuditor(st({ auditorRan: undefined, auditorOutcome: "unavailable" })), false);
  });

  it("un nodo escritor fallido salta el Auditor", () => {
    assert.equal(
      shouldSkipAuditor(st({ lastStepFailed: { node: "software_architect", error: "boom" } as MDDStateType["lastStepFailed"] })),
      true,
    );
  });
});
