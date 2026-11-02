import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MddQueueService } from "./mdd-queue.service.js";

type FakeJob = {
  data: Record<string, unknown>;
  attemptsMade: number;
  opts: { attempts: number };
  progress: number;
  failedReason?: string;
  timestamp: number;
  getState: () => Promise<string>;
};

function makeJob(state: string, overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    data: { projectId: "p1" },
    attemptsMade: 1,
    opts: { attempts: 2 },
    progress: 0,
    failedReason: "timeout",
    timestamp: 1,
    getState: async () => state,
    ...overrides,
  };
}

function makeService(job: FakeJob | null): MddQueueService {
  const svc = new MddQueueService({} as never, {} as never, {} as never, {} as never);
  (svc as unknown as { queue: unknown }).queue = { getJob: async () => job };
  return svc;
}

describe("MddQueueService.getJobStatus (estado BullMQ terminal)", () => {
  it("failed con attemptsMade < attempts se reporta failed y conserva error e intentos", async () => {
    const status = await makeService(makeJob("failed")).getJobStatus("j1");
    assert.equal(status.status, "failed");
    assert.equal(status.error, "timeout");
    assert.equal(status.attemptsMade, 1);
  });

  it("delayed (reintento real de BullMQ) se reporta retrying", async () => {
    const status = await makeService(makeJob("delayed")).getJobStatus("j1");
    assert.equal(status.status, "retrying");
  });

  it("waiting se reporta queued", async () => {
    const status = await makeService(makeJob("waiting", { attemptsMade: 0 })).getJobStatus("j1");
    assert.equal(status.status, "queued");
  });
});
