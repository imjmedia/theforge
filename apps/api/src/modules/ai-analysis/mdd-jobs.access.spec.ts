/**
 * Acceso a jobs MDD por jobId: se resuelve el proyecto del job (`getJobAccessRef`) y se exige `read`.
 * Nunca 403: job ajeno, inexistente o con projectId distinto responden igual (404 "Job no encontrado").
 */
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ProjectAccessService } from "../../common/access/project-access.service.js";
import { requestUserStore } from "../../common/request-user.store.js";
import { AiAnalysisController } from "./ai-analysis.controller.js";

const PROJECTS = [
  { id: "p-a", userId: "user-a", visibility: "PRIVATE" },
  { id: "p-shared", userId: "user-a", visibility: "SHARED" },
];
const JOBS: Record<string, { projectId: string; userId: string | null }> = {
  "job-a": { projectId: "p-a", userId: "user-a" },
  "job-shared": { projectId: "p-shared", userId: "user-a" },
};

function makeController() {
  const prisma = {
    project: { findUnique: async (args: { where: { id: string } }) => PROJECTS.find((p) => p.id === args.where.id) ?? null },
    stage: { findFirst: async () => null },
  };
  const statusCalls: string[] = [];
  const mddQueue = {
    getJobAccessRef: async (jobId: string) => JOBS[jobId] ?? null,
    getJobStatus: async (jobId: string) => {
      statusCalls.push(jobId);
      const ref = JOBS[jobId];
      return ref
        ? { jobId, projectId: ref.projectId, mode: "manager", status: "completed", progress: 100 }
        : { jobId, mode: null, status: "unknown", progress: 0 };
    },
  };
  const mddJobEvents = {
    // eslint-disable-next-line require-yield
    tail: async function* () {
      return;
    },
  };
  const controller = new AiAnalysisController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    prisma as never,
    {} as never,
    mddQueue as never,
    {} as never,
    {} as never,
    mddJobEvents as never,
    new ProjectAccessService(prisma as never),
  );
  return { controller, statusCalls };
}

function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return requestUserStore.run({ userId, role: "developer" }, fn);
}

async function rejectsJobNotFound(p: Promise<unknown>) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof NotFoundException, `esperaba 404, llegó ${String(e)}`);
    assert.equal((e as NotFoundException).message, "Job no encontrado");
    return true;
  });
}

function fakeRes() {
  return Object.assign(new PassThrough(), { setHeader() {}, flushHeaders() {} });
}

describe("GET /ai-analysis/mdd/jobs/:jobId", () => {
  it("el dueño ve el estado", async () => {
    const { controller } = makeController();
    const status = await as("user-a", () => controller.getMddJobStatus("job-a"));
    assert.equal(status.status, "completed");
  });

  it("B contra el job de A (PRIVATE) => 404 y no toca getJobStatus", async () => {
    const { controller, statusCalls } = makeController();
    await rejectsJobNotFound(as("user-b", () => controller.getMddJobStatus("job-a")));
    assert.deepEqual(statusCalls, []);
  });

  it("B contra un job de proyecto SHARED de A => lectura permitida", async () => {
    const { controller } = makeController();
    const status = await as("user-b", () => controller.getMddJobStatus("job-shared"));
    assert.equal(status.projectId, "p-shared");
  });

  it("job inexistente (ref null) => 404", async () => {
    const { controller } = makeController();
    await rejectsJobNotFound(as("user-a", () => controller.getMddJobStatus("job-nope")));
  });
});

describe("GET /ai-analysis/mdd/jobs/:jobId/events", () => {
  it("B contra el job de A => 404 (nunca 403)", async () => {
    const { controller } = makeController();
    await rejectsJobNotFound(
      as("user-b", () => controller.streamMddJobEvents("job-a", "p-a", undefined, fakeRes() as never)),
    );
  });

  it("el dueño con su projectId abre el stream", async () => {
    const { controller } = makeController();
    const res = fakeRes();
    await as("user-a", () => controller.streamMddJobEvents("job-a", "p-a", undefined, res as never));
    await new Promise<void>((resolve) => {
      res.on("finish", resolve);
      res.resume();
    });
    assert.ok(res.writableFinished);
  });

  it("projectId de la query distinto al del job => 404 aunque el usuario sea dueño de ambos", async () => {
    const { controller } = makeController();
    await rejectsJobNotFound(
      as("user-a", () => controller.streamMddJobEvents("job-a", "p-shared", undefined, fakeRes() as never)),
    );
  });

  it("ref null => 404", async () => {
    const { controller } = makeController();
    await rejectsJobNotFound(
      as("user-a", () => controller.streamMddJobEvents("job-nope", "p-a", undefined, fakeRes() as never)),
    );
  });
});
