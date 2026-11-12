import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWorkshopSemaphoreGreen,
  resolveWorkshopHeadlineScore,
  resolveWorkshopSemaphoreStatus,
} from "./workshopSemaphoreStatus.js";

describe("workshopSemaphoreStatus (P11)", () => {
  it("color = semaphore.status", () => {
    assert.equal(
      resolveWorkshopSemaphoreStatus(
        { semaphore: { status: "green" } as never, precision: 90, totalMXN: 0, totalMXNMarket: 0, totalHours: 0, roles: {}, rolesHours: {}, status: "yellow", totalMXNIA: 0, readinessHints: [], mddReadinessHints: [], traceabilityHints: [] },
        "ROJO",
      ),
      "green",
    );
  });

  it("headline desde veredicto integral", () => {
    const h = resolveWorkshopHeadlineScore({
      semaphore: {
        status: "yellow",
        headline: 88,
        headlineSource: "integral",
        integral: 88,
      } as never,
      precision: 70,
      totalMXN: 0,
      totalMXNMarket: 0,
      totalHours: 0,
      roles: {},
      rolesHours: {},
      status: "red",
      totalMXNIA: 0,
      readinessHints: [],
      mddReadinessHints: [],
      traceabilityHints: [],
    });
    assert.equal(h.value, 88);
    assert.equal(h.source, "integral");
  });

  it("CL-22: deliverablesGate en veredicto (allowed=false)", () => {
    const live = {
      semaphore: {
        status: "green",
        headline: 95,
        headlineSource: "integral",
        integral: 95,
        deliverablesGate: { allowed: false, rule: "high", reasons: ["falta Spec"] },
      } as never,
      precision: 95,
      totalMXN: 0,
      totalMXNMarket: 0,
      totalHours: 0,
      roles: {},
      rolesHours: {},
      status: "green",
      totalMXNIA: 0,
      readinessHints: [],
      mddReadinessHints: [],
      traceabilityHints: [],
    };
    assert.equal(isWorkshopSemaphoreGreen(live, "VERDE"), true);
    assert.equal(live.semaphore.deliverablesGate.allowed, false);
  });
});
