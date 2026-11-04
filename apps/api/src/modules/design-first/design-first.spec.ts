import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  compileDataNeedsToPag,
  exportPagToOpenApiSpec,
  parseDesignSpec,
} from "@theforge/shared-types";
import { validateOpenApi31 } from "./openapi-validate.util.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/shared-types/src/design-first/__fixtures__",
);
const goldenSpec = parseDesignSpec(JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")));

describe("DesignFirst services", () => {
  it("compile-contract produce OpenAPI válido determinista (RF-10)", () => {
    const compiled = compileDataNeedsToPag({ designSpec: goldenSpec, projectName: "ThreeScreensGolden" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const a = exportPagToOpenApiSpec(compiled.pag);
    const b = exportPagToOpenApiSpec(compiled.pag);
    assert.deepEqual(a, b);
    assert.equal(validateOpenApi31(a).ok, true);
  });
});
