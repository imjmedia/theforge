import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { exportPagToOpenApiSpec } from "@theforge/shared-types";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import { validateOpenApi31 } from "./openapi-validate.util.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/shared-types/src/design-first/__fixtures__",
);

describe("validateOpenApi31", () => {
  it("acepta el golden three-screens OpenAPI", () => {
    const pag = JSON.parse(
      readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8"),
    ) as ProjectArchitectureGraph;
    const doc = exportPagToOpenApiSpec(pag);
    const result = validateOpenApi31(doc);
    assert.equal(result.ok, true);
  });

  it("rechaza openapi 3.0.0 con ruta", () => {
    const result = validateOpenApi31({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.path.includes("openapi")));
  });

  it("rechaza esquema roto en components.schemas", () => {
    const result = validateOpenApi31({
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      paths: {
        "/x": {
          get: {
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: {
        schemas: {
          Bad: { type: 123 },
        },
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.path.includes("/components/schemas/Bad")));
  });

  it("rechaza operación sin responses", () => {
    const result = validateOpenApi31({
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      paths: { "/x": { get: { summary: "sin respuestas" } } },
    });
    assert.equal(result.ok, false);
  });
});
