import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { MddEvalRunProgressDto } from "@theforge/shared-types";
import { MDD_EVAL_CANCELLED_MESSAGE, executeMddEvalRun } from "./mdd-eval-run.executor.js";
import { MddEvalRunStore, type MddEvalRunMeta } from "./mdd-eval-run-store.util.js";
import { makeEvalCase, makeFakeDeps, makeSummary, makeRecord, tempDir, waitFor } from "./mdd-eval-web.test-fixtures.js";

function makeMeta(runId: string, caseIds: string[], overrides: Partial<MddEvalRunMeta> = {}): MddEvalRunMeta {
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

describe("executeMddEvalRun", () => {
  it("completa: escribe summary + markdown + run.json y reporta progreso por caso", async () => {
    const store = new MddEvalRunStore(tempDir());
    const cases = [makeEvalCase("caso-a"), makeEvalCase("caso-b")];
    const { deps, deleted } = makeFakeDeps();
    const progress: MddEvalRunProgressDto[] = [];
    const outcome = await executeMddEvalRun({
      meta: makeMeta("run-ok", ["caso-a", "caso-b"]),
      cases,
      store,
      deps,
      signal: new AbortController().signal,
      onProgress: (p) => void progress.push(p),
    });
    assert.equal(outcome.status, "completed");
    const meta = store.readMeta("run-ok")!;
    assert.equal(meta.status, "completed");
    assert.ok(meta.finishedAt);
    assert.deepEqual(meta.progress, { total: 2, done: 2, running: [], lastMessage: "caso-b: aprobado" });
    const summary = store.readSummary("run-ok")!;
    assert.deepEqual(summary.cases.map((c) => c.caseId), ["caso-a", "caso-b"]);
    assert.equal(summary.args.source, "web");
    assert.ok(existsSync(path.join(store.root, "run-ok", "caso-a.md")));
    assert.deepEqual(deleted.sort(), ["p-caso-a", "p-caso-b"]);
    assert.ok(progress.some((p) => p.running.includes("caso-a")), "reporta el caso en curso");
    assert.ok(progress.some((p) => p.done === 1), "reporta el avance tras el primer caso");
    assert.equal(progress.at(-1)!.done, 2);
  });

  it("propaga el mensaje de progreso del pipeline como lastMessage", async () => {
    const store = new MddEvalRunStore(tempDir());
    const { deps } = makeFakeDeps({ delayMs: 5 });
    const messages: string[] = [];
    await executeMddEvalRun({
      meta: makeMeta("run-msg", ["caso-a"]),
      cases: [makeEvalCase("caso-a")],
      store,
      deps,
      signal: new AbortController().signal,
      onProgress: (p) => {
        if (p.lastMessage) messages.push(p.lastMessage);
      },
      now: (() => {
        let t = 0;
        return () => (t += 2000);
      })(),
    });
    assert.ok(messages.includes("caso-a: planificando"), messages.join(" | "));
  });

  it("cancelación: aborta casos en vuelo, limpia proyectos y deja status cancelled sin summary", async () => {
    const store = new MddEvalRunStore(tempDir());
    const controller = new AbortController();
    const { deps, deleted, created } = makeFakeDeps({ hang: true });
    const promise = executeMddEvalRun({
      meta: makeMeta("run-cancel", ["caso-a", "caso-b"]),
      cases: [makeEvalCase("caso-a"), makeEvalCase("caso-b")],
      store,
      deps,
      signal: controller.signal,
    });
    await waitFor(() => created.length === 1);
    controller.abort();
    const outcome = await promise;
    assert.equal(outcome.status, "cancelled");
    const meta = store.readMeta("run-cancel")!;
    assert.equal(meta.status, "cancelled");
    assert.ok(meta.finishedAt);
    assert.equal(store.readSummary("run-cancel"), undefined);
    assert.deepEqual(deleted, ["p-caso-a"]);
    assert.equal(created.length, 1, "el caso pendiente no llegó a crear su proyecto");
    assert.ok(MDD_EVAL_CANCELLED_MESSAGE.length > 0);
  });

  it("fallo del runner → failed con el mensaje, sin lanzar", async () => {
    const store = new MddEvalRunStore(tempDir());
    const { deps } = makeFakeDeps();
    const outcome = await executeMddEvalRun({
      meta: makeMeta("run-fail", ["caso-a"]),
      cases: [makeEvalCase("caso-a")],
      store,
      deps,
      signal: new AbortController().signal,
      runSuite: async () => {
        throw new Error("disco lleno");
      },
    });
    assert.deepEqual(outcome, { status: "failed", error: "disco lleno" });
    const meta = store.readMeta("run-fail")!;
    assert.equal(meta.status, "failed");
    assert.equal(meta.error, "disco lleno");
  });

  it("usa el runSuite inyectado con concurrencia y keep de la meta", async () => {
    const store = new MddEvalRunStore(tempDir());
    const { deps } = makeFakeDeps();
    let seen: { concurrency: number; keep?: boolean; timeoutMs: number; runId: string } | undefined;
    const outcome = await executeMddEvalRun({
      meta: makeMeta("run-opts", ["caso-a"], { concurrency: 3, keepProjects: true, timeoutMs: 90_000 }),
      cases: [makeEvalCase("caso-a")],
      store,
      deps,
      signal: new AbortController().signal,
      runSuite: async (_d, _c, opts) => {
        seen = opts;
        return makeSummary("run-opts", [makeRecord("caso-a")]);
      },
    });
    assert.equal(outcome.status, "completed");
    assert.deepEqual(
      [seen?.concurrency, seen?.keep, seen?.timeoutMs, seen?.runId],
      [3, true, 90_000, "run-opts"],
    );
  });
});
