import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertNever, isDesignFirst, isGreenfield, isLegacy, isMergeBlockedByDesignFirst, MERGE_DESIGN_FIRST_CONFLICT_MESSAGE } from "./project-type.js";

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

  it("isDesignFirst operativo para DESIGN_FIRST", () => {
    assert.equal(isDesignFirst("DESIGN_FIRST"), true);
    assert.equal(isDesignFirst("NEW"), false);
    assert.equal(isDesignFirst("LEGACY"), false);
  });

  it("merge rechazado si algún proyecto es DESIGN_FIRST (CL-26)", () => {
    assert.equal(isMergeBlockedByDesignFirst(["NEW", "LEGACY"]), false);
    assert.equal(isMergeBlockedByDesignFirst(["NEW", "DESIGN_FIRST"]), true);
    assert.match(MERGE_DESIGN_FIRST_CONFLICT_MESSAGE, /Design-First/);
  });

  it("assertNever lanza con mensaje", () => {
    assert.throws(
      () => assertNever("unexpected" as never),
      /Tipo de proyecto no soportado/,
    );
  });
});
