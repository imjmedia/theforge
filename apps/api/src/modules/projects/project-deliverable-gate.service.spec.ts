import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateDeliverablesGate } from "@theforge/shared-types";

describe("project-deliverable-gate (CL-22, P10)", () => {
  it("HIGH verde sin Spec → allowed=false", () => {
    const r = evaluateDeliverablesGate({
      profile: "HIGH",
      verdict: { status: "green", reasons: [] },
      hasSpec: false,
      hasBootstrap: true,
      legacyHasDoc: false,
      designFirstGateOk: false,
    });
    assert.equal(r.allowed, false);
    assert.ok(r.reasons.some((x) => /spec/i.test(x)));
  });

  it("flag apagado: blockers MDD independientes de deliverablesGate", () => {
    const dg = evaluateDeliverablesGate({
      profile: "HIGH",
      verdict: { status: "yellow", reasons: [] },
      hasSpec: true,
      hasBootstrap: true,
      legacyHasDoc: false,
      designFirstGateOk: false,
    });
    assert.equal(dg.allowed, false);
  });
});
