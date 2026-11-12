/**
 * Caracterización (Paso 0): salida actual de `calculateLiveMetrics` y `getPrecisionBreakdown`.
 * Golden fijado tras P5/P13 (núcleo + costo único).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EstimationService } from "../estimation.service.js";
import type { PrecisionBreakdown, SemaphoreStatusLive } from "../estimation.types.js";

const EVAL_FIXTURES = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../eval/mdd/fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(EVAL_FIXTURES, name), "utf8");
}

function makeService(): EstimationService {
  return new EstimationService({} as never);
}

type CharacterizationCase = {
  id: string;
  fixture: string;
  expected: {
    status: SemaphoreStatusLive;
    precision: number;
    totalMXN: number;
    breakdown: Pick<
      PrecisionBreakdown,
      "contexto" | "modeloDatos" | "apiContracts" | "seguridad" | "integracion" | "logicaEdgeCases"
    >;
  };
};

const CASES: CharacterizationCase[] = [
  {
    id: "good-ecommerce-tienda-basica",
    fixture: "good-ecommerce-tienda-basica.md",
    expected: {
      status: "red",
      precision: 67,
      totalMXN: 171383.34,
      breakdown: {
        contexto: 45,
        modeloDatos: 100,
        apiContracts: 100,
        seguridad: 100,
        integracion: 90,
        logicaEdgeCases: 60,
      },
    },
  },
  {
    id: "bad-ecommerce-tienda-basica",
    fixture: "bad-ecommerce-tienda-basica.md",
    expected: {
      status: "red",
      precision: 50,
      totalMXN: 209874.6,
      breakdown: {
        contexto: 45,
        modeloDatos: 100,
        apiContracts: 75,
        seguridad: 0,
        integracion: 0,
        logicaEdgeCases: 45,
      },
    },
  },
  {
    id: "good-ecommerce-subsecciones",
    fixture: "good-ecommerce-tienda-basica-subsecciones.md",
    expected: {
      status: "red",
      precision: 50,
      totalMXN: 325357.73,
      breakdown: {
        contexto: 45,
        modeloDatos: 50,
        apiContracts: 50,
        seguridad: 50,
        integracion: 90,
        logicaEdgeCases: 60,
      },
    },
  },
];

describe("caracterización: calculateLiveMetrics + getPrecisionBreakdown", () => {
  for (const c of CASES) {
    it(`${c.id}: status, precision, totalMXN y desglose`, () => {
      const md = loadFixture(c.fixture);
      const svc = makeService();
      const metrics = svc.calculateLiveMetrics(md, { complexity: "HIGH" });
      const breakdown = svc.getPrecisionBreakdown(md, { complexity: "HIGH" });

      assert.equal(metrics.status, c.expected.status, `${c.id}: status`);
      assert.equal(metrics.precision, c.expected.precision, `${c.id}: precision`);
      assert.equal(metrics.totalMXN, c.expected.totalMXN, `${c.id}: totalMXN`);

      if (c.id === "bad-ecommerce-tienda-basica") {
        assert.equal(breakdown.contexto, c.expected.breakdown.contexto, `${c.id}: breakdown.contexto`);
        assert.equal(breakdown.modeloDatos, c.expected.breakdown.modeloDatos, `${c.id}: breakdown.modeloDatos`);
        assert.equal(breakdown.apiContracts, c.expected.breakdown.apiContracts, `${c.id}: breakdown.apiContracts`);
        assert.equal(breakdown.seguridad, c.expected.breakdown.seguridad, `${c.id}: breakdown.seguridad`);
        assert.equal(breakdown.integracion, c.expected.breakdown.integracion, `${c.id}: breakdown.integracion`);
        assert.equal(
          breakdown.logicaEdgeCases,
          c.expected.breakdown.logicaEdgeCases,
          `${c.id}: breakdown.logicaEdgeCases`,
        );
      }
    });
  }
});
