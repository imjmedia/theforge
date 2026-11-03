import { isStageScopedDeliverableField } from "./workshopStageDeliverables";

const TOKEN_KEY = "theforge_access_token";
const USER_KEY = "theforge_user";

export interface TheForgeUser {
  id: string;
  email: string;
  role: "super_admin" | "admin" | "developer";
  /** Display name from profile / JWT; may be empty until backend provides it */
  name?: string | null;
}

export const API_BASE = import.meta.env?.VITE_API_URL ?? "/api";

/** Decodifica JWT sin verificar firma. */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob((token.split(".")[1] ?? ""))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  // Extraer user info del JWT
  const payload = decodeJwt(token);
  if (payload) {
    const rawName = payload.name;
    const name =
      typeof rawName === "string" && rawName.trim() !== ""
        ? rawName.trim()
        : null;
    const user: TheForgeUser = {
      id: (payload.sub as string) || "",
      email: (payload.email as string) || "",
      role:
        (payload.role as TheForgeUser["role"]) || "developer",
      name,
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

export function getStoredUser(): TheForgeUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TheForgeUser;
  } catch {
    return null;
  }
}

/** Sincroniza rol y perfil desde la API (útil si el JWT en localStorage está desactualizado). */
export async function refreshStoredUserFromApi(): Promise<TheForgeUser | null> {
  const r = await apiFetch(`${API_BASE}/auth/me`);
  if (!r.ok) return getStoredUser();
  const data = (await r.json()) as {
    id?: string;
    email?: string;
    role?: TheForgeUser["role"];
    name?: string | null;
  };
  const user: TheForgeUser = {
    id: data.id ?? "",
    email: data.email ?? "",
    role: data.role ?? "developer",
    name: data.name ?? null,
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearOfflineQueue();
}

/** Resuelve rutas `/api/...` o relativas al `API_BASE` del entorno. */
export function resolveApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = API_BASE.replace(/\/$/, "");
  if (normalized.startsWith("/api/") || normalized === "/api") {
    if (base.endsWith("/api")) {
      return `${base}${normalized.slice(4)}`;
    }
    if (base.includes("://")) {
      return `${base}${normalized.startsWith("/api") ? normalized.slice(4) : normalized}`;
    }
    return normalized;
  }
  return `${base}${normalized}`;
}

/** Fetch al API con Authorization si hay sesión; ante 401 limpia token y emite evento. */
export async function apiFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string" && !input.includes("://")
      ? resolveApiUrl(input)
      : input;
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const r = await fetch(url, { ...init, headers });
  if (r.status === 401 && token) {
    clearAccessToken();
    window.dispatchEvent(new Event("theforge:auth-expired"));
  }
  return r;
}

class ApiClient {
  get(url: string, init?: Omit<RequestInit, "method" | "body">) {
    return apiFetch(resolveApiUrl(url), { ...init, method: "GET" });
  }

  post(url: string, body?: unknown, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return apiFetch(resolveApiUrl(url), {
      ...init,
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  put(url: string, body?: unknown, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return apiFetch(resolveApiUrl(url), {
      ...init,
      method: "PUT",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  patch(url: string, body?: unknown, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return apiFetch(resolveApiUrl(url), {
      ...init,
      method: "PATCH",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  delete(url: string, init?: Omit<RequestInit, "method" | "body">) {
    return apiFetch(resolveApiUrl(url), { ...init, method: "DELETE" });
  }
}

export const api = new ApiClient();

/**
 * Fetch con reintentos automáticos ante NetworkError o 5xx.
 * Backoff exponencial: 1s → 2s → 4s (con jitter ±500ms).
 * @param maxRetries  Número de reintentos (default 3 → hasta 4 intentos totales)
 */
export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await apiFetch(input, init);
      if (r.status < 500 || attempt === maxRetries) return r;
      lastErr = new Error(`Error del servidor (HTTP ${r.status})`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) throw lastErr;
    }
    const delay = Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 500;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr ?? new Error("fetchWithRetry: error desconocido");
}

/* ── Cola offline para persistencia local ────────────────────────────── */

const OFFLINE_QUEUE_KEY = "theforge_offline_queue";
/** Entradas más viejas se descartan al cargar la cola. */
export const OFFLINE_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineEntry {
  field: string;
  content: string;
  projectId: string;
  /** Etapa activa al encolar (`null` = campos a nivel proyecto). */
  stageId: string | null;
  timestamp: number;
  /** Hash del contenido encolado (dedupe / diagnóstico). */
  contentHash: string;
}

/** Hash rápido del cuerpo encolado (no criptográfico). */
export function hashOfflineContent(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) ^ content.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function queueKey(entry: Pick<OfflineEntry, "projectId" | "stageId" | "field">): string {
  const pid = entry.projectId.trim();
  const sid = (entry.stageId ?? "").trim() || "_";
  return `${pid}:${sid}:${entry.field}`;
}

function normalizeOfflineEntry(raw: Partial<OfflineEntry>): OfflineEntry | null {
  if (!raw.field || !raw.projectId || typeof raw.content !== "string") return null;
  const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
  const stageId = raw.stageId === undefined ? null : raw.stageId;
  const contentHash =
    typeof raw.contentHash === "string" && raw.contentHash
      ? raw.contentHash
      : hashOfflineContent(raw.content);
  return {
    field: raw.field,
    content: raw.content,
    projectId: raw.projectId,
    stageId,
    timestamp,
    contentHash,
  };
}

function saveOfflineQueue(queue: OfflineEntry[]): void {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function pruneStaleOfflineEntries(queue: OfflineEntry[], now = Date.now()): OfflineEntry[] {
  const kept: OfflineEntry[] = [];
  let dropped = 0;
  for (const entry of queue) {
    if (now - entry.timestamp > OFFLINE_QUEUE_MAX_AGE_MS) {
      dropped++;
      continue;
    }
    kept.push(entry);
  }
  if (dropped > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("theforge:offline-queue-stale-dropped", { detail: { count: dropped } }),
    );
  }
  return kept;
}

export function getOfflineQueue(): OfflineEntry[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<OfflineEntry>[];
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((e) => normalizeOfflineEntry(e))
      .filter((e): e is OfflineEntry => e != null);
    const pruned = pruneStaleOfflineEntries(normalized);
    if (pruned.length !== parsed.length) {
      saveOfflineQueue(pruned);
    }
    return pruned;
  } catch {
    return [];
  }
}

export function clearOfflineQueue(): void {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export function addToOfflineQueue(entry: Omit<OfflineEntry, "contentHash" | "timestamp"> & Partial<Pick<OfflineEntry, "contentHash" | "timestamp">>): void {
  const full: OfflineEntry = {
    ...entry,
    stageId: entry.stageId ?? null,
    timestamp: entry.timestamp ?? Date.now(),
    contentHash: entry.contentHash ?? hashOfflineContent(entry.content),
  };
  const queue = getOfflineQueue();
  const key = queueKey(full);
  const filtered = queue.filter((e) => queueKey(e) !== key);
  filtered.push(full);
  saveOfflineQueue(filtered);
}

export function removeFromOfflineQueue(entry: Pick<OfflineEntry, "projectId" | "stageId" | "field">): void {
  const key = queueKey(entry);
  const queue = getOfflineQueue();
  const filtered = queue.filter((e) => queueKey(e) !== key);
  saveOfflineQueue(filtered);
}

function patchBodyForOfflineEntry(entry: OfflineEntry): Record<string, unknown> {
  const body: Record<string, unknown> = { [entry.field]: entry.content };
  if (entry.field === "mddContent" || isStageScopedDeliverableField(entry.field)) {
    if (entry.stageId) body.stageId = entry.stageId;
  }
  return body;
}

/** Reintenta enviar todos los items pendientes. Retorna cuántos se pudieron sincronizar. */
export async function flushOfflineQueue(): Promise<number> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;
  let synced = 0;
  for (const entry of queue) {
    try {
      const r = await fetchWithRetry(`${API_BASE}/projects/${entry.projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBodyForOfflineEntry(entry)),
      });
      if (r.ok) {
        removeFromOfflineQueue(entry);
        synced++;
      } else if (r.status >= 400 && r.status < 500) {
        // Validation / client error — drop entry; retrying will never succeed.
        removeFromOfflineQueue(entry);
      }
    } catch {
      // No se pudo sincronizar ahora, se reintentará después
      break;
    }
  }
  return synced;
}
