import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@theforge/database";
import {
  buildProjectClearMddDependentDeliverablesUpdate,
  buildStageClearMddDependentDeliverablesUpdate,
} from "./clear-mdd-dependent-deliverables.util.js";
import {
  MDD_DEPENDENT_DELIVERABLE_KEYS,
  MDD_DEPENDENT_PROJECT_ONLY_KEYS,
  MDD_DEPENDENT_STAGE_DELIVERABLE_KEYS,
} from "@theforge/shared-types";

describe("clear-mdd-dependent-deliverables.util", () => {
  it("buildProjectClearMddDependentDeliverablesUpdate nulls all MDD-dependent fields and tasksJson", () => {
    const payload = buildProjectClearMddDependentDeliverablesUpdate();
    for (const key of MDD_DEPENDENT_DELIVERABLE_KEYS) {
      assert.equal(payload[key], null);
    }
    assert.equal(payload.tasksJson, Prisma.JsonNull);
    assert.equal(Object.keys(payload).length, MDD_DEPENDENT_DELIVERABLE_KEYS.length + 1);
  });

  it("buildStageClearMddDependentDeliverablesUpdate clears snapshot and pendingCascadeDelta", () => {
    const payload = buildStageClearMddDependentDeliverablesUpdate({
      pendingCascadeDelta: { affectedDeliverables: ["spec"] },
      other: "keep",
    });
    assert.equal(payload.changeSpecContent, null);
    assert.ok(payload.deliverableSnapshot);
    assert.deepEqual(payload.shortTermContext, {
      other: "keep",
      pendingCascadeDelta: null,
    });
    assert.equal(payload.specContent, null);
    assert.equal(payload.tasksJson, Prisma.JsonNull);
    for (const key of MDD_DEPENDENT_STAGE_DELIVERABLE_KEYS) {
      assert.equal(payload[key], null);
    }
    for (const key of MDD_DEPENDENT_PROJECT_ONLY_KEYS) {
      assert.equal(payload[key as keyof typeof payload], undefined);
    }
  });
});
