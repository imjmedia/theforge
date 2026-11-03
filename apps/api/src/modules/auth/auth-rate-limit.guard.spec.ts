import test from "node:test";
import assert from "node:assert/strict";
import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AUTH_RATE_LIMIT_EMAIL,
  AUTH_RATE_LIMIT_EMAIL_VERIFY,
  AUTH_RATE_LIMIT_IP,
  AUTH_RATE_LIMIT_IP_MCP,
  AUTH_RATE_LIMIT_MCP_SECRET,
  AUTH_RATE_LIMIT_PROFILE_KEY,
  AuthRateLimitGuard,
} from "./auth-rate-limit.guard.js";
import { AuthRedisStore } from "./auth-redis.store.js";

function makeContext(req: Record<string, unknown>, profile?: string) {
  const headers: Record<string, string> = {};
  const handler = () => undefined;
  if (profile) Reflect.defineMetadata(AUTH_RATE_LIMIT_PROFILE_KEY, profile, handler);
  const ctx = {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader: (k: string, v: string) => void (headers[k] = v) }),
    }),
  };
  return { ctx: ctx as never, headers };
}

function makeGuard(clock = { t: 1_000_000 }) {
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "test" }, now: () => clock.t });
  return { guard: new AuthRateLimitGuard(store, new Reflector()), clock };
}

async function expect429(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof HttpException);
    assert.equal(err.getStatus(), 429);
    return err;
  }
  throw new Error("se esperaba 429");
}

test("guard — supera el límite por IP → 429 con Retry-After", async () => {
  const { guard, clock } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_IP.limit; i++) {
    const { ctx } = makeContext({ ip: "1.2.3.4", body: {} });
    assert.equal(await guard.canActivate(ctx), true);
  }
  clock.t += 5_000;
  const { ctx, headers } = makeContext({ ip: "1.2.3.4", body: {} });
  await expect429(guard.canActivate(ctx));
  assert.equal(headers["Retry-After"], String(AUTH_RATE_LIMIT_IP.windowSeconds - 5));
  // Otra IP no se ve afectada.
  const other = makeContext({ ip: "5.6.7.8", body: {} });
  assert.equal(await guard.canActivate(other.ctx), true);
});

test("guard — supera el límite por email (normalizado) aunque cambie la IP → 429", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_EMAIL.limit; i++) {
    const { ctx } = makeContext({ ip: `10.0.0.${i}`, body: { email: i % 2 ? " A@Test.com " : "a@test.com" } });
    assert.equal(await guard.canActivate(ctx), true);
  }
  const { ctx, headers } = makeContext({ ip: "10.0.0.99", body: { email: "A@TEST.com" } });
  await expect429(guard.canActivate(ctx));
  assert.equal(headers["Retry-After"], String(AUTH_RATE_LIMIT_EMAIL.windowSeconds));
});

test("guard — perfil verify admite 10 por email y deniega el 11", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_EMAIL_VERIFY.limit; i++) {
    const { ctx } = makeContext({ ip: `10.0.1.${i}`, body: { email: "v@test.com" } }, "verify");
    assert.equal(await guard.canActivate(ctx), true);
  }
  const { ctx } = makeContext({ ip: "10.0.1.200", body: { email: "v@test.com" } }, "verify");
  await expect429(guard.canActivate(ctx));
});

test("guard — sin email en el body solo aplica el límite por IP", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_EMAIL.limit + 3; i++) {
    const { ctx } = makeContext({ ip: "9.9.9.9", body: { secret: "x" } });
    assert.equal(await guard.canActivate(ctx), true);
  }
});

test("guard — producción sin Redis falla cerrado (503)", async () => {
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "production" } });
  const guard = new AuthRateLimitGuard(store, new Reflector());
  const { ctx } = makeContext({ ip: "1.1.1.1", body: {} });
  await assert.rejects(() => guard.canActivate(ctx), ServiceUnavailableException);
});

test("guard mcp-login — dos secrets distintos desde la misma IP no comparten cubeta", async () => {
  const { guard } = makeGuard();
  // Un secret agota su cubeta...
  for (let i = 0; i < AUTH_RATE_LIMIT_MCP_SECRET.limit; i++) {
    const { ctx } = makeContext({ ip: "172.18.0.5", body: { secret: "a".repeat(64) } }, "mcp-login");
    assert.equal(await guard.canActivate(ctx), true);
  }
  const blocked = makeContext({ ip: "172.18.0.5", body: { secret: "a".repeat(64) } }, "mcp-login");
  await expect429(guard.canActivate(blocked.ctx));
  // ...y otro secret desde la misma IP sigue pasando (incluso más de 20 veces: la cubeta de IP es amplia).
  for (let i = 0; i < AUTH_RATE_LIMIT_MCP_SECRET.limit; i++) {
    const { ctx } = makeContext({ ip: "172.18.0.5", body: { secret: "b".repeat(64) } }, "mcp-login");
    assert.equal(await guard.canActivate(ctx), true);
  }
});

test("guard mcp-login — el mismo secret 21 veces → 429 con Retry-After", async () => {
  const { guard, clock } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_MCP_SECRET.limit; i++) {
    const { ctx } = makeContext({ ip: `10.1.0.${i}`, body: { secret: "c".repeat(64) } }, "mcp-login");
    assert.equal(await guard.canActivate(ctx), true);
  }
  clock.t += 7_000;
  const { ctx, headers } = makeContext({ ip: "10.1.0.200", body: { secret: "c".repeat(64) } }, "mcp-login");
  await expect429(guard.canActivate(ctx));
  assert.equal(headers["Retry-After"], String(AUTH_RATE_LIMIT_MCP_SECRET.windowSeconds - 7));
});

test("guard mcp-login — la cubeta por IP es amplia: 600/min por IP y el 601 recibe 429", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_IP_MCP.limit; i++) {
    const { ctx } = makeContext({ ip: "172.18.0.9", body: { secret: `s-${i}` } }, "mcp-login");
    assert.equal(await guard.canActivate(ctx), true);
  }
  const { ctx } = makeContext({ ip: "172.18.0.9", body: { secret: "otro" } }, "mcp-login");
  await expect429(guard.canActivate(ctx));
});

test("guard mcp-login — la clave de Redis lleva el sha256 del secret, nunca el secret", async () => {
  const keys: string[] = [];
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "test" } });
  const original = store.hit.bind(store);
  store.hit = async (key: string, limit: number, windowSeconds: number) => {
    keys.push(key);
    return original(key, limit, windowSeconds);
  };
  const guard = new AuthRateLimitGuard(store, new Reflector());
  const secret = "d".repeat(64);
  const { ctx } = makeContext({ ip: "1.1.1.1", body: { secret } }, "mcp-login");
  await guard.canActivate(ctx);
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k) => !k.includes(secret)));
  assert.match(keys[1]!, /^auth:rl:mcp-secret:[0-9a-f]{64}$/);
});

test("guard mcp-login — sin secret en el body solo aplica la cubeta amplia de IP", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < AUTH_RATE_LIMIT_MCP_SECRET.limit + 5; i++) {
    const { ctx } = makeContext({ ip: "2.2.2.2", body: {} }, "mcp-login");
    assert.equal(await guard.canActivate(ctx), true);
  }
});
