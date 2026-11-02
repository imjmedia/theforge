import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { JwtUserCache } from "./jwt-user-cache.js";
import { AuthRedisStore, type OtpConsumeResult } from "./auth-redis.store.js";

function makeService(outcome: OtpConsumeResult, user: Record<string, unknown> | null) {
  const store = { consumeOtpAttempt: async () => outcome };
  const service = new AuthService(
    { signAsync: async () => "jwt" } as never,
    {} as never,
    { user: { findUnique: async () => user } } as never,
    {} as never,
    store as never,
    new JwtUserCache(),
  );
  return service;
}

const user = { id: "u1", email: "a@test.com", role: "developer", mcpSecret: "s", name: null };

test("verifyOtp — locked → 401 'Demasiados intentos; solicita un código nuevo'", async () => {
  const service = makeService("locked", user);
  await assert.rejects(
    () => service.verifyOtp("a@test.com", "123456"),
    (err: unknown) =>
      err instanceof UnauthorizedException && err.message === "Demasiados intentos; solicita un código nuevo",
  );
});

test("verifyOtp — invalid y expired → 401 con el mensaje genérico", async () => {
  for (const outcome of ["invalid", "expired"] as const) {
    const service = makeService(outcome, user);
    await assert.rejects(
      () => service.verifyOtp("a@test.com", "123456"),
      (err: unknown) => err instanceof UnauthorizedException && err.message === "Código o correo inválido",
    );
  }
});

test("verifyOtp — ok emite JWT", async () => {
  const service = makeService("ok", user);
  const r = await service.verifyOtp(" A@Test.com ", "123 456");
  assert.equal(r.accessToken, "jwt");
  assert.equal(r.user.id, "u1");
});

test("verifyOtp — integración con el store en memoria: 5 fallos bloquean y el código correcto ya no sirve", async () => {
  const store = AuthRedisStore.createForTest({ env: { NODE_ENV: "test" } });
  const service = new AuthService(
    { signAsync: async () => "jwt" } as never,
    {} as never,
    { user: { findUnique: async () => user } } as never,
    {} as never,
    store,
    new JwtUserCache(),
  );
  await store.setOtp("a@test.com", "123456", 600);
  for (let i = 0; i < 4; i++) {
    await assert.rejects(() => service.verifyOtp("a@test.com", "000000"), /Código o correo inválido/);
  }
  await assert.rejects(() => service.verifyOtp("a@test.com", "000000"), /Demasiados intentos/);
  await assert.rejects(() => service.verifyOtp("a@test.com", "123456"), UnauthorizedException);
});
