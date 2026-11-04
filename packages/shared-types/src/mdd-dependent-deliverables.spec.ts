import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMddDependentKeys,
  MDD_DEPENDENT_DELIVERABLE_KEYS,
  MDD_DEPENDENT_KEYS_EXCLUDING_DESIGN_ARTIFACTS,
} from "./mdd-dependent-deliverables.js";

describe("getMddDependentKeys", () => {
  it("NEW conserva todas las claves", () => {
    assert.deepEqual(getMddDependentKeys("NEW"), MDD_DEPENDENT_DELIVERABLE_KEYS);
  });

  it("DESIGN_FIRST excluye artefactos de diseño (misma lista hoy: no incluye designSpec/architectureGraph)", () => {
    assert.deepEqual(getMddDependentKeys("DESIGN_FIRST"), MDD_DEPENDENT_KEYS_EXCLUDING_DESIGN_ARTIFACTS);
    assert.equal(getMddDependentKeys("DESIGN_FIRST").includes("specContent"), true);
  });
});
