import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  designFirstCompletenessScore,
  designFirstPhaseSemaphore,
  hasEvaluableInput,
  minSemaphoreStatus,
} from "./estimation-design-first.util.js";
import { evaluateDesignFirstPhaseGates, EMPTY_DESIGN_SPEC, parseDesignSpec } from "@theforge/shared-types";

const goldenSpec = parseDesignSpec(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../../../packages/shared-types/src/design-first/__fixtures__/three-screens.json",
      ),
      "utf8",
    ),
  ),
);

describe("estimation Design-First", () => {
  it("hasEvaluableInput sin MDD pero con pantallas", () => {
    assert.equal(hasEvaluableInput("DESIGN_FIRST", "", goldenSpec), true);
  });

  it("phase1 rojo deja semáforo rojo", () => {
    const gates = evaluateDesignFirstPhaseGates({ designSpec: EMPTY_DESIGN_SPEC });
    assert.equal(designFirstPhaseSemaphore(gates, false), "red");
  });

  it("sin MDD nunca verde aunque phase3 ok", () => {
    const gates = {
      phase1: { ok: true, issues: [] },
      phase2: { ok: true, issues: [] },
      phase3: { ok: true, issues: [] },
    };
    assert.equal(designFirstPhaseSemaphore(gates, false), "yellow");
  });

  it("precision fases 1-2 capped at 40", () => {
    const gates = evaluateDesignFirstPhaseGates({ designSpec: EMPTY_DESIGN_SPEC });
    assert.ok(designFirstCompletenessScore(gates) <= 40);
  });

  it("minSemaphoreStatus elige el peor", () => {
    assert.equal(minSemaphoreStatus("green", "yellow"), "yellow");
    assert.equal(minSemaphoreStatus("red", "green"), "red");
  });
});
