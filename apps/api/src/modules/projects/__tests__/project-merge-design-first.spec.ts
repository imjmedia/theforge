import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { describe, it } from "node:test";
import { isMergeBlockedByDesignFirst, MERGE_DESIGN_FIRST_CONFLICT_MESSAGE } from "@theforge/shared-types";

describe("project merge DESIGN_FIRST (CL-26)", () => {
  it("ConflictException 409 con mensaje estable cuando hay DESIGN_FIRST", () => {
    assert.equal(isMergeBlockedByDesignFirst(["NEW", "DESIGN_FIRST"]), true);
    const err = new ConflictException(MERGE_DESIGN_FIRST_CONFLICT_MESSAGE);
    assert.equal(err.getStatus(), 409);
    assert.equal(err.message, MERGE_DESIGN_FIRST_CONFLICT_MESSAGE);
  });
});
