/**
 * Fallback en proceso (sin REDIS_URL) de la cola del eval: ejecuta una suite falsa con las mismas
 * rutas que el worker (executeMddEvalRun, run.json, cancelación) sin Nest, Redis ni LLM.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestUserStore } from "../../../common/request-user.store.js";
import { MddEvalQueueService } from "./mdd-eval-queue.service.js";
import { MddEvalRunStore, type MddEvalRunMeta } from "./mdd-eval-run-store.util.js";
import { makeFakeDeps, makeRecord, makeSummary, tempDir, waitFor, writeCasesDir } from "./mdd-eval-web.test-fixtures.js";
import type { MddEvalRunnerDeps } from "./mdd-eval-runner.js";

function makeQueue(deps: () => MddEvalRunnerDeps, caseIds = ["caso-a", "caso-b"]) {
  const queue = new MddEvalQueueService({} as never, {} as never, {} as never);
  queue.store = new MddEvalRunStore(tempDir());
  queue.casesDir = writeCasesDir(caseIds);
  queue.depsFactory = deps;
  return queue;
}

function meta(runId: string, caseIds: string[], overrides: Partial<MddEvalRunMeta> = {}): MddEvalRunMeta {
  return {
    runId,
    status: "queued",
    requestedByUserId: "user-1",
    groupId: "group-1",
    caseIds,
    concurrency: 1,
    keepProjects: false,
    startedAt: "2026-10-30T10:00:00.000Z",
    progress: { total: caseIds.length, done: 0, running: [] },
    ...overrides,
  };
}

describe("MddEvalQueueService sin Redis (en proceso)", () => {
  it("no usa Redis y ejecuta la suite falsa de punta a punta", async () => {
    const { deps, deleted } = makeFakeDeps({ delayMs: 5 });
    const queue = makeQueue(() => deps);
    assert.equal(queue.usesRedis(), false);
    const m = meta("run-1", ["caso-a", "caso-b"]);
    await queue.store.writeMeta(m);
    await queue.enqueue(m);
    assert.ok(["waiting", "active"].includes((await queue.getLiveState("run-1"))!.state));

    await waitFor(async () => (await queue.getLiveState("run-1"))?.state === "completed");
    const live = (await queue.getLiveState("run-1"))!;
    assert.equal(live.cancelled, false);
    assert.equal(queue.store.readMeta("run-1")?.status, "completed");
    assert.equal(queue.store.readSummary("run-1")?.cases.length, 2);
    assert.deepEqual(deleted.sort(), ["p-caso-a", "p-caso-b"]);
    assert.equal(live.progress?.done, 2);
  });

  it("usa el usuario solicitante como contexto de la ejecución", async () => {
    const { deps } = makeFakeDeps();
    let seenUser: string | undefined;
    const queue = makeQueue(() => ({
      ...deps,
      async createTempProject(evalCase) {
        seenUser = requestUserStore.getStore()?.userId;
        return deps.createTempProject(evalCase);
      },
    }));
    const m = meta("run-user", ["caso-a"], { requestedByUserId: "admin-7" });
    await queue.store.writeMeta(m);
    await queue.enqueue(m);
    await waitFor(async () => (await queue.getLiveState("run-user"))?.state === "completed");
    assert.equal(seenUser, "admin-7");
  });

  it("ejecuta en serie: la segunda corrida espera a la primera y se puede cancelar en espera", async () => {
    const hang = makeFakeDeps({ hang: true });
    const queue = makeQueue(() => hang.deps);
    for (const id of ["run-a", "run-b"]) {
      const m = meta(id, ["caso-a"]);
      await queue.store.writeMeta(m);
      await queue.enqueue(m);
    }
    await waitFor(() => hang.created.length === 1);
    assert.equal((await queue.getLiveState("run-a"))!.state, "active");
    assert.equal((await queue.getLiveState("run-b"))!.state, "waiting");

    assert.equal(await queue.cancel("run-b"), "cancelled");
    assert.equal((await queue.getLiveState("run-b"))!.cancelled, true);

    assert.equal(await queue.cancel("run-a"), "cancelling");
    await waitFor(() => queue.store.readMeta("run-a")?.status === "cancelled");
    const a = (await queue.getLiveState("run-a"))!;
    assert.equal(a.cancelled, true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(hang.created.length, 1, "la corrida cancelada en espera nunca se ejecutó");
    assert.equal(queue.store.readSummary("run-a"), undefined);
    assert.equal(await queue.cancel("run-a"), "not-active");
  });

  it("un fallo de ejecución deja la corrida en failed con el error", async () => {
    const { deps } = makeFakeDeps();
    const queue = makeQueue(() => deps);
    const m = meta("run-bad", ["caso-inexistente"]);
    await queue.store.writeMeta(m);
    await queue.enqueue(m);
    await waitFor(async () => (await queue.getLiveState("run-bad"))?.state === "failed");
    const live = (await queue.getLiveState("run-bad"))!;
    assert.match(live.error ?? "", /caso desconocido: caso-inexistente/);
  });

  it("runSuite inyectado (suite falsa) también se respeta", async () => {
    const { deps } = makeFakeDeps();
    const queue = makeQueue(() => deps);
    queue.runSuiteFn = async () => makeSummary("run-fake", [makeRecord("caso-a")]);
    const m = meta("run-fake", ["caso-a"]);
    await queue.store.writeMeta(m);
    await queue.enqueue(m);
    await waitFor(async () => (await queue.getLiveState("run-fake"))?.state === "completed");
    assert.equal(queue.store.readSummary("run-fake")?.cases[0].caseId, "caso-a");
  });

  it("getLiveState devuelve null para corridas desconocidas", async () => {
    const queue = makeQueue(() => makeFakeDeps().deps);
    assert.equal(await queue.getLiveState("nada"), null);
    assert.deepEqual(await queue.listLive(), []);
  });
});
