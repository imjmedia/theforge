/**
 * @fileoverview Lease por hilo LangGraph (`mdd:thread-lock:<key>`).
 *
 * Por qué existe: un hilo (proyecto + etapa) comparte un único checkpoint. Dos turnos concurrentes
 * (stream manager + resume, stream + job BullMQ, dos pestañas) escribirían el mismo estado y se
 * pisarían (auditorScore, mddDraft, flags de gate). El `Set` en proceso del controller nunca se
 * consultaba y no cruza réplicas.
 *
 * Implementación: `SET key token NX PX ttl` en Redis (lease con TTL) renovado cada 60 s mientras el turno
 * corre y liberado en `finally` con compare-and-delete. Reentrante por AsyncLocalStorage: un job que ya
 * tiene el lease puede llamar a los streams internos sin autobloquearse.
 *
 * Falla cerrado: con `REDIS_URL` configurada, si Redis no está listo (tope 5 s) o el `SET` falla,
 * `acquire` lanza `ThreadLockUnavailableError` (`LOCK_UNAVAILABLE`); nunca concede exclusión local. El Map
 * en proceso solo se usa SIN `REDIS_URL` (desarrollo/tests; en producción el esquema de entorno la exige).
 *
 * Pérdida del lease: el lease expone `signal` (abortado con `ThreadLeaseLostError`, `LEASE_LOST`) e
 * `isHeld()`. Solo una pérdida CONFIRMADA aborta: el Lua de renovación devuelve 0 (el token ya no es el
 * nuestro), el compare-and-delete de liberación no encuentra nuestro token, o el lease venció sin poder
 * renovarse (reloj local, conservador). Un error transitorio de Redis al renovar solo se registra y se
 * reintenta en el siguiente tick.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { connectIoredisReady } from "../../../common/redis/connect-ioredis-ready.js";
import { runWithMddLeaseContext } from "../../../common/mdd-lease-context.js";
import { getActiveLlmAbortSignal, runWithLlmAbortSignal } from "../utils/mdd-llm-stream-invoke.util.js";

export const THREAD_LOCK_KEY_PREFIX = "mdd:thread-lock:";
export const THREAD_BUSY_CODE = "THREAD_BUSY";
export const THREAD_BUSY_MESSAGE = "Ya hay un turno en curso para este hilo. Espera a que termine.";
export const LOCK_UNAVAILABLE_CODE = "LOCK_UNAVAILABLE";
export const LOCK_UNAVAILABLE_MESSAGE =
  "No se pudo tomar el bloqueo del hilo (Redis no disponible). Intenta de nuevo en unos minutos.";
export const LEASE_LOST_CODE = "LEASE_LOST";
export const LEASE_LOST_MESSAGE = "Se perdió el bloqueo del hilo durante el turno; el resultado se descarta.";
/**
 * Clave del contador global de fencing, compartida por todas las réplicas. Su valor nunca va por detrás del reloj:
 * el fence de cada lease es `max(INCR, Date.now())` (ver `FENCE_LUA`).
 */
export const THREAD_FENCE_KEY = "mdd:thread-fence";
/** Mensaje de `ThreadLockUnavailableError` cuando no se puede obtener el fence (`FENCE_LUA` falla o Redis no responde). */
export const FENCE_UNAVAILABLE_MESSAGE = "No se pudo obtener el fence del hilo MDD";

const DEFAULT_TTL_MS = 20 * 60_000;
const DEFAULT_RENEW_MS = 60_000;
const REDIS_READY_TIMEOUT_MS = 5_000;
const REDIS_COMMAND_TIMEOUT_MS = 5_000;

/** Lanzado por `runExclusive` cuando el hilo está ocupado (el job BullMQ lo trata como no reintentable). */
export class ThreadBusyError extends Error {
  readonly code = THREAD_BUSY_CODE;
  constructor(key: string) {
    super(`${THREAD_BUSY_CODE}: ${THREAD_BUSY_MESSAGE} (${key})`);
    this.name = "ThreadBusyError";
  }
}

/** Redis no está listo o falló el `SET`: no se concede el lease (reintentable acotado en BullMQ). */
export class ThreadLockUnavailableError extends Error {
  readonly code = LOCK_UNAVAILABLE_CODE;
  constructor(key: string, cause?: unknown, message: string = LOCK_UNAVAILABLE_MESSAGE) {
    const detail = cause == null ? "" : `: ${cause instanceof Error ? cause.message : String(cause)}`;
    super(`${LOCK_UNAVAILABLE_CODE}: ${message} (${key})${detail}`);
    this.name = "ThreadLockUnavailableError";
    if (cause != null) this.cause = cause;
  }
}

/** Razón del `abort` del `signal` del lease cuando se pierde el bloqueo (no reintentable). */
export class ThreadLeaseLostError extends Error {
  readonly code = LEASE_LOST_CODE;
  constructor(key: string) {
    super(`${LEASE_LOST_CODE}: ${LEASE_LOST_MESSAGE} (${key})`);
    this.name = "ThreadLeaseLostError";
  }
}

export type ThreadRunLease = {
  readonly key: string;
  /** Fencing token: entero creciente entre leases (también entre claves). Para descartar escritores viejos. */
  readonly fence: number;
  /** Se aborta con `ThreadLeaseLostError` (`signal.reason`) cuando la pérdida del lease está confirmada. */
  readonly signal: AbortSignal;
  /** False si el lease se perdió (confirmado), venció sin renovarse o ya se liberó. */
  isHeld: () => boolean;
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
  status?: string;
  set: (...args: unknown[]) => Promise<unknown>;
  eval: (...args: unknown[]) => Promise<unknown>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  once?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  removeListener?: (event: string, cb: (...a: unknown[]) => void) => unknown;
};

const RENEW_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
/**
 * Fence atómico: `INCR` con suelo en el reloj (`ARGV[1]` = `Date.now()`). Si el contador quedó por debajo del reloj
 * (flush de Redis, o un proceso en modo Map que escribe en la misma BD), sube al reloj y lo devuelve. Así el fence
 * es estrictamente creciente aunque cambie quién lo sembró, y dos réplicas nunca reciben el mismo valor.
 */
const FENCE_LUA = `local v = redis.call("incr", KEYS[1]); local now = tonumber(ARGV[1]); if v < now then redis.call("set", KEYS[1], ARGV[1]); v = now end; return v`;

/** Valor devuelto por `INCR` del fence: debe ser un entero seguro; si no, es un fallo (no se concede). */
function parseFence(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`fence no entero: ${String(raw)}`);
  return n;
}

/** Leases que el contexto async actual ya tiene (reentrancia). */
const heldLeasesStorage = new AsyncLocalStorage<ReadonlyMap<string, ThreadRunLease>>();

/** Variables que lee el servicio (vía `ConfigService`; `process.env` solo si no se inyectó). */
type ThreadLockEnv = { THREAD_RUN_LOCK_TTL_MS?: string };

export function resolveThreadRunLockTtlMs(env: ThreadLockEnv = process.env): number {
  const n = Number.parseInt(env.THREAD_RUN_LOCK_TTL_MS?.trim() ?? "", 10);
  return Number.isFinite(n) && n >= 1_000 ? n : DEFAULT_TTL_MS;
}

/** Clave canónica del hilo MDD: un hilo por proyecto/etapa (`stage` vacío = hilo del proyecto). */
export function mddThreadLockKey(projectId: string, stageId?: string | null): string {
  return `${projectId.trim()}:${(stageId ?? "").trim() || "_"}`;
}

@Injectable()
export class ThreadRunLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThreadRunLockService.name);
  private redis: RedisLike | null = null;
  /** Conexión en curso; se descarta al fallar (el siguiente `acquire` reintenta limpio). */
  private redisInit: Promise<RedisLike> | null = null;
  private readonly memory = new Map<string, { token: string; expiresAt: number }>();
  /** Último fence emitido en modo Map (sin Redis). Cada acquire toma `max(anterior + 1, Date.now())`. */
  private memoryFence = 0;

  /**
   * `REDIS_URL` y `THREAD_RUN_LOCK_TTL_MS` salen de `ConfigService` (módulo global de la app). Sin
   * `ConfigService` inyectado (specs: `new ThreadRunLockService()`) se lee `process.env` como respaldo.
   */
  constructor(@Optional() private readonly config?: ConfigService) {}

  /**
   * `ConfigService.get` devuelve el valor ya validado por `config/env.schema.ts`, que puede ser un
   * número (`THREAD_RUN_LOCK_TTL_MS` con `z.coerce.number`); se normaliza siempre a string.
   */
  private readEnv(name: string): string | undefined {
    const raw: unknown = this.config ? this.config.get(name) : process.env[name];
    if (raw === undefined || raw === null) return undefined;
    return typeof raw === "string" ? raw : String(raw);
  }

  private redisUrl(): string | undefined {
    return this.readEnv("REDIS_URL")?.trim() || undefined;
  }

  private ttlMs(): number {
    return resolveThreadRunLockTtlMs({ THREAD_RUN_LOCK_TTL_MS: this.readEnv("THREAD_RUN_LOCK_TTL_MS") });
  }

  onModuleInit(): void {
    if (!this.redisUrl()) {
      this.logger.warn(
        "REDIS_URL no configurada: el lease por hilo MDD usa un lock en proceso (solo válido en desarrollo, no cruza réplicas)",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    const r = this.redis;
    this.redis = null;
    this.redisInit = null;
    if (r) await Promise.resolve(r.quit?.()).catch(() => r.disconnect?.());
  }

  /**
   * Cliente Redis listo, o `null` si NO hay `REDIS_URL` (modo en proceso).
   * Con `REDIS_URL`, si no hay conexión lista lanza `ThreadLockUnavailableError`.
   */
  private async getRedis(key: string): Promise<RedisLike | null> {
    const url = this.redisUrl();
    if (!url) return null;
    if (this.redis?.status === "end") {
      this.redis.disconnect?.();
      this.redis = null;
    }
    if (this.redis) return this.redis;
    if (!this.redisInit) {
      const init = connectIoredisReady<RedisLike>(url, {
        name: "thread-lock",
        readyTimeoutMs: REDIS_READY_TIMEOUT_MS,
        maxRetriesPerRequest: 2,
        commandTimeoutMs: REDIS_COMMAND_TIMEOUT_MS,
      }).then(
        (client) => {
          if (this.redisInit === init) {
            this.redis = client;
            this.redisInit = null;
          } else {
            client.disconnect?.();
          }
          return client;
        },
        (err: unknown) => {
          if (this.redisInit === init) this.redisInit = null; // no cachear el rechazo
          throw err;
        },
      );
      this.redisInit = init;
    }
    try {
      return await this.redisInit;
    } catch (err) {
      this.logger.warn(`thread-lock: Redis no está listo, no se concede el lease: ${err instanceof Error ? err.message : String(err)}`);
      throw new ThreadLockUnavailableError(key, err);
    }
  }

  /** Lease del contexto async actual para `key` (reentrancia), si lo hay. */
  private heldInContext(key: string): ThreadRunLease | undefined {
    return heldLeasesStorage.getStore()?.get(key);
  }

  /** True si el contexto async actual ya tiene el lease de `key` (reentrancia). */
  isHeldInContext(key: string): boolean {
    return this.heldInContext(key) != null;
  }

  /**
   * Intenta tomar el lease. Devuelve `null` si el hilo está ocupado.
   * Lanza `ThreadLockUnavailableError` si Redis no responde (nunca concede el lease en ese caso).
   * Reentrante: si este contexto async ya lo tiene, devuelve un lease que comparte `signal`/`isHeld`/`fence` del
   * original y cuyo `release` es no-op.
   */
  /** Vista reentrante de un lease exterior: comparte `signal`, `fence` e `isHeld`; su `release` es no-op. */
  private reentrantView(outer: ThreadRunLease): ThreadRunLease {
    return { key: outer.key, signal: outer.signal, fence: outer.fence, isHeld: outer.isHeld, release: async () => undefined };
  }

  async acquire(key: string, options: ThreadLockAcquireOptions = {}): Promise<ThreadRunLease | null> {
    const outer = this.heldInContext(key);
    if (outer) return this.reentrantView(outer);

    const ttlMs = options.ttlMs ?? this.ttlMs();
    const renewEveryMs = options.renewEveryMs ?? Math.min(DEFAULT_RENEW_MS, Math.max(1_000, Math.floor(ttlMs / 3)));
    const token = randomUUID();
    const redisKey = `${THREAD_LOCK_KEY_PREFIX}${key}`;

    const redis = await this.getRedis(key);
    // Se mide ANTES de enviar el comando: el vencimiento local nunca es posterior al real (conservador).
    let confirmedAt = Date.now();
    let acquired = false;
    if (redis) {
      try {
        acquired = (await redis.set(redisKey, token, "PX", ttlMs, "NX")) === "OK";
      } catch (err) {
        this.logger.warn(`thread-lock acquire falló en Redis (${err instanceof Error ? err.message : err}); no se concede el lease`);
        throw new ThreadLockUnavailableError(key, err);
      }
    } else {
      const now = Date.now();
      const cur = this.memory.get(redisKey);
      if (!cur || cur.expiresAt <= now) {
        this.memory.set(redisKey, { token, expiresAt: now + ttlMs });
        acquired = true;
      }
    }
    if (!acquired) return null;

    // Fence: contador global creciente con suelo en el reloj (`FENCE_LUA`). Si no se puede obtener, no se concede:
    // se libera el lease tomado.
    let fence: number;
    if (redis) {
      try {
        fence = parseFence(await redis.eval(FENCE_LUA, 1, THREAD_FENCE_KEY, String(Date.now())));
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(`thread-lock ${key}: no se pudo obtener el fence (${motivo}); se libera el lease`);
        try {
          await redis.eval(RELEASE_LUA, 1, redisKey, token);
        } catch (relErr) {
          this.logger.warn(
            `thread-lock ${key}: release tras fallo de fence falló (expirará por TTL): ${relErr instanceof Error ? relErr.message : String(relErr)}`,
          );
        }
        throw new ThreadLockUnavailableError(key, err, FENCE_UNAVAILABLE_MESSAGE);
      }
    } else {
      fence = Math.max(this.memoryFence + 1, Date.now());
      this.memoryFence = fence;
    }

    const controller = new AbortController();
    let released = false;
    let lost = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let renewing = false;

    const markLost = (why: string): void => {
      if (lost) return;
      lost = true;
      if (timer) clearInterval(timer);
      this.logger.warn(`thread-lock ${key}: lease perdido (${why})`);
      controller.abort(new ThreadLeaseLostError(key));
    };
    /** Vencido por reloj local sin haberse renovado ⇒ pérdida confirmada. */
    const checkExpiry = (): void => {
      if (!released && !lost && Date.now() >= confirmedAt + ttlMs) markLost("venció sin poder renovarse");
    };

    const renew = async (): Promise<void> => {
      if (released || lost || renewing) return;
      renewing = true;
      const startedAt = Date.now();
      try {
        if (redis) {
          const ok = await redis.eval(RENEW_LUA, 1, redisKey, token, String(ttlMs));
          if (released) return;
          if (Number(ok) === 1) confirmedAt = startedAt;
          else markLost("expiró o lo tomó otro turno");
        } else {
          const cur = this.memory.get(redisKey);
          if (cur?.token === token) {
            cur.expiresAt = Date.now() + ttlMs;
            confirmedAt = startedAt;
          } else {
            markLost("expiró o lo tomó otro turno");
          }
        }
      } catch (err) {
        // Transitorio: no aborta; se reintenta en el siguiente tick. Si vence, checkExpiry lo confirma.
        this.logger.warn(`thread-lock ${key}: renovación falló (se reintenta): ${err instanceof Error ? err.message : String(err)}`);
        checkExpiry();
      } finally {
        renewing = false;
      }
    };
    if (renewEveryMs > 0) {
      timer = setInterval(() => void renew(), renewEveryMs);
      timer.unref?.();
    }

    return {
      key,
      fence,
      signal: controller.signal,
      isHeld: () => {
        checkExpiry();
        return !released && !lost;
      },
      release: async () => {
        if (released) return;
        // Antes de marcar `released`: así un vencimiento sin renovar aún se detecta como pérdida.
        checkExpiry();
        released = true;
        if (timer) clearInterval(timer);
        try {
          if (redis) {
            const deleted = await redis.eval(RELEASE_LUA, 1, redisKey, token);
            if (Number(deleted) !== 1) markLost("compare-and-delete: el token ya no era el nuestro");
          } else if (this.memory.get(redisKey)?.token === token) {
            this.memory.delete(redisKey);
          } else {
            markLost("compare-and-delete: el token ya no era el nuestro");
          }
        } catch (err) {
          this.logger.warn(`thread-lock ${key}: release falló (expirará por TTL): ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };
  }

  /**
   * Toma el lease, ejecuta `fn` con el hilo marcado como "en poder de este contexto" (los streams
   * internos no lo vuelven a tomar) y lo libera en `finally`. Lanza `ThreadBusyError` si está ocupado y
   * `ThreadLockUnavailableError` si Redis no responde.
   *
   * `fn` recibe, además de la señal, el lease (con `fence`); además, el contexto async de `fn` expone ese fence
   * (`getActiveMddLeaseFence`) para que las escrituras sin fence explícito (tools del Manager) queden condicionadas. La señal combina la del turno activo (contexto LLM) con la del lease: se aborta con
   * `ThreadLeaseLostError` si el lease se pierde. Además esa señal queda como señal LLM activa del
   * contexto. Si el lease se pierde durante `fn`, el resultado se descarta: se lanza `ThreadLeaseLostError`
   * (no reintentable), también cuando `fn` terminó "bien" o falló por el aborto resultante.
   *
   * Una pérdida detectada SOLO al liberar (compare-and-delete sin nuestro token, o vencimiento entre el
   * último `persist` y el `release`) no descarta nada: `fn` ya terminó y persistió bajo lease vigente, así
   * que se devuelve su resultado y la pérdida queda como `warn` (si no, un job quedaría `failed` con el
   * MDD ya guardado y se saltaría su post-proceso).
   */
  async runExclusive<T>(
    key: string,
    fn: (signal: AbortSignal, lease: ThreadRunLease) => Promise<T>,
    options?: ThreadLockAcquireOptions,
  ): Promise<T> {
    const outer = this.heldInContext(key);
    if (outer) return fn(outer.signal, this.reentrantView(outer));
    const lease = await this.acquire(key, options);
    if (!lease) throw new ThreadBusyError(key);
    const held = new Map(heldLeasesStorage.getStore() ?? []);
    held.set(key, lease);
    const turnSignal = getActiveLlmAbortSignal();
    const signal = turnSignal ? AbortSignal.any([turnSignal, lease.signal]) : lease.signal;
    let result: T;
    let lostDuringRun = false;
    try {
      result = await heldLeasesStorage.run(held, () =>
        runWithLlmAbortSignal(signal, () => runWithMddLeaseContext({ fence: lease.fence, key }, () => fn(signal, lease))),
      );
      lostDuringRun = lease.signal.aborted;
    } catch (err) {
      if (!lease.isHeld() && lease.signal.aborted) throw lease.signal.reason;
      throw err;
    } finally {
      await lease.release();
    }
    if (lostDuringRun) throw lease.signal.reason;
    if (lease.signal.aborted) {
      this.logger.warn(
        `thread-lock ${key}: el lease se perdió solo al liberarlo; el turno ya había terminado y se conserva su resultado`,
      );
    }
    return result;
  }
}
