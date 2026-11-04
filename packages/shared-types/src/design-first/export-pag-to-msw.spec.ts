import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { ProjectArchitectureGraph } from "../project-architecture-graph.js";
import { exportPagToMswHandlers } from "./export-pag-to-msw.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

describe("exportPagToMswHandlers", () => {
  const pag = JSON.parse(
    readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8"),
  ) as ProjectArchitectureGraph;

  it("genera handlers y browser byte a byte (golden)", () => {
    const out = exportPagToMswHandlers(pag);
    assert.equal(out.handlersTs, readFileSync(join(fixtureDir, "three-screens.handlers.txt"), "utf8"));
    assert.equal(out.browserTs, readFileSync(join(fixtureDir, "three-screens.browser.txt"), "utf8"));
  });

  it("usa rutas :id y header x-mock-state", () => {
    const out = exportPagToMswHandlers(pag);
    assert.match(out.handlersTs, /http\.get\(`\/api\/v1\/customers\/:id`/);
    assert.match(out.handlersTs, /x-mock-state/);
    assert.match(out.handlersTs, /mockState === "empty"/);
    assert.match(out.handlersTs, /mockState === "error"/);
  });
});
