import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { setPlatformConfigOverrides } from "../system-config/platform-config.runtime.js";

function makeAuthService(prisma: {
  user: {
    findUnique: (args: unknown) => Promise<unknown>;
    create?: (args: unknown) => Promise<unknown>;
    update?: (args: unknown) => Promise<unknown>;
  };
}) {
  return new AuthService(
    {} as never,
    {} as never,
    { user: prisma.user } as never,
    {} as never,
  );
}

test("provisionUserFromForgeOps — crea usuario y expone devCode sin SMTP", async () => {
  setPlatformConfigOverrides({
    forgeops_provision_secret: "forgeops-test-secret",
    otp_dev_expose_code: "1",
  });

  const created: unknown[] = [];
  const service = makeAuthService({
    user: {
      findUnique: async () => null,
      create: async (args: unknown) => {
        created.push(args);
        return {
          id: "u-new",
          email: "new@test.com",
          role: "developer",
          name: "Nuevo",
        };
      },
    },
  });

  const result = await service.provisionUserFromForgeOps("Bearer forgeops-test-secret", {
    email: "new@test.com",
    name: "Nuevo",
    loginUrl: "https://theforge.example.com",
  });

  assert.equal(result.created, true);
  assert.equal(result.accessEmailSent, true);
  assert.match(result.devCode ?? "", /^\d{6}$/);
  assert.equal(result.user.email, "new@test.com");
  assert.equal(created.length, 1);

  setPlatformConfigOverrides({});
});

test("provisionUserFromForgeOps — usuario existente sin reenvío", async () => {
  setPlatformConfigOverrides({ forgeops_provision_secret: "forgeops-test-secret" });

  const service = makeAuthService({
    user: {
      findUnique: async () => ({
        id: "u-1",
        email: "exists@test.com",
        role: "developer",
        name: null,
      }),
    },
  });

  const result = await service.provisionUserFromForgeOps("Bearer forgeops-test-secret", {
    email: "exists@test.com",
    resendIfExists: false,
  });

  assert.equal(result.created, false);
  assert.equal(result.accessEmailSent, false);

  setPlatformConfigOverrides({});
});

test("provisionUserFromForgeOps — rechaza token inválido", async () => {
  setPlatformConfigOverrides({ forgeops_provision_secret: "forgeops-test-secret" });

  const service = makeAuthService({
    user: {
      findUnique: async () => null,
    },
  });

  await assert.rejects(
    () =>
      service.provisionUserFromForgeOps("Bearer wrong", {
        email: "x@test.com",
      }),
    UnauthorizedException,
  );

  setPlatformConfigOverrides({});
});
