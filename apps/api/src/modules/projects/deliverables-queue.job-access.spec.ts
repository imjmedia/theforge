import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestUserStore } from "../../common/request-user.store.js";
import { DeliverablesQueueService, type GenerateJobData } from "./deliverables-queue.service.js";

const JOB_ID_RE = /^deliv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type AddCall = { name: string; data: GenerateJobData; opts: { jobId?: string } | undefined };

function makeService(queue: unknown): DeliverablesQueueService {
  const guard = {
    assertCanEnqueue: async () => {},
    registerBackgroundJob: () => {},
  };
  const svc = new DeliverablesQueueService({} as never, guard as never, null, {} as never);
  const internals = svc as unknown as Record<string, unknown>;
  internals.queue = queue;
  internals.pumpInMemoryQueue = () => {};
  return svc;
}

function makeAddQueue(calls: AddCall[]) {
  return {
    add: async (name: string, data: GenerateJobData, opts?: { jobId?: string }) => {
      calls.push({ name, data, opts });
      return { id: opts?.jobId };
    },
  };
}

describe("DeliverablesQueueService.enqueue (jobId no adivinable)", () => {
  it("añade a BullMQ con jobId deliv-<uuid> y devuelve ese id", async () => {
    const calls: AddCall[] = [];
    const id = await makeService(makeAddQueue(calls)).enqueue({
      type: "user-stories",
      projectId: "p1",
      userId: "u1",
    });
    assert.match(id, JOB_ID_RE);
    assert.equal(calls[0].opts?.jobId, id);
    assert.equal(calls[0].data.userId, "u1");
    assert.equal(calls[0].data.projectId, "p1");
  });

  it("job.data lleva userId del contexto de la petición si el llamador no lo pasa", async () => {
    const calls: AddCall[] = [];
    const svc = makeService(makeAddQueue(calls));
    await requestUserStore.run({ userId: "u-req", role: "developer" }, () =>
      svc.enqueue({ type: "user-stories", projectId: "p9" }),
    );
    assert.equal(calls[0].data.userId, "u-req");
  });

  it("dos encolados generan ids distintos", async () => {
    const svc = makeService(makeAddQueue([]));
    const a = await svc.enqueue({ type: "user-stories", projectId: "p1", userId: "u1" });
    const b = await svc.enqueue({ type: "user-stories", projectId: "p1", userId: "u1" });
    assert.notEqual(a, b);
  });

  it("sin Redis (in-memory) el id también es deliv-<uuid>", async () => {
    const svc = makeService(null);
    const id = await svc.enqueue({ type: "user-stories", projectId: "p1", userId: "u1" });
    assert.match(id, JOB_ID_RE);
    assert.deepEqual(await svc.getJobAccessRef(id), { projectId: "p1", userId: "u1" });
  });
});

describe("DeliverablesQueueService.getJobAccessRef", () => {
  it("devuelve projectId y userId de job.data usando solo getJob", async () => {
    const getJobCalls: string[] = [];
    const job = {
      data: { projectId: "p1", userId: "u1", type: "user-stories" },
      getState: () => assert.fail("no debe consultar estado"),
      moveToFailed: () => assert.fail("no debe mutar"),
      remove: () => assert.fail("no debe mutar"),
    };
    const queue = {
      getJob: async (id: string) => {
        getJobCalls.push(id);
        return job;
      },
      getJobs: () => assert.fail("no debe listar jobs"),
      add: () => assert.fail("no debe encolar"),
    };
    const ref = await makeService(queue).getJobAccessRef("deliv-abc");
    assert.deepEqual(ref, { projectId: "p1", userId: "u1" });
    assert.deepEqual(getJobCalls, ["deliv-abc"]);
  });

  it("job inexistente devuelve null", async () => {
    const ref = await makeService({ getJob: async () => undefined }).getJobAccessRef("deliv-nope");
    assert.equal(ref, null);
  });

  it("job antiguo sin userId en data devuelve userId null", async () => {
    const queue = { getJob: async () => ({ data: { projectId: "p1", type: "user-stories" } }) };
    const ref = await makeService(queue).getJobAccessRef("7");
    assert.deepEqual(ref, { projectId: "p1", userId: null });
  });

  it("jobId vacío o no string devuelve null sin tocar la cola", async () => {
    const queue = { getJob: async () => assert.fail("no debe llamar a getJob") };
    const svc = makeService(queue);
    assert.equal(await svc.getJobAccessRef(""), null);
    assert.equal(await svc.getJobAccessRef(undefined as never), null);
    assert.equal(await svc.getJobAccessRef(42 as never), null);
  });

  it("sin cola ni job en memoria devuelve null", async () => {
    assert.equal(await makeService(null).getJobAccessRef("deliv-x"), null);
  });
});
