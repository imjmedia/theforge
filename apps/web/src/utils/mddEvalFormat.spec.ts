import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  complexityLabel,
  computeDelta,
  deltaInfo,
  dimensionLabel,
  elapsedSince,
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
  getPollIntervalMs,
  isActiveRunStatus,
  isTerminalRunStatus,
  passTransition,
  progressPercent,
  runStatusLabel,
  runStatusTone,
} from "./mddEvalFormat.js";

describe("formatDuration", () => {
  it("formats sub-second, seconds, minutes and hours", () => {
    assert.equal(formatDuration(450), "450ms");
    assert.equal(formatDuration(4500), "4.5s");
    assert.equal(formatDuration(45_000), "45s");
    assert.equal(formatDuration(83_000), "1m 23s");
    assert.equal(formatDuration(3_725_000), "1h 02m");
  });

  it("returns a dash for invalid values", () => {
    assert.equal(formatDuration(undefined), "—");
    assert.equal(formatDuration(Number.NaN), "—");
    assert.equal(formatDuration(-1), "—");
  });
});

describe("formatCost / formatPercent / formatScore", () => {
  it("formats cost with adaptive precision", () => {
    assert.equal(formatCost(0), "$0.00");
    assert.equal(formatCost(0.0042), "$0.0042");
    assert.equal(formatCost(0.1234), "$0.123");
    assert.equal(formatCost(12.345), "$12.35");
    assert.equal(formatCost(null), "—");
  });

  it("formats ratio as percentage", () => {
    assert.equal(formatPercent(0.756), "76%");
    assert.equal(formatPercent(1), "100%");
    assert.equal(formatPercent(undefined), "—");
  });

  it("drops trailing decimals on whole scores", () => {
    assert.equal(formatScore(80), "80");
    assert.equal(formatScore(79.46), "79.5");
    assert.equal(formatScore(null), "—");
  });
});

describe("run status helpers", () => {
  it("maps labels and tones", () => {
    assert.equal(runStatusLabel("running"), "En ejecución");
    assert.equal(runStatusLabel("cancelled"), "Cancelada");
    assert.equal(runStatusTone("completed"), "success");
    assert.equal(runStatusTone("failed"), "destructive");
  });

  it("detects terminal statuses", () => {
    assert.equal(isTerminalRunStatus("completed"), true);
    assert.equal(isTerminalRunStatus("failed"), true);
    assert.equal(isTerminalRunStatus("cancelled"), true);
    assert.equal(isActiveRunStatus("queued"), true);
    assert.equal(isActiveRunStatus("running"), true);
  });

  it("labels complexity in Spanish", () => {
    assert.equal(complexityLabel("LOW"), "Baja");
    assert.equal(complexityLabel("HIGH"), "Alta");
  });
});

describe("deltaInfo / computeDelta", () => {
  it("colors improvements green and regressions red", () => {
    assert.deepEqual(deltaInfo(4.5), { arrow: "▲", tone: "positive", text: "+4.5" });
    assert.deepEqual(deltaInfo(-2), { arrow: "▼", tone: "negative", text: "-2" });
  });

  it("inverts tone when lower is better", () => {
    assert.equal(deltaInfo(-30_000, { higherIsBetter: false }).tone, "positive");
    assert.equal(deltaInfo(30_000, { higherIsBetter: false }).tone, "negative");
  });

  it("treats tiny deltas as neutral and missing as dash", () => {
    assert.deepEqual(deltaInfo(0.01), { arrow: "→", tone: "neutral", text: "0" });
    assert.deepEqual(deltaInfo(undefined), { arrow: "", tone: "neutral", text: "—" });
  });

  it("computes delta only when both values exist", () => {
    assert.equal(computeDelta(70, 82), 12);
    assert.equal(computeDelta(undefined, 82), undefined);
  });
});

describe("passTransition", () => {
  it("flags fixes and regressions", () => {
    assert.deepEqual(passTransition(false, true), { label: "FAIL → PASS", tone: "positive" });
    assert.deepEqual(passTransition(true, false), { label: "PASS → FAIL", tone: "negative" });
    assert.deepEqual(passTransition(true, true), { label: "PASS → PASS", tone: "neutral" });
    assert.deepEqual(passTransition(undefined, true), { label: "— → PASS", tone: "neutral" });
  });
});

describe("polling and progress", () => {
  it("polls every 3s and backs off to 10s after 5 minutes", () => {
    assert.equal(getPollIntervalMs(0), 3000);
    assert.equal(getPollIntervalMs(299_999), 3000);
    assert.equal(getPollIntervalMs(300_000), 10_000);
    assert.equal(getPollIntervalMs(3_600_000), 10_000);
  });

  it("clamps progress percent", () => {
    assert.equal(progressPercent(0, 0), 0);
    assert.equal(progressPercent(3, 12), 25);
    assert.equal(progressPercent(15, 12), 100);
  });

  it("computes elapsed time against an injected clock", () => {
    const start = "2026-01-01T00:00:00.000Z";
    assert.equal(elapsedSince(start, Date.parse(start) + 5000), 5000);
    assert.equal(elapsedSince("nope"), undefined);
    assert.equal(elapsedSince(undefined), undefined);
  });
});

describe("dimensionLabel", () => {
  it("humanizes snake and kebab keys", () => {
    assert.equal(dimensionLabel("api_contracts"), "Api contracts");
    assert.equal(dimensionLabel("security"), "Security");
  });
});
