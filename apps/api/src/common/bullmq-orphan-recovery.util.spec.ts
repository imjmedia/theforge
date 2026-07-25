import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Job, Queue } from "bullmq";
import {
  BULLMQ_DELIVERABLES_ORPHAN_REASON,
  BULLMQ_WORKER_RESTARTED_REASON,
  forceFailBullMqActiveJob,
  isBullMqJobLockHeld,
  reconcileOrphanBullMqActiveJob,
  recoverBullMqJobsAfterWorkerRestart,
} from "./bullmq-orphan-recovery.util.js";

function mockJob(state: string, id = "50"): Job {
  let currentState = state;
  return {
    id,
    discard: async () => undefined,
    moveToFailed: async (_err: Error) => {
      currentState = "failed";
    },
    remove: async () => {
      currentState = "removed";
    },
    getState: async () => currentState,
  } as unknown as Job;
}

function mockQueue(jobsByState: Record<string, Job[]>, lockHeld = false): Queue {
  const deletedLocks: string[] = [];
  return {
    client: Promise.resolve({
      del: async (key: string) => {
        deletedLocks.push(key);
        return 1;
      },
      exists: async (key: string) => (lockHeld && key.endsWith(":lock") ? 1 : 0),
    }),
    toKey: (jobId: string) => `bull:test:${jobId}`,
    getJobs: async (states: string[]) => {
      const out: Job[] = [];
      for (const state of states) {
        out.push(...(jobsByState[state] ?? []));
      }
      return out;
    },
    _deletedLocks: deletedLocks,
  } as unknown as Queue & { _deletedLocks: string[] };
}

describe("forceFailBullMqActiveJob", () => {
  it("skips non-active jobs", async () => {
    const queue = mockQueue({});
    const job = mockJob("waiting");
    const ok = await forceFailBullMqActiveJob(queue, job, BULLMQ_WORKER_RESTARTED_REASON);
    assert.equal(ok, false);
  });

  it("deletes lock and fails active jobs", async () => {
    const queue = mockQueue({});
    const job = mockJob("active", "50");
    const ok = await forceFailBullMqActiveJob(queue, job, BULLMQ_WORKER_RESTARTED_REASON);
    assert.equal(ok, true);
    assert.deepEqual((queue as Queue & { _deletedLocks: string[] })._deletedLocks, [
      "bull:test:50:lock",
    ]);
  });
});

describe("recoverBullMqJobsAfterWorkerRestart", () => {
  it("fails active and removes queued jobs", async () => {
    const queue = mockQueue({
      active: [mockJob("active", "1")],
      waiting: [mockJob("waiting", "2")],
      delayed: [mockJob("delayed", "3")],
    });
    const result = await recoverBullMqJobsAfterWorkerRestart(queue);
    assert.equal(result.failedActive, 1);
    assert.equal(result.removedQueued, 2);
  });
});

describe("isBullMqJobLockHeld", () => {
  it("returns true when lock exists", async () => {
    const queue = mockQueue({}, true);
    assert.equal(await isBullMqJobLockHeld(queue, "218"), true);
  });

  it("returns false when lock is missing", async () => {
    const queue = mockQueue({});
    assert.equal(await isBullMqJobLockHeld(queue, "218"), false);
  });
});

describe("reconcileOrphanBullMqActiveJob", () => {
  it("skips when job runs locally", async () => {
    const queue = mockQueue({});
    const job = mockJob("active", "218");
    const result = await reconcileOrphanBullMqActiveJob(queue, job, {
      reason: BULLMQ_DELIVERABLES_ORPHAN_REASON,
      isLocallyRunning: (id) => id === "218",
    });
    assert.equal(result, "running");
  });

  it("skips when Redis lock is held", async () => {
    const queue = mockQueue({}, true);
    const job = mockJob("active", "218");
    const result = await reconcileOrphanBullMqActiveJob(queue, job, {
      reason: BULLMQ_DELIVERABLES_ORPHAN_REASON,
    });
    assert.equal(result, "running");
  });

  it("reconciles orphan active jobs without lock", async () => {
    const queue = mockQueue({});
    const job = mockJob("active", "218");
    const result = await reconcileOrphanBullMqActiveJob(queue, job, {
      reason: BULLMQ_DELIVERABLES_ORPHAN_REASON,
    });
    assert.equal(result, "reconciled");
  });
});
