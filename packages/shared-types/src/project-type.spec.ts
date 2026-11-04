import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertNever, isDesignFirst, isGreenfield, isLegacy } from "./project-type.js";

describe("project-type helpers", () => {
  it("isGreenfield: NEW y DESIGN_FIRST; LEGACY no", () => {
    assert.equal(isGreenfield("NEW"), true);
    assert.equal(isGreenfield("DESIGN_FIRST"), true);
    assert.equal(isGreenfield("LEGACY"), false);
  });

  it("isLegacy solo LEGACY", () => {
    assert.equal(isLegacy("LEGACY"), true);
    assert.equal(isLegacy("NEW"), false);
    assert.equal(isLegacy("DESIGN_FIRST"), false);
  });

  it("isDesignFirst operativo para DESIGN_FIRST (enum en paso 5)", () => {
    assert.equal(isDesignFirst("DESIGN_FIRST"), true);
    assert.equal(isDesignFirst("NEW"), false);
    assert.equal(isDesignFirst("LEGACY"), false);
  });

  it("assertNever lanza con mensaje", () => {
    assert.throws(
      () => assertNever("unexpected" as never),
      /Tipo de proyecto no soportado/,
    );
  });
});
