import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "./jwt.strategy.js";
import { JwtUserCache } from "./jwt-user-cache.js";

type Row = { id: string; email: string; role: string; tokenVersion: number };

function makeStrategy(row: Row | null) {
  let queries = 0;
  const prisma = {
    user: {
      findUnique: async (args: { where: { id: string } }) => {
        queries++;
        return row && row.id === args.where.id ? { ...row } : null;
      },
    },
  };
  const cache = new JwtUserCache();
  const config = { get: () => "test-secret" };
  const strategy = new JwtStrategy(config as never, prisma as never, cache);
  return { strategy, cache, queries: () => queries };
}

const dev: Row = { id: "u1", email: "bd@test.com", role: "developer", tokenVersion: 0 };

test("validate — usuario inexistente → 401", async () => {
  const { strategy } = makeStrategy(null);
  await assert.rejects(
    () => strategy.validate({ sub: "fantasma", email: "x@test.com", role: "admin" }),
    UnauthorizedException,
  );
});

test("validate — el rol y el email salen de la BD, no del payload", async () => {
  const { strategy } = makeStrategy(dev);
  const r = await strategy.validate({ sub: "u1", email: "viejo@test.com", role: "super_admin" });
  assert.deepEqual(r, { userId: "u1", email: "bd@test.com", role: "developer" });
});

test("validate — la segunda llamada dentro del TTL no consulta la BD; tras invalidate sí", async () => {
  const { strategy, cache, queries } = makeStrategy(dev);
  await strategy.validate({ sub: "u1", email: "a", role: "developer" });
  await strategy.validate({ sub: "u1", email: "a", role: "developer" });
  assert.equal(queries(), 1);
  cache.invalidate("u1");
  await strategy.validate({ sub: "u1", email: "a", role: "developer" });
  assert.equal(queries(), 2);
});

test("validate — tokenVersion distinta → 401", async () => {
  const { strategy } = makeStrategy({ ...dev, tokenVersion: 2 });
  await assert.rejects(
    () => strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 1 }),
    UnauthorizedException,
  );
  const ok = await strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 2 });
  assert.equal(ok.userId, "u1");
});

test("validate — token sin claim tv sigue válido mientras tokenVersion sea 0, y deja de serlo al subir", async () => {
  const { strategy } = makeStrategy(dev);
  const r = await strategy.validate({ sub: "u1", email: "a", role: "developer" });
  assert.equal(r.userId, "u1");

  const bumped = makeStrategy({ ...dev, tokenVersion: 1 });
  await assert.rejects(
    () => bumped.strategy.validate({ sub: "u1", email: "a", role: "developer" }),
    UnauthorizedException,
  );
});

test("validate — un usuario degradado tras invalidar deja de operar con el rol viejo", async () => {
  const row: Row = { ...dev, role: "admin" };
  const { strategy, cache } = makeStrategy(row);
  assert.equal((await strategy.validate({ sub: "u1", email: "a", role: "admin" })).role, "admin");
  row.role = "developer";
  cache.invalidate("u1");
  // El row del mock se copia en cada consulta: reflejará el rol nuevo.
  assert.equal((await strategy.validate({ sub: "u1", email: "a", role: "admin" })).role, "developer");
});

test("validate — carrera: lectura de BD previa a invalidate (rotación) no deja la fila vieja en caché", async () => {
  // La BD responde con tokenVersion 0 pero solo cuando la prueba lo libera (simula una lectura lenta).
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reads = 0;
  const prisma = {
    user: {
      findUnique: async () => {
        reads++;
        const snapshot = { id: "u1", email: "bd@test.com", role: "developer", tokenVersion: 0 };
        if (reads === 1) await gate;
        return reads === 1 ? snapshot : { ...snapshot, tokenVersion: 1 };
      },
    },
  };
  const cache = new JwtUserCache();
  const strategy = new JwtStrategy({ get: () => "test-secret" } as never, prisma as never, cache);

  const inFlight = strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 0 }); // A lee tv=0
  await Promise.resolve();
  cache.invalidate("u1"); // regenerateMcpSecret: update (tv=1) + invalidate
  release();
  await inFlight; // A termina con su lectura (el token viejo pasa una sola vez), pero no cachea
  assert.equal(cache.get("u1"), undefined);

  // El token viejo ya se rechaza porque la siguiente petición lee la BD (tv=1)...
  await assert.rejects(
    () => strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 0 }),
    UnauthorizedException,
  );
  // ...y el token nuevo pasa.
  assert.equal((await strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 1 })).userId, "u1");
});

test("validate — caché vieja con tv del token mayor: relee la BD una vez antes de rechazar", async () => {
  const row: Row = { ...dev, tokenVersion: 1 };
  const { strategy, cache, queries } = makeStrategy(row);
  cache.set("u1", { ...row, tokenVersion: 0 }); // otra réplica rotó; esta tiene la fila vieja en caché
  const r = await strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 1 });
  assert.equal(r.userId, "u1");
  assert.equal(queries(), 1);
  assert.equal(cache.get("u1")?.tokenVersion, 1);
});

test("validate — token revocado (tv menor que el cacheado) se rechaza sin releer la BD", async () => {
  const { strategy, queries } = makeStrategy({ ...dev, tokenVersion: 2 });
  await strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 2 }); // llena la caché
  await assert.rejects(
    () => strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 1 }),
    UnauthorizedException,
  );
  assert.equal(queries(), 1);
});

test("validate — caché vieja y la BD tampoco coincide con un tv mayor: 401", async () => {
  const { strategy, cache } = makeStrategy({ ...dev, tokenVersion: 1 });
  cache.set("u1", { ...dev, tokenVersion: 1 });
  await assert.rejects(
    () => strategy.validate({ sub: "u1", email: "a", role: "developer", tv: 5 }),
    UnauthorizedException,
  );
});
