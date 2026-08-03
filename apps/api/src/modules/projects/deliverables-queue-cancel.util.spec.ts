import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDeliverablesActiveCancel } from "./deliverables-queue-cancel.util.js";

describe("resolveDeliverablesActiveCancel", () => {
  it("force-fails orphan active jobs (no local worker, no lock)", async () => {
    let forced = 0;
    const outcome = await resolveDeliverablesActiveCancel({
      alreadyCancelling: false,
      locallyRunning: false,
      lockHeld: false,
      forceFail: async () => {
        forced += 1;
        return true;
      },
    });
    assert.equal(outcome, "cancelled");
    assert.equal(forced, 1);
  });

  it("returns cancelling on first request when worker holds lock", async () => {
    let forced = 0;
    const outcome = await resolveDeliverablesActiveCancel({
      alreadyCancelling: false,
      locallyRunning: false,
      lockHeld: true,
      forceFail: async () => {
        forced += 1;
        return true;
      },
    });
    assert.equal(outcome, "cancelling");
    assert.equal(forced, 0);
  });

  it("force-fails on second cancel while still active", async () => {
    let forced = 0;
    const outcome = await resolveDeliverablesActiveCancel({
      alreadyCancelling: true,
      locallyRunning: false,
      lockHeld: true,
      forceFail: async () => {
        forced += 1;
        return true;
      },
    });
    assert.equal(outcome, "cancelled");
    assert.equal(forced, 1);
  });

  it("stays cancelling when force-fail fails", async () => {
    const outcome = await resolveDeliverablesActiveCancel({
      alreadyCancelling: true,
      locallyRunning: true,
      lockHeld: true,
      forceFail: async () => false,
    });
    assert.equal(outcome, "cancelling");
  });
});
