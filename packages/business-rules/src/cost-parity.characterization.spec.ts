/**
 * Caracterización: paridad de costo (panel, web, Estimation persistida) con `countCostDrivers`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EstimationService } from "../../../apps/api/src/modules/ai-analysis/estimation/estimation.service.js";
import { liveSemaphoreToDbStatus } from "../../../apps/api/src/modules/ai-analysis/estimation/live-semaphore-status.util.js";
import { countCostDrivers } from "./cost-drivers.js";
import { extractTechnicalMetadataTags } from "../../../apps/api/src/modules/engine/mdd-markdown-parser.js";
import { CostCalculatorService } from "../../../apps/api/src/modules/engine/cost-calculator.service.js";
import { calculateCostFromMdd } from "../../../apps/web/src/utils/costCalculator.js";

const EVAL_FIXTURES = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../apps/api/eval/mdd/fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(EVAL_FIXTURES, name), "utf8");
}

function persistedCost(md: string, status: ReturnType<typeof liveSemaphoreToDbStatus>) {
  const { entityCount, screenCount, extraEndpointCount } = countCostDrivers(md);
  return new CostCalculatorService().calculate({
    entityCount,
    screenCount,
    extraEndpointCount,
    metadataTags: extractTechnicalMetadataTags(md),
    infraFixedHours: 0,
    status,
  });
}

const CASES = [
  {
    id: "good-ecommerce-tienda-basica",
    fixture: "good-ecommerce-tienda-basica.md",
    panelMxn: 171383.34,
    webMxn: 171383.34,
    persistMxn: 171383.34,
  },
  {
    id: "bad-ecommerce-tienda-basica",
    fixture: "bad-ecommerce-tienda-basica.md",
    panelMxn: 209874.6,
    webMxn: 209874.6,
    persistMxn: 209874.6,
  },
  {
    id: "good-ecommerce-subsecciones",
    fixture: "good-ecommerce-tienda-basica-subsecciones.md",
    panelMxn: 325357.73,
    webMxn: 325357.73,
    persistMxn: 325357.73,
  },
] as const;

describe("caracterización: paridad de costo (3 vías)", () => {
  const svc = new EstimationService({} as never);

  for (const c of CASES) {
    it(`${c.id}: panel vs web vs persistido`, () => {
      const md = loadFixture(c.fixture);
      const live = svc.calculateLiveMetrics(md, { complexity: "HIGH" });
      const dbStatus = liveSemaphoreToDbStatus(live.status);
      const web = calculateCostFromMdd(md, { status: dbStatus });
      const persist = persistedCost(md, dbStatus);

      assert.equal(live.totalMXN, c.panelMxn, `${c.id}: panel totalMXN`);
      assert.equal(web.totalMxn, c.webMxn, `${c.id}: web totalMxn`);
      assert.equal(persist.totalMxn, c.persistMxn, `${c.id}: persistido totalMxn`);
    });
  }
});
