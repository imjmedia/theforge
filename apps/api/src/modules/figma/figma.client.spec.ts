import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FigmaClient } from "./figma.client.js";

function mockConfig(): ConfigService {
  return {
    get: (key: string, def?: unknown) => {
      if (key === "FIGMA_API_BASE_URL") return "https://api.figma.com";
      if (key === "DESIGN_FIRST_FIGMA_TIMEOUT_MS") return 5_000;
      return def;
    },
  } as ConfigService;
}

describe("figma.client", () => {
  it("CL-01: 401 → ERR_FIGMA_TOKEN_INVALID", async () => {
    const client = FigmaClient.createForTest(mockConfig(), {
      fetchImpl: async () => new Response("{}", { status: 401 }),
    });
    await assert.rejects(
      () => client.validateToken("user-1", "bad-token"),
      (e: unknown) => {
        assert.ok(e instanceof UnauthorizedException);
        assert.equal((e.getResponse() as { code?: string }).code, "ERR_FIGMA_TOKEN_INVALID");
        return true;
      },
    );
  });

  it("CL-04: 429 agota reintentos", async () => {
    let calls = 0;
    const client = FigmaClient.createForTest(mockConfig(), {
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
      },
    });
    await assert.rejects(() => client.getFile("user-1", "token", "abcdefghijkl"));
    assert.ok(calls >= 3);
  });

  it("lee fixture grabado sin tokens", async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
    const body = readFileSync(join(fixtureDir, "file-response.json"), "utf8");
    assert.equal(body.includes("figd_"), false);
    const client = FigmaClient.createForTest(mockConfig(), {
      fetchImpl: async () => new Response(body, { status: 200 }),
    });
    const data = (await client.getFile("user-1", "token", "abcdefghijkl")) as { document?: { type?: string } };
    assert.equal(data.document?.type, "DOCUMENT");
  });
});
