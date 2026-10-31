import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MDD_EVAL_INTERRUPTED_ERROR,
  buildMddEvalCompareDto,
  buildMddEvalRunDto,
  deriveMddEvalRunStatus,
  toCaseDetailDto,
  toCaseSummaryDto,
  toRunRecordDto,
} from "./mdd-eval-dto.util.js";
import { metaFromSummary } from "./mdd-eval-run-store.util.js";
import { makeEvalCase, makeRecord, makeSummary } from "./mdd-eval-web.test-fixtures.js";

describe("toCaseSummaryDto / toCaseDetailDto", () => {
  it("recorta el brief, expone umbrales y banderas dbga/brd", () => {
    const long = makeEvalCase("caso-largo", { brief: "x".repeat(500), dbga: "DBGA", thresholds: { minRubric: 70, minAuditor: 60 } });
    const dto = toCaseSummaryDto(long);
    assert.equal(dto.briefPreview.length, 201);
    assert.ok(dto.briefPreview.endsWith("…"));
    assert.equal(dto.minRubric, 70);
    assert.equal(dto.minAuditor, 60);
    assert.equal(dto.hasDbga, true);
    assert.equal(dto.hasBrd, false);
    const detail = toCaseDetailDto(long);
    assert.equal(detail.brief.length, 500);
    assert.equal(detail.dbga, "DBGA");
    assert.equal("brd" in detail, false);
    assert.deepEqual(detail.expect.capabilities[0], { name: "Catálogo", endpointHints: ["/products"] });
  });
});

describe("toRunRecordDto", () => {
  it("mapea métricas, hasMarkdown y solo expone projectId con keepProjects", () => {
    const record = makeRecord("caso-a", { auditTrail: ["harness: proyecto temporal conservado 11111111-2222-3333-4444-555555555555"] });
    const kept = toRunRecordDto(record, { hasMarkdown: true, keepProjects: true });
    assert.equal(kept.projectId, "11111111-2222-3333-4444-555555555555");
    assert.equal(kept.hasMarkdown, true);
    assert.equal(kept.auditorScore, 90);
    assert.equal(kept.rubric.dimensions[0].key, "structure");
    const notKept = toRunRecordDto(record, { hasMarkdown: false, keepProjects: false });
    assert.equal("projectId" in notKept, false);
    assert.equal(notKept.hasMarkdown, false);
  });

  it("omite los campos opcionales ausentes", () => {
    const record = makeRecord("caso-b", { auditorScore: undefined, llmCalls: undefined, costUsd: undefined, passed: false, error: "timeout" });
    const dto = toRunRecordDto(record, { hasMarkdown: false, keepProjects: false });
    assert.equal("auditorScore" in dto, false);
    assert.equal("llmCalls" in dto, false);
    assert.equal(dto.error, "timeout");
    assert.equal(dto.passed, false);
  });
});

describe("buildMddEvalRunDto desde un summary", () => {
  const summary = makeSummary("20261030T100000Z-web", [makeRecord("caso-a"), makeRecord("caso-b", { passed: false })]);
  const meta = {
    ...metaFromSummary(summary),
    requestedByUserId: "user-1",
    groupId: "group-1",
    keepProjects: false,
  };

  it("completed: registros, agregados, progreso lleno y gitSha", () => {
    const dto = buildMddEvalRunDto({
      meta,
      status: "completed",
      summary,
      hasMarkdown: (_record, key) => key === "caso-a",
    });
    assert.equal(dto.status, "completed");
    assert.equal(dto.runId, "20261030T100000Z-web");
    assert.equal(dto.requestedByUserId, "user-1");
    assert.deepEqual(dto.caseIds, ["caso-a", "caso-b"]);
    assert.deepEqual(dto.progress, { total: 2, done: 2, running: [] });
    assert.deepEqual(dto.records.map((r) => r.hasMarkdown), [true, false]);
    assert.equal(dto.aggregates?.cases, 2);
    assert.equal(dto.aggregates?.passed, 1);
    assert.equal(dto.gitSha, "abc1234");
    assert.equal(dto.finishedAt, "2026-10-30T10:05:00.000Z");
    assert.equal(dto.error, undefined);
  });

  it("queued: sin registros ni agregados, usa el progreso vivo y no expone finishedAt", () => {
    const dto = buildMddEvalRunDto({
      meta: { ...meta, status: "queued", finishedAt: undefined, progress: { total: 2, done: 0, running: [] } },
      status: "queued",
      hasMarkdown: () => false,
    });
    assert.deepEqual(dto.records, []);
    assert.equal(dto.aggregates, undefined);
    assert.equal(dto.finishedAt, undefined);
    assert.deepEqual(dto.progress, { total: 2, done: 0, running: [] });
  });

  it("running: toma el progreso proporcionado", () => {
    const dto = buildMddEvalRunDto({
      meta: { ...meta, status: "running" },
      status: "running",
      progress: { total: 2, done: 1, running: ["caso-b"], lastMessage: "caso-b: schema" },
      hasMarkdown: () => false,
    });
    assert.deepEqual(dto.progress.running, ["caso-b"]);
    assert.equal(dto.progress.lastMessage, "caso-b: schema");
  });
});

describe("deriveMddEvalRunStatus", () => {
  const base = { hasSummary: false };

  it("estados de la cola", () => {
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "queued", live: { state: "waiting" } }).status, "queued");
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "queued", live: { state: "active" } }).status, "running");
    assert.equal(deriveMddEvalRunStatus({ hasSummary: true, metaStatus: "running", live: { state: "completed" } }).status, "completed");
  });

  it("job failed incluye el error de la cola (o el del run.json si existe)", () => {
    const fromQueue = deriveMddEvalRunStatus({ ...base, metaStatus: "running", live: { state: "failed", error: "job stalled" } });
    assert.deepEqual(fromQueue, { status: "failed", error: "job stalled" });
    const fromMeta = deriveMddEvalRunStatus({ ...base, metaStatus: "failed", metaError: "sin proveedor", live: { state: "failed", error: "x" } });
    assert.equal(fromMeta.error, "sin proveedor");
  });

  it("cancelada gana sobre el estado vivo (flag de cola o run.json)", () => {
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "running", live: { state: "active", cancelled: true } }).status, "cancelled");
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "cancelled", live: null }).status, "cancelled");
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "cancelled", live: { state: "waiting" } }).status, "cancelled");
  });

  it("solo disco: terminales tal cual; queued/running sin proceso → completed con summary, failed sin él", () => {
    assert.equal(deriveMddEvalRunStatus({ hasSummary: true, metaStatus: "completed", live: null }).status, "completed");
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "failed", live: null, metaError: "boom" }).error, "boom");
    assert.equal(deriveMddEvalRunStatus({ hasSummary: true, metaStatus: "running", live: null }).status, "completed");
    const orphan = deriveMddEvalRunStatus({ ...base, metaStatus: "running", live: null });
    assert.deepEqual(orphan, { status: "failed", error: MDD_EVAL_INTERRUPTED_ERROR });
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "queued", live: null }).status, "failed");
  });

  it("con la cola inaccesible se confía en run.json", () => {
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "running", live: null, liveUnavailable: true }).status, "running");
    assert.equal(deriveMddEvalRunStatus({ ...base, metaStatus: "queued", live: null, liveUnavailable: true }).status, "queued");
  });
});

describe("buildMddEvalCompareDto", () => {
  it("emparejados, solo-previa y solo-nueva con deltas", () => {
    const base = makeSummary("run-base", [
      makeRecord("caso-a", { rubric: { ...makeRecord("x").rubric, total: 70 }, auditorScore: 80, durationMs: 1000 }),
      makeRecord("caso-solo-base"),
    ]);
    const target = makeSummary("run-target", [
      makeRecord("caso-a", { rubric: { ...makeRecord("x").rubric, total: 90 }, auditorScore: 85, durationMs: 800 }),
      makeRecord("caso-solo-target"),
    ]);
    const dto = buildMddEvalCompareDto(base, target);
    assert.equal(dto.baseRunId, "run-base");
    assert.equal(dto.targetRunId, "run-target");
    const a = dto.rows.find((r) => r.caseId === "caso-a")!;
    assert.deepEqual(
      [a.rubricBefore, a.rubricAfter, a.rubricDelta, a.auditorDelta, a.durationBeforeMs, a.durationAfterMs],
      [70, 90, 20, 5, 1000, 800],
    );
    const onlyBase = dto.rows.find((r) => r.caseId === "caso-solo-base")!;
    assert.equal(onlyBase.rubricAfter, undefined);
    assert.equal(onlyBase.passedAfter, undefined);
    assert.equal(onlyBase.passedBefore, true);
    assert.equal(dto.aggregatesBefore?.cases, 2);
    assert.equal(dto.aggregatesAfter?.cases, 2);
  });
});
