/**
 * @fileoverview Servicio Nest del relay de eventos del chat MDD (Redis con fallback en proceso).
 *
 * Con `REDIS_URL`: lista `mdd:job-events:<jobId>` (JSON por entrada, TTL 24 h) + canal pub/sub homónimo
 * que avisa de cada entrada nueva (`{"i":<índice>,"type":"<tipo>"}`). El lector no confía en el payload
 * del aviso: ante cualquier notificación vuelve a leer la lista desde su cursor (sin huecos ni duplicados).
 * Sin `REDIS_URL` (dev) usa `InProcessMddJobEventStore` (válido porque la cola también es in-memory).
 */
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  InProcessMddJobEventStore,
  MDD_JOB_EVENTS_TTL_SEC,
  MddJobEventRelay,
  mddJobEventsKey,
  tailMddJobEvents,
  type MddJobEventStore,
  type MddJobRelayEvent,
  type MddJobStoredEntry,
  type MddJobTailLine,
  type MddJobTailOptions,
} from "./mdd-job-events.util.js";

type RedisCommands = {
  rpush: (key: string, ...values: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  publish: (channel: string, message: string) => Promise<number>;
  lset: (key: string, index: number, value: string) => Promise<unknown>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, cb: (...args: unknown[]) => void) => unknown;
};

type RedisSubscriber = {
  subscribe: (...channels: string[]) => Promise<unknown>;
  unsubscribe: (...channels: string[]) => Promise<unknown>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on: (event: string, cb: (...args: unknown[]) => void) => unknown;
};

type RedisCtor = new (url: string, options?: Record<string, unknown>) => RedisCommands & RedisSubscriber;

/** Store Redis: un cliente para comandos y otro (lazy, compartido) para suscripciones. */
class RedisMddJobEventStore implements MddJobEventStore {
  private sub: RedisSubscriber | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly url: string,
    private readonly ctor: RedisCtor,
    private readonly cmd: RedisCommands,
    private readonly logger: Logger,
  ) {}

  async append(jobId: string, event: MddJobRelayEvent): Promise<number> {
    const key = mddJobEventsKey(jobId);
    const length = await this.cmd.rpush(key, JSON.stringify(event));
    const index = length - 1;
    await this.cmd.expire(key, MDD_JOB_EVENTS_TTL_SEC);
    await this.cmd.publish(key, JSON.stringify({ i: index, type: event.type }));
    return index;
  }

  async replace(jobId: string, index: number, event: MddJobRelayEvent): Promise<void> {
    await this.cmd.lset(mddJobEventsKey(jobId), index, JSON.stringify(event));
  }

  async read(jobId: string, fromIndex: number): Promise<MddJobStoredEntry[]> {
    const start = Math.max(0, fromIndex);
    const raw = await this.cmd.lrange(mddJobEventsKey(jobId), start, -1);
    const out: MddJobStoredEntry[] = [];
    raw.forEach((line, i) => {
      try {
        out.push({ index: start + i, event: JSON.parse(line) as MddJobRelayEvent });
      } catch {
        // Entrada corrupta: se conserva el índice con un tombstone para no desalinear cursores.
        out.push({ index: start + i, event: { type: "noop" } });
      }
    });
    return out;
  }

  private ensureSubscriber(): RedisSubscriber {
    if (this.sub) return this.sub;
    const sub = new this.ctor(this.url, { maxRetriesPerRequest: null });
    sub.on("error", (err: unknown) => {
      this.logger.warn(`Redis job-events (sub) error: ${err instanceof Error ? err.message : String(err)}`);
    });
    sub.on("message", (channel: unknown) => {
      if (typeof channel !== "string") return;
      for (const cb of this.listeners.get(channel) ?? []) cb();
    });
    this.sub = sub;
    return sub;
  }

  async subscribe(jobId: string, onNotify: () => void): Promise<() => void> {
    const channel = mddJobEventsKey(jobId);
    const sub = this.ensureSubscriber();
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await sub.subscribe(channel);
    }
    set.add(onNotify);
    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(onNotify);
      if (current.size === 0) {
        this.listeners.delete(channel);
        void sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    const sub = this.sub;
    this.sub = null;
    this.listeners.clear();
    if (sub) await sub.quit?.().catch(() => sub.disconnect?.());
    await this.cmd.quit?.().catch(() => this.cmd.disconnect?.());
  }
}

@Injectable()
export class MddJobEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(MddJobEventsService.name);
  private storePromise: Promise<MddJobEventStore> | null = null;
  private redisStore: RedisMddJobEventStore | null = null;

  async onModuleDestroy(): Promise<void> {
    await this.redisStore?.close().catch(() => undefined);
    this.redisStore = null;
    this.storePromise = null;
  }

  /** Inyecta un store (tests). */
  useStore(store: MddJobEventStore): void {
    this.storePromise = Promise.resolve(store);
  }

  private getStore(): Promise<MddJobEventStore> {
    this.storePromise ??= this.createStore();
    return this.storePromise;
  }

  private async createStore(): Promise<MddJobEventStore> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.logger.log("MDD job-events: sin REDIS_URL — relay en proceso (solo desarrollo)");
      return new InProcessMddJobEventStore();
    }
    try {
      // ioredis llega hoisted vía bullmq; import dinámico para no cargarlo sin Redis.
      const mod = (await import("ioredis")) as unknown as { default?: RedisCtor; Redis?: RedisCtor };
      const Ctor = mod.default ?? mod.Redis;
      if (!Ctor) throw new Error("ioredis no exporta un constructor");
      const cmd = new Ctor(url, { maxRetriesPerRequest: 2 });
      cmd.on?.("error", (err: unknown) => {
        this.logger.warn(`Redis job-events error: ${err instanceof Error ? err.message : String(err)}`);
      });
      const store = new RedisMddJobEventStore(url, Ctor, cmd, this.logger);
      this.redisStore = store;
      return store;
    } catch (err) {
      this.logger.error(
        `MDD job-events: Redis no disponible, relay en proceso (el seguimiento no cruzará réplicas): ${err instanceof Error ? err.message : String(err)}`,
      );
      return new InProcessMddJobEventStore();
    }
  }

  /** Relay del job (lo usa el worker). Los fallos del store se registran sin interrumpir el turno. */
  async relayFor(jobId: string): Promise<MddJobEventRelay> {
    const store = await this.getStore();
    let warned = false;
    return new MddJobEventRelay(store, jobId, {
      onError: (err) => {
        if (warned) return;
        warned = true;
        this.logger.warn(
          `MDD job-events ${jobId}: no se pudo registrar un evento (el turno continúa): ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    });
  }

  async read(jobId: string, fromIndex: number): Promise<MddJobStoredEntry[]> {
    return (await this.getStore()).read(jobId, fromIndex);
  }

  /** Reproduce desde `cursor` y sigue en vivo (ver `tailMddJobEvents`). */
  async *tail(
    jobId: string,
    cursor: number,
    options?: MddJobTailOptions,
  ): AsyncGenerator<MddJobTailLine, void, undefined> {
    const store = await this.getStore();
    yield* tailMddJobEvents(store, jobId, cursor, options);
  }
}
