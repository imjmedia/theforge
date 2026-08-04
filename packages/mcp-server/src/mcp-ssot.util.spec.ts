import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrichStagesWithBundleMeta,
  pickPrimaryStageFromApi,
  resolveTasksSsotFromProjectApi,
} from "./mcp-ssot.util.js";

describe("mcp-ssot.util", () => {
  it("pickPrimaryStageFromApi prefers ACTIVE stage", () => {
    const picked = pickPrimaryStageFromApi([
      { ordinal: 2, workflowStatus: "PENDING" },
      { ordinal: 1, workflowStatus: "ACTIVE", tasksJson: { tasks: [{ id: "T-1" }] } },
    ]);
    assert.equal(picked?.ordinal, 1);
  });

  it("pickPrimaryStageFromApi prefers integration stage when baseline ACTIVE lacks Ariadne tasks", () => {
    const picked = pickPrimaryStageFromApi([
      {
        id: "stage-1",
        ordinal: 1,
        workflowStatus: "ACTIVE",
        tasksJson: { tasks: [{ id: "T-login" }] },
        legacyChangeState: {},
      },
      {
        id: "stage-9",
        ordinal: 9,
        workflowStatus: "DRAFT",
        tasksJson: { tasks: [{ id: "T-010" }] },
        legacyChangeState: {
          tasksSource: "ariadne_cursor_tasks_markdown",
        },
      },
    ]);
    assert.equal(picked?.ordinal, 9);
    assert.equal(picked?.id, "stage-9");
  });

  it("resolveTasksSsotFromProjectApi reads bundle version from snapshot", () => {
    const ssot = resolveTasksSsotFromProjectApi(
      { tasksContent: "# Tasks\n- [ ] T-001", tasksJson: null },
      {
        deliverableSnapshot: {
          capturedAt: "2026-07-20T00:00:00Z",
          bundleVersion: "2026-07-20T00:00:00Z#abc1",
        },
      },
    );
    assert.equal(ssot.deliverableBundleVersion, "2026-07-20T00:00:00Z#abc1");
    assert.equal(ssot.source, "tasksContent");
  });

  it("enrichStagesWithBundleMeta adds flat bundle fields", () => {
    const out = enrichStagesWithBundleMeta([
      {
        id: "s1",
        deliverableSnapshot: { capturedAt: "x", bundleVersion: "v1" },
      },
    ]) as Record<string, unknown>[];
    assert.equal(out[0]?.deliverableBundleVersion, "v1");
  });
});
