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

  describe("estado sin cambios (S4)", () => {
    const MDD = "## 1. Contexto\n\nTexto mínimo de prueba para semáforo.";

    async function makeSvc(
      stage: { status: Status; precisionScore: number; shortTermContext: unknown },
      writes: unknown[],
      count = 1,
    ) {
      const prisma = {
        stage: {
          findUnique: async () => ({ mddContent: MDD, updatedAt: new Date("2020-01-01"), ...stage }),
          updateMany: async (args: unknown) => {
            writes.push(args);
            return { count };
          },
        },
        project: { findUnique: async () => ({ infraContent: null }) },
      };
      const { ConformanceService } = await import("../engine/conformance.service.js");
      return new StageSemaphoreSyncService(
        prisma as never,
        new ConformanceService(),
        { resolveAuditorGapsForPersisted: async () => undefined } as never,
        { recalcAndUpsert: async () => undefined } as never,
      );
    }

    /** Calcula estado, puntaje y hash reales con una primera corrida que siempre escribe. */
    async function baseline() {
      const writes: unknown[] = [];
      const svc = await makeSvc(
        { status: Status.ROJO, precisionScore: -1, shortTermContext: {} },
        writes,
      );
      const r = await svc.syncFromPersisted("p1", "s1", { content: MDD });
      assert.ok(r);
      const data = (writes[0] as { data: { status: Status; precisionScore: number; shortTermContext: { semaphoreSync: { inputsHash: string } } } }).data;
      return {
        status: data.status,
        precisionScore: data.precisionScore,
        hash: data.shortTermContext.semaphoreSync.inputsHash,
      };
    }

    it("hash distinto: reescribe solo shortTermContext con el hash nuevo", async () => {
      const b = await baseline();
      const writes: unknown[] = [];
      const svc = await makeSvc(
        {
          status: b.status,
          precisionScore: b.precisionScore,
          shortTermContext: { otro: 1, semaphoreSync: { version: 1, inputsHash: "viejo" } },
        },
        writes,
      );
      const r = await svc.syncFromPersisted("p1", "s1", { content: MDD });
      assert.equal(r?.changed, false);
      assert.equal(writes.length, 1);
      const arg = writes[0] as { where: { updatedAt: Date }; data: Record<string, any> };
      assert.deepEqual(arg.where.updatedAt, new Date("2020-01-01"));
      assert.deepEqual(Object.keys(arg.data), ["shortTermContext"]);
      assert.equal(arg.data.shortTermContext.semaphoreSync.inputsHash, b.hash);
      assert.equal(arg.data.shortTermContext.otro, 1);
    });

    it("hash distinto con CAS fallido: registra cas-miss en debug y devuelve changed=false", async () => {
      const b = await baseline();
      const writes: unknown[] = [];
      const svc = await makeSvc(
        {
          status: b.status,
          precisionScore: b.precisionScore,
          shortTermContext: { semaphoreSync: { version: 1, inputsHash: "viejo" } },
        },
        writes,
        0,
      );
      const debugs: string[] = [];
      (svc as unknown as { logger: { debug: (m: string) => void } }).logger.debug = (m: string) => {
        debugs.push(m);
      };
      const r = await svc.syncFromPersisted("p1", "s1", { content: MDD, reason: "t" });
      assert.equal(r?.changed, false);
      assert.equal(writes.length, 1);
      assert.ok(debugs.some((m) => m.includes("cas-miss")), debugs.join("|"));
    });

    it("mismo hash: no escribe", async () => {
      const b = await baseline();
      const writes: unknown[] = [];
      const svc = await makeSvc(
        {
          status: b.status,
          precisionScore: b.precisionScore,
          shortTermContext: { semaphoreSync: { version: 1, inputsHash: b.hash } },
        },
        writes,
      );
      const r = await svc.syncFromPersisted("p1", "s1", { content: MDD });
      assert.equal(r?.changed, false);
      assert.equal(writes.length, 0);
    });
  });
});
