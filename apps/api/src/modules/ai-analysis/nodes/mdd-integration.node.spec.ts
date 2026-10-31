import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { integrationStructuredSchema, normalizeIntegrationStructuredPayload } from "./mdd-integration.node.js";

describe("integrationStructuredSchema (tolerancia)", () => {
  it("acepta el formato canónico", () => {
    const r = integrationStructuredSchema.parse({
      integracion: { subsections: [{ title: "Flujo", content: ["a", "b"] }] },
    });
    assert.deepEqual(r.integracion.subsections[0]!.content, ["a", "b"]);
  });

  it("acepta content como string único", () => {
    const r = integrationStructuredSchema.parse({
      integracion: { subsections: [{ title: "Flujo", content: "Texto único" }] },
    });
    assert.deepEqual(r.integracion.subsections[0]!.content, ["Texto único"]);
  });

  it("acepta integracion como array desnudo", () => {
    const r = integrationStructuredSchema.parse({
      integracion: [{ title: "Despliegue", content: ["Docker"] }],
    });
    assert.equal(r.integracion.subsections.length, 1);
    assert.equal(r.integracion.subsections[0]!.title, "Despliegue");
  });

  it("acepta alias subsecciones y titulo", () => {
    const r = integrationStructuredSchema.parse({
      integracion: {
        subsecciones: [
          { titulo: "Variables", content: ["DATABASE_URL"] },
          { titulo: "CI/CD", content: "Pipeline" },
        ],
        manifest: { project_id: "x" },
      },
    });
    assert.deepEqual(
      r.integracion.subsections.map((s) => s.title),
      ["Variables", "CI/CD"],
    );
    assert.deepEqual(r.integracion.manifest, { project_id: "x" });
  });

  it("no inventa subsecciones cuando falta integracion", () => {
    assert.equal(integrationStructuredSchema.safeParse({ foo: 1 }).success, false);
    assert.deepEqual(normalizeIntegrationStructuredPayload("x"), "x");
  });
});
