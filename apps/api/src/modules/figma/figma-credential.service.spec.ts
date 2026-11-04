import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreconditionFailedException } from "@nestjs/common";
import { FigmaCredentialService } from "./figma-credential.service.js";
import type { FigmaClient } from "./figma.client.js";
import type { TokenCryptoService } from "../crypto/token-crypto.service.js";

describe("figma-credential.service", () => {
  it("GET nunca devuelve el token", async () => {
    const prisma = {
      userFigmaCredential: {
        findUnique: async () => ({
          figmaHandle: "designer",
          lastValidatedAt: new Date("2026-01-01"),
          tokenCiphertext: "cipher",
          tokenKeyVersion: 1,
        }),
      },
    };
    const svc = new FigmaCredentialService(
      prisma as never,
      { decrypt: () => "secret-token" } as TokenCryptoService,
      {} as FigmaClient,
    );
    const status = await svc.getStatus("u1");
    assert.equal(status.connected, true);
    assert.equal(status.figmaHandle, "designer");
    assert.equal("token" in status, false);
  });

  it("CL-31: sin credencial → ERR_FIGMA_NOT_CONNECTED", async () => {
    const prisma = {
      userFigmaCredential: {
        findUnique: async () => null,
      },
    };
    const svc = new FigmaCredentialService(prisma as never, {} as TokenCryptoService, {} as FigmaClient);
    await assert.rejects(
      () => svc.requireDecryptedToken("u1"),
      (e: unknown) => {
        assert.ok(e instanceof PreconditionFailedException);
        assert.equal((e.getResponse() as { code?: string }).code, "ERR_FIGMA_NOT_CONNECTED");
        return true;
      },
    );
  });
});
