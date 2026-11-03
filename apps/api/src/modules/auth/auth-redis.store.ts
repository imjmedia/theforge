/**
 * @fileoverview Almacén de seguridad de auth (OTP + contadores + límite de peticiones) sobre Redis.
 *
 * Por qué existe: el OTP vivía en un `Map` en proceso (no cruza réplicas) y `verifyOtp` no contaba
 * fallos (6 dígitos / 10 min = fuerza bruta trivial). Aquí el OTP, su contador de intentos y los
 * contadores de rate limit viven en Redis con TTL y operaciones atómicas (Lua).
 *
 * Modo memoria: fuera de producción y sin `REDIS_URL`, mismos contratos con Maps en proceso (dev/tests).
 * En producción, sin Redis o con Redis caído ⇒ fallo cerrado (`ServiceUnavailableException`, 503).
 * `REDIS_URL` y `NODE_ENV` se leen de `ConfigService` (validados en `config/env.schema.ts`).
 */
import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";

export const AUTH_OTP_MAX_ATTEMPTS = 5;
export const AUTH_STORE_UNAVAILABLE_MESSAGE =
  "Servicio de autenticación no disponible temporalmente. Intenta de nuevo en unos minutos.";

export type OtpConsumeResult = "ok" | "invalid" | "locked" | "expired";
export type RateLimitHit = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/** Subconjunto de ioredis que usa el store (permite inyectar un falso en tests). */
export type AuthRedisClient = {
  status?: string;
  eval: (...args: unknown[]) => Promise<unknown>;
  set: (...args: unknown[]) => Promise<unknown>;
  del: (...args: unknown[]) => Promise<unknown>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  once?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  removeListener?: (event: string, cb: (...a: unknown[]) => void) => unknown;
};

const OTP_KEY = "auth:otp:";
const OTP_FAILS_KEY = "auth:otp-fails:";
const OTP_RESEND_KEY = "auth:otp-resend:";
const READY_TIMEOUT_MS = 5_000;

/**
 * KEYS[1]=otp, KEYS[2]=contador de intentos; ARGV[1]=máx. intentos.
 * Cuenta el intento ANTES de comparar (evita que peticiones concurrentes superen el tope) y borra el OTP
 * al pasarse. La comparación del código se hace en Node con `timingSafeEqual`.
 * Sin OTP pero con el contador en el tope ⇒ `locked` (el bloqueo persiste hasta que caduque el contador);
 * con el contador por debajo del tope ⇒ `invalid`; sin contador ⇒ `expired`.
 */
export const OTP_RESERVE_LUA = `
local stored = redis.call("GET", KEYS[1])
if not stored then
  local fails = redis.call("GET", KEYS[2])
  if not fails then return {"expired"} end
  if tonumber(fails) >= tonumber(ARGV[1]) then return {"locked"} end
  return {"invalid"}
end
local n = redis.call("INCR", KEYS[2])
local pttl = redis.call("PTTL", KEYS[1])
if pttl > 0 then redis.call("PEXPIRE", KEYS[2], pttl) end
if n > tonumber(ARGV[1]) then
  redis.call("DEL", KEYS[1])
  return {"locked"}
end
return {"check", stored, tostring(n)}
`;
/** KEYS[1]=otp, KEYS[2]=contador. Consume el OTP una sola vez (DEL atómico). */
export const OTP_CONSUME_LUA = `
if redis.call("DEL", KEYS[1]) == 1 then
  redis.call("DEL", KEYS[2])
  return 1
end
return 0
`;
/** KEYS[1]=otp. Tras un fallo en el último intento permitido, descarta el OTP. */
export const OTP_LOCK_LUA = `redis.call("DEL", KEYS[1]) return 1`;
/** KEYS[1]=contador; ARGV[1]=ventana en segundos. Ventana fija: INCR + EXPIRE en el primero. */
export const RATE_HIT_LUA = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}
`;

type StoreOptions = {
  redis?: AuthRedisClient | null;
  /** Variables de entorno que expondrá el `ConfigService` falso (`REDIS_URL`, `NODE_ENV`). */
  env?: Record<string, string | undefined>;
  now?: () => number;
};

function codesEqual(a: string, b: string): boolean {
  // Se comparan digests de longitud fija: `timingSafeEqual` exige buffers del mismo tamaño.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

@Injectable()
export class AuthRedisStore implements OnModuleDestroy {
  private readonly logger = new Logger(AuthRedisStore.name);
  private now: () => number = () => Date.now();
  private redis: AuthRedisClient | null = null;
  private redisInit: Promise<AuthRedisClient> | null = null;
  private readonly memOtp = new Map<string, { code: string; expiresAt: number }>();
  private readonly memFails = new Map<string, { count: number; expiresAt: number }>();
  private readonly memHits = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  /** Tests: `ConfigService` falso por constructor y, opcionalmente, cliente Redis falso y reloj. */
  static createForTest(options: StoreOptions = {}): AuthRedisStore {
    const env = options.env ?? {};
    const store = new AuthRedisStore({ get: (key: string) => env[key] } as unknown as ConfigService);
    if (options.now) store.now = options.now;
    if (options.redis) store.redis = options.redis;
    return store;
  }

  async onModuleDestroy(): Promise<void> {
    const r = this.redis;
    this.redis = null;
    this.redisInit = null;
    if (r) await Promise.resolve(r.quit?.()).catch(() => r.disconnect?.());
  }

  // ─── API pública ───

  async setOtp(email: string, code: string, ttlSeconds: number): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      const now = this.now();
      this.memOtp.set(email, { code, expiresAt: now + ttlSeconds * 1000 });
      this.memFails.delete(email);
      return;
    }
    await this.run(async () => {
      await redis.del(OTP_FAILS_KEY + email);
      await redis.set(OTP_KEY + email, code, "EX", ttlSeconds);
    });
  }

  /** Borra OTP, contador de intentos y marca de reenvío (p. ej. si falló el envío del correo). */
  async deleteOtp(email: string): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) {
      this.memOtp.delete(email);
      this.memFails.delete(email);
      this.memHits.delete(OTP_RESEND_KEY + email);
      return;
    }
    await this.run(() => redis.del(OTP_KEY + email, OTP_FAILS_KEY + email, OTP_RESEND_KEY + email));
  }

  /** Reserva el envío de un OTP: false si ya hubo uno dentro de la ventana de reenvío (no es error). */
  async reserveOtpSend(email: string, windowSeconds: number): Promise<boolean> {
    const r = await this.hit(OTP_RESEND_KEY + email, 1, windowSeconds);
    return r.allowed;
  }

  /**
   * Verifica el OTP contando el intento. Atómico respecto al tope de intentos: tras
   * `AUTH_OTP_MAX_ATTEMPTS` fallos el OTP se descarta (`locked`) y el código correcto ya no sirve; los
   * intentos siguientes siguen devolviendo `locked` mientras el contador esté en el tope (hasta que caduque
   * la ventana del OTP o se emita un código nuevo).
   */
  async consumeOtpAttempt(email: string, code: string): Promise<OtpConsumeResult> {
    const redis = await this.getRedis();
    if (!redis) return this.consumeOtpMemory(email, code);

    return this.run(async () => {
      const reserved = (await redis.eval(
        OTP_RESERVE_LUA,
        2,
        OTP_KEY + email,
        OTP_FAILS_KEY + email,
        AUTH_OTP_MAX_ATTEMPTS,
      )) as unknown;
      const [status, stored, attemptsRaw] = Array.isArray(reserved) ? (reserved as unknown[]) : [];
      if (status === "expired" || status === "invalid" || status === "locked") return status;
      if (status !== "check" || typeof stored !== "string") {
        throw new Error("respuesta inesperada de Redis en verificación de OTP");
      }
      if (codesEqual(stored, code)) {
        const consumed = await redis.eval(OTP_CONSUME_LUA, 2, OTP_KEY + email, OTP_FAILS_KEY + email);
        return Number(consumed) === 1 ? "ok" : "invalid";
      }
      if (Number(attemptsRaw) >= AUTH_OTP_MAX_ATTEMPTS) {
        await redis.eval(OTP_LOCK_LUA, 1, OTP_KEY + email);
        return "locked";
      }
      return "invalid";
    });
  }

  /** Límite por ventana fija. `retryAfterSeconds` = tiempo restante de la ventana. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitHit> {
    const redis = await this.getRedis();
    let count: number;
    let ttl: number;
    if (!redis) {
      const now = this.now();
      let entry = this.memHits.get(key);
      if (!entry || entry.expiresAt <= now) {
        entry = { count: 0, expiresAt: now + windowSeconds * 1000 };
      }
      entry.count += 1;
      this.memHits.set(key, entry);
      count = entry.count;
      ttl = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    } else {
      const res = await this.run(() => redis.eval(RATE_HIT_LUA, 1, key, windowSeconds));
      const [n, t] = Array.isArray(res) ? (res as unknown[]) : [];
      count = Number(n);
      ttl = Number(t);
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
        throw this.unavailable("respuesta inesperada de Redis en rate limit");
      }
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, ttl),
    };
  }

  // ─── Internos ───

  private consumeOtpMemory(email: string, code: string): OtpConsumeResult {
    const now = this.now();
    const otp = this.memOtp.get(email);
    if (otp && otp.expiresAt <= now) {
      this.memOtp.delete(email);
      this.memFails.delete(email);
    }
    const live = this.memOtp.get(email);
    const fails = this.memFails.get(email);
    const failsLive = fails && fails.expiresAt > now ? fails : undefined;
    if (!live) {
      if (!failsLive) return "expired";
      return failsLive.count >= AUTH_OTP_MAX_ATTEMPTS ? "locked" : "invalid";
    }

    const count = (failsLive?.count ?? 0) + 1;
    this.memFails.set(email, { count, expiresAt: live.expiresAt });
    if (count > AUTH_OTP_MAX_ATTEMPTS) {
      this.memOtp.delete(email);
      return "locked";
    }
    if (codesEqual(live.code, code)) {
      this.memOtp.delete(email);
      this.memFails.delete(email);
      return "ok";
    }
    if (count >= AUTH_OTP_MAX_ATTEMPTS) {
      this.memOtp.delete(email);
      return "locked";
    }
    return "invalid";
  }

  private unavailable(detail: string): ServiceUnavailableException {
    this.logger.error(`AuthRedisStore no disponible: ${detail}`);
    return new ServiceUnavailableException(AUTH_STORE_UNAVAILABLE_MESSAGE);
  }

  /** Ejecuta una operación Redis; cualquier error ⇒ 503 (fallo cerrado). */
  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw this.unavailable(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Cliente Redis listo, o `null` para modo memoria (solo fuera de producción y sin `REDIS_URL`).
   * En producción sin Redis lanza 503.
   */
  private async getRedis(): Promise<AuthRedisClient | null> {
    if (this.redis) return this.redis;
    const url = this.config.get<string>("REDIS_URL")?.trim();
    if (!url) {
      if (this.config.get<string>("NODE_ENV") === "production") {
        throw this.unavailable("REDIS_URL no configurado en producción");
      }
      return null;
    }
    if (!this.redisInit) {
      this.redisInit = this.connect(url).catch((err: unknown) => {
        this.redisInit = null;
        throw this.unavailable(err instanceof Error ? err.message : String(err));
      });
    }
    return this.redisInit;
  }

  private async connect(url: string): Promise<AuthRedisClient> {
    // ioredis llega hoisted vía bullmq; import dinámico para no cargarlo sin Redis.
    const mod = (await import("ioredis")) as unknown as {
      default?: new (u: string, o?: Record<string, unknown>) => AuthRedisClient;
      Redis?: new (u: string, o?: Record<string, unknown>) => AuthRedisClient;
    };
    const Ctor = mod.default ?? mod.Redis;
    if (!Ctor) throw new Error("ioredis no exporta un constructor");
    const client = new Ctor(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
    client.on?.("error", (err: unknown) => {
      this.logger.warn(`Redis auth error: ${err instanceof Error ? err.message : String(err)}`);
    });
    try {
      await this.waitUntilReady(client);
    } catch (err) {
      client.disconnect?.();
      throw err;
    }
    this.redis = client;
    return client;
  }

  /** Con `enableOfflineQueue:false` un comando previo a `ready` falla: se espera el evento explícitamente. */
  private waitUntilReady(client: AuthRedisClient): Promise<void> {
    if (client.status === "ready") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Redis no llegó a "ready" en ${READY_TIMEOUT_MS} ms`));
      }, READY_TIMEOUT_MS);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("conexión Redis cerrada antes de estar lista"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        client.removeListener?.("ready", onReady);
        client.removeListener?.("end", onEnd);
      };
      client.once?.("ready", onReady);
      client.once?.("end", onEnd);
    });
  }
}
