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
    // Límite explícito: el default viene de CASCADE_W4_MAX_ATTEMPTS (1 por defecto) y no debe
    // condicionar la regla que prueba este caso.
    const gaps = ["[Scheduler] x"];
    const max = 3;
    assert.equal(shouldRunAnotherCascadeW4Pass(gaps, 0, max), true);
    assert.equal(shouldRunAnotherCascadeW4Pass(gaps, 1, max), true);
    assert.equal(shouldRunAnotherCascadeW4Pass(gaps, 2, max), false);
    assert.equal(shouldRunAnotherCascadeW4Pass([], 0, max), false);
    assert.ok(CASCADE_W4_PRECISION_MAX_ATTEMPTS >= 1);
  });
});
