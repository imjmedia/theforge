/**
 * @fileoverview Conexión ioredis que solo se entrega cuando el cliente está `ready`.
 *
 * Por qué existe: con `enableOfflineQueue: false` (necesario para fallar cerrado en vez de encolar comandos
 * sin límite) ioredis rechaza cualquier comando emitido antes de `ready` ("Stream isn't writeable").
 * Los consumidores (almacén de auth, lease por hilo MDD) esperaban ese evento cada uno por su lado; aquí
 * vive la única implementación: crea el cliente, espera `ready` con tope y, si falla, lo desconecta y lanza.
 *
 * No cachea nada: quien llama decide qué hacer con el cliente y NO debe cachear la promesa rechazada
 * (el siguiente intento abre una conexión limpia).
 */
import { Logger } from "@nestjs/common";

export const DEFAULT_REDIS_READY_TIMEOUT_MS = 5_000;
export const DEFAULT_REDIS_MAX_RETRIES_PER_REQUEST = 2;

/** Subconjunto de ioredis que usa el helper (permite inyectar un falso en tests). */
export type IoredisLikeClient = {
  status?: string;
  on?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  once?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  removeListener?: (event: string, cb: (...a: unknown[]) => void) => unknown;
  disconnect?: () => void;
  quit?: () => Promise<unknown>;
};

export type ConnectIoredisReadyOptions = {
  /** Etiqueta para los logs (`Redis <name> error: ...`). */
  name: string;
  /** Tope de espera hasta `ready` (ms). Default 5 s. */
  readyTimeoutMs?: number;
  /** `maxRetriesPerRequest` de ioredis. Default 2 (acotado: nunca reintenta sin fin). */
  maxRetriesPerRequest?: number;
  /** `commandTimeout` de ioredis (ms): sin valor, no se fija (comportamiento de ioredis). */
  commandTimeoutMs?: number;
  /** Solo tests: fábrica del cliente en lugar de `import("ioredis")`. */
  createClient?: (url: string, options: Record<string, unknown>) => IoredisLikeClient;
};

async function defaultCreateClient(url: string, options: Record<string, unknown>): Promise<IoredisLikeClient> {
  // ioredis llega hoisted vía bullmq; import dinámico para no cargarlo sin Redis.
  const mod = (await import("ioredis")) as unknown as {
    default?: new (u: string, o?: Record<string, unknown>) => IoredisLikeClient;
    Redis?: new (u: string, o?: Record<string, unknown>) => IoredisLikeClient;
  };
  const Ctor = mod.default ?? mod.Redis;
  if (!Ctor) throw new Error("ioredis no exporta un constructor");
  return new Ctor(url, options);
}

/** Espera `ready`; rechaza por timeout o si la conexión se cierra antes. */
function waitUntilReady(client: IoredisLikeClient, timeoutMs: number): Promise<void> {
  if (client.status === "ready") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis no llegó a "ready" en ${timeoutMs} ms`));
    }, timeoutMs);
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

/**
 * Devuelve un cliente ioredis ya `ready` (`enableOfflineQueue: false`) o lanza. Si falla, el cliente
 * creado se desconecta para no dejar reconexiones huérfanas.
 */
export async function connectIoredisReady<T extends IoredisLikeClient = IoredisLikeClient>(
  url: string,
  options: ConnectIoredisReadyOptions,
): Promise<T> {
  const logger = new Logger("connectIoredisReady");
  const clientOptions: Record<string, unknown> = {
    maxRetriesPerRequest: options.maxRetriesPerRequest ?? DEFAULT_REDIS_MAX_RETRIES_PER_REQUEST,
    enableOfflineQueue: false,
  };
  if (options.commandTimeoutMs != null) clientOptions.commandTimeout = options.commandTimeoutMs;

  const client = options.createClient
    ? options.createClient(url, clientOptions)
    : await defaultCreateClient(url, clientOptions);
  client.on?.("error", (err: unknown) => {
    logger.warn(`Redis ${options.name} error: ${err instanceof Error ? err.message : String(err)}`);
  });
  try {
    await waitUntilReady(client, options.readyTimeoutMs ?? DEFAULT_REDIS_READY_TIMEOUT_MS);
  } catch (err) {
    client.disconnect?.();
    throw err;
  }
  return client as T;
}
