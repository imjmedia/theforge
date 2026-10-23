import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectMergeConflicts } from "../project-merge-conflicts.util.js";
import type { MergeSourceSnapshot } from "../project-merge-conflicts.util.js";
import { emptyPhase0Document } from "../../ai-analysis/phase0/phase0-normalize.util.js";


function source(name: string, patch: Partial<ReturnType<typeof emptyPhase0Document>>): MergeSourceSnapshot {
  const base = emptyPhase0Document();
  return {
    projectId: name,
    name,
    projectType: "NEW",
    borrador: { ...base, ...patch },
  };
}

describe("detectMergeConflicts", () => {
  it("detecta permisos distintos en el mismo rol", () => {
    const conflicts = detectMergeConflicts([
      source("A", { roles: [{ rol: "Admin", permisos: ["ver"] }] }),
      source("B", { roles: [{ rol: "Admin", permisos: ["editar"] }] }),
    ]);
    assert.ok(conflicts.some((c) => c.kind === "role_permission_mismatch"));
  });

  it("detecta mezcla NEW y LEGACY", () => {
    const a = source("A", {});
    const b = source("B", {});
    b.projectType = "LEGACY";
    const conflicts = detectMergeConflicts([a, b]);
    assert.ok(conflicts.some((c) => c.kind === "project_type_mismatch"));
  });
});
