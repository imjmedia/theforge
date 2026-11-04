import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TokenCryptoService } from "../crypto/token-crypto.service.js";
import { FigmaClient } from "./figma.client.js";
import { throwFigmaNotConnected, throwFigmaTokenInvalid, isFigmaTokenInvalid } from "./figma.errors.js";

export type FigmaCredentialStatus = {
  connected: boolean;
  figmaHandle: string | null;
  lastValidatedAt: string | null;
};

@Injectable()
export class FigmaCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly figmaClient: FigmaClient,
  ) {}

  async getStatus(userId: string): Promise<FigmaCredentialStatus> {
    const row = await this.prisma.userFigmaCredential.findUnique({ where: { userId } });
    if (!row) {
      return { connected: false, figmaHandle: null, lastValidatedAt: null };
    }
    return {
      connected: true,
      figmaHandle: row.figmaHandle,
      lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    };
  }

  async upsertToken(userId: string, token: string): Promise<FigmaCredentialStatus> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error("Token vacío");
    }
    let handle: string | null = null;
    try {
      const me = await this.figmaClient.validateToken(userId, trimmed);
      handle = me.handle;
    } catch (err) {
      if (isFigmaTokenInvalid(err)) throw err;
      throwFigmaTokenInvalid();
    }
    const { ciphertext, keyVersion } = this.tokenCrypto.encrypt(trimmed);
    const now = new Date();
    await this.prisma.userFigmaCredential.upsert({
      where: { userId },
      create: {
        userId,
        tokenCiphertext: ciphertext,
        tokenKeyVersion: keyVersion,
        figmaHandle: handle,
        lastValidatedAt: now,
      },
      update: {
        tokenCiphertext: ciphertext,
        tokenKeyVersion: keyVersion,
        figmaHandle: handle,
        lastValidatedAt: now,
      },
    });
    return this.getStatus(userId);
  }

  async deleteCredential(userId: string): Promise<{ ok: true }> {
    await this.prisma.userFigmaCredential.deleteMany({ where: { userId } });
    return { ok: true };
  }

  async requireDecryptedToken(userId: string): Promise<string> {
    const row = await this.prisma.userFigmaCredential.findUnique({ where: { userId } });
    if (!row) {
      throwFigmaNotConnected();
    }
    return this.tokenCrypto.decrypt(row!.tokenCiphertext, row!.tokenKeyVersion);
  }
}
