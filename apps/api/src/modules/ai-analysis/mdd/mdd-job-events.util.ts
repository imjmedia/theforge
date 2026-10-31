/**
 * @fileoverview Relay de eventos del chat MDD ejecutado en el worker BullMQ.
 *
 * El turno del chat (Manager / resume) corre en el worker y cada evento que emite el generador
 * (`progress`, `draft`, `interrupt`, `done`, `error`) se agrega a una lista ordenada por job. El cliente
 * (cualquier réplica de API) los reproduce desde un cursor y sigue en vivo hasta un evento terminal.
 * Así el turno sobrevive al cierre de la pestaña o al reinicio de la réplica HTTP.
 *
 * Este módulo es puro (sin Nest ni Redis): define el contrato `MddJobEventStore`, la implementación
 * en proceso (dev / tests), el relay por job (tope de borradores) y el generador de cola (`tail`).
 * La implementación Redis vive en `mdd-job-events.service.ts`.
 */
import { EventEmitter } from "node:events";

/** Prefijo de la lista Redis y del canal pub/sub: `mdd:job-events:<jobId>`. */
export const MDD_JOB_EVENTS_PREFIX = "mdd:job-events:";
/** TTL de la lista de eventos (24 h). */
export const MDD_JOB_EVENTS_TTL_SEC = 24 * 60 * 60;
/** Solo se conservan los últimos N borradores (el resto se reemplaza por `noop`) para acotar memoria. */
export const MDD_JOB_EVENTS_MAX_DRAFTS = 3;
/** Heartbeat del endpoint de eventos (igual que el NDJSON legacy). */
export const MDD_JOB_EVENTS_HEARTBEAT_MS = 15_000;
/** Cada cuánto el tail consulta si el job murió sin emitir evento terminal. */
export const MDD_JOB_EVENTS_IDLE_CHECK_MS = 5_000;
/** Tipo de la entrada tombstone que sustituye a un borrador descartado (mantiene estables los cursores). */
export const MDD_JOB_EVENT_NOOP = "noop";

export type MddJobRelayEvent = { type: string } & Record<string, unknown>;

export type MddJobStoredEntry = { index: number; event: MddJobRelayEvent };

/** Línea emitida por el endpoint: el evento original más `cursor` (= índice de la siguiente entrada). */
export type MddJobTailLine = MddJobRelayEvent & { cursor: number };

const TERMINAL_TYPES: ReadonlySet<string> = new Set(["done", "error", "interrupt", "blocked"]);

/** `done`, `error`, `interrupt` y `blocked` cierran la suscripción: el cliente termina su turno con cualquiera de ellos. */
export function isTerminalMddJobEvent(event: { type: string }): boolean {
  return TERMINAL_TYPES.has(event.type);
}

export function mddJobEventsKey(jobId: string): string {
  return `${MDD_JOB_EVENTS_PREFIX}${jobId}`;
}

/** Normaliza el query `cursor` (cualquier valor inválido o negativo → 0). */
export function parseMddJobEventsCursor(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Contrato de almacenamiento: lista append-only con reemplazo puntual y notificación de nuevas entradas. */
export interface MddJobEventStore {
  /** Agrega el evento y devuelve su índice (0-based). Notifica a los suscriptores. */
  append(jobId: string, event: MddJobRelayEvent): Promise<number>;
  /** Sustituye una entrada existente (tombstone de borradores). No notifica. */
  replace(jobId: string, index: number, event: MddJobRelayEvent): Promise<void>;
  /** Entradas con índice >= `fromIndex`, en orden. */
  read(jobId: string, fromIndex: number): Promise<MddJobStoredEntry[]>;
  /** Registra un aviso "hay entradas nuevas"; devuelve la función para darse de baja. */
  subscribe(jobId: string, onNotify: () => void): Promise<() => void>;
}

type InProcessJob = { entries: MddJobRelayEvent[]; expiresAt: number };

/** Implementación en proceso (sin `REDIS_URL`): array + EventEmitter. Solo válida con cola in-memory. */
export class InProcessMddJobEventStore implements MddJobEventStore {
  private readonly jobs = new Map<string, InProcessJob>();
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly ttlMs: number = MDD_JOB_EVENTS_TTL_SEC * 1000,
    private readonly now: () => number = Date.now,
  ) {
    this.emitter.setMaxListeners(0);
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, job] of this.jobs) {
      if (job.expiresAt <= t) this.jobs.delete(id);
    }
  }

  async append(jobId: string, event: MddJobRelayEvent): Promise<number> {
    this.sweep();
    let job = this.jobs.get(jobId);
    if (!job) {
      job = { entries: [], expiresAt: 0 };
      this.jobs.set(jobId, job);
    }
    job.expiresAt = this.now() + this.ttlMs;
    job.entries.push(event);
    const index = job.entries.length - 1;
    this.emitter.emit(jobId);
    return index;
  }

  async replace(jobId: string, index: number, event: MddJobRelayEvent): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && index >= 0 && index < job.entries.length) job.entries[index] = event;
  }

  async read(jobId: string, fromIndex: number): Promise<MddJobStoredEntry[]> {
    const job = this.jobs.get(jobId);
    if (!job || job.expiresAt <= this.now()) return [];
    const start = Math.max(0, fromIndex);
    return job.entries.slice(start).map((event, i) => ({ index: start + i, event }));
  }

  async subscribe(jobId: string, onNotify: () => void): Promise<() => void> {
    this.emitter.on(jobId, onNotify);
    return () => {
      this.emitter.off(jobId, onNotify);
    };
  }

  /** Solo tests / diagnóstico. */
  size(jobId: string): number {
    return this.jobs.get(jobId)?.entries.length ?? 0;
  }
}

/**
 * Relay de un job: agrega cada evento del generador al store y aplica el tope de borradores.
 * Los borradores antiguos se sustituyen por `noop` (no se borran) para que los cursores sigan siendo
 * índices estables. Un fallo del store nunca debe tumbar el turno: se reporta por `onError` y se sigue.
 */
export class MddJobEventRelay {
  private readonly draftIndexes: number[] = [];
  private terminal = false;

  constructor(
    private readonly store: MddJobEventStore,
    readonly jobId: string,
    private readonly options: {
      maxDrafts?: number;
      onError?: (err: unknown) => void;
    } = {},
  ) {}

  hasTerminal(): boolean {
    return this.terminal;
  }

  /** Agrega un evento; devuelve su índice, o -1 si el store falló. */
  async emit(event: MddJobRelayEvent): Promise<number> {
    try {
      const index = await this.store.append(this.jobId, event);
      if (isTerminalMddJobEvent(event)) this.terminal = true;
      if (event.type === "draft") {
        this.draftIndexes.push(index);
        const max = Math.max(1, this.options.maxDrafts ?? MDD_JOB_EVENTS_MAX_DRAFTS);
        while (this.draftIndexes.length > max) {
          const stale = this.draftIndexes.shift();
          if (stale !== undefined) {
            await this.store.replace(this.jobId, stale, { type: MDD_JOB_EVENT_NOOP });
          }
        }
      }
      return index;
    } catch (err) {
      this.options.onError?.(err);
      return -1;
    }
  }

  /** Garantiza un cierre para el cliente (cancelación, caída del turno, generador sin evento final). */
  async emitTerminalIfMissing(event: MddJobRelayEvent): Promise<void> {
    if (this.terminal) return;
    await this.emit(event);
  }
}

export type MddJobTailOptions = {
  signal?: AbortSignal;
  heartbeatMs?: number;
  idleCheckMs?: number;
  /**
   * Se invoca cuando pasó `idleCheckMs` sin eventos nuevos. Si devuelve un evento (terminal), el tail lo
   * emite y termina (job fallido, huérfano o expirado sin evento final).
   */
  onIdle?: () => Promise<MddJobRelayEvent | null>;
};

/**
 * Reproduce las entradas desde `cursor` y sigue en vivo hasta un evento terminal, el aborto del cliente
 * o un evento sintético de `onIdle`. Cada línea lleva `cursor` (índice de la siguiente entrada) para
 * poder reanudar; los `noop` se omiten pero avanzan el cursor.
 */
export async function* tailMddJobEvents(
  store: MddJobEventStore,
  jobId: string,
  cursor: number,
  options: MddJobTailOptions = {},
): AsyncGenerator<MddJobTailLine, void, undefined> {
  const heartbeatMs = options.heartbeatMs ?? MDD_JOB_EVENTS_HEARTBEAT_MS;
  const idleCheckMs = Math.min(options.idleCheckMs ?? MDD_JOB_EVENTS_IDLE_CHECK_MS, heartbeatMs);
  const signal = options.signal;
  let next = Math.max(0, cursor);
  let dirty = true;
  let wakeResolve: (() => void) | null = null;
  const unsubscribe = await store.subscribe(jobId, () => {
    dirty = true;
    wakeResolve?.();
  });
  let lastBeat = Date.now();
  try {
    for (;;) {
      if (signal?.aborted) return;
      dirty = false;
      const entries = await store.read(jobId, next);
      for (const entry of entries) {
        next = entry.index + 1;
        if (entry.event.type === MDD_JOB_EVENT_NOOP) continue;
        yield { ...entry.event, cursor: next };
        lastBeat = Date.now();
        if (isTerminalMddJobEvent(entry.event)) return;
      }
      if (entries.length > 0) continue;
      if (dirty) continue;

      const reason = await new Promise<"notify" | "timeout" | "abort">((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (r: "notify" | "timeout" | "abort"): void => {
          if (timer) clearTimeout(timer);
          wakeResolve = null;
          signal?.removeEventListener("abort", onAbort);
          resolve(r);
        };
        const onAbort = (): void => finish("abort");
        wakeResolve = () => finish("notify");
        timer = setTimeout(() => finish("timeout"), idleCheckMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) finish("abort");
      });
      if (reason === "abort") return;
      if (reason === "timeout") {
        if (options.onIdle) {
          const synthetic = await options.onIdle();
          if (synthetic) {
            yield { ...synthetic, cursor: next };
            return;
          }
        }
        if (Date.now() - lastBeat >= heartbeatMs) {
          yield { type: "heartbeat", cursor: next };
          lastBeat = Date.now();
        }
      }
    }
  } finally {
    unsubscribe();
  }
}
