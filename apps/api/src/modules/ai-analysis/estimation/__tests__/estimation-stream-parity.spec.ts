/**
 * Paso 6: paridad stream (`evaluateForStream`) vs panel (`calculateLiveMetrics` persisted).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EstimationService } from "../estimation.service.js";

const FIXTURE = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../eval/mdd/fixtures/good-ecommerce-tienda-basica.md",
);

describe("estimation-stream-parity (P6)", () => {
  it("evaluateForStream y calculateLiveMetrics (stream) coinciden en status y headline", () => {
    const md = readFileSync(FIXTURE, "utf8");
    const svc = new EstimationService({} as never);
    const stream = svc.evaluateForStream(md, { complexity: "HIGH", projectId: "synthetic" });
    const panel = svc.calculateLiveMetrics(md, {
      complexity: "HIGH",
      projectId: "synthetic",
      semaphoreSource: "stream",
    });
    assert.equal(stream.status, panel.status);
    assert.equal(stream.semaphore.headline, panel.semaphore.headline);
  });
});
