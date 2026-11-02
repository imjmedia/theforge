import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { JwtUserCache } from "./jwt-user-cache.js";

type UserRow = { id: string; email: string; role: string; mcpSecret?: string | null };

function makeService(rows: UserRow[]) {
  const cache = new JwtUserCache();
  const invalidated: string[] = [];
  const originalInvalidate = cache.invalidate.bind(cache);
  cache.invalidate = (id: string) => {
    invalidated.push(id);
    originalInvalidate(id);
  };
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  const service = new AuthService(
    {} as never,
    {} as never,
    {
      user: {
        findUnique: async (args: { where: { id?: string; email?: string } }) =>
          rows.find((r) => r.id === args.where.id || r.email === args.where.email) ?? null,
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          const row = rows.find((r) => r.id === args.where.id)!;
          return { ...row, ...args.data };
        },
        create: async (args: { data: Record<string, unknown> }) => {
          creates.push(args.data);
          return { id: "nuevo", ...args.data };
        },
        delete: async (args: { where: { id: string } }) => {
          deletes.push(args.where.id);
          return {};
        },
      },
    } as never,
    {} as never,
    {} as never,
    cache,
  );
  return { service, updates, creates, deletes, invalidated };
}

const dev: UserRow = { id: "dev-1", email: "dev@test.com", role: "developer", mcpSecret: "s-dev" };
const admin: UserRow = { id: "admin-1", email: "admin@test.com", role: "admin", mcpSecret: "s-admin" };
const sa: UserRow = { id: "sa-1", email: "sa@test.com", role: "super_admin", mcpSecret: "s-sa" };

test("updateUserRole — admin no puede asignar super_admin (403)", async () => {
  const { service, updates } = makeService([dev, admin]);
  await assert.rejects(() => service.updateUserRole("dev-1", "super_admin", "admin-1", "admin"), ForbiddenException);
  assert.deepEqual(updates, []);
});

test("updateUserRole — admin no puede cambiar el rol de un super_admin (403)", async () => {
  const { service, updates } = makeService([sa, admin]);
  await assert.rejects(() => service.updateUserRole("sa-1", "developer", "admin-1", "admin"), ForbiddenException);
  assert.deepEqual(updates, []);
});

test("updateUserRole — admin gestiona developer y admin (paridad)", async () => {
  const { service, updates } = makeService([dev, admin]);
  const r = await service.updateUserRole("dev-1", "admin", "admin-1", "admin");
  assert.equal(r.role, "admin");
  assert.deepEqual(updates, [{ id: "dev-1", data: { role: "admin", tokenVersion: { increment: 1 } } }]);
});

test("updateUserRole — super_admin asigna super_admin (OK)", async () => {
  const { service, updates } = makeService([dev, sa]);
  const r = await service.updateUserRole("dev-1", "super_admin", "sa-1", "super_admin");
  assert.equal(r.role, "super_admin");
  assert.deepEqual(updates, [{ id: "dev-1", data: { role: "super_admin", tokenVersion: { increment: 1 } } }]);
});

test("updateUserRole — nadie cambia su propio rol (403), tampoco un super_admin", async () => {
  const { service, updates } = makeService([admin, sa]);
  await assert.rejects(() => service.updateUserRole("admin-1", "developer", "admin-1", "admin"), ForbiddenException);
  await assert.rejects(() => service.updateUserRole("admin-1", "admin", "admin-1", "admin"), ForbiddenException);
  await assert.rejects(() => service.updateUserRole("sa-1", "admin", "sa-1", "super_admin"), ForbiddenException);
  assert.deepEqual(updates, []);
});

test("getUserMcpSecretAdmin — admin no lee el secret de un super_admin (403)", async () => {
  const { service } = makeService([sa]);
  await assert.rejects(() => service.getUserMcpSecretAdmin("sa-1", "admin"), ForbiddenException);
});

test("getUserMcpSecretAdmin — admin lee el de un developer; super_admin lee el de un super_admin", async () => {
  const { service } = makeService([dev, sa]);
  assert.equal((await service.getUserMcpSecretAdmin("dev-1", "admin")).mcpSecret, "s-dev");
  assert.equal((await service.getUserMcpSecretAdmin("sa-1", "super_admin")).mcpSecret, "s-sa");
});

test("regenerateUserMcpSecretAdmin — admin no regenera el de un super_admin (403)", async () => {
  const { service, updates } = makeService([sa]);
  await assert.rejects(() => service.regenerateUserMcpSecretAdmin("sa-1", "admin"), ForbiddenException);
  assert.deepEqual(updates, []);
});

test("updateUserProfile — admin no cambia email de un super_admin (403); super_admin sí", async () => {
  const { service, updates } = makeService([sa]);
  await assert.rejects(
    () => service.updateUserProfile("sa-1", { email: "otro@test.com" }, "admin"),
    ForbiddenException,
  );
  assert.deepEqual(updates, []);
  const r = await service.updateUserProfile("sa-1", { name: "Nuevo" }, "super_admin");
  assert.equal(r.name, "Nuevo");
});

test("createUser — admin no crea super_admin (403); super_admin sí; admin crea admin", async () => {
  const { service, creates } = makeService([]);
  await assert.rejects(() => service.createUser("a@test.com", undefined, "super_admin", "admin"), ForbiddenException);
  assert.deepEqual(creates, []);
  const r1 = await service.createUser("b@test.com", undefined, "super_admin", "super_admin");
  assert.equal(r1.role, "super_admin");
  const r2 = await service.createUser("c@test.com", undefined, "admin", "admin");
  assert.equal(r2.role, "admin");
});

test("deleteUser — admin no borra a un super_admin (403); super_admin sí; no a sí mismo", async () => {
  const { service, deletes } = makeService([sa, dev]);
  await assert.rejects(() => service.deleteUser("sa-1", "admin-1", "admin"), ForbiddenException);
  assert.deepEqual(deletes, []);
  await service.deleteUser("sa-1", "sa-2", "super_admin");
  assert.deepEqual(deletes, ["sa-1"]);
  await assert.rejects(() => service.deleteUser("dev-1", "dev-1", "admin"), ForbiddenException);
});
