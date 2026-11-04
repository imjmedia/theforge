import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DELIVERABLE_DESIGN_SCREENS_RENDER_STEP,
  deliverableWaveStepLabel,
  resolveDeliverableWaves,
} from "@theforge/shared-types";

describe("DeliverablesCascade — Design-First oleadas", () => {
  it("design_screens_render tiene etiqueta de progreso", () => {
    assert.equal(
      deliverableWaveStepLabel(DELIVERABLE_DESIGN_SCREENS_RENDER_STEP),
      "Pantallas (Design-First)",
    );
  });

  it("HIGH DESIGN_FIRST coloca api_contracts antes de design_screens_render", () => {
    const flat = resolveDeliverableWaves("HIGH", { projectType: "DESIGN_FIRST" }).flat();
    assert.ok(flat.indexOf("api_contracts") < flat.indexOf(DELIVERABLE_DESIGN_SCREENS_RENDER_STEP));
  });
});
