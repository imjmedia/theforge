import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  compileDataNeedsToPag,
} from "./compile-data-needs-to-pag.js";
import {
  evaluateDesignFirstPhaseGates,
  evaluatePhase1Gate,
  evaluatePhase2Gate,
} from "./design-first-gates.js";
import { parseDesignSpec, EMPTY_DESIGN_SPEC } from "./design-spec.js";
import { hashDesignSpec } from "./design-spec-hash.node.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const goldenSpec = parseDesignSpec(
  JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")),
);

describe("evaluateDesignFirstPhaseGates (I9)", () => {
  it("golden: phase1 y phase2 ok; phase3 ok con PAG y hash alineado", () => {
    const compiled = compileDataNeedsToPag({
      designSpec: goldenSpec,
      projectName: "ThreeScreensGolden",
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const hash = hashDesignSpec(goldenSpec);
    const gates = evaluateDesignFirstPhaseGates({
      designSpec: goldenSpec,
      pag: compiled.pag,
      designSpecHash: hash,
      architectureGraphSourceHash: hash,
    });
    assert.equal(gates.phase1.ok, true);
    assert.equal(gates.phase2.ok, true);
    assert.equal(gates.phase3.ok, true);
  });

  it("spec vacío: phase1 en rojo (CL-11)", () => {
    const gates = evaluateDesignFirstPhaseGates({ designSpec: EMPTY_DESIGN_SPEC });
    assert.equal(gates.phase1.ok, false);
    assert.ok(gates.phase1.issues.some((i) => /al menos una pantalla/.test(i.message)));
  });

  it("pantalla sin datos y sin static: phase2 issue (CL-13)", () => {
    const spec = structuredClone(goldenSpec);
    spec.screens = spec.screens.filter((s) => s.id === "order-list");
    spec.dataNeeds = [];
    spec.navigation = [];
    spec.entities = [];
    const phase2 = evaluatePhase2Gate(spec);
    assert.equal(phase2.ok, false);
    assert.ok(phase2.issues.some((i) => /static/.test(i.message)));
  });

  it("pantalla static sin datos: phase2 ok en regla CL-13", () => {
    const spec = structuredClone(goldenSpec);
    spec.screens = [spec.screens.find((s) => s.id === "home")!];
    spec.dataNeeds = [];
    spec.navigation = [];
    spec.entities = [];
    const phase2 = evaluatePhase2Gate(spec);
    assert.equal(phase2.ok, true);
  });

  it("phase1 exige componente o static", () => {
    const spec = structuredClone(goldenSpec);
    const screen = spec.screens.find((s) => s.id === "order-list")!;
    screen.components = [];
    screen.static = undefined;
    const phase1 = evaluatePhase1Gate(spec);
    assert.equal(phase1.ok, false);
  });

  it("phase3 stale cuando hash difiere", () => {
    const compiled = compileDataNeedsToPag({
      designSpec: goldenSpec,
      projectName: "ThreeScreensGolden",
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const gates = evaluateDesignFirstPhaseGates({
      designSpec: goldenSpec,
      pag: compiled.pag,
      designSpecHash: "aaa",
      architectureGraphSourceHash: "bbb",
    });
    assert.equal(gates.phase3.ok, false);
  });
});
