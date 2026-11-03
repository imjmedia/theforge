import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./auth.service.js";
import { JwtUserCache } from "./jwt-user-cache.js";

type UserRow = { id: string; email: string; role: string; mcpSecret: string | null; name: string | null; tokenVersion: number };

function makeService(rows: UserRow[]) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const signed: Record<string, unknown>[] = [];
  const cache = new JwtUserCache();
  const invalidated: string[] = [];
  const originalInvalidate = cache.invalidate.bind(cache);
  cache.invalidate = (id: string) => {
    invalidated.push(id);
    originalInvalidate(id);
  };
  const service = new AuthService(
    {
      signAsync: async (payload: Record<string, unknown>) => {
        signed.push(payload);
        return "jwt";
      },
    } as never,
    {} as never,
    {
      user: {
        findUnique: async (args: { where: { id?: string; email?: string; mcpSecret?: string } }) =>
          rows.find(
            (r) =>
              (args.where.id && r.id === args.where.id) ||
              (args.where.email && r.email === args.where.email) ||
              (args.where.mcpSecret && r.mcpSecret === args.where.mcpSecret),
          ) ?? null,
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          const row = rows.find((r) => r.id === args.where.id)!;
          const { tokenVersion, ...rest } = args.data as { tokenVersion?: { increment: number } };
          const next = tokenVersion ? { tokenVersion: row.tokenVersion + tokenVersion.increment } : {};
          return { ...row, ...rest, ...next };
        },
      },
    } as never,
    {} as never,
    { consumeOtpAttempt: async () => "ok" } as never,
    cache,
  );
  return { service, updates, signed, invalidated, cache };
}

const dev: UserRow = { id: "dev-1", email: "dev@test.com", role: "developer", mcpSecret: "s-dev", name: null, tokenVersion: 3 };
const admin: UserRow = { id: "admin-1", email: "admin@test.com", role: "admin", mcpSecret: "s-admin", name: null, tokenVersion: 0 };

test("updateUserRole — incrementa tokenVersion e invalida la caché del usuario", async () => {
  const { service, updates, invalidated } = makeService([dev, admin]);
  await service.updateUserRole("dev-1", "admin", "admin-1", "admin");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]!.data.tokenVersion, { increment: 1 });
  assert.deepEqual(invalidated, ["dev-1"]);
});

test("updateUserRole — mismo rol: no incrementa tokenVersion, no actualiza ni invalida", async () => {
  const { service, updates, invalidated } = makeService([dev, admin]);
  const r = await service.updateUserRole("dev-1", "developer", "admin-1", "admin");
  assert.deepEqual(r, { id: "dev-1", email: "dev@test.com", role: "developer" });
  assert.equal(updates.length, 0);
  assert.deepEqual(invalidated, []);
});

test("regenerateMcpSecret — incrementa tokenVersion, invalida la caché y devuelve un accessToken con el tv nuevo", async () => {
  const { service, updates, invalidated, signed } = makeService([dev]);
  const r = await service.regenerateMcpSecret("dev-1");
  assert.match(r.mcpSecret, /^[0-9a-f]{64}$/);
  assert.deepEqual(updates[0]!.data.tokenVersion, { increment: 1 });
  assert.equal(updates[0]!.data.mcpSecret, r.mcpSecret);
  assert.deepEqual(invalidated, ["dev-1"]);
  // El token nuevo se firma con tokenVersion ya incrementado (3 → 4), así que no es revocado por la rotación.
  assert.equal(r.accessToken, "jwt");
  assert.equal(signed.length, 1);
  assert.equal(signed[0]!.sub, "dev-1");
  assert.equal(signed[0]!.email, "dev@test.com");
  assert.equal(signed[0]!.role, "developer");
  assert.equal(signed[0]!.tv, 4);
  assert.deepEqual(Object.keys(r).sort(), ["accessToken", "mcpSecret"]);
});

test("regenerateUserMcpSecretAdmin — incrementa tokenVersion e invalida la caché", async () => {
  const { service, updates, invalidated } = makeService([dev, admin]);
  await service.regenerateUserMcpSecretAdmin("dev-1", "admin");
  assert.deepEqual(updates[0]!.data.tokenVersion, { increment: 1 });
  assert.deepEqual(invalidated, ["dev-1"]);
});

test("getMcpSecret — la primera generación no sube tokenVersion (no cierra la sesión)", async () => {
  const { service, updates } = makeService([{ ...dev, mcpSecret: null }]);
  const r = await service.getMcpSecret("dev-1");
  assert.ok("mcpSecret" in r && r.mcpSecret);
  assert.equal("tokenVersion" in updates[0]!.data, false);
});

test("updateUserProfile — cambio de email sube tokenVersion; solo nombre no, pero ambos invalidan la caché", async () => {
  const { service, updates, invalidated } = makeService([dev, admin]);
  await service.updateUserProfile("dev-1", { name: "Nuevo" }, "admin");
  assert.equal("tokenVersion" in updates[0]!.data, false);
  await service.updateUserProfile("dev-1", { email: "Nuevo@Test.com" }, "admin");
  assert.equal(updates[1]!.data.email, "nuevo@test.com");
  assert.deepEqual(updates[1]!.data.tokenVersion, { increment: 1 });
  assert.deepEqual(invalidated, ["dev-1", "dev-1"]);
});

test("verifyOtp — el JWT firmado lleva tv = tokenVersion del usuario", async () => {
  const { service, signed } = makeService([dev]);
  await service.verifyOtp("dev@test.com", "123456");
  assert.equal(signed[0]!.tv, 3);
  assert.equal(signed[0]!.sub, "dev-1");
});

test("mcpLogin — el JWT firmado lleva tv", async () => {
  const { service, signed } = makeService([dev]);
  await service.mcpLogin("s-dev");
  assert.equal(signed[0]!.tv, 3);
});
