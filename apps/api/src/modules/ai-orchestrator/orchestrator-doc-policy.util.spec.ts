import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  orchestratorTabAllowsDocPersist,
  stripFrozenDeliverableFromDonePayload,
} from "./orchestrator-doc-policy.util.js";

describe("orchestrator-doc-policy.util", () => {
  it("bloquea persist en entregables congelados", () => {
    assert.equal(orchestratorTabAllowsDocPersist("spec"), false);
    assert.equal(orchestratorTabAllowsDocPersist("blueprint"), false);
    assert.equal(orchestratorTabAllowsDocPersist("ux-ui-guide"), true);
    assert.equal(orchestratorTabAllowsDocPersist("mdd"), true);
  });

  it("stripFrozenDeliverableFromDonePayload limpia campos de persist", () => {
    const out = stripFrozenDeliverableFromDonePayload("spec", {
      specContent: "# Spec",
      documentPersisted: true,
      session: {},
    });
    assert.equal(out.specContent, undefined);
    assert.equal(out.documentPersisted, false);
  });
});
