import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  compileDataNeedsToPag,
  serializeCompiledPag,
  PAG_ENDPOINT_DEFAULTS,
} from "./compile-data-needs-to-pag.js";
import { parseDesignSpec } from "./design-spec.js";
import { validateProjectArchitectureGraph } from "../project-architecture-graph.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const goldenSpec = parseDesignSpec(
  JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")),
);
const goldenPagText = readFileSync(join(fixtureDir, "three-screens.pag.json"), "utf8");

describe("compileDataNeedsToPag", () => {
  it("golden three-screens byte a byte en dos corridas (I4)", () => {
    const run = () =>
      compileDataNeedsToPag({ designSpec: goldenSpec, projectName: "ThreeScreensGolden" });
    const a = run();
    const b = run();
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    const bytesA = serializeCompiledPag(a.pag);
    const bytesB = serializeCompiledPag(b.pag);
    assert.equal(bytesA, bytesB);
    assert.equal(bytesA, goldenPagText);
  });

  it("trazabilidad theforgeSources en entidades y endpoints (I5)", () => {
    const result = compileDataNeedsToPag({ designSpec: goldenSpec, projectName: "ThreeScreensGolden" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const order = result.pag.entities.find((e) => e.name === "Order");
    assert.ok(order?.theforgeSources?.length);
    const listEp = result.pag.endpoints.find(
      (e) => e.method === "GET" && e.path === "/api/v1/orders",
    );
    assert.ok(listEp?.theforgeSources?.some((s) => s.screenId === "order-list"));
  });

  it("dashboard sin endpointHint no añade GET /views/... (Q5)", () => {
    const result = compileDataNeedsToPag({ designSpec: goldenSpec, projectName: "ThreeScreensGolden" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!result.pag.endpoints.some((e) => e.path.includes("/views/")));
  });

  it("añade GET solo cuando hay endpointHint", () => {
    const spec = structuredClone(goldenSpec);
    spec.dataNeeds[0]!.components[0]!.needs[0]!.endpointHint = `/views/order-list`;
    const result = compileDataNeedsToPag({ designSpec: spec, projectName: "Hint" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.pag.endpoints.some((e) => e.path === "/views/order-list" && e.method === "GET"));
  });

  it("PAG inválido devuelve issues sin reparar (CL-17 / I6)", () => {
    const result = compileDataNeedsToPag({ designSpec: goldenSpec, projectName: "ThreeScreensGolden" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const broken = structuredClone(result.pag);
    broken.endpoints.push({
      ...PAG_ENDPOINT_DEFAULTS,
      path: "/api/v1/broken",
      method: "GET",
      targetEntity: "NonExistentEntity",
    });
    const v = validateProjectArchitectureGraph(broken);
    assert.equal(v.ok, false);
    assert.ok(v.errors.length > 0);
  });
});

describe("compileDataNeedsToPag invariantes previas", () => {
  it("spec con I1 roto no compila", () => {
    const spec = structuredClone(goldenSpec);
    spec.screens.push({ ...spec.screens[0]! });
    const result = compileDataNeedsToPag({ designSpec: spec, projectName: "X" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((i) => i.message.includes("I1")));
  });
});
