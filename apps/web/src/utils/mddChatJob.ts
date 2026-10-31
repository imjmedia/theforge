import { parseNdjsonLine } from "./ndjson";

/**
 * Helpers puros del chat MDD vía cola (BullMQ): estado persistido del job activo (jobId + cursor) para
 * reanudar tras recargar la página, avance del cursor, detección de eventos terminales y lector NDJSON.
 * No dependen del store ni de `window`: el `Storage` se inyecta (tests).
 */

const STORAGE_PREFIX = "theforge:mdd-chat-job:";
/** Entradas guardadas más viejas que esto se ignoran (el relay de eventos expira a las 24 h). */
export const MDD_CHAT_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Fallos de red consecutivos al leer eventos antes de rendirse (con backoff ≈ 1 min en total). */
export const MDD_CHAT_EVENTS_MAX_CONSECUTIVE_FAILURES = 8;

export type SavedMddChatJob = {
  jobId: string;
  /** Índice de la siguiente entrada de eventos a leer (valor `cursor` de la última línea procesada). */
  cursor: number;
  savedAt: number;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `localStorage` si existe y funciona; `null` en SSR, modo privado o storage bloqueado. */
export function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function mddChatJobStorageKey(projectId: string, stageId?: string | null): string {
  return `${STORAGE_PREFIX}${projectId.trim()}:${(stageId ?? "").trim() || "_"}`;
}

export function saveMddChatJob(
  projectId: string,
  stageId: string | null | undefined,
  job: { jobId: string; cursor: number },
  storage: StorageLike | null = safeLocalStorage(),
  now: number = Date.now(),
): void {
  if (!storage || !projectId.trim() || !job.jobId.trim()) return;
  const value: SavedMddChatJob = { jobId: job.jobId, cursor: Math.max(0, job.cursor), savedAt: now };
  try {
    storage.setItem(mddChatJobStorageKey(projectId, stageId), JSON.stringify(value));
  } catch {
    /* storage lleno o bloqueado: sin reanudación, el chat sigue funcionando */
  }
}

export function loadMddChatJob(
  projectId: string,
  stageId: string | null | undefined,
  storage: StorageLike | null = safeLocalStorage(),
  now: number = Date.now(),
): SavedMddChatJob | null {
  if (!storage || !projectId.trim()) return null;
  try {
    const raw = storage.getItem(mddChatJobStorageKey(projectId, stageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedMddChatJob> | null;
    if (!parsed || typeof parsed.jobId !== "string" || !parsed.jobId.trim()) return null;
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (now - savedAt > MDD_CHAT_JOB_MAX_AGE_MS) {
      storage.removeItem(mddChatJobStorageKey(projectId, stageId));
      return null;
    }
    const cursor = typeof parsed.cursor === "number" && parsed.cursor > 0 ? Math.floor(parsed.cursor) : 0;
    return { jobId: parsed.jobId, cursor, savedAt };
  } catch {
    return null;
  }
}

export function clearMddChatJob(
  projectId: string,
  stageId: string | null | undefined,
  storage: StorageLike | null = safeLocalStorage(),
): void {
  if (!storage || !projectId.trim()) return;
  try {
    storage.removeItem(mddChatJobStorageKey(projectId, stageId));
  } catch {
    /* ignore */
  }
}

/** Nuevo cursor tras una línea: el `cursor` de la línea si es mayor; nunca retrocede. */
export function nextMddChatCursor(prev: number, line: { cursor?: unknown }): number {
  const c = typeof line.cursor === "number" && Number.isFinite(line.cursor) ? Math.floor(line.cursor) : prev;
  return c > prev ? c : prev;
}

/** Eventos que cierran el turno del lado del servidor (el relay corta tras ellos). */
export function isMddChatTerminalEvent(event: { type?: unknown }): boolean {
  return event.type === "done" || event.type === "error" || event.type === "interrupt" || event.type === "blocked";
}

/**
 * ¿Merece la pena reanudar un job guardado? Sí mientras el servidor lo conozca (activo, en cola, o ya
 * terminado con eventos sin consumir: waiting_user / done / error se reproducen desde el cursor).
 * No si el job ya no existe, es de otro proyecto o no hay estado.
 */
export function shouldResubscribeToChatJob(
  status: { status?: string; projectId?: string } | null | undefined,
  projectId: string,
): boolean {
  if (!status || !status.status || status.status === "unknown") return false;
  if (status.projectId && status.projectId.trim() !== projectId.trim()) return false;
  return true;
}

/** Espera antes de reintentar la lectura de eventos (backoff exponencial acotado: 1 s … 15 s). */
export function chatEventsReconnectDelayMs(failures: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, failures - 1));
}

/** Itera los objetos JSON de un cuerpo NDJSON (tolera líneas partidas entre chunks). */
export async function* readNdjsonObjects(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        for (const obj of parseNdjsonLine(line)) yield obj;
      }
    }
    buffer += decoder.decode();
    for (const obj of parseNdjsonLine(buffer)) yield obj;
  } finally {
    // Salida anticipada (evento terminal / aborto): cerrar la conexión en vez de dejarla abierta.
    void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      /* lectura aún pendiente al abortar */
    }
  }
}

export type MddChatEventsOutcome = "terminal" | "aborted";

export type ConsumeMddChatEventsOptions = {
  jobId: string;
  /** Cursor inicial (primera entrada a leer). */
  cursor: number;
  signal?: AbortSignal;
  /** Abre `GET …/jobs/:jobId/events?cursor=N` (inyectable para tests). */
  openStream: (cursor: number, signal?: AbortSignal) => Promise<{
    ok: boolean;
    status: number;
    body: ReadableStream<Uint8Array> | null;
  }>;
  /** Procesa un evento real (no heartbeat). Devuelve `terminal` si el turno terminó. */
  onEvent: (event: Record<string, unknown>) => Promise<"continue" | "terminal">;
  /** Notifica el cursor ya procesado (persistirlo para reanudar tras recarga). */
  onCursor?: (cursor: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Consume los eventos de un job de chat con reconexión: si el stream se corta sin evento terminal
 * (red, reinicio de la réplica, proxy) reabre desde el último cursor. Termina en `terminal` al procesar un
 * `done` / `error` / `interrupt` / `blocked`, o en `aborted` si el consumidor aborta. Lanza si el job no
 * existe (404) o tras demasiados fallos consecutivos.
 */
export async function consumeMddChatEvents(options: ConsumeMddChatEventsOptions): Promise<MddChatEventsOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let cursor = Math.max(0, options.cursor);
  let failures = 0;
  for (;;) {
    if (options.signal?.aborted) return "aborted";
    try {
      const res = await options.openStream(cursor, options.signal);
      if (!res.ok) {
        if (res.status === 404 || res.status === 400 || res.status === 403) {
          throw Object.assign(new Error("El job del chat ya no existe en el servidor."), { fatal: true });
        }
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("Respuesta sin cuerpo");
      failures = 0;
      for await (const line of readNdjsonObjects(res.body)) {
        if (options.signal?.aborted) return "aborted";
        if (line.type === "heartbeat") {
          cursor = nextMddChatCursor(cursor, line);
          continue;
        }
        const outcome = await options.onEvent(line);
        cursor = nextMddChatCursor(cursor, line);
        options.onCursor?.(cursor);
        if (outcome === "terminal" || isMddChatTerminalEvent(line)) return "terminal";
      }
      // El servidor cerró sin evento terminal: reconectar desde el cursor.
      await sleep(chatEventsReconnectDelayMs(1));
    } catch (err) {
      if (options.signal?.aborted) return "aborted";
      if (err instanceof Error && (err as { fatal?: boolean }).fatal) throw err;
      failures += 1;
      if (failures >= MDD_CHAT_EVENTS_MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          "Error de conexión con el servidor. El turno sigue en el servidor; recarga la página para recuperar el resultado.",
        );
      }
      await sleep(chatEventsReconnectDelayMs(failures));
    }
  }
}
