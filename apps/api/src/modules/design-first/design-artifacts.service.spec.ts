import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { ProjectArchitectureGraph } from "@theforge/shared-types";
import { parseDesignSpec } from "@theforge/shared-types";
import {
  buildDesignFirstHandoffArtifacts,
  DesignArtifactsService,
} from "./design-artifacts.service.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/shared-types/src/design-first/__fixtures__",
);

describe("design-artifacts.service", () => {
  const designSpec = parseDesignSpec(
    JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")),
  );
  const pag = JSON.parse(
    readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8"),
  ) as ProjectArchitectureGraph;

  it("genera siete grupos de artefactos con openapi válido", () => {
    const files = buildDesignFirstHandoffArtifacts({ designSpec, pag });
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("openapi.yaml"));
    assert.ok(paths.includes("mocks/handlers.ts"));
    assert.ok(paths.includes("mocks/browser.ts"));
    assert.ok(paths.includes("mocks/README.md"));
    assert.ok(paths.includes("docs/sdd/pantallas.md"));
    assert.ok(paths.includes("docs/sdd/datos.md"));
    assert.ok(paths.some((p) => p.startsWith("mocks/fixtures/")));
    assert.match(files.find((f) => f.path === "mocks/README.md")!.content, /msw@\^2/);

    const svc = new DesignArtifactsService();
    svc.assertOpenApiArtifact(pag);
  });
});
