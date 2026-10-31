/**
 * @fileoverview Lease por hilo LangGraph (`mdd:thread-lock:<key>`).
 *
 * Por qué existe: un hilo (proyecto + etapa) comparte un único checkpoint. Dos turnos concurrentes
 * (stream manager + resume, stream + job BullMQ, dos pestañas) escribirían el mismo estado y se
 * pisarían (auditorScore, mddDraft, flags de gate). El `Set` en proceso del controller nunca se
 * consultaba y no cruza réplicas.
 *
 * Implementación: `SET key token NX PX ttl` en Redis (lease con TTL) renovado cada 60 s mientras el turno
 * corre y liberado en `finally` con compare-and-delete. Sin `REDIS_URL` (dev) cae a un Map en proceso
 * con la misma semántica (TTL + renovación). Reentrante por AsyncLocalStorage: un job que ya tiene el
 * lease puede llamar a los streams internos sin autobloquearse.
 */
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const THREAD_LOCK_KEY_PREFIX = "mdd:thread-lock:";
export const THREAD_BUSY_CODE = "THREAD_BUSY";
export const THREAD_BUSY_MESSAGE = "Ya hay un turno en curso para este hilo. Espera a que termine.";

const DEFAULT_TTL_MS = 20 * 60_000;
const DEFAULT_RENEW_MS = 60_000;

/** Lanzado por `runExclusive` cuando el hilo está ocupado (el job BullMQ lo trata como no reintentable). */
export class ThreadBusyError extends Error {
  readonly code = THREAD_BUSY_CODE;
  constructor(key: string) {
    super(`${THREAD_BUSY_CODE}: ${THREAD_BUSY_MESSAGE} (${key})`);
    this.name = "ThreadBusyError";
  }
}

export type ThreadRunLease = {
  readonly key: string;
  /** Libera el lease (idempotente). Solo borra si el token sigue siendo el nuestro. */
  release: () => Promise<void>;
};

export type ThreadLockAcquireOptions = {
  /** TTL del lease (ms). Default `THREAD_RUN_LOCK_TTL_MS` o 20 min. */
  ttlMs?: number;
  /** Cada cuánto renovar (ms). Default 60 s (acotado a ttl/3). `0` desactiva la renovación (tests). */
  renewEveryMs?: number;
};

type RedisLike = {
  set: (...args: unknown[]) => Promise<unknown>;
  eval: (...args: unknown[]) => Promise<unknown>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, cb: (...a: unknown[]) => void) => unknown;
};

const RENEW_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

const heldKeysStorage = new AsyncLocalStorage<ReadonlySet<string>>();

export function resolveThreadRunLockTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.THREAD_RUN_LOCK_TTL_MS?.trim() ?? "", 10);
  return Number.isFinite(n) && n >= 1_000 ? n : DEFAULT_TTL_MS;
}

/** Clave canónica del hilo MDD: un hilo por proyecto/etapa (`stage` vacío = hilo del proyecto). */
export function mddThreadLockKey(projectId: string, stageId?: string | null): string {
  return `${projectId.trim()}:${(stageId ?? "").trim() || "_"}`;
}

@Injectable()
export class ThreadRunLockService implements OnModuleDestroy {
  private readonly logger = new Logger(ThreadRunLockService.name);
  private redis: RedisLike | null = null;
  private redisInit: Promise<RedisLike | null> | null = null;
  private readonly memory = new Map<string, { token: string; expiresAt: number }>();

  async onModuleDestroy(): Promise<void> {
    const r = this.redis;
    this.redis = null;
    this.redisInit = null;
    if (r) await r.quit?.().catch(() => r.disconnect?.());
  }

  private async getRedis(): Promise<RedisLike | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.redis) return this.redis;
    if (!this.redisInit) {
      this.redisInit = (async () => {
        try {
          // ioredis llega hoisted vía bullmq (node-linker=hoisted); import dinámico para no cargarlo sin Redis.
          const mod = (await import("ioredis")) as unknown as {
            default?: new (u: string, o?: Record<string, unknown>) => RedisLike;
            Redis?: new (u: string, o?: Record<string, unknown>) => RedisLike;
          };
          const Ctor = mod.default ?? mod.Redis;
          if (!Ctor) throw new Error("ioredis no exporta un constructor");
          const client = new Ctor(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
          client.on?.("error", (err: unknown) => {
            this.logger.warn(`Redis thread-lock error: ${err instanceof Error ? err.message : String(err)}`);
          });
          this.redis = client;
          return client;
        } catch (err) {
          this.logger.warn(
            `Redis thread-lock no disponible, usando lock en proceso: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.redisInit = null;
          return null;
        }
      })();
    }
    return this.redisInit;
  }

  /** True si el contexto async actual ya tiene el lease de `key` (reentrancia). */
  isHeldInContext(key: string): boolean {
    return heldKeysStorage.getStore()?.has(key) ?? false;
  }

  /**
   * Intenta tomar el lease. Devuelve `null` si el hilo está ocupado.
   * Reentrante: si este contexto async ya lo tiene, devuelve un lease no-op.
   */
  async acquire(key: string, options: ThreadLockAcquireOptions = {}): Promise<ThreadRunLease | null> {
    if (this.isHeldInContext(key)) return { key, release: async () => undefined };

    const ttlMs = options.ttlMs ?? resolveThreadRunLockTtlMs();
    const renewEveryMs = options.renewEveryMs ?? Math.min(DEFAULT_RENEW_MS, Math.max(1_000, Math.floor(ttlMs / 3)));
    const token = randomUUID();
    const redisKey = `${THREAD_LOCK_KEY_PREFIX}${key}`;

    const redis = await this.getRedis();
    let acquired = false;
    let useRedis = redis != null;
    if (redis) {
      try {
        acquired = (await redis.set(redisKey, token, "PX", ttlMs, "NX")) === "OK";
      } catch (err) {
        // Redis caído: no bloquear al usuario; degradamos a lock en proceso.
        this.logger.warn(`thread-lock acquire falló en Redis (${err instanceof Error ? err.message : err}); fallback en proceso`);
        useRedis = false;
      }
    }
    if (!useRedis) {
      const now = Date.now();
      const cur = this.memory.get(redisKey);
      if (!cur || cur.expiresAt <= now) {
        this.memory.set(redisKey, { token, expiresAt: now + ttlMs });
        acquired = true;
      }
    }
    if (!acquired) return null;

    let released = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const renew = async (): Promise<void> => {
      if (released) return;
      try {
        if (useRedis && redis) {
          const ok = await redis.eval(RENEW_LUA, 1, redisKey, token, String(ttlMs));
          if (Number(ok) !== 1) this.logger.warn(`thread-lock ${key}: lease perdido (expiró o lo tomó otro turno)`);
        } else {
          const cur = this.memory.get(redisKey);
          if (cur?.token === token) cur.expiresAt = Date.now() + ttlMs;
        }
      } catch (err) {
        this.logger.warn(`thread-lock ${key}: renovación falló: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    if (renewEveryMs > 0) {
      timer = setInterval(() => void renew(), renewEveryMs);
      timer.unref?.();
    }

    return {
      key,
      release: async () => {
        if (released) return;
        released = true;
        if (timer) clearInterval(timer);
        try {
          if (useRedis && redis) {
            await redis.eval(RELEASE_LUA, 1, redisKey, token);
          } else if (this.memory.get(redisKey)?.token === token) {
            this.memory.delete(redisKey);
          }
        } catch (err) {
          this.logger.warn(`thread-lock ${key}: release falló (expirará por TTL): ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };
  }

  /**
   * Toma el lease, ejecuta `fn` con el hilo marcado como "en poder de este contexto" (los streams
   * internos no lo vuelven a tomar) y lo libera en `finally`. Lanza `ThreadBusyError` si está ocupado.
   */
  async runExclusive<T>(key: string, fn: () => Promise<T>, options?: ThreadLockAcquireOptions): Promise<T> {
    if (this.isHeldInContext(key)) return fn();
    const lease = await this.acquire(key, options);
    if (!lease) throw new ThreadBusyError(key);
    const held = new Set(heldKeysStorage.getStore() ?? []);
    held.add(key);
    try {
      return await heldKeysStorage.run(held, fn);
    } finally {
      await lease.release();
    }
  }
}
