import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatMddHighPipelinePhaseHeading,
  resolveMddHighPipelinePhase,
} from "./mdd-high-pipeline-phases.js";

describe("mdd-high-pipeline-phases", () => {
  it("mapea nodos del pipeline HIGH a fases UI", () => {
    const phase = resolveMddHighPipelinePhase("data_model");
    assert.deepStrictEqual(phase, { index: 2, total: 4, label: "Modelo de datos" });
    assert.strictEqual(formatMddHighPipelinePhaseHeading(phase!), "Fase 2/4: Modelo de datos");
  });

  it("devuelve null para nodos fuera del pipeline HIGH", () => {
    assert.strictEqual(resolveMddHighPipelinePhase("clarifier"), null);
  });
});
