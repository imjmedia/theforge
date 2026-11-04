import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProjectArchitectureGraph } from "../project-architecture-graph.js";
import {
  compilePagToMddSection3,
  compilePagToMddSection4,
  listPagEndpointsForMddCompare,
} from "./compile-pag-to-mdd-sections.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "__fixtures__");

function loadThreeScreensPag(): ProjectArchitectureGraph {
  const raw = readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8");
  return JSON.parse(raw) as ProjectArchitectureGraph;
}

function readGolden(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

describe("compilePagToMddSection3/4 — three-screens golden", () => {
  const pag = loadThreeScreensPag();

  it("§3 byte a byte contra golden", () => {
    const out = compilePagToMddSection3(pag);
    assert.equal(out, readGolden("three-screens.mdd-section3.txt"));
  });

  it("§4 byte a byte contra golden", () => {
    const out = compilePagToMddSection4(pag);
    assert.equal(out, readGolden("three-screens.mdd-section4.txt"));
  });

  it("§4 lista los mismos endpoints que el PAG (orden compilado)", () => {
    const pagEps = listPagEndpointsForMddCompare(pag);
    const sortedPag = [...pag.endpoints].sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      const order = ["DELETE", "GET", "PATCH", "POST", "PUT"];
      return order.indexOf(a.method) - order.indexOf(b.method);
    });
    assert.deepEqual(pagEps, sortedPag.map((e) => ({ method: e.method, path: e.path })));
  });
});

describe("compilePagToMddSection3/4 — determinismo", () => {
  it("misma entrada → mismos bytes", () => {
    const pag = loadThreeScreensPag();
    assert.equal(compilePagToMddSection3(pag), compilePagToMddSection3(pag));
    assert.equal(compilePagToMddSection4(pag), compilePagToMddSection4(pag));
  });
});
