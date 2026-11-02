import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { formatNestApiError } from "./api-error.util.js";

const API_BASE = process.env.THEFORGE_API_URL ?? "http://theforge-api:3000";
const TIMEOUT_MS = Number(process.env.THEFORGE_MCP_TIMEOUT) || 120_000;

const TOKEN_TTL_MS = 55 * 60 * 1000;
/** Margen antes de la caducidad en el que el token ya se considera vencido. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_CACHED_TOKENS = 500;

export const MISSING_SECRET_MESSAGE = "Falta el secret MCP de la petición";

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Caché de JWT por secret (clave = sha256 del secret; el secret nunca se usa como clave ni se registra). */
const tokenCache = new Map<string, CachedToken>();
/** Logins en vuelo por secret, para no duplicar `POST /auth/mcp-login` en peticiones concurrentes. */
const inflightLogins = new Map<string, Promise<string>>();

interface RequestContext {
  secret: string;
  secretHash: string;
}

/** Contexto de la petición JSON-RPC en curso: aísla el secret entre usuarios concurrentes. */
const requestContext = new AsyncLocalStorage<RequestContext>();

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Ejecuta `fn` con el secret MCP de la petición fijado en el contexto asíncrono.
 * Todo `mcpApiClient.*` invocado dentro (también tras `await`) usa el token de ese secret.
 */
export function runWithMcpSecret<T>(secret: string, fn: () => Promise<T>): Promise<T> {
  const s = secret.trim();
  if (!s) return Promise.reject(new Error(MISSING_SECRET_MESSAGE));
  return requestContext.run({ secret: s, secretHash: hashSecret(s) }, fn);
}

function currentContext(): RequestContext {
  const ctx = requestContext.getStore();
  if (!ctx) throw new Error(MISSING_SECRET_MESSAGE);
  return ctx;
}

function pruneTokenCache(now: number): void {
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
  // Map conserva orden de inserción: se expulsa la entrada más antigua.
  while (tokenCache.size >= MAX_CACHED_TOKENS) {
    const oldest = tokenCache.keys().next().value;
    if (oldest === undefined) break;
    tokenCache.delete(oldest);
  }
}

function readCachedToken(secretHash: string): string | null {
  const entry = tokenCache.get(secretHash);
  if (entry && Date.now() < entry.expiresAt - TOKEN_REFRESH_MARGIN_MS) return entry.token;
  return null;
}

async function requestLogin(secret: string, secretHash: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/mcp-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP login failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { accessToken: string };
  const now = Date.now();
  pruneTokenCache(now);
  tokenCache.delete(secretHash);
  tokenCache.set(secretHash, { token: data.accessToken, expiresAt: now + TOKEN_TTL_MS });
  return data.accessToken;
}

/**
 * Obtiene el JWT del `secret` indicado (caché por secret; login solo si falta o está por caducar).
 * `force` ignora la caché (reintento tras 401). Devuelve el token; no toca ningún estado global de usuario.
 */
export async function login(secret: string, force = false): Promise<string> {
  const s = (secret ?? "").trim();
  if (!s) throw new Error(MISSING_SECRET_MESSAGE);
  const secretHash = hashSecret(s);
  if (!force) {
    const cached = readCachedToken(secretHash);
    if (cached) return cached;
  }
  const pending = inflightLogins.get(secretHash);
  if (pending) return pending;
  const promise = requestLogin(s, secretHash).finally(() => {
    inflightLogins.delete(secretHash);
  });
  inflightLogins.set(secretHash, promise);
  return promise;
}

/** Token vigente para la petición en curso (login si hace falta). */
async function tokenForRequest(): Promise<{ token: string; ctx: RequestContext }> {
  const ctx = currentContext();
  return { token: await login(ctx.secret), ctx };
}

/**
 * Tras un 401: login fresco para el secret de la petición. Si otra petición concurrente ya renovó
 * el token (distinto del que falló), se reutiliza en lugar de hacer otro login.
 */
async function refreshAfter401(ctx: RequestContext, failedToken: string): Promise<string> {
  const current = tokenCache.get(ctx.secretHash)?.token;
  if (current && current !== failedToken) return current;
  tokenCache.delete(ctx.secretHash);
  return login(ctx.secret, true);
}

function authHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** Solo para pruebas: vacía la caché y los logins en vuelo. */
export function resetMcpTokenCacheForTests(): void {
  tokenCache.clear();
  inflightLogins.clear();
}

async function apiFetch(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  try {
    const { token, ctx } = await tokenForRequest();
    const res = await fetch(url, {
      method,
      headers: authHeaders(token),
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401 && !retried) {
      await refreshAfter401(ctx, token);
      return apiFetch(method, path, body, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(formatNestApiError(res.status, text));
    }
    return res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${TIMEOUT_MS}ms: ${method} ${path}`);
    }
    if (err instanceof TypeError && err.message.includes("fetch")) {
      throw new Error(`Network error connecting to API at ${API_BASE}${path}: ${err.message}`);
    }
    throw err;
  }
}

async function apiFetchAllowStatuses(
  method: string,
  path: string,
  body: unknown | undefined,
  allowedStatuses: number[],
  retried = false,
): Promise<{ status: number; data: unknown }> {
  const url = `${API_BASE}${path}`;
  const { token, ctx } = await tokenForRequest();
  const res = await fetch(url, {
    method,
    headers: authHeaders(token),
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 401 && !retried) {
    await refreshAfter401(ctx, token);
    return apiFetchAllowStatuses(method, path, body, allowedStatuses, true);
  }

  const text = await res.text().catch(() => "");
  let data: unknown = text;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else {
    data = null;
  }

  if (res.ok || allowedStatuses.includes(res.status)) {
    return { status: res.status, data };
  }

  throw new Error(formatNestApiError(res.status, text));
}

/** Cliente HTTP tipado hacia la API Nest de The Forge (JWT M2M por secret desde el contexto de la petición; un reintento con login fresco en 401). */
export const mcpApiClient = {
  get: <T = unknown>(path: string) => apiFetch("GET", path) as Promise<T>,
  post: (path: string, body?: unknown) => apiFetch("POST", path, body),
  patch: (path: string, body?: unknown) => apiFetch("PATCH", path, body),
  delete: (path: string) => apiFetch("DELETE", path),
  fetchAllowStatuses: apiFetchAllowStatuses,
};
