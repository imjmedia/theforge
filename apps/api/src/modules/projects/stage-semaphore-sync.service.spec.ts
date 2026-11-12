import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StageSemaphoreSyncService } from "./stage-semaphore-sync.service.js";
import { Status } from "@theforge/database";

describe("StageSemaphoreSyncService (P8a)", () => {
  it("CAS: no escribe si updatedAt no coincide (CL-30)", async () => {
    const updates: unknown[] = [];
    const prisma = {
      stage: {
        findUnique: async () => ({
          mddContent: "## 1. Contexto\n\nTexto mínimo de prueba para semáforo.",
          status: Status.VERDE,
          precisionScore: 95,
          updatedAt: new Date("2020-01-01"),
          shortTermContext: {},
        }),
        updateMany: async (args: unknown) => {
          updates.push(args);
          return { count: 0 };
        },
      },
      project: { findUnique: async () => ({ infraContent: null }) },
    };
    const svc = new StageSemaphoreSyncService(
      prisma as never,
      new (await import("../engine/conformance.service.js")).ConformanceService(),
      {
        resolveAuditorGapsForPersisted: async () => undefined,
      } as never,
      { recalcAndUpsert: async () => undefined } as never,
    );
    const r = await svc.syncFromPersisted("p1", "s1", { reason: "test-cas" });
    assert.equal(r, null);
    assert.ok(updates.length >= 1);
  });
});
