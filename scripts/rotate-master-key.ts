#!/usr/bin/env npx tsx
/**
 * Re-cifra tokens BYOK hacia TOKEN_ACTIVE_KEY_VERSION.
 * Tablas: user_provider_configs, provider_instances, user_figma_credentials, ui_mcp_instances.
 *
 * Requiere: DATABASE_URL, TOKEN_MASTER_KEYS, TOKEN_ACTIVE_KEY_VERSION
 * Uso: npm run rotate-master-key
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@theforge/database";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function parseKeys(): Map<number, Buffer> {
  const raw = process.env.TOKEN_MASTER_KEYS?.trim();
  if (!raw) throw new Error("TOKEN_MASTER_KEYS requerido");
  const parsed = JSON.parse(raw) as Record<string, string>;
  const map = new Map<number, Buffer>();
  for (const [k, v] of Object.entries(parsed)) {
    const version = parseInt(k, 10);
    const buf = Buffer.from(v, "base64");
    if (buf.length !== 32) throw new Error(`Clave ${k} inválida (debe ser 32 bytes en base64)`);
    map.set(version, buf);
  }
  return map;
}

function decryptBlob(ciphertext: string, keys: Map<number, Buffer>): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || !parts[0]?.startsWith("v")) throw new Error("blob inválido");
  const version = parseInt(parts[0].slice(1), 10);
  const key = keys.get(version);
  if (!key) throw new Error(`sin clave v${version} en TOKEN_MASTER_KEYS`);
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const data = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function encryptBlob(plaintext: string, version: number, keys: Map<number, Buffer>): string {
  const key = keys.get(version);
  if (!key) throw new Error(`sin clave activa v${version}`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${version}`, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

type TokenRow = { id: string; tokenCiphertext: string; tokenKeyVersion: number | null };

async function rotateTable(
  label: string,
  rows: TokenRow[],
  targetVersion: number,
  keys: Map<number, Buffer>,
  update: (id: string, ciphertext: string, keyVersion: number) => Promise<void>,
): Promise<{ rotated: number; skipped: number }> {
  let rotated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.tokenCiphertext?.trim()) {
      skipped++;
      continue;
    }
    if (row.tokenKeyVersion === targetVersion) {
      skipped++;
      continue;
    }
    const plain = decryptBlob(row.tokenCiphertext, keys);
    const next = encryptBlob(plain, targetVersion, keys);
    await update(row.id, next, targetVersion);
    rotated++;
  }
  console.log(`  ${label}: rotated=${rotated} skipped=${skipped}`);
  return { rotated, skipped };
}

async function main(): Promise<void> {
  const keys = parseKeys();
  const targetVersion = parseInt(process.env.TOKEN_ACTIVE_KEY_VERSION?.trim() || "1", 10);
  if (!keys.has(targetVersion)) {
    throw new Error(`TOKEN_ACTIVE_KEY_VERSION=${targetVersion} no está en TOKEN_MASTER_KEYS`);
  }

  const prisma = new PrismaClient();

  const userConfigs = await prisma.userProviderConfig.findMany({
    select: { id: true, tokenCiphertext: true, tokenKeyVersion: true },
  });
  const instances = await prisma.providerInstance.findMany({
    select: { id: true, tokenCiphertext: true, tokenKeyVersion: true },
  });
  const figmaCreds = await prisma.userFigmaCredential.findMany({
    select: { id: true, tokenCiphertext: true, tokenKeyVersion: true },
  });
  const uiMcpInstances = await prisma.uiMcpInstance.findMany({
    where: { tokenCiphertext: { not: null } },
    select: { id: true, tokenCiphertext: true, tokenKeyVersion: true },
  });

  console.log(`rotate-master-key → target=v${targetVersion}`);
  const a = await rotateTable(
    "user_provider_configs",
    userConfigs,
    targetVersion,
    keys,
    (id, tokenCiphertext, tokenKeyVersion) =>
      prisma.userProviderConfig.update({ where: { id }, data: { tokenCiphertext, tokenKeyVersion } }),
  );
  const b = await rotateTable(
    "provider_instances",
    instances,
    targetVersion,
    keys,
    (id, tokenCiphertext, tokenKeyVersion) =>
      prisma.providerInstance.update({ where: { id }, data: { tokenCiphertext, tokenKeyVersion } }),
  );
  const c = await rotateTable(
    "user_figma_credentials",
    figmaCreds,
    targetVersion,
    keys,
    (id, tokenCiphertext, tokenKeyVersion) =>
      prisma.userFigmaCredential.update({ where: { id }, data: { tokenCiphertext, tokenKeyVersion } }),
  );
  const d = await rotateTable(
    "ui_mcp_instances",
    uiMcpInstances.map((r) => ({
      id: r.id,
      tokenCiphertext: r.tokenCiphertext ?? "",
      tokenKeyVersion: r.tokenKeyVersion,
    })),
    targetVersion,
    keys,
    (id, tokenCiphertext, tokenKeyVersion) =>
      prisma.uiMcpInstance.update({ where: { id }, data: { tokenCiphertext, tokenKeyVersion } }),
  );

  console.log(
    `rotate-master-key: total rotated=${a.rotated + b.rotated + c.rotated + d.rotated} skipped=${a.skipped + b.skipped + c.skipped + d.skipped} target=v${targetVersion}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
