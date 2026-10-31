/**
 * Servicio + controller del eval web con Prisma/AIFactory falsos y la cola en proceso real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PATH_METADATA } from "@nestjs/common/constants";
import { DEFAULT_PROJECT_GROUP_ID, MDD_EVAL_API_ROUTES } from "@theforge/shared-types";
import { requestUserStore } from "../../../common/request-user.store.js";
import { writeEvalResults } from "./mdd-eval-report.util.js";
import { MddEvalController } from "./mdd-eval.controller.js";
import { MddEvalQueueService } from "./mdd-eval-queue.service.js";
import { MddEvalRunStore } from "./mdd-eval-run-store.util.js";
import { MddEvalService } from "./mdd-eval.service.js";
import { makeFakeDeps, makeRecord, makeSummary, tempDir, waitFor, writeCasesDir } from "./mdd-eval-web.test-fixtures.js";
import type { MddEvalRunnerDeps } from "./mdd-eval-runner.js";

function setup(options: { groupExists?: boolean; runtimeError?: string; deps?: () => MddEvalRunnerDeps } = {}) {
  const store = new MddEvalRunStore(tempDir());
  const casesDir = writeCasesDir(["caso-a", "caso-b"]);
  const queue = new MddEvalQueueService({} as never, {} as never, {} as never);
  queue.store = store;
  queue.casesDir = casesDir;
  const fake = makeFakeDeps({ delayMs: 5 });
  queue.depsFactory = options.deps ?? (() => fake.deps);
  const runtimeCalls: string[] = [];
  const prisma = {
    projectGroup: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        options.groupExists === false ? null : { id: where.id },
    },
  };
  const aiFactory = {
    resolveRuntime: async (userId: string) => {
      runtimeCalls.push(userId);
      if (options.runtimeError) throw new Error(options.runtimeError);
      return {};
    },
  };
  const service = new MddEvalService(prisma as never, aiFactory as never, queue);
  service.store = store;
  service.casesDir = casesDir;
  const controller = new MddEvalController(service);
  const asAdmin = <T,>(fn: () => T, userId = "admin-1", role = "admin"): T =>
    requestUserStore.run({ userId, role }, fn);
  return { service, controller, queue, store, fake, runtimeCalls, asAdmin };
}

describe("MddEvalController", () => {
  it("rutas exactamente como MDD_EVAL_API_ROUTES y runs/compare declarado antes de runs/:runId", () => {
    const proto = MddEvalController.prototype as unknown as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");
    const pathsInOrder = names.map((n) => Reflect.getMetadata(PATH_METADATA, proto[n] as object) as string);
    assert.deepEqual(new Set(pathsInOrder), new Set(Object.values(MDD_EVAL_API_ROUTES)));
    assert.ok(
      pathsInOrder.indexOf(MDD_EVAL_API_ROUTES.compare) < pathsInOrder.indexOf(MDD_EVAL_API_ROUTES.run),
      `compare debe ir antes de run: ${pathsInOrder.join(", ")}`,
    );
    assert.equal(Reflect.getMetadata(PATH_METADATA, MddEvalController), "ai-analysis/eval/mdd");
  });

  it("cada handler exige rol admin", async () => {
    const { controller, asAdmin } = setup();
    const calls: Array<() => unknown> = [
      () => controller.listCases(),
      () => controller.getCase("caso-a"),
      () => controller.startRun({}),
      () => controller.listRuns(),
      () => controller.compare("a", "b"),
      () => controller.getRun("x"),
      () => controller.cancelRun("x"),
      () => controller.getCaseMarkdown("x", "y"),
    ];
    for (const call of calls) {
      await assert.rejects(Promise.resolve().then(() => asAdmin(call, "dev-1", "developer")), /Se requiere rol admin/);
    }
    assert.equal(asAdmin(() => controller.listCases(), "a", "admin").length, 2);
    assert.equal(asAdmin(() => controller.listCases(), "a", "super_admin").length, 2);
  });

  it("GET runs/compare resuelve a compare y no a un runId 'compare'", async () => {
    const { controller, store, asAdmin } = setup();
    for (const [id, total] of [["run-base", 70], ["run-target", 90]] as const) {
      const record = makeRecord("caso-a", { rubric: { ...makeRecord("x").rubric, total } });
      await writeEvalResults(makeSummary(id, [record]), store.runDir(id), new Map());
    }
    const dto = asAdmin(() => controller.compare("run-base", "run-target"));
    assert.equal(dto.baseRunId, "run-base");
    assert.equal(dto.rows[0].rubricDelta, 20);
    assert.throws(() => asAdmin(() => controller.compare(undefined, "run-target")), /base y target/);
    assert.throws(() => asAdmin(() => controller.compare("run-base", "nope")), /no tiene resultados/);
  });

  it("GET cases/:id devuelve 404 si el caso no existe", () => {
    const { controller, asAdmin } = setup();
    assert.equal(asAdmin(() => controller.getCase("caso-b")).id, "caso-b");
    assert.throws(() => asAdmin(() => controller.getCase("nope")), /no encontrado/);
  });
});

describe("MddEvalService.startRun", () => {
  it("valida el body con el schema compartido", async () => {
    const { service, asAdmin } = setup();
    await assert.rejects(asAdmin(() => service.startRun({ concurrency: 9 })), /Bad Request|concurrency/i);
    await assert.rejects(asAdmin(() => service.startRun({ groupId: "no-uuid" })), /Bad Request|groupId/i);
  });

  it("rechaza casos desconocidos y grupo inexistente", async () => {
    const a = setup();
    await assert.rejects(a.asAdmin(() => a.service.startRun({ caseIds: ["nope"] })), /Casos desconocidos: nope/);
    const b = setup({ groupExists: false });
    await assert.rejects(b.asAdmin(() => b.service.startRun({})), /grupo de proyectos .* no existe/);
  });

  it("valida el proveedor LLM del solicitante (AIFactory.resolveRuntime) con mensaje en español", async () => {
    const { service, runtimeCalls, asAdmin, store } = setup({ runtimeError: "sin proveedor activo" });
    await assert.rejects(
      asAdmin(() => service.startRun({}), "user-9"),
      /No tienes un proveedor de LLM configurado.*sin proveedor activo/s,
    );
    assert.deepEqual(runtimeCalls, ["user-9"]);
    assert.deepEqual(store.listRunIds(), [], "no se persiste ni encola nada si falla la validación");
  });

  it("encola con el solicitante, grupo por defecto y todos los casos; run.json queda escrito", async () => {
    const { service, runtimeCalls, asAdmin, store, queue } = setup();
    const dto = await asAdmin(() => service.startRun({}), "admin-5");
    assert.ok(["queued", "running"].includes(dto.status));
    assert.equal(dto.requestedByUserId, "admin-5");
    assert.equal(dto.groupId, DEFAULT_PROJECT_GROUP_ID);
    assert.deepEqual(dto.caseIds, ["caso-a", "caso-b"]);
    assert.equal(dto.concurrency, 1);
    assert.equal(dto.keepProjects, false);
    assert.deepEqual(runtimeCalls, ["admin-5"]);
    const meta = store.readMeta(dto.runId)!;
    assert.equal(meta.requestedByUserId, "admin-5");
    await waitFor(async () => (await queue.getLiveState(dto.runId))?.state === "completed");
  });

  it("flujo completo: completed con registros, markdown, listado y comparación", async () => {
    const { service, asAdmin, controller, store, queue } = setup();
    const first = await asAdmin(() => service.startRun({ caseIds: ["caso-b", "caso-a"], keepProjects: true }));
    assert.deepEqual(first.caseIds, ["caso-b", "caso-a"]);
    assert.equal(first.keepProjects, true);
    await waitFor(async () => (await queue.getLiveState(first.runId))?.state === "completed");

    const done = await service.getRun(first.runId);
    assert.equal(done.status, "completed");
    assert.deepEqual(done.records.map((r) => r.caseId), ["caso-a", "caso-b"]);
    assert.ok(done.records.every((r) => r.hasMarkdown));
    assert.equal(done.aggregates?.cases, 2);
    assert.deepEqual([done.progress.total, done.progress.done, done.progress.running], [2, 2, []]);

    const markdown = asAdmin(() => controller.getCaseMarkdown(first.runId, "caso-a"));
    assert.match(markdown, /^# MDD/);
    assert.throws(() => service.getCaseMarkdown(first.runId, "nope"), /no encontrado/);
    assert.throws(() => service.getCaseMarkdown(first.runId, "../summary"), /no encontrado/);

    // Una corrida anterior solo en disco (como las del CLI: sin run.json).
    await writeEvalResults(
      makeSummary("20200101T000000Z", [makeRecord("caso-a")], { startedAt: "2020-01-01T00:00:00.000Z", finishedAt: "2020-01-01T00:01:00.000Z" }),
      store.runDir("20200101T000000Z"),
      new Map([["caso-a", "# viejo"]]),
    );
    const old = await service.getRun("20200101T000000Z");
    assert.equal(old.status, "completed");
    assert.equal(old.records[0].hasMarkdown, true);
    assert.equal(old.requestedByUserId, "");

    const list = await service.listRuns();
    assert.deepEqual(list.map((r) => r.runId), [first.runId, "20200101T000000Z"]);

    const cmp = service.compare("20200101T000000Z", first.runId);
    assert.equal(cmp.rows.length, 2);

    await assert.rejects(service.getRun("no-existe"), /no encontrada/);
  });

  it("cancelRun: una corrida activa termina cancelled; una terminada se devuelve tal cual", async () => {
    const hang = makeFakeDeps({ hang: true });
    const { service, asAdmin, queue, store } = setup({ deps: () => hang.deps });
    const run = await asAdmin(() => service.startRun({ caseIds: ["caso-a"] }));
    await waitFor(() => hang.created.length === 1);
    assert.equal((await service.getRun(run.runId)).status, "running");

    const cancelling = await service.cancelRun(run.runId);
    assert.equal(cancelling.status, "cancelled");
    await waitFor(() => store.readMeta(run.runId)?.status === "cancelled");
    assert.equal((await service.getRun(run.runId)).status, "cancelled");
    assert.equal((await service.getRun(run.runId)).records.length, 0);
    assert.equal((await service.cancelRun(run.runId)).status, "cancelled");
    void queue;
  });

  it("cancelRun en espera la saca de la cola y deja run.json cancelled", async () => {
    const hang = makeFakeDeps({ hang: true });
    const { service, asAdmin, store } = setup({ deps: () => hang.deps });
    const first = await asAdmin(() => service.startRun({ caseIds: ["caso-a"] }));
    await waitFor(() => hang.created.length === 1);
    const second = await asAdmin(() => service.startRun({ caseIds: ["caso-b"] }));
    assert.equal((await service.getRun(second.runId)).status, "queued");
    const cancelled = await service.cancelRun(second.runId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(store.readMeta(second.runId)?.status, "cancelled");
    await service.cancelRun(first.runId);
    await waitFor(() => store.readMeta(first.runId)?.status === "cancelled");
  });

  it("una corrida queued/running en disco sin proceso vivo se reporta failed (interrumpida)", async () => {
    const { service, store } = setup();
    await store.writeMeta({
      runId: "20261030T090000Z-web",
      status: "running",
      requestedByUserId: "u",
      groupId: "g",
      caseIds: ["caso-a"],
      concurrency: 1,
      keepProjects: false,
      startedAt: "2026-10-30T09:00:00.000Z",
      progress: { total: 1, done: 0, running: ["caso-a"] },
    });
    const dto = await service.getRun("20261030T090000Z-web");
    assert.equal(dto.status, "failed");
    assert.match(dto.error ?? "", /interrumpi/);
  });
});
