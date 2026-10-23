import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DocReconcileService } from "./doc-reconcile.service.js";

describe("DocReconcileService", () => {
  const service = new DocReconcileService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it("ordena artefactos según dependencias", () => {
    const ordered = service.orderedArtifacts([
      "tasks",
      "blueprint",
      "apiContracts",
      "spec",
    ]);
    assert.deepEqual(ordered, ["mdd", "spec", "apiContracts", "blueprint", "tasks"]);
  });

  it("siempre incluye mdd aunque no esté en affectedArtifacts", () => {
    const ordered = service.orderedArtifacts(["blueprint"]);
    assert.equal(ordered[0], "mdd");
    assert.ok(ordered.includes("blueprint"));
  });

  it("buildGapsFeedback incluye referencia y descripción", () => {
    const feedback = service.buildGapsFeedback(
      "Descripción detallada del gap encontrado en implementación.",
      {
        reference: "§4.2 Auth",
        codePaths: ["src/auth/jwt.guard.ts"],
      },
    );
    assert.ok(feedback.includes("§4.2 Auth"));
    assert.ok(feedback.includes("jwt.guard.ts"));
  });
});
