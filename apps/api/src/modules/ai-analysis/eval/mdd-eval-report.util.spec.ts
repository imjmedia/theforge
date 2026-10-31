/**
 * Tests de los informes del eval de MDDs (escritura, comparación, resumen de una línea).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { MddEvalRunRecord, MddEvalSummary } from "./mdd-eval.types.js";
import { buildEvalSummary } from "./mdd-eval-runner.js";
import {
  compareSummaries,
  evalFileKeys,
  formatAggregatesLine,
  formatDuration,
  loadEvalSummary,
  renderEvalSummaryMarkdown,
  writeEvalResults,
} from "./mdd-eval-report.util.js";

const tempDirs: string[] = [];
after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mdd-eval-report-"));
  tempDirs.push(dir);
  return dir;
}

function record(caseId: string, overrides: Partial<MddEvalRunRecord> = {}): MddEvalRunRecord {
  const total = overrides.rubric?.total ?? 80;
  return {
    caseId,
    complexity: "HIGH",
    startedAt: "2026-10-30T10:00:00.000Z",
    durationMs: 125_000,
    markdownLen: 1200,
    gateBlockers: [],
    gateWarnings: [],
    auditTrail: [],
    rubric: { total, passed: total >= 80, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] },
    passed: total >= 80,
    ...overrides,
  };
}

function summaryOf(runId: string, records: MddEvalRunRecord[]): MddEvalSummary {
  return buildEvalSummary({
    runId,
    startedAt: "2026-10-30T10:00:00.000Z",
    finishedAt: "2026-10-30T10:30:00.000Z",
    gitSha: "abc1234",
    args: { concurrency: 1 },
    records,
  });
}

describe("formatDuration", () => {
  it("formatea ms, s y m:ss", () => {
    assert.equal(formatDuration(850), "850 ms");
    assert.equal(formatDuration(12_400), "12.4 s");
    assert.equal(formatDuration(247_000), "4m 07s");
    assert.equal(formatDuration(Number.NaN), "—");
  });
});

describe("evalFileKeys", () => {
  it("usa el caseId y añade sufijo a los repetidos (good/bad del mismo caso)", () => {
    const keys = evalFileKeys([record("a-case"), record("b-case"), record("a-case")]);
    assert.deepEqual(keys, ["a-case", "b-case", "a-case-2"]);
  });
});

describe("formatAggregatesLine", () => {
  it("resume aprobados, medias y totales en una línea", () => {
    const summary = summaryOf("r1", [
      record("a-case", { rubric: { total: 90, passed: true, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] }, auditorScore: 88, costUsd: 0.25, llmCalls: 4 }),
      record("b-case", { rubric: { total: 50, passed: false, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] }, passed: false }),
    ]);
    const line = formatAggregatesLine(summary);
    assert.match(line, /1\/2 aprobados \(50%\)/);
    assert.match(line, /rúbrica media 70\.0/);
    assert.match(line, /auditor media 88\.0/);
    assert.match(line, /coste \$0\.2500/);
    assert.match(line, /llamadas LLM 4/);
    assert.ok(!line.includes("\n"));
  });
});

describe("writeEvalResults", () => {
  it("escribe summary.json, summary.md, el MDD y el score por caso", async () => {
    const dir = await makeTempDir();
    const outDir = path.join(dir, "run");
    const summary = summaryOf("r-write", [
      record("ecommerce-ok", { rubric: { total: 91, passed: true, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] }, auditorScore: 90 }),
      record("ecommerce-bad", {
        passed: false,
        error: "timeout tras 50 ms",
        rubric: { total: 0, passed: false, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: ["sin §3"] },
      }),
    ]);

    const result = await writeEvalResults(summary, outDir, new Map([["ecommerce-ok", "# MDD bueno"]]));

    const files = (await readdir(outDir)).sort();
    assert.deepEqual(files, ["ecommerce-bad.score.json", "ecommerce-ok.md", "ecommerce-ok.score.json", "summary.json", "summary.md"]);
    assert.equal(await readFile(path.join(outDir, "ecommerce-ok.md"), "utf8"), "# MDD bueno");

    const saved = loadEvalSummary(path.join(outDir, "summary.json"));
    const okCase = saved.cases.find((c) => c.caseId === "ecommerce-ok");
    const badCase = saved.cases.find((c) => c.caseId === "ecommerce-bad");
    assert.equal(okCase?.markdownPath, "ecommerce-ok.md");
    assert.equal(badCase?.markdownPath, undefined);
    assert.equal(result.summary.cases.length, 2);

    const score = JSON.parse(await readFile(path.join(outDir, "ecommerce-ok.score.json"), "utf8"));
    assert.equal(score.caseId, "ecommerce-ok");
    assert.equal(score.rubric.total, 91);

    const md = await readFile(path.join(outDir, "summary.md"), "utf8");
    assert.match(md, /\| caso \| complejidad \| rúbrica \| auditor \| gate \| % \| duración \| coste \| estado \|/);
    assert.match(md, /\| ecommerce-ok \| HIGH \| 91\.0 \| 90 \| — \| — \| 2m 05s \| — \| PASS \|/);
    assert.match(md, /\| ecommerce-bad \| HIGH \| 0\.0 \| — \| — \| — \| 2m 05s \| — \| FAIL \|/);
    assert.match(md, /## Fallos/);
    assert.match(md, /### ecommerce-bad \(FAIL\)[\s\S]*- sin §3[\s\S]*- error: timeout tras 50 ms/);
    assert.match(md, /### ecommerce-ok \(PASS\)\n\n- Sin fallos\./);
  });

  it("no escribe MDD cuando el markdown viene vacío", async () => {
    const dir = await makeTempDir();
    const summary = summaryOf("r-empty", [record("solo-case")]);
    await writeEvalResults(summary, path.join(dir, "out"), {});
    const files = await readdir(path.join(dir, "out"));
    assert.ok(!files.includes("solo-case.md"));
    assert.ok(files.includes("solo-case.score.json"));
  });

  it("renderEvalSummaryMarkdown marca el commit ausente con guion", () => {
    const summary = { ...summaryOf("r-md", []), gitSha: undefined };
    assert.match(renderEvalSummaryMarkdown(summary), /Commit: —/);
  });
});

describe("loadEvalSummary", () => {
  it("rechaza ficheros que no son un summary", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "bad.json");
    await writeFile(file, JSON.stringify({ hello: "world" }), "utf8");
    assert.throws(() => loadEvalSummary(file), /no es un summary\.json/);
  });
});

describe("compareSummaries", () => {
  it("calcula deltas de rúbrica, auditor y duración por caso emparejado", () => {
    const prev = summaryOf("prev", [
      record("ecommerce-a", { durationMs: 100_000, auditorScore: 80, rubric: { total: 70, passed: false, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] }, passed: false }),
      record("ecommerce-b", { durationMs: 60_000, auditorScore: 90, rubric: { total: 70, passed: false, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] }, passed: false }),
      record("solo-previa"),
    ]);
    const next = summaryOf("next", [
      record("ecommerce-a", { durationMs: 130_000, auditorScore: 91, rubric: { total: 85, passed: true, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] }, passed: true }),
      record("ecommerce-b", { durationMs: 60_000, auditorScore: 90 }),
      record("solo-nueva"),
    ]);

    const comparison = compareSummaries(prev, next);
    const byKey = new Map(comparison.cases.map((c) => [c.key, c]));

    const a = byKey.get("ecommerce-a");
    assert.equal(a?.status, "matched");
    assert.equal(a?.rubric.delta, 15);
    assert.equal(a?.auditor.delta, 11);
    assert.equal(a?.durationMs.delta, 30_000);
    assert.deepEqual(a?.passed, { prev: false, next: true });

    assert.equal(byKey.get("ecommerce-b")?.rubric.delta, 10);
    assert.equal(byKey.get("solo-previa")?.status, "only-prev");
    assert.equal(byKey.get("solo-previa")?.rubric.next, null);
    assert.equal(byKey.get("solo-previa")?.rubric.delta, null);
    assert.equal(byKey.get("solo-nueva")?.status, "only-next");
    assert.equal(byKey.get("solo-nueva")?.auditor.prev, null);

    assert.match(comparison.markdown, /# Comparación · prev → next/);
    assert.match(comparison.markdown, /\| ecommerce-a \| 70\.0 → 85\.0 \(\+15\.0\)/);
    assert.match(comparison.markdown, /solo-previa \(solo en previa\)/);
    assert.match(comparison.markdown, /\+30\.0 s/);
  });

  it("delta de agregados y duración negativa", () => {
    const prev = summaryOf("p", [record("x-case", { durationMs: 200_000, rubric: { total: 90, passed: true, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] } })]);
    const next = summaryOf("n", [record("x-case", { durationMs: 100_000, rubric: { total: 80, passed: true, dimensions: [], forbiddenHits: [], forbiddenPenalty: 0, failures: [] } })]);
    const comparison = compareSummaries(prev, next);
    assert.equal(comparison.aggregates.avgRubric.delta, -10);
    assert.equal(comparison.aggregates.avgDurationMs.delta, -100_000);
    assert.equal(comparison.aggregates.passRate.delta, 0);
    assert.match(comparison.markdown, /Δ duración media: -1m 40s/);
  });
});
