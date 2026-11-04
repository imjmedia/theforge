import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProjectSchema } from "./project.js";

describe("createProjectSchema (Design-First paso 5/10)", () => {
  it("acepta projectType DESIGN_FIRST en el contrato zod (flag en API)", () => {
    const result = createProjectSchema.safeParse({
      name: "Demo",
      projectType: "DESIGN_FIRST",
    });
    assert.equal(result.success, true);
  });

  it("acepta NEW y LEGACY con reglas existentes", () => {
    assert.ok(createProjectSchema.safeParse({ name: "N", projectType: "NEW" }).success);
    const legacy = createProjectSchema.safeParse({
      name: "L",
      projectType: "LEGACY",
      theforgeProjectId: "11111111-1111-4111-8111-111111111111",
    });
    assert.ok(legacy.success);
  });
});
