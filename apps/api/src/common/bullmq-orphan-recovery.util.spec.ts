import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Job, Queue } from "bullmq";
import {
  BULLMQ_WORKER_RESTARTED_REASON,
  forceFailBullMqActiveJob,
  recoverBullMqJobsAfterWorkerRestart,
} from "./bullmq-orphan-recovery.util.js";

function mockJob(state: string, id = "50"): Job {
  let currentState = state;
  return {
    id,
    discard: async () => undefined,
    moveToFailed: async (err: Error) => {
      assert.equal(err.message, BULLMQ_WORKER_RESTARTED_REASON);
      currentState = "failed";
    },
    remove: async () => {
      currentState = "removed";
    },
    getState: async () => currentState,
  } as unknown as Job;
}

function mockQueue(jobsByState: Record<string, Job[]>): Queue {
  const deletedLocks: string[] = [];
  return {
    client: Promise.resolve({
      del: async (key: string) => {
        deletedLocks.push(key);
        return 1;
      },
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
