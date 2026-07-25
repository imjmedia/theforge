import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASCADE_W4_PRECISION_MAX_ATTEMPTS,
  filterSchedulerResearchPrecisionGaps,
  shouldRunAnotherCascadeW4Pass,
} from "./cascade-w4-post-pass.util.js";

describe("cascade-w4-post-pass.util", () => {
  it("filtra gaps scheduler y research→tasks", () => {
    const gaps = [
      "[Scheduler] Horarios distintos: 22:00 vs 09:00",
      "[Architecture] Servicio missing",
      "[Research→Tasks] Open gap sin task: G1",
    ];
    const filtered = filterSchedulerResearchPrecisionGaps(gaps);
    assert.equal(filtered.length, 2);
  });

  it("shouldRunAnotherCascadeW4Pass respeta max intentos", () => {
    const gaps = ["[Scheduler] x"];
    assert.equal(shouldRunAnotherCascadeW4Pass(gaps, 0, CASCADE_W4_PRECISION_MAX_ATTEMPTS), true);
    assert.equal(shouldRunAnotherCascadeW4Pass(gaps, 1, CASCADE_W4_PRECISION_MAX_ATTEMPTS), true);
    assert.equal(shouldRunAnotherCascadeW4Pass(gaps, 2, CASCADE_W4_PRECISION_MAX_ATTEMPTS), false);
    assert.equal(shouldRunAnotherCascadeW4Pass([], 0, CASCADE_W4_PRECISION_MAX_ATTEMPTS), false);
  });
});
