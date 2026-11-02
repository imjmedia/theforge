import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  MISSING_SECRET_MESSAGE,
  mcpApiClient,
  resetMcpTokenCacheForTests,
  runWithMcpSecret,
} from "./mcp-api-client.js";

interface Call {
  url: string;
  auth?: string;
  secret?: string;
}

const realFetch = globalThis.fetch;
let calls: Call[];
/** Tokens emitidos por secret: `tok-<secret>-<n>`. */
let issued: Record<string, number>;
/** Tokens que la API trata como revocados (responde 401). */
let revoked: Set<string>;
let loginDelayMs = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installFakeFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.endsWith("/auth/mcp-login")) {
      const secret = (JSON.parse(String(init?.body)) as { secret: string }).secret;
      calls.push({ url, secret });
      if (loginDelayMs) await new Promise((r) => setTimeout(r, loginDelayMs));
      issued[secret] = (issued[secret] ?? 0) + 1;
      return json(200, { accessToken: `tok-${secret}-${issued[secret]}` });
    }
    calls.push({ url, auth: headers.Authorization });
    // Cede el turno para entrelazar peticiones concurrentes.
    await new Promise((r) => setTimeout(r, 5));
    const token = (headers.Authorization ?? "").replace("Bearer ", "");
    if (!token || revoked.has(token)) return json(401, { message: "Unauthorized" });
    return json(200, { token });
  }) as typeof fetch;
}

const logins = () => calls.filter((c) => c.url.endsWith("/auth/mcp-login"));
const apiCalls = () => calls.filter((c) => !c.url.endsWith("/auth/mcp-login"));

describe("mcp-api-client: contexto por petición y caché por secret", () => {
  beforeEach(() => {
    calls = [];
    issued = {};
    revoked = new Set();
    loginDelayMs = 0;
    resetMcpTokenCacheForTests();
    installFakeFetch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    mock.restoreAll();
  });

  test("dos secrets concurrentes usan cada uno su propio token", async () => {
    const [a, b] = await Promise.all([
      runWithMcpSecret("secret-A", async () => {
        const r1 = (await mcpApiClient.get("/projects")) as { token: string };
        const r2 = (await mcpApiClient.post("/projects/1/x", {})) as { token: string };
        return [r1.token, r2.token];
      }),
      runWithMcpSecret("secret-B", async () => {
        const r1 = (await mcpApiClient.get("/projects")) as { token: string };
        const r2 = (await mcpApiClient.delete("/projects/2")) as { token: string };
        return [r1.token, r2.token];
      }),
    ]);
    assert.deepEqual(a, ["tok-secret-A-1", "tok-secret-A-1"]);
    assert.deepEqual(b, ["tok-secret-B-1", "tok-secret-B-1"]);
    assert.equal(logins().length, 2);
  });

  test("el segundo uso del mismo secret no vuelve a hacer login", async () => {
    await runWithMcpSecret("secret-A", () => mcpApiClient.get("/a"));
    await runWithMcpSecret("secret-B", () => mcpApiClient.get("/b"));
    await runWithMcpSecret("secret-A", () => mcpApiClient.get("/c"));
    assert.equal(logins().length, 2);
    assert.equal(apiCalls()[2]?.auth, "Bearer tok-secret-A-1");
  });

  test("peticiones simultáneas del mismo secret comparten un único login", async () => {
    loginDelayMs = 20;
    await Promise.all([
      runWithMcpSecret("secret-A", () => mcpApiClient.get("/a")),
      runWithMcpSecret("secret-A", () => mcpApiClient.get("/b")),
      runWithMcpSecret("secret-A", () => mcpApiClient.get("/c")),
    ]);
    assert.equal(logins().length, 1);
  });

  test("401 provoca un reintento con login nuevo solo para ese secret", async () => {
    await runWithMcpSecret("secret-A", () => mcpApiClient.get("/warm"));
    await runWithMcpSecret("secret-B", () => mcpApiClient.get("/warm"));
    revoked.add("tok-secret-A-1");
    const res = (await runWithMcpSecret("secret-A", () => mcpApiClient.get("/x"))) as { token: string };
    assert.equal(res.token, "tok-secret-A-2");
    assert.equal(logins().length, 3);
    assert.equal(issued["secret-B"], 1);
  });

  test("401 repetido propaga el error tras un único reintento", async () => {
    revoked.add("tok-secret-A-1");
    revoked.add("tok-secret-A-2");
    await assert.rejects(
      runWithMcpSecret("secret-A", () => mcpApiClient.get("/x")),
      /401|Unauthorized|No autorizado|sesión/i,
    );
    assert.equal(logins().length, 2);
    assert.equal(apiCalls().length, 2);
  });

  test("fetchAllowStatuses también reintenta una vez tras 401", async () => {
    await runWithMcpSecret("secret-A", () => mcpApiClient.get("/warm"));
    revoked.add("tok-secret-A-1");
    const res = await runWithMcpSecret("secret-A", () => mcpApiClient.fetchAllowStatuses("GET", "/x", undefined, [404]));
    assert.equal(res.status, 200);
    assert.equal(logins().length, 2);
  });

  test("sin secret en el contexto falla con error claro y no llama a la API", async () => {
    await runWithMcpSecret("secret-A", () => mcpApiClient.get("/warm"));
    const before = calls.length;
    await assert.rejects(mcpApiClient.get("/x"), new RegExp(MISSING_SECRET_MESSAGE));
    await assert.rejects(runWithMcpSecret("  ", () => mcpApiClient.get("/x")), new RegExp(MISSING_SECRET_MESSAGE));
    assert.equal(calls.length, before);
  });

  test("un fallo de login no deja un token cacheado ni contamina a otros secrets", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/auth/mcp-login")) return json(401, { message: "bad secret" });
      return original(input, init);
    }) as typeof fetch;
    await assert.rejects(runWithMcpSecret("bad", () => mcpApiClient.get("/x")), /MCP login failed: HTTP 401/);
    globalThis.fetch = original;
    const res = (await runWithMcpSecret("secret-A", () => mcpApiClient.get("/x"))) as { token: string };
    assert.equal(res.token, "tok-secret-A-1");
  });
});
