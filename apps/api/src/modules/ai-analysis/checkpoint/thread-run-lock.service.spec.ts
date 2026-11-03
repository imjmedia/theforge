import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ConfigService } from "@nestjs/config";
import {
  FENCE_UNAVAILABLE_MESSAGE,
  mddThreadLockKey,
  THREAD_FENCE_KEY,
  THREAD_LOCK_KEY_PREFIX,
  ThreadBusyError,
  ThreadLeaseLostError,
  ThreadLockUnavailableError,
  ThreadRunLockService,
  resolveThreadRunLockTtlMs,
} from "./thread-run-lock.service.js";
import { getActiveLlmAbortSignal, runWithLlmAbortSignal } from "../utils/mdd-llm-stream-invoke.util.js";
import { getActiveMddLeaseFence } from "../../../common/mdd-lease-context.js";

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

/** Redis falso inyectado por el seam de `redis` privado (el servicio ya lo tiene "conectado"). */
type FakeRedis = {
  status: string;
  set: (...a: unknown[]) => Promise<unknown>;
  eval: (...a: unknown[]) => Promise<unknown>;
  disconnect: () => void;
  calls: Array<{ op: string; args: unknown[] }>;
  kv: Map<string, string>;
};

function fakeRedis(overrides: Partial<Pick<FakeRedis, "set" | "eval">> = {}): FakeRedis {
  const kv = new Map<string, string>();
  const calls: FakeRedis["calls"] = [];
  return {
    status: "ready",
    calls,
    kv,
    disconnect: () => undefined,
    set:
      overrides.set ??
      (async (...a: unknown[]) => {
        // lease: SET key token PX ttl NX · fence: FENCE_LUA (INCR con suelo en Date.now())
        const [key, value, ...opts] = a as [string, string, ...unknown[]];
        calls.push({ op: key === THREAD_FENCE_KEY ? "seed" : "set", args: a });
        if (opts.includes("NX") && kv.has(key)) return null;
        kv.set(key, value);
        return "OK";
      }),
    eval:
      overrides.eval ??
      (async (...a: unknown[]) => {
        const [script, , key, token] = a as [string, number, string, string];
        if (script.includes("incr")) {
          // FENCE_LUA: INCR con suelo en el reloj (ARGV[1] = token aquí). Mismo contrato que el script real.
          calls.push({ op: "fence", args: a });
          const next = Number(kv.get(key) ?? "0") + 1;
          const v = next < Number(token) ? Number(token) : next;
          kv.set(key, String(v));
          return v;
        }
        const isRenew = script.includes("pexpire");
        calls.push({ op: isRenew ? "renew" : "release", args: a });
        if (kv.get(key) !== token) return 0;
        if (!isRenew) kv.delete(key);
        return 1;
      }),
  };
}

function withRedis(svc: ThreadRunLockService, redis: FakeRedis): void {
  (svc as unknown as { redis: FakeRedis }).redis = redis;
}

describe("ThreadRunLockService (Redis, falla cerrado)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    // Puerto cerrado y sin ready: ioredis real nunca llega a "ready" dentro del tope de los tests.
    process.env.REDIS_URL = "redis://127.0.0.1:1";
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("(a) primer acquire con Redis no listo lanza LOCK_UNAVAILABLE y no cae al Map; el rechazo no se cachea", async () => {
    const svc = new ThreadRunLockService();
    let intentos = 0;
    // sustituye la conexión real por una que nunca llega a ready y falla rápido
    (svc as unknown as { getRedis: (k: string) => Promise<never> }).getRedis = async (key: string) => {
      intentos++;
      throw new ThreadLockUnavailableError(key, new Error('Redis no llegó a "ready" en 5000 ms'));
    };
    await assert.rejects(svc.acquire("p1:_", { renewEveryMs: 0 }), (err: unknown) => {
      assert.ok(err instanceof ThreadLockUnavailableError);
      assert.equal(err.code, "LOCK_UNAVAILABLE");
      return true;
    });
    assert.equal((svc as unknown as { memory: Map<string, unknown> }).memory.size, 0, "no concede exclusión local");
    await assert.rejects(svc.acquire("p1:_", { renewEveryMs: 0 }), ThreadLockUnavailableError);
    assert.equal(intentos, 2, "cada acquire reintenta (sin promesa rechazada cacheada)");
  });

  it("(a) con la conexión real a un puerto sin Redis: LOCK_UNAVAILABLE y sin promesa cacheada", async () => {
    const svc = new ThreadRunLockService();
    await assert.rejects(svc.acquire("p1:_", { renewEveryMs: 0 }), ThreadLockUnavailableError);
    const priv = svc as unknown as { redisInit: unknown; redis: unknown; memory: Map<string, unknown> };
    assert.equal(priv.redisInit, null, "la promesa rechazada no queda cacheada");
    assert.equal(priv.redis, null);
    assert.equal(priv.memory.size, 0);
    await svc.onModuleDestroy();
  });

  it("(b) Redis caído (error en SET) lanza LOCK_UNAVAILABLE y no concede el lease ni usa el Map", async () => {
    const svc = new ThreadRunLockService();
    withRedis(
      svc,
      fakeRedis({
        set: async () => {
          throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
        },
      }),
    );
    await assert.rejects(svc.acquire("p1:_", { renewEveryMs: 0 }), (err: unknown) => {
      assert.ok(err instanceof ThreadLockUnavailableError);
      assert.match(err.message, /LOCK_UNAVAILABLE/);
      assert.match(err.message, /Stream isn't writeable/);
      return true;
    });
    assert.equal((svc as unknown as { memory: Map<string, unknown> }).memory.size, 0);
    await assert.rejects(
      svc.runExclusive("p1:_", async () => "no debe ejecutarse"),
      ThreadLockUnavailableError,
    );
  });

  it("acquire exclusivo en Redis: el segundo devuelve null y tras release se vuelve a tomar", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis());
    const a = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(a);
    assert.equal(await svc.acquire("p1:_", { renewEveryMs: 0 }), null);
    await a.release();
    assert.ok(await svc.acquire("p1:_", { renewEveryMs: 0 }));
  });

  it("(d) renew devuelve 0 → signal abortado con LEASE_LOST e isHeld() false", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis({ eval: async () => 0 }));
    const lease = await svc.acquire("p1:_", { ttlMs: 60_000, renewEveryMs: 10 });
    assert.ok(lease);
    assert.equal(lease.isHeld(), true);
    assert.equal(lease.signal.aborted, false);
    await sleep(60);
    assert.equal(lease.signal.aborted, true);
    assert.ok(lease.signal.reason instanceof ThreadLeaseLostError);
    assert.equal((lease.signal.reason as ThreadLeaseLostError).code, "LEASE_LOST");
    assert.equal(lease.isHeld(), false);
    await lease.release();
  });

  it("(e) un error transitorio en renew NO aborta: sigue held y se recupera en el siguiente tick", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    const realEval = redis.eval;
    let renewals = 0;
    redis.eval = async (...a: unknown[]) => {
      if ((a[0] as string).includes("pexpire")) {
        renewals++;
        if (renewals <= 2) throw new Error("ECONNRESET");
      }
      return realEval(...a);
    };
    withRedis(svc, redis);
    const lease = await svc.acquire("p1:_", { ttlMs: 60_000, renewEveryMs: 10 });
    assert.ok(lease);
    await sleep(60);
    assert.ok(renewals >= 3, "reintenta en los ticks siguientes");
    assert.equal(lease.signal.aborted, false);
    assert.equal(lease.isHeld(), true);
    await lease.release();
  });

  it("(e) si el lease vence sin poder renovarse se trata como pérdida confirmada", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    const realEval = redis.eval;
    redis.eval = async (...a: unknown[]) => {
      if ((a[0] as string).includes("pexpire")) throw new Error("ECONNRESET");
      return realEval(...a);
    };
    withRedis(svc, redis);
    const lease = await svc.acquire("p1:_", { ttlMs: 50, renewEveryMs: 10 });
    assert.ok(lease);
    assert.equal(lease.isHeld(), true);
    await sleep(90);
    assert.equal(lease.isHeld(), false);
    assert.equal(lease.signal.aborted, true);
    assert.ok(lease.signal.reason instanceof ThreadLeaseLostError);
    await lease.release();
  });

  it("(g) release hace compare-and-delete: no borra el lease de otro dueño y marca la pérdida", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    withRedis(svc, redis);
    const lease = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(lease);
    const setCall = redis.calls.find((c) => c.op === "set")!;
    // otro turno toma el lease (el nuestro expiró): el valor guardado ya no es nuestro token
    const key = setCall.args[0] as string;
    const original = redis.eval;
    let deleted = 0;
    redis.eval = async (...a: unknown[]) => {
      const out = await original(...a);
      if (out === 1 && !(a[0] as string).includes("pexpire")) deleted++;
      return out;
    };
    await redis.set(key, "token-de-otro"); // pisa sin NX
    await lease.release();
    assert.equal(deleted, 0, "el token ajeno no se borra");
    assert.equal(lease.signal.aborted, true);
    assert.ok(lease.signal.reason instanceof ThreadLeaseLostError);
    assert.equal(lease.isHeld(), false);
    // el lease ajeno sigue en pie
    assert.equal(await svc.acquire("p1:_", { renewEveryMs: 0 }), null);
  });

  it("(g) release con el token propio borra la clave (compare-and-delete OK) y no aborta", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    withRedis(svc, redis);
    const lease = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(lease);
    assert.equal(lease.isHeld(), true);
    await lease.release();
    assert.equal(lease.signal.aborted, false);
    assert.equal(lease.isHeld(), false, "liberado ya no está held");
    assert.equal(redis.calls.filter((c) => c.op === "release").length, 1);
    await lease.release(); // idempotente: no vuelve a llamar a Redis
    assert.equal(redis.calls.filter((c) => c.op === "release").length, 1);
    assert.ok(await svc.acquire("p1:_", { renewEveryMs: 0 }));
  });

  it("(f) reentrancia por ALS: el acquire interno no se autobloquea y comparte signal/isHeld del lease externo", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    withRedis(svc, redis);
    const key = mddThreadLockKey("proj", "stage");
    const out = await svc.runExclusive(
      key,
      async (outerSignal) => {
        assert.equal(svc.isHeldInContext(key), true);
        const inner = await svc.acquire(key, { renewEveryMs: 0 });
        assert.ok(inner);
        assert.equal(inner.signal, outerSignal);
        assert.equal(inner.isHeld(), true);
        await inner.release(); // no-op: no libera el lease externo
        assert.equal(redis.calls.filter((c) => c.op === "release").length, 0);
        return svc.runExclusive(key, async () => "interno");
      },
      { renewEveryMs: 0 },
    );
    assert.equal(out, "interno");
    assert.equal(redis.calls.filter((c) => c.op === "set").length, 1, "un solo SET: el lease se tomó una vez");
    assert.equal(redis.calls.filter((c) => c.op === "release").length, 1);
    assert.equal(svc.isHeldInContext(key), false);
  });

  it("runExclusive encadena la señal del turno (ALS LLM) con la del lease y la deja como señal LLM activa", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis());
    const turn = new AbortController();
    const seen = await runWithLlmAbortSignal(turn.signal, () =>
      svc.runExclusive(
        "p1:_",
        async (signal) => {
          assert.equal(getActiveLlmAbortSignal(), signal);
          assert.equal(signal.aborted, false);
          turn.abort(new Error("cancelado"));
          assert.equal(signal.aborted, true, "la señal del turno aborta la combinada");
          return "ok";
        },
        { renewEveryMs: 0 },
      ),
    );
    assert.equal(seen, "ok");
  });

  it("runExclusive descarta el resultado y lanza LEASE_LOST si el lease se pierde durante fn", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis({ eval: async () => 0 }));
    await assert.rejects(
      svc.runExclusive(
        "p1:_",
        async (signal) => {
          await sleep(60);
          assert.equal(signal.aborted, true);
          return "resultado invalido";
        },
        { ttlMs: 60_000, renewEveryMs: 10 },
      ),
      ThreadLeaseLostError,
    );
    // si fn falla por el aborto, el error visible es LEASE_LOST (no el AbortError genérico)
    await assert.rejects(
      svc.runExclusive(
        "p2:_",
        async (signal) => {
          await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        },
        { ttlMs: 60_000, renewEveryMs: 10 },
      ),
      ThreadLeaseLostError,
    );
  });

  it("runExclusive: fn termina bien y la pérdida solo se detecta en release => devuelve el resultado y no lanza", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    withRedis(svc, redis);
    const out = await svc.runExclusive(
      "p1:_",
      async () => {
        // otro turno pisa la clave tras el último persist: el compare-and-delete de release no la borra
        const setCall = redis.calls.find((c) => c.op === "set")!;
        await redis.set(setCall.args[0] as string, "token-de-otro");
        return "resultado persistido";
      },
      { renewEveryMs: 0 },
    );
    assert.equal(out, "resultado persistido");
    // el lease ajeno sigue en pie: release no lo borró
    assert.equal(await svc.acquire("p1:_", { renewEveryMs: 0 }), null);
  });

  it("runExclusive: si fn falla y la pérdida solo se detecta en release, se propaga el error de fn", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    withRedis(svc, redis);
    await assert.rejects(
      svc.runExclusive(
        "p1:_",
        async () => {
          const setCall = redis.calls.find((c) => c.op === "set")!;
          await redis.set(setCall.args[0] as string, "token-de-otro");
          throw new Error("fallo propio de fn");
        },
        { renewEveryMs: 0 },
      ),
      /fallo propio de fn/,
    );
  });
});

describe("ThreadRunLockService (configuración inyectada)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // el ConfigService manda sobre process.env
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("con ConfigService sin REDIS_URL usa el lock en proceso aunque process.env la tenga", async () => {
    const svc = new ThreadRunLockService({ get: () => undefined } as unknown as ConfigService);
    const a = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(a);
    assert.equal((svc as unknown as { memory: Map<string, unknown> }).memory.size, 1);
    await a.release();
  });

  it("el TTL por defecto sale de THREAD_RUN_LOCK_TTL_MS del ConfigService", async () => {
    const cfg = { get: (k: string) => (k === "THREAD_RUN_LOCK_TTL_MS" ? "5000" : undefined) };
    const svc = new ThreadRunLockService(cfg as unknown as ConfigService);
    const a = await svc.acquire("p1:ttl", { renewEveryMs: 0 });
    assert.ok(a);
    const entry = (svc as unknown as { memory: Map<string, { expiresAt: number }> }).memory.get("mdd:thread-lock:p1:ttl");
    const restante = (entry?.expiresAt ?? 0) - Date.now();
    assert.ok(restante > 4_000 && restante <= 5_000, `TTL esperado ~5000 ms, fue ${restante}`);
    await a.release();
  });

  it("acepta el TTL como número (ConfigService devuelve el valor ya validado por env.schema)", async () => {
    const cfg = { get: (k: string) => (k === "THREAD_RUN_LOCK_TTL_MS" ? 7_000 : undefined) };
    const svc = new ThreadRunLockService(cfg as unknown as ConfigService);
    const a = await svc.acquire("p1:ttl-num", { renewEveryMs: 0 });
    assert.ok(a, "un TTL numérico no debe romper acquire");
    const entry = (svc as unknown as { memory: Map<string, { expiresAt: number }> }).memory.get("mdd:thread-lock:p1:ttl-num");
    const restante = (entry?.expiresAt ?? 0) - Date.now();
    assert.ok(restante > 6_000 && restante <= 7_000, `TTL esperado ~7000 ms, fue ${restante}`);
    await a.release();
  });
});

describe("ThreadRunLockService (sin REDIS_URL: lease en proceso)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("(c) sin REDIS_URL usa el Map en proceso (no lanza LOCK_UNAVAILABLE)", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("p1:_", { renewEveryMs: 0 });
    assert.ok(a);
    assert.equal((svc as unknown as { memory: Map<string, unknown> }).memory.size, 1);
    assert.equal(await svc.acquire("p1:_", { renewEveryMs: 0 }), null);
    assert.equal(a.isHeld(), true);
    await a.release();
    assert.equal(a.isHeld(), false);
  });

  it("en memoria, un lease pisado por otro dueño aborta con LEASE_LOST al renovar", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("p1:_", { ttlMs: 60_000, renewEveryMs: 10 });
    assert.ok(a);
    (svc as unknown as { memory: Map<string, { token: string; expiresAt: number }> }).memory.set(
      "mdd:thread-lock:p1:_",
      { token: "otro", expiresAt: Date.now() + 60_000 },
    );
    await sleep(50);
    assert.equal(a.signal.aborted, true);
    assert.ok(a.signal.reason instanceof ThreadLeaseLostError);
    assert.equal(a.isHeld(), false);
  });
});

describe("ThreadRunLockService (fence, sin REDIS_URL: contador en memoria)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("(a) dos acquire consecutivos (claves distintas) dan fences estrictamente crecientes", async () => {
    const svc = new ThreadRunLockService();
    const a = await svc.acquire("f1:_", { renewEveryMs: 0 });
    const b = await svc.acquire("f2:_", { renewEveryMs: 0 });
    assert.ok(a && b);
    assert.ok(Number.isSafeInteger(a.fence));
    assert.ok(b.fence > a.fence, `fence debe crecer: ${a.fence} -> ${b.fence}`);
    await a.release();
    await b.release();
  });

  it("(c) la vista reentrante comparte el fence del lease exterior", async () => {
    const svc = new ThreadRunLockService();
    const key = "f3:_";
    await svc.runExclusive(
      key,
      async (_signal, outer) => {
        const inner = await svc.acquire(key, { renewEveryMs: 0 });
        assert.ok(inner);
        assert.equal(inner.fence, outer.fence);
        await inner.release();
      },
      { renewEveryMs: 0 },
    );
  });
});

describe("ThreadRunLockService (fence, con Redis falso)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // getRedis exige REDIS_URL; la conexión real se sustituye
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("(a) dos acquire consecutivos (claves distintas) dan fences estrictamente crecientes", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis());
    const a = await svc.acquire("f1:_", { renewEveryMs: 0 });
    const b = await svc.acquire("f2:_", { renewEveryMs: 0 });
    assert.ok(a && b);
    assert.ok(b.fence > a.fence, `fence debe crecer: ${a.fence} -> ${b.fence}`);
    await a.release();
    await b.release();
  });

  it("(b) sin clave de siembra, el primer fence es >= Date.now() al momento de la llamada", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    withRedis(svc, redis);
    assert.equal(redis.kv.has(THREAD_FENCE_KEY), false);
    const antes = Date.now();
    const lease = await svc.acquire("f1b:_", { renewEveryMs: 0 });
    assert.ok(lease);
    assert.ok(lease.fence >= antes, `fence ${lease.fence} debe ser >= ${antes}`);
    assert.equal(redis.kv.get(THREAD_FENCE_KEY), String(lease.fence));
    await lease.release();
  });

  it("(b) un contador por debajo del reloj sube al reloj (ya no queda en 5001)", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    redis.kv.set(THREAD_FENCE_KEY, "5000");
    withRedis(svc, redis);
    const antes = Date.now();
    const lease = await svc.acquire("f1c:_", { renewEveryMs: 0 });
    assert.ok(lease);
    assert.ok(lease.fence >= antes, `fence ${lease.fence} debe ser >= ${antes}`);
    assert.equal(redis.kv.get(THREAD_FENCE_KEY), String(lease.fence));
    await lease.release();
  });

  it("(c) la vista reentrante comparte el fence del lease exterior", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis());
    const key = "f3:_";
    await svc.runExclusive(
      key,
      async (_signal, outer) => {
        const inner = await svc.acquire(key, { renewEveryMs: 0 });
        assert.ok(inner);
        assert.equal(inner.fence, outer.fence);
        await inner.release();
      },
      { renewEveryMs: 0 },
    );
  });

  it("(d) si el script de fence falla, acquire lanza LOCK_UNAVAILABLE, libera el lease y el siguiente acquire funciona", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    let fallar = true;
    const realEval = redis.eval;
    redis.eval = async (...a: unknown[]) => {
      if (fallar && (a[0] as string).includes("incr")) throw new Error("INCR caído");
      return realEval(...a);
    };
    withRedis(svc, redis);
    await assert.rejects(svc.acquire("f4:_", { renewEveryMs: 0 }), (err: unknown) => {
      assert.ok(err instanceof ThreadLockUnavailableError);
      assert.equal(err.code, "LOCK_UNAVAILABLE");
      assert.match(err.message, new RegExp(FENCE_UNAVAILABLE_MESSAGE));
      assert.match(err.message, /INCR caído/);
      return true;
    });
    assert.equal(redis.kv.has(`${THREAD_LOCK_KEY_PREFIX}f4:_`), false, "el lease tomado se liberó");
    assert.equal(redis.calls.filter((c) => c.op === "release").length, 1);
    fallar = false;
    const ok = await svc.acquire("f4:_", { renewEveryMs: 0 });
    assert.ok(ok, "tras la liberación el hilo vuelve a tomarse");
    assert.ok(ok.fence > 0);
    await ok.release();
  });

  it("(e) runExclusive pasa el lease como segundo argumento (con key, fence e isHeld)", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis());
    const fence = await svc.runExclusive(
      "f5:_",
      async (signal, lease) => {
        assert.equal(lease.key, "f5:_");
        assert.equal(typeof lease.fence, "number");
        assert.equal(lease.isHeld(), true);
        assert.equal(signal.aborted, false);
        return lease.fence;
      },
      { renewEveryMs: 0 },
    );
    assert.equal(typeof fence, "number");
  });
});

describe("ThreadRunLockService (fence: suelo en el reloj, sin REDIS_URL)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("(a3) modo Map: aunque el contador interno vaya por detrás, el fence sube al reloj y sigue creciendo", async () => {
    const svc = new ThreadRunLockService();
    (svc as unknown as { memoryFence: number }).memoryFence = 5;
    const antes = Date.now();
    const a = await svc.acquire("f6:_", { renewEveryMs: 0 });
    assert.ok(a);
    assert.ok(a.fence >= antes, `fence ${a.fence} debe ser >= ${antes}`);
    await a.release();
    const b = await svc.acquire("f6:_", { renewEveryMs: 0 });
    assert.ok(b);
    assert.ok(b.fence > a.fence, `fence debe crecer: ${a.fence} -> ${b.fence}`);
    await b.release();
  });
});

describe("ThreadRunLockService (fence con Redis falso: suelo en el reloj y contexto MDD)", () => {
  let prevRedis: string | undefined;
  beforeEach(() => {
    prevRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // getRedis exige REDIS_URL; la conexión real se sustituye
  });
  afterEach(() => {
    if (prevRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prevRedis;
  });

  it("(a3) con el contador de Redis en 5 el fence es >= Date.now(), queda guardado y no retrocede", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    redis.kv.set(THREAD_FENCE_KEY, "5");
    withRedis(svc, redis);
    const antes = Date.now();
    const a = await svc.acquire("f1d:_", { renewEveryMs: 0 });
    assert.ok(a);
    assert.ok(a.fence >= antes, `fence ${a.fence} debe ser >= ${antes}`);
    assert.equal(redis.kv.get(THREAD_FENCE_KEY), String(a.fence));
    await a.release();
    const b = await svc.acquire("f1e:_", { renewEveryMs: 0 });
    assert.ok(b);
    assert.ok(b.fence > a.fence, `fence debe crecer: ${a.fence} -> ${b.fence}`);
    await b.release();
  });

  it("(a3) un contador de Redis ya por encima del reloj se incrementa (no se reinicia al reloj)", async () => {
    const svc = new ThreadRunLockService();
    const redis = fakeRedis();
    const alto = 9_999_999_999_999;
    redis.kv.set(THREAD_FENCE_KEY, String(alto));
    withRedis(svc, redis);
    const lease = await svc.acquire("f1f:_", { renewEveryMs: 0 });
    assert.ok(lease);
    assert.equal(lease.fence, alto + 1);
    await lease.release();
  });

  it("runExclusive fija el fence como contexto MDD; acquire directo no lo fija", async () => {
    const svc = new ThreadRunLockService();
    withRedis(svc, fakeRedis());
    assert.equal(getActiveMddLeaseFence(), undefined);
    const directo = await svc.acquire("c1:_", { renewEveryMs: 0 });
    assert.ok(directo);
    assert.equal(getActiveMddLeaseFence(), undefined, "acquire directo no fija contexto");
    await directo.release();
    const visto = await svc.runExclusive(
      "c1:_",
      async (_signal, lease) => {
        await sleep(2);
        return { dentro: getActiveMddLeaseFence(), fence: lease.fence };
      },
      { renewEveryMs: 0 },
    );
    assert.equal(visto.dentro, visto.fence, "el contexto MDD lleva el fence del lease del turno");
    assert.equal(getActiveMddLeaseFence(), undefined, "fuera de runExclusive no hay fence");
  });
});
