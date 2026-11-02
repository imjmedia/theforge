import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatIntegrationHandoffPreviewStory, nextNewLegId } from "./project-integration.js";

describe("nextNewLegId", () => {
  it("starts at NEW-LEG-01", () => {
    assert.strictEqual(nextNewLegId([]), "NEW-LEG-01");
  });

  it("increments from max existing", () => {
    assert.strictEqual(nextNewLegId([{ id: "NEW-LEG-03" }, { id: "NEW-LEG-01" }]), "NEW-LEG-04");
  });
});

describe("formatIntegrationHandoffPreviewStory", () => {
  it("formats natural-language handoff as integration user story preview", () => {
    const md = formatIntegrationHandoffPreviewStory({
      id: "NEW-LEG-01",
      title: "Costos en cotizador",
      description: "El cotizador debe mostrar costos desglosados por medio.",
      actor: "vendedor",
      acceptanceCriteria: ["Se ve el costo unitario"],
    });
    assert.ok(md.includes("NEW-LEG-01"));
    assert.ok(md.includes("Costos en cotizador"));
    assert.ok(md.includes("costos desglosados"));
    assert.ok(md.includes("**Como:** vendedor"));
    assert.ok(md.includes("Se ve el costo unitario"));
    assert.ok(md.includes("No** forma parte del documento **Historias de Usuario**"));
  });
});
