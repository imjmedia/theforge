#!/usr/bin/env node
/**
 * @fileoverview **@theforge/mcp-server** — servidor MCP en TypeScript que expone la API REST de The Forge
 * (NestJS) como herramientas MCP. Autenticación M2M: `MCP_M2M_SECRET` → JWT con refresco ante `401`.
 *
 * **Transportes**
 * - HTTP (`StreamableHTTP`): despliegue detrás de Docker/Traefik; flag `--http`, puerto `PORT` (default 3100).
 * - Stdio: desarrollo local o integración como subproceso (sin args).
 *
 * Definiciones y handlers de tools: {@link ./tools/index.ts} (dominios en `tools/*.tools.ts`).
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 */

import { login, mcpApiClient, runWithMcpSecret } from "./mcp-api-client.js";
import { setMcpClientName } from "./mcp-client-context.js";
import type { McpHandler } from "./mcp-tool.types.js";
import { buildMcpHandlers, buildMcpTools } from "./tools/index.js";

const PORT = Number(process.env.PORT) || 3000;
const USE_HTTP = process.argv.includes("--http");

const TOOLS = buildMcpTools();
const handlers: Record<string, McpHandler> = buildMcpHandlers(mcpApiClient);

interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: number | string | null;
}

interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JSONRPCError;
  id?: number | string | null;
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const result = await handler(args ?? {});
  return { content: [{ type: "text", text: result }] };
}

async function handleJSONRPC(request: JSONRPCRequest): Promise<JSONRPCResponse> {
  const { method, params, id } = request;

  try {
    switch (method) {
      case "initialize": {
        const info = (params as { clientInfo?: { name?: string } } | undefined)?.clientInfo;
        if (info?.name) setMcpClientName(info.name);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "theforge-mcp", version: "0.1.0" },
          },
        };
      }

      case "notifications/initialized": {
        return { jsonrpc: "2.0", result: {} };
      }

      case "tools/list": {
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      }

      case "tools/call": {
        const { name, arguments: args } = (params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        if (!name) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } };
        }
        try {
          const toolResult = await handleToolCall(name, args ?? {});
          return { jsonrpc: "2.0", id, result: toolResult };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [{ type: "text", text: `Error: ${message}` }],
            },
          };
        }
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: `Internal error: ${message}` },
    };
  }
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

async function main(): Promise<void> {
  console.error(`[theforge-mcp] MCP server listo para recibir requests (auth por header MCP_M2M_SECRET)`);

  if (USE_HTTP) {
    const { createServer } = await import("node:http");
    const httpServer = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Session-ID, MCP_M2M_SECRET");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
      if (req.method === "GET" && (urlPath === "/health" || urlPath === "/health/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "theforge-mcp" }));
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

      const body = await readBody(req);

      let clientSecret = (req.headers["mcp_m2m_secret"] as string) || "";
      if (!clientSecret) {
        const authHeader = (req.headers["authorization"] as string) || "";
        const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
        if (bearerMatch) clientSecret = bearerMatch[1];
      }
      if (!clientSecret) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "MCP_M2M_SECRET header required — usa el secret de Settings en TheForge",
            },
            id: null,
          }),
        );
        return;
      }
      try {
        await login(clientSecret);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
        return;
      }

      try {
        const json: JSONRPCRequest = JSON.parse(body);
        const response = await runWithMcpSecret(clientSecret, () => handleJSONRPC(json));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[theforge-mcp] Error parsing request: ${message}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: `Parse error: ${message}` },
            id: null,
          } as JSONRPCResponse),
        );
      }
    });

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.error(`[theforge-mcp] HTTP escuchando en 0.0.0.0:${PORT}`);
    });
  } else {
    console.error("[theforge-mcp] Iniciando en modo stdio");
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin });
    // Stdio es un proceso de un solo usuario: su secret viene del entorno (MCP_M2M_SECRET).
    const stdioSecret = (process.env.MCP_M2M_SECRET ?? "").trim();

    rl.on("line", async (line) => {
      line = line.trim();
      if (!line) return;

      try {
        const request: JSONRPCRequest = JSON.parse(line);
        const response = stdioSecret
          ? await runWithMcpSecret(stdioSecret, () => handleJSONRPC(request))
          : await handleJSONRPC(request);
        if (response.id !== undefined && response.id !== null) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[theforge-mcp] Stdio error: ${message}`);
        process.stderr.write(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: `Parse error: ${message}` },
            id: null,
          } as JSONRPCResponse) + "\n",
        );
      }
    });
  }
}

main().catch((err) => {
  console.error("[theforge-mcp] Fatal:", err);
  process.exit(1);
});
