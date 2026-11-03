import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestUserStore } from "../../../common/request-user.store.js";
import { MddQueueService, type MddJobData } from "./mdd-queue.service.js";

const JOB_ID_RE = /^mdd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type AddCall = { name: string; data: MddJobData; opts: Record<string, unknown> | undefined };

function makeService(queue: unknown): MddQueueService {
  const svc = new MddQueueService({} as never, {} as never, {} as never, {} as never);
  const internals = svc as unknown as Record<string, unknown>;
  internals.queue = queue;
  // Guardas de encolado fuera del alcance de este spec.
  internals.preemptActiveMddJobsForProject = async () => {};
  internals.reapOrphanActiveMddJobsForProject = async () => {};
  internals.assertCanEnqueue = async () => {};
  internals.cancelQueuedSiblingsForProject = async () => {};
  return svc;
}

describe("MddQueueService.enqueue (jobId no adivinable)", () => {
  it("añade a BullMQ con jobId mdd-<uuid> y devuelve ese id", async () => {
    const calls: AddCall[] = [];
    const queue = {
      add: async (name: string, data: MddJobData, opts?: Record<string, unknown>) => {
        calls.push({ name, data, opts });
        return { id: String(opts?.jobId) };
      },
    };
    const id = await makeService(queue).enqueue({ mode: "section-pipeline", projectId: "p1", userId: "u1" });
    assert.match(id, JOB_ID_RE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts?.jobId, id);
  });

  it("el turno de chat conserva attempts: 1 junto al jobId", async () => {
    const calls: AddCall[] = [];
    const queue = {
      add: async (name: string, data: MddJobData, opts?: Record<string, unknown>) => {
        calls.push({ name, data, opts });
        return { id: String(opts?.jobId) };
      },
    };
    const id = await makeService(queue).enqueue({ mode: "manager", projectId: "p1", userId: "u1" });
    assert.match(id, JOB_ID_RE);
    assert.equal(calls[0].opts?.attempts, 1);
    assert.equal(calls[0].opts?.jobId, id);
  });

  it("job.data lleva userId del contexto de la petición si el llamador no lo pasa", async () => {
    const calls: AddCall[] = [];
    const queue = {
      add: async (name: string, data: MddJobData, opts?: Record<string, unknown>) => {
        calls.push({ name, data, opts });
        return { id: String(opts?.jobId) };
      },
    };
    const svc = makeService(queue);
    await requestUserStore.run({ userId: "u-req", role: "developer" }, () =>
      svc.enqueue({ mode: "section-pipeline", projectId: "p9" }),
    );
    assert.equal(calls[0].data.userId, "u-req");
    assert.equal(calls[0].data.projectId, "p9");
  });

  it("dos encolados generan ids distintos", async () => {
    const queue = { add: async (_n: string, _d: unknown, opts?: { jobId?: string }) => ({ id: opts?.jobId }) };
    const svc = makeService(queue);
    const a = await svc.enqueue({ mode: "section-pipeline", projectId: "p1", userId: "u1" });
    const b = await svc.enqueue({ mode: "section-pipeline", projectId: "p1", userId: "u1" });
    assert.notEqual(a, b);
  });

  it("sin Redis (in-memory) el id también es mdd-<uuid>", async () => {
    const svc = makeService(null);
    (svc as unknown as Record<string, unknown>).pumpInMemoryQueue = () => {};
    const id = await svc.enqueue({ mode: "section-pipeline", projectId: "p1", userId: "u1" });
    assert.match(id, JOB_ID_RE);
    assert.deepEqual(await svc.getJobAccessRef(id), { projectId: "p1", userId: "u1" });
  });
});

describe("MddQueueService.getJobAccessRef", () => {
  it("devuelve projectId y userId de job.data usando solo getJob", async () => {
    const getJobCalls: string[] = [];
    const job = {
      data: { projectId: "p1", userId: "u1", mode: "section-pipeline" },
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
    const ref = await makeService(queue).getJobAccessRef("mdd-abc");
    assert.deepEqual(ref, { projectId: "p1", userId: "u1" });
    assert.deepEqual(getJobCalls, ["mdd-abc"]);
  });

  it("job inexistente devuelve null", async () => {
    const ref = await makeService({ getJob: async () => undefined }).getJobAccessRef("mdd-nope");
    assert.equal(ref, null);
  });

  it("job antiguo sin userId en data devuelve userId null", async () => {
    const queue = { getJob: async () => ({ data: { projectId: "p1", mode: "section-pipeline" } }) };
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
    assert.equal(await makeService(null).getJobAccessRef("mdd-x"), null);
  });
});
