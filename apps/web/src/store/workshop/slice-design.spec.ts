import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDesignReadToPatch,
  DESIGN_REVISION_CONFLICT_NOTICE,
  designApiErrorMessage,
} from "./slice-design.js";
import { DesignFirstApiError } from "../../lib/design-first-api.js";
import { EMPTY_DESIGN_SPEC } from "@theforge/shared-types";

describe("slice-design helpers", () => {
  it("applyDesignReadToPatch incrementa revisión en estado", () => {
    const patch = applyDesignReadToPatch({
      designSpec: EMPTY_DESIGN_SPEC,
      revision: 3,
      gates: {
        phase1: { ok: false, issues: [] },
        phase2: { ok: false, issues: [] },
        phase3: { ok: false, issues: [] },
      },
      designSpecHash: "abc",
      architectureGraphSourceHash: null,
      stale: false,
    });
    assert.equal(patch.designRevision, 3);
    assert.equal(patch.designStale, false);
  });

  it("409 ERR_DESIGN_REVISION_CONFLICT → aviso en español", () => {
    const msg = designApiErrorMessage(
      new DesignFirstApiError("La revisión del diseño cambió", {
        code: "ERR_DESIGN_REVISION_CONFLICT",
      }),
      "fallback",
    );
    assert.match(msg, /revisión/i);
    assert.equal(DESIGN_REVISION_CONFLICT_NOTICE.length > 10, true);
  });

  it("422 expone mensaje al panel", () => {
    const msg = designApiErrorMessage(
      new DesignFirstApiError("Invariante", {
        code: "ERR_DESIGN_INVARIANT",
        issues: [{ path: "screens[0].route", message: "Ruta duplicada" }],
      }),
      "fallback",
    );
    assert.match(msg, /Ruta duplicada/);
  });
});
