import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveMddUpstreamSyncStatus,
  isMddUpstreamRegenerationBusy,
  type MddUpstreamSyncStatus,
} from "./project-generation-guard.js";

describe("mdd upstream sync banner visibility", () => {
  const pendingSync: MddUpstreamSyncStatus = {
    pendingSync: true,
    canSync: true,
    changedSources: ["benchmark"],
    recommendedSections: [1, 2],
    expandedSections: [1, 2, 3, 4, 7],
    needsFullRegen: false,
    hasBaseline: true,
    changes: [],
  };

  it("isMddUpstreamRegenerationBusy detecta pipeline activo", () => {
    assert.equal(
      isMddUpstreamRegenerationBusy({
        mddJobs: [{ jobId: "1", mode: "pipeline", status: "active" }],
      }),
      true,
    );
    assert.equal(
      isMddUpstreamRegenerationBusy({
        mddJobs: [{ jobId: "1", mode: "section", status: "active" }],
      }),
      false,
    );
  });

  it("effectiveMddUpstreamSyncStatus oculta pendingSync durante pipeline", () => {
    const effective = effectiveMddUpstreamSyncStatus(pendingSync, {
      mddJobs: [{ jobId: "157", mode: "pipeline", status: "active" }],
    });
    assert.equal(effective?.pendingSync, false);
  });

  it("effectiveMddUpstreamSyncStatus conserva pendingSync sin job MDD", () => {
    const effective = effectiveMddUpstreamSyncStatus(pendingSync, { mddJobs: [] });
    assert.equal(effective?.pendingSync, true);
  });
});
