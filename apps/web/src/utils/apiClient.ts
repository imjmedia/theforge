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
}

/** Fetch al API con Authorization si hay sesión; ante 401 limpia token y emite evento. */
export async function apiFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const r = await fetch(input, { ...init, headers });
  if (r.status === 401 && token) {
    clearAccessToken();
    window.dispatchEvent(new Event("theforge:auth-expired"));
  }
  return r;
}

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

export interface OfflineEntry {
  field: string;
  content: string;
  projectId: string;
  timestamp: number;
}

export function getOfflineQueue(): OfflineEntry[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineEntry[]) : [];
  } catch {
    return [];
  }
}

export function addToOfflineQueue(entry: OfflineEntry): void {
  const queue = getOfflineQueue();
  // Reemplazar entrada previa del mismo field (solo la última versión)
  const filtered = queue.filter((e) => e.field !== entry.field);
  filtered.push(entry);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
}

export function removeFromOfflineQueue(field: string): void {
  const queue = getOfflineQueue();
  const filtered = queue.filter((e) => e.field !== field);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
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
        body: JSON.stringify({ [entry.field]: entry.content }),
      });
      if (r.ok) {
        removeFromOfflineQueue(entry.field);
        synced++;
      } else if (r.status >= 400 && r.status < 500) {
        // Validation / client error — drop entry; retrying will never succeed.
        removeFromOfflineQueue(entry.field);
      }
    } catch {
      // No se pudo sincronizar ahora, se reintentará después
      break;
    }
  }
  return synced;
}
