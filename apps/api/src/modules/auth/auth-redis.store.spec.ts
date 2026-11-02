import test from "node:test";
import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  AUTH_OTP_MAX_ATTEMPTS,
  AuthRedisStore,
  OTP_CONSUME_LUA,
  OTP_LOCK_LUA,
  OTP_RESERVE_LUA,
  RATE_HIT_LUA,
  type AuthRedisClient,
} from "./auth-redis.store.js";

function memoryStore(clock: { t: number } = { t: 1_000_000 }) {
  return AuthRedisStore.createForTest({ env: { NODE_ENV: "test" }, now: () => clock.t });
}

test("OTP — 4 fallos y luego el código correcto → ok; el OTP es de un solo uso", async () => {
  const store = memoryStore();
  await store.setOtp("a@test.com", "123456", 600);
  for (let i = 0; i < AUTH_OTP_MAX_ATTEMPTS - 1; i++) {
    assert.equal(await store.consumeOtpAttempt("a@test.com", "000000"), "invalid");
  }
  assert.equal(await store.consumeOtpAttempt("a@test.com", "123456"), "ok");
  assert.notEqual(await store.consumeOtpAttempt("a@test.com", "123456"), "ok");
});

test("OTP — 5 fallos → locked y los intentos siguientes (incluso con el código correcto) siguen en locked", async () => {
  const store = memoryStore();
  await store.setOtp("a@test.com", "123456", 600);
  for (let i = 0; i < AUTH_OTP_MAX_ATTEMPTS - 1; i++) {
    assert.equal(await store.consumeOtpAttempt("a@test.com", "000000"), "invalid");
  }
  assert.equal(await store.consumeOtpAttempt("a@test.com", "000000"), "locked");
  assert.equal(await store.consumeOtpAttempt("a@test.com", "123456"), "locked");
  assert.equal(await store.consumeOtpAttempt("a@test.com", "000000"), "locked");
});

test("OTP — el bloqueo termina con el TTL del OTP (expired) y con un código nuevo", async () => {
  const clock = { t: 1_000_000 };
  const store = memoryStore(clock);
  await store.setOtp("a@test.com", "123456", 600);
  for (let i = 0; i < AUTH_OTP_MAX_ATTEMPTS; i++) await store.consumeOtpAttempt("a@test.com", "000000");
  assert.equal(await store.consumeOtpAttempt("a@test.com", "123456"), "locked");
  clock.t += 601_000;
  assert.equal(await store.consumeOtpAttempt("a@test.com", "123456"), "expired");
});

test("OTP — un código nuevo reinicia el contador de intentos", async () => {
  const store = memoryStore();
  await store.setOtp("a@test.com", "123456", 600);
  for (let i = 0; i < AUTH_OTP_MAX_ATTEMPTS; i++) await store.consumeOtpAttempt("a@test.com", "000000");
  await store.setOtp("a@test.com", "654321", 600);
  assert.equal(await store.consumeOtpAttempt("a@test.com", "654321"), "ok");
});

test("OTP — pasado el TTL → expired; sin OTP → expired", async () => {
  const clock = { t: 1_000_000 };
  const store = memoryStore(clock);
  assert.equal(await store.consumeOtpAttempt("x@test.com", "123456"), "expired");
  await store.setOtp("a@test.com", "123456", 600);
  clock.t += 601_000;
  assert.equal(await store.consumeOtpAttempt("a@test.com", "123456"), "expired");
});

test("OTP — código de longitud distinta no lanza y cuenta como fallo", async () => {
  const store = memoryStore();
  await store.setOtp("a@test.com", "123456", 600);
  assert.equal(await store.consumeOtpAttempt("a@test.com", "12"), "invalid");
});

test("reserveOtpSend — un envío por ventana; deleteOtp libera el reenvío", async () => {
  const store = memoryStore();
  assert.equal(await store.reserveOtpSend("a@test.com", 60), true);
  assert.equal(await store.reserveOtpSend("a@test.com", 60), false);
  await store.deleteOtp("a@test.com");
  assert.equal(await store.reserveOtpSend("a@test.com", 60), true);
});

test("hit — permite N, deniega N+1 con retryAfterSeconds y reabre al vencer la ventana", async () => {
  const clock = { t: 1_000_000 };
  const store = memoryStore(clock);
  for (let i = 1; i <= 3; i++) {
    const r = await store.hit("k", 3, 60);
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 3 - i);
  }
  clock.t += 10_000;
  const denied = await store.hit("k", 3, 60);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 50);
  clock.t += 51_000;
  assert.equal((await store.hit("k", 3, 60)).allowed, true);
});

test("REDIS_URL y NODE_ENV se leen del ConfigService inyectado por constructor", async () => {
  const reads: string[] = [];
  const config = {
    get: (key: string) => {
      reads.push(key);
      return key === "NODE_ENV" ? "production" : undefined;
    },
  };
  const store = new AuthRedisStore(config as never);
  await assert.rejects(() => store.hit("k", 1, 60), ServiceUnavailableException);
  assert.deepEqual(reads, ["REDIS_URL", "NODE_ENV"]);
  const devStore = new AuthRedisStore({ get: () => undefined } as never);
  assert.equal((await devStore.hit("k", 1, 60)).allowed, true);
});

test("producción sin REDIS_URL → 503 (falla cerrado) en todas las operaciones", async () => {
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "production" } });
  await assert.rejects(() => store.setOtp("a@test.com", "123456", 600), ServiceUnavailableException);
  await assert.rejects(() => store.consumeOtpAttempt("a@test.com", "123456"), ServiceUnavailableException);
  await assert.rejects(() => store.hit("k", 1, 60), ServiceUnavailableException);
});

/** Redis falso: emula los scripts Lua por identidad (la semántica real la cubre el modo memoria). */
function fakeRedis() {
  const kv = new Map<string, string>();
  const calls: string[] = [];
  const client: AuthRedisClient = {
    status: "ready",
    set: async (...args: unknown[]) => {
      calls.push("set");
      kv.set(String(args[0]), String(args[1]));
      return "OK";
    },
    del: async (...args: unknown[]) => {
      calls.push("del");
      let n = 0;
      for (const k of args) if (kv.delete(String(k))) n++;
      return n;
    },
    eval: async (...args: unknown[]) => {
      const [script, , ...rest] = args as [string, number, ...unknown[]];
      if (script === OTP_RESERVE_LUA) {
        calls.push("reserve");
        const [otpKey, failsKey, max] = rest as [string, string, number];
        const stored = kv.get(otpKey);
        if (!stored) {
          if (!kv.has(failsKey)) return ["expired"];
          return [Number(kv.get(failsKey)) >= max ? "locked" : "invalid"];
        }
        const n = Number(kv.get(failsKey) ?? 0) + 1;
        kv.set(failsKey, String(n));
        if (n > max) {
          kv.delete(otpKey);
          return ["locked"];
        }
        return ["check", stored, String(n)];
      }
      if (script === OTP_CONSUME_LUA) {
        calls.push("consume");
        const [otpKey, failsKey] = rest as [string, string];
        if (kv.delete(otpKey)) {
          kv.delete(failsKey);
          return 1;
        }
        return 0;
      }
      if (script === OTP_LOCK_LUA) {
        calls.push("lock");
        kv.delete(rest[0] as string);
        return 1;
      }
      if (script === RATE_HIT_LUA) {
        calls.push("hit");
        const key = rest[0] as string;
        const n = Number(kv.get(key) ?? 0) + 1;
        kv.set(key, String(n));
        return [n, 42];
      }
      throw new Error("script desconocido");
    },
  };
  return { client, kv, calls };
}

test("Redis — setOtp/consume: acierto y 5º fallo bloquean vía scripts atómicos", async () => {
  const { client, kv } = fakeRedis();
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "production" }, redis: client });
  await store.setOtp("a@test.com", "123456", 600);
  assert.equal(kv.get("auth:otp:a@test.com"), "123456");
  assert.equal(await store.consumeOtpAttempt("a@test.com", "123456"), "ok");
  assert.equal(kv.has("auth:otp:a@test.com"), false);

  await store.setOtp("b@test.com", "123456", 600);
  for (let i = 0; i < AUTH_OTP_MAX_ATTEMPTS - 1; i++) {
    assert.equal(await store.consumeOtpAttempt("b@test.com", "000000"), "invalid");
  }
  assert.equal(await store.consumeOtpAttempt("b@test.com", "000000"), "locked");
  assert.equal(await store.consumeOtpAttempt("b@test.com", "123456"), "locked");
});

test("Redis — hit usa retryAfter del TTL de Redis", async () => {
  const { client } = fakeRedis();
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "production" }, redis: client });
  const a = await store.hit("k", 1, 60);
  assert.deepEqual(a, { allowed: true, remaining: 0, retryAfterSeconds: 42 });
  const b = await store.hit("k", 1, 60);
  assert.deepEqual(b, { allowed: false, remaining: 0, retryAfterSeconds: 42 });
});

test("Redis — un error del cliente ⇒ 503, nunca permite", async () => {
  const client: AuthRedisClient = {
    status: "ready",
    set: async () => {
      throw new Error("ECONNRESET");
    },
    del: async () => {
      throw new Error("ECONNRESET");
    },
    eval: async () => {
      throw new Error("ECONNRESET");
    },
  };
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "production" }, redis: client });
  await assert.rejects(() => store.consumeOtpAttempt("a@test.com", "123456"), ServiceUnavailableException);
  await assert.rejects(() => store.hit("k", 5, 60), ServiceUnavailableException);
  await assert.rejects(() => store.setOtp("a@test.com", "123456", 600), ServiceUnavailableException);
});
