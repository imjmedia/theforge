import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertDesignSpecWithinLimits,
  DesignSpecByteLimitError,
  DesignSpecScreenCountError,
  EMPTY_DESIGN_SPEC,
  parseDesignSpec,
  toScreenSpecV1,
  fromScreenSpecV1,
  validateDesignSpecI1,
  validateDesignSpecI2,
  validateDesignSpecI3,
  validateDesignSpecInvariants,
  DESIGN_SPEC_MAX_SCREEN_COUNT,
  type DesignSpec,
} from "./design-spec.js";
import { hashDesignSpec } from "./design-spec-hash.node.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const golden = parseDesignSpec(
  JSON.parse(readFileSync(join(fixtureDir, "three-screens.json"), "utf8")),
);

describe("designSpec golden three-screens", () => {
  it("parsea y cumple I1, I2 e I3", () => {
    assert.equal(golden.screens.length, 3);
    assert.deepEqual(validateDesignSpecInvariants(golden), []);
  });

  it("EMPTY_DESIGN_SPEC es valor inicial RF-01", () => {
    assert.deepEqual(EMPTY_DESIGN_SPEC, {
      schemaVersion: 1,
      entities: [],
      screens: [],
      navigation: [],
      dataNeeds: [],
    });
  });
});

describe("validateDesignSpecI1 (CL-12, RF-06)", () => {
  it("detecta id de pantalla duplicado", () => {
    const spec: DesignSpec = {
      ...golden,
      screens: [...golden.screens, { ...golden.screens[0]! }],
    };
    const issues = validateDesignSpecI1(spec);
    assert.ok(issues.some((i) => i.invariant === "I1" && /duplicado/.test(i.message)));
  });

  it("detecta ruta duplicada", () => {
    const spec: DesignSpec = {
      ...golden,
      screens: golden.screens.map((s, i) => (i === 1 ? { ...s, route: golden.screens[0]!.route } : s)),
    };
    assert.ok(validateDesignSpecI1(spec).some((i) => /ruta duplicada/.test(i.message)));
  });

  it("detecta arista a pantalla inexistente", () => {
    const spec: DesignSpec = {
      ...golden,
      navigation: [
        ...golden.navigation,
        {
          id: "nav-broken",
          from: "order-list",
          to: "missing-screen",
          trigger: { event: "click" },
        },
      ],
    };
    assert.ok(validateDesignSpecI1(spec).some((i) => /colgante/.test(i.message)));
  });
});

describe("validateDesignSpecI3 (CL-14)", () => {
  it("detecta need sin tipo", () => {
    const spec = structuredClone(golden);
    spec.dataNeeds[0]!.components[0]!.needs[0]!.type = "   ";
    assert.ok(validateDesignSpecI3(spec).some((i) => /sin tipo/.test(i.message)));
  });

  it("detecta tipos contradictorios en el mismo campo", () => {
    const spec = structuredClone(golden);
    const block = spec.dataNeeds[0]!.components[0]!;
    block.needs.push({
      ...block.needs[0]!,
      id: "need-dup-type",
      type: "number",
    });
    assert.ok(validateDesignSpecI3(spec).some((i) => /contradict/.test(i.message)));
  });
});

describe("validateDesignSpecI2", () => {
  it("detecta action hacia entidad inexistente", () => {
    const spec = structuredClone(golden);
    spec.dataNeeds[0]!.components[0]!.needs[0]!.action = "unknown-entity";
    assert.ok(validateDesignSpecI2(spec).some((i) => i.invariant === "I2"));
  });
});

describe("hashDesignSpec (RNF-02)", () => {
  it("es igual con claves reordenadas", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        dataNeeds: golden.dataNeeds,
        entities: golden.entities,
        navigation: golden.navigation,
        schemaVersion: 1,
        screens: golden.screens,
      }),
    ) as DesignSpec;
    assert.equal(hashDesignSpec(golden), hashDesignSpec(reordered));
  });
});

describe("assertDesignSpecWithinLimits (CL-28, RNF-04)", () => {
  it("rechaza más de 200 pantallas", () => {
    const spec: DesignSpec = {
      ...EMPTY_DESIGN_SPEC,
      screens: Array.from({ length: DESIGN_SPEC_MAX_SCREEN_COUNT + 1 }, (_, i) => ({
        id: `screen-${i}`,
        name: `Screen ${i}`,
        route: `/s-${i}`,
        roles: [],
        origin: { kind: "manual" as const },
        components: [{ id: `c-${i}`, component: "Box" }],
      })),
    };
    assert.throws(() => assertDesignSpecWithinLimits(spec, 1_000_000), DesignSpecScreenCountError);
  });

  it("rechaza tamaño por encima del máximo", () => {
    assert.throws(
      () => assertDesignSpecWithinLimits(golden, 64),
      DesignSpecByteLimitError,
    );
  });
});

describe("ScreenSpec v1 adapters", () => {
  it("toScreenSpecV1 expone tres pantallas con endpoints", () => {
    const v1 = toScreenSpecV1(golden);
    assert.equal(v1.length, 3);
    assert.ok(v1[0]!.endpoints.includes("/api/v1/orders"));
  });

  it("roundtrip v1 conserva nombres y conteo de pantallas", () => {
    const v1 = toScreenSpecV1(golden);
    const back = fromScreenSpecV1(v1, golden);
    assert.equal(back.screens.length, v1.length);
    for (let i = 0; i < v1.length; i++) {
      assert.equal(back.screens[i]!.name, v1[i]!.name);
      assert.equal(back.screens[i]!.components.length, v1[i]!.components.length);
    }
  });
});
