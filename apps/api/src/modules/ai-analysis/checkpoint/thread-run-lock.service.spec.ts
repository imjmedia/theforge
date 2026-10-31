import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  mddThreadLockKey,
  ThreadBusyError,
  ThreadRunLockService,
  resolveThreadRunLockTtlMs,
} from "./thread-run-lock.service.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("ThreadRunLockService (in-process fallback, sin REDIS_URL)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("el segundo acquire falla mientras el primero sigue vivo y funciona tras release", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(a);
    assert.equal(await svc.acquire("p1:_", { renewEveryMs: 0 }), null);
    // otro hilo no se ve afectado
    const other = await svc.acquire("p2:_", { renewEveryMs: 0 });
    assert.ok(other);
    await a.release();
    const again = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(again);
    await again.release();
    await other.release();
  });

  it("el lease expira tras el TTL sin renovación", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("p1:s1", { ttlMs: 40, renewEveryMs: 0 });
    assert.ok(a);
    assert.equal(await svc.acquire("p1:s1", { ttlMs: 40, renewEveryMs: 0 }), null);
    await sleep(70);
    const b = await svc.acquire("p1:s1", { ttlMs: 40, renewEveryMs: 0 });
    assert.ok(b, "tras el TTL el hilo debe poder tomarse de nuevo");
    // el release tardío del dueño anterior no debe borrar el lease del nuevo
    await a.release();
    assert.equal(await svc.acquire("p1:s1", { ttlMs: 40, renewEveryMs: 0 }), null);
    await b.release();
  });

  it("la renovación mantiene vivo el lease más allá del TTL inicial", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("p1:renew", { ttlMs: 60, renewEveryMs: 15 });
    assert.ok(a);
    await sleep(150);
    assert.equal(await svc.acquire("p1:renew", { ttlMs: 60, renewEveryMs: 0 }), null);
    await a.release();
    assert.ok(await svc.acquire("p1:renew", { ttlMs: 60, renewEveryMs: 0 }));
  });

  it("release es idempotente", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("p1:idem", { renewEveryMs: 0 });
    await a!.release();
    await a!.release();
    assert.ok(await svc.acquire("p1:idem", { renewEveryMs: 0 }));
  });

  it("runExclusive libera en finally y es reentrante en el mismo contexto", async () => {
    const svc = new ThreadRunLockService();
    const key = mddThreadLockKey("proj", "stage");
    const out = await svc.runExclusive(
      key,
      async () => {
        // un stream interno dentro del job no se autobloquea
        const inner = await svc.acquire(key, { renewEveryMs: 0 });
        assert.ok(inner);
        await inner.release();
        // otro contexto (fuera del store) sí ve el hilo ocupado
        return await new Promise<string>((resolve) => {
          setImmediate(() => resolve("ok"));
        });
      },
      { renewEveryMs: 0 },
    );
    assert.equal(out, "ok");
    assert.ok(await svc.acquire(key, { renewEveryMs: 0 }), "liberado tras runExclusive");
  });

  it("runExclusive lanza ThreadBusyError si otro turno tiene el hilo y libera si fn falla", async () => {
    const svc = new ThreadRunLockService();
    const held = await svc.acquire("busy:_", { renewEveryMs: 0 });
    await assert.rejects(svc.runExclusive("busy:_", async () => "x"), ThreadBusyError);
    await held!.release();
    await assert.rejects(
      svc.runExclusive("busy:_", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.ok(await svc.acquire("busy:_", { renewEveryMs: 0 }));
  });
});

describe("thread lock helpers", () => {
  it("mddThreadLockKey normaliza etapa vacía", () => {
    assert.equal(mddThreadLockKey(" p ", ""), "p:_");
    assert.equal(mddThreadLockKey("p", null), "p:_");
    assert.equal(mddThreadLockKey("p", " s1 "), "p:s1");
  });

  it("resolveThreadRunLockTtlMs lee THREAD_RUN_LOCK_TTL_MS con default de 20 min", () => {
    assert.equal(resolveThreadRunLockTtlMs({} as NodeJS.ProcessEnv), 20 * 60_000);
    assert.equal(resolveThreadRunLockTtlMs({ THREAD_RUN_LOCK_TTL_MS: "5000" } as NodeJS.ProcessEnv), 5000);
    assert.equal(resolveThreadRunLockTtlMs({ THREAD_RUN_LOCK_TTL_MS: "abc" } as NodeJS.ProcessEnv), 20 * 60_000);
  });
});
