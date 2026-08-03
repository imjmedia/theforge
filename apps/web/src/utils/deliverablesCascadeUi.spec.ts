import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeDeliverablesGenerationJob,
  isDeliverablesCascadeUiActive,
  loadingReasonForDeliverablesJobType,
} from "./deliverablesCascadeUi.js";

describe("deliverablesCascadeUi", () => {
  it("detects active cascade job from generation-status", () => {
    const job = activeDeliverablesGenerationJob({
      busy: true,
      mddStreamActive: false,
      mddJobs: [],
      activeJob: { jobId: "j1", type: "cascade", status: "active" },
      queuedJobs: [],
      gates: {},
    });
    assert.equal(job?.jobId, "j1");
  });

  it("isDeliverablesCascadeUiActive when server job exists without local loading", () => {
    assert.equal(
      isDeliverablesCascadeUiActive({
        loading: false,
        loadingReason: null,
        generationStatus: {
          busy: true,
          mddStreamActive: false,
          mddJobs: [],
          activeJob: { jobId: "j1", type: "cascade", status: "active" },
          queuedJobs: [],
          gates: {},
        },
      }),
      true,
    );
  });

  it("maps repair job type to repair loading reason", () => {
    assert.equal(loadingReasonForDeliverablesJobType("repair-sdd-gaps"), "repair-sdd-gaps");
    assert.equal(loadingReasonForDeliverablesJobType("cascade-delta"), "deliverables-cascade");
  });
});
