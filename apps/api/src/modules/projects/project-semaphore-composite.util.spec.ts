/**
 * Caracterización (Paso 0 / P7): `evaluateCompositeSemaphore` sobre fixtures de eval/mdd.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ComplexityLevel, Status } from "@theforge/database";
import { ConformanceService } from "../engine/conformance.service.js";
import { evaluateCompositeSemaphore } from "./project-semaphore-composite.util.js";

const EVAL_FIXTURES = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../eval/mdd/fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(EVAL_FIXTURES, name), "utf8");
}

describe("caracterización: evaluateCompositeSemaphore", () => {
  const conformance = new ConformanceService();
  const cases = [
    {
      id: "good-ecommerce-tienda-basica",
      fixture: "good-ecommerce-tienda-basica.md",
      // P7: veredicto del núcleo (sin derivados: nota, sin razón Conformidad post_cascade)
      expected: { status: Status.ROJO, minPrecision: 0 },
    },
    {
      id: "bad-ecommerce-tienda-basica",
      fixture: "bad-ecommerce-tienda-basica.md",
      expected: { status: Status.ROJO, minPrecision: 0 },
    },
    {
      id: "good-ecommerce-subsecciones",
      fixture: "good-ecommerce-tienda-basica-subsecciones.md",
      expected: { status: Status.ROJO, minPrecision: 0 },
    },
  ];

  for (const c of cases) {
    it(`${c.id}: status y precisionScore desde núcleo`, () => {
      const md = loadFixture(c.fixture);
      const result = evaluateCompositeSemaphore(conformance, {
        complexity: ComplexityLevel.HIGH,
        mddMarkdown: md,
      });

      assert.equal(result.status, c.expected.status, `${c.id}: status`);
      assert.ok(
        result.precisionScore >= c.expected.minPrecision,
        `${c.id}: precisionScore ${result.precisionScore}`,
      );
      if (c.id.startsWith("good")) {
        assert.ok(
          !result.composite.reasons.some((r) => /^Conformidad:/.test(r)),
          "derivatives none: sin razón Conformidad",
        );
      }
    });
  }
});
