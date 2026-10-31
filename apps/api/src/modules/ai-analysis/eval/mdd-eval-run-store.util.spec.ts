import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { writeEvalResults } from "./mdd-eval-report.util.js";
import {
  MddEvalRunStore,
  buildMddEvalRunId,
  isSafeMddEvalId,
  metaFromSummary,
  type MddEvalRunMeta,
} from "./mdd-eval-run-store.util.js";
import { makeRecord, makeSummary, tempDir } from "./mdd-eval-web.test-fixtures.js";

function makeMeta(runId: string, overrides: Partial<MddEvalRunMeta> = {}): MddEvalRunMeta {
  return {
    runId,
    status: "queued",
    requestedByUserId: "user-1",
    groupId: "00000000-0000-4000-8000-000000000001",
    caseIds: ["caso-a", "caso-b"],
    concurrency: 2,
    keepProjects: true,
    timeoutMs: 60_000,
    startedAt: "2026-10-30T10:00:00.000Z",
    progress: { total: 2, done: 0, running: [] },
    ...overrides,
  };
}

describe("MddEvalRunStore run.json", () => {
  it("round trip: lo escrito es lo leído, y un estado posterior lo reemplaza", async () => {
    const store = new MddEvalRunStore(tempDir());
    const meta = makeMeta("20261030T100000Z-web");
    await store.writeMeta(meta);
    assert.deepEqual(store.readMeta(meta.runId), meta);
    const done: MddEvalRunMeta = {
      ...meta,
      status: "failed",
      finishedAt: "2026-10-30T10:01:00.000Z",
      error: "sin proveedor",
      progress: { total: 2, done: 1, running: ["caso-b"], lastMessage: "caso-b: x" },
    };
    await store.writeMeta(done);
    assert.deepEqual(store.readMeta(meta.runId), done);
  });

  it("run.json corrupto o ausente → undefined; ids inseguros se rechazan", async () => {
    const store = new MddEvalRunStore(tempDir());
    assert.equal(store.readMeta("no-existe"), undefined);
    mkdirSync(path.join(store.root, "corrupta"), { recursive: true });
    writeFileSync(path.join(store.root, "corrupta", "run.json"), "{no json");
    assert.equal(store.readMeta("corrupta"), undefined);
    assert.equal(store.readMeta("../etc"), undefined);
    assert.equal(isSafeMddEvalId("../x"), false);
    assert.equal(isSafeMddEvalId("a/b"), false);
    assert.equal(isSafeMddEvalId("20261030T100000Z-web"), true);
    assert.throws(() => store.runDir("../x"), /inválido/);
  });

  it("una corrida completada se reconstruye desde disco (run.json + summary + markdown)", async () => {
    const store = new MddEvalRunStore(tempDir());
    const runId = "20261030T100000Z-web";
    const summary = makeSummary(runId, [makeRecord("caso-a"), makeRecord("caso-b")]);
    await store.writeMeta(makeMeta(runId, { status: "completed", finishedAt: summary.finishedAt }));
    await writeEvalResults(summary, store.runDir(runId), new Map([["caso-a", "# MDD A"]]));
    const reloaded = new MddEvalRunStore(store.root);
    assert.equal(reloaded.readMeta(runId)?.status, "completed");
    const loaded = reloaded.readSummary(runId)!;
    assert.equal(loaded.cases.length, 2);
    assert.ok(reloaded.markdownPath(runId, loaded, "caso-a"));
    assert.equal(reloaded.markdownPath(runId, loaded, "caso-b"), undefined);
    assert.equal(reloaded.markdownPath(runId, loaded, "../caso-a"), undefined);
    assert.equal(reloaded.markdownPath(runId, loaded, "no-existe"), undefined);
  });

  it("listRunIds: solo carpetas, más recientes primero", async () => {
    const store = new MddEvalRunStore(tempDir());
    for (const id of ["20261029T100000Z-web", "20261031T100000Z-web", "20261030T100000Z-dry"]) {
      mkdirSync(path.join(store.root, id), { recursive: true });
    }
    writeFileSync(path.join(store.root, ".gitignore"), "*");
    assert.deepEqual(store.listRunIds(), ["20261031T100000Z-web", "20261030T100000Z-dry", "20261029T100000Z-web"]);
  });
});

describe("helpers", () => {
  it("buildMddEvalRunId evita colisiones", () => {
    const now = new Date("2026-10-30T10:00:00.123Z");
    assert.equal(buildMddEvalRunId(now, () => false), "20261030T100000Z-web");
    const taken = new Set(["20261030T100000Z-web", "20261030T100000Z-web-2"]);
    assert.equal(buildMddEvalRunId(now, (id) => taken.has(id)), "20261030T100000Z-web-3");
  });

  it("metaFromSummary deriva una corrida del CLI (sin run.json)", () => {
    const summary = makeSummary("20261030T100000Z", [makeRecord("caso-a")], {
      args: { mode: "real", concurrency: 3, keep: true },
    });
    const meta = metaFromSummary(summary);
    assert.equal(meta.status, "completed");
    assert.equal(meta.concurrency, 3);
    assert.equal(meta.keepProjects, true);
    assert.deepEqual(meta.caseIds, ["caso-a"]);
    assert.deepEqual(meta.progress, { total: 1, done: 1, running: [] });
  });
});
