import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { meetsIntegralLiveGreenCriteria } from "./estimation.types.js";

describe("meetsIntegralLiveGreenCriteria", () => {
  it("VERDE con precisión 97%, trazabilidad 94% y ≤5 brechas (panel típico ≥90%)", () => {
    assert.equal(
      meetsIntegralLiveGreenCriteria({
        precision: 97,
        consistencyScore: 94,
        crossDocumentGapCount: 3,
      }),
      true,
    );
  });

  it("AMARILLO si trazabilidad < 90% aunque precisión alta", () => {
    assert.equal(
      meetsIntegralLiveGreenCriteria({
        precision: 97,
        consistencyScore: 89,
        crossDocumentGapCount: 0,
      }),
      false,
    );
  });

  it("AMARILLO si >5 brechas transversales", () => {
    assert.equal(
      meetsIntegralLiveGreenCriteria({
        precision: 97,
        consistencyScore: 94,
        crossDocumentGapCount: 6,
      }),
      false,
    );
  });

  it("AMARILLO si precisión < 90%", () => {
    assert.equal(
      meetsIntegralLiveGreenCriteria({
        precision: 89,
        consistencyScore: 100,
        crossDocumentGapCount: 0,
      }),
      false,
    );
  });
});
