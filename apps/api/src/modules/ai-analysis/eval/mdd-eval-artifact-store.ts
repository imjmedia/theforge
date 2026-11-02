/**
 * @fileoverview Almacén de los MDD generados por el eval (`<caseKey>.md`) para que la API pueda
 * servirlos aunque el worker que ejecuta la corrida escriba en otro contenedor sin volumen compartido.
 *
 * Con `REDIS_URL`: cada markdown va en `theforge:mdd-eval:md:<runId>:<caseKey>` (SET con TTL) y el set
 * `theforge:mdd-eval:md-index:<runId>` lista las claves de la corrida (para `listCaseKeys`). Ambos
 * caducan a los `MDD_EVAL_ARTIFACT_TTL_SECONDS` (7 días por defecto) y cada escritura renueva el TTL del
 * índice. Sin `REDIS_URL` (desarrollo) usa un Map en memoria del proceso. Si Redis no responde, las
 * lecturas degradan a "no existe" (la web sigue con el disco) y la escritura lanza para que el ejecutor
 * la registre sin abortar la corrida.
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { isSafeMddEvalId } from "./mdd-eval-run-store.util.js";

/** 7 días. */
export const MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS = 604_800;
export const MDD_EVAL_ARTIFACT_KEY_PREFIX = "theforge:mdd-eval:md:";
export const MDD_EVAL_ARTIFACT_INDEX_PREFIX = "theforge:mdd-eval:md-index:";

/** TTL en segundos desde `MDD_EVAL_ARTIFACT_TTL_SECONDS`; valores no válidos (no enteros, ≤ 0) usan el default. */
export function resolveMddEvalArtifactTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MDD_EVAL_ARTIFACT_TTL_SECONDS?.trim();
  if (!raw) return MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS;
}

export function mddEvalArtifactKey(runId: string, caseKey: string): string {
  return `${MDD_EVAL_ARTIFACT_KEY_PREFIX}${runId}:${caseKey}`;
}

export function mddEvalArtifactIndexKey(runId: string): string {
  return `${MDD_EVAL_ARTIFACT_INDEX_PREFIX}${runId}`;
}

function isSafeArtifactRef(runId: string, caseKey: string): boolean {
  return isSafeMddEvalId(runId) && isSafeMddEvalId(caseKey);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Backend concreto (Redis, memoria o nulo). Puede lanzar; el almacén decide cómo degradar. */
export interface MddEvalArtifactBackend {
  put(runId: string, caseKey: string, markdown: string): Promise<void>;
  get(runId: string, caseKey: string): Promise<string | undefined>;
  has(runId: string, caseKey: string): Promise<boolean>;
  listCaseKeys(runId: string): Promise<string[]>;
  close?(): Promise<void>;
}

/** Backend en memoria del proceso (sin Redis). Respeta el TTL con el reloj inyectado. */
export class InMemoryMddEvalArtifactBackend implements MddEvalArtifactBackend {
  private readonly values = new Map<string, { markdown: string; expiresAt: number }>();
  private readonly indexes = new Map<string, { keys: Set<string>; expiresAt: number }>();

  constructor(
    private readonly ttlSeconds: number = MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async put(runId: string, caseKey: string, markdown: string): Promise<void> {
    this.prune();
    const expiresAt = this.now() + this.ttlSeconds * 1000;
    this.values.set(mddEvalArtifactKey(runId, caseKey), { markdown, expiresAt });
    const index = this.liveIndex(runId) ?? { keys: new Set<string>(), expiresAt };
    index.keys.add(caseKey);
    index.expiresAt = expiresAt;
    this.indexes.set(runId, index);
  }

  async get(runId: string, caseKey: string): Promise<string | undefined> {
    const key = mddEvalArtifactKey(runId, caseKey);
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.markdown;
  }

  async has(runId: string, caseKey: string): Promise<boolean> {
    return (await this.get(runId, caseKey)) !== undefined;
  }

  async listCaseKeys(runId: string): Promise<string[]> {
    const index = this.liveIndex(runId);
    return index ? [...index.keys].sort() : [];
  }

  private liveIndex(runId: string) {
    const index = this.indexes.get(runId);
    if (index && index.expiresAt <= this.now()) {
      this.indexes.delete(runId);
      return undefined;
    }
    return index;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.values) if (entry.expiresAt <= now) this.values.delete(key);
    for (const [runId, index] of this.indexes) if (index.expiresAt <= now) this.indexes.delete(runId);
  }
}

/** Subconjunto de la transacción de ioredis que usa el almacén. */
export interface MddEvalRedisMulti {
  set(key: string, value: string, mode: "EX", seconds: number): MddEvalRedisMulti;
  sadd(key: string, member: string): MddEvalRedisMulti;
  expire(key: string, seconds: number): MddEvalRedisMulti;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

/** Subconjunto de comandos de ioredis que usa el almacén. */
export interface MddEvalRedisClient {
  multi(): MddEvalRedisMulti;
  get(key: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, cb: (...args: unknown[]) => void) => unknown;
}

/**
 * Backend Redis. El SET y el SADD + EXPIRE del índice van en una transacción MULTI. El índice caduca
 * con la última escritura, así que nunca antes que sus miembros; un miembro cuyo valor ya caducó
 * (minutos antes del índice) puede seguir listado: el endpoint de markdown vuelve a comprobar el valor.
 */
export class RedisMddEvalArtifactBackend implements MddEvalArtifactBackend {
  constructor(
    private readonly client: MddEvalRedisClient,
    private readonly ttlSeconds: number = MDD_EVAL_ARTIFACT_DEFAULT_TTL_SECONDS,
  ) {}

  async put(runId: string, caseKey: string, markdown: string): Promise<void> {
    const index = mddEvalArtifactIndexKey(runId);
    const results = await this.client
      .multi()
      .set(mddEvalArtifactKey(runId, caseKey), markdown, "EX", this.ttlSeconds)
      .sadd(index, caseKey)
      .expire(index, this.ttlSeconds)
      .exec();
    if (!results) throw new Error("transacción de MDD abortada");
    const failure = results.find(([error]) => Boolean(error))?.[0];
    if (failure) throw failure;
  }

  async get(runId: string, caseKey: string): Promise<string | undefined> {
    return (await this.client.get(mddEvalArtifactKey(runId, caseKey))) ?? undefined;
  }

  async has(runId: string, caseKey: string): Promise<boolean> {
    return (await this.client.exists(mddEvalArtifactKey(runId, caseKey))) > 0;
  }

  async listCaseKeys(runId: string): Promise<string[]> {
    return (await this.client.smembers(mddEvalArtifactIndexKey(runId))).sort();
  }

  async close(): Promise<void> {
    await this.client.quit?.().catch(() => this.client.disconnect?.());
  }
}

/** Sin backend utilizable (no se pudo cargar ioredis): solo disco. Las escrituras lanzan. */
class UnavailableMddEvalArtifactBackend implements MddEvalArtifactBackend {
  constructor(private readonly reason: string) {}

  async put(): Promise<void> {
    throw new Error(`almacén de MDD no disponible: ${this.reason}`);
  }

  async get(): Promise<string | undefined> {
    return undefined;
  }

  async has(): Promise<boolean> {
    return false;
  }

  async listCaseKeys(): Promise<string[]> {
    return [];
  }
}

type MddEvalRedisCtor = new (url: string, options?: Record<string, unknown>) => MddEvalRedisClient;

/**
 * Almacén de MDD por caso. Lo comparten el ejecutor (worker o proceso en desarrollo) y el servicio web.
 * Las lecturas nunca lanzan: ante un fallo de Redis registran un aviso (una vez hasta que vuelva a
 * responder) y devuelven "no existe", de modo que la web usa el disco.
 */
@Injectable()
export class MddEvalArtifactStore implements OnModuleDestroy {
  private readonly logger = new Logger(MddEvalArtifactStore.name);
  private backendPromise: Promise<MddEvalArtifactBackend> | null = null;
  private degraded = false;

  /** Inyecta un backend (tests). */
  useBackend(backend: MddEvalArtifactBackend): void {
    this.backendPromise = Promise.resolve(backend);
  }

  async onModuleDestroy(): Promise<void> {
    const pending = this.backendPromise;
    this.backendPromise = null;
    if (!pending) return;
    try {
      await (await pending).close?.();
    } catch {
      // al cerrar no hay nada que recuperar
    }
  }

  /** Guarda el markdown de un caso. Lanza si la referencia no es segura o Redis falla (el ejecutor lo registra). */
  async putMarkdown(runId: string, caseKey: string, markdown: string): Promise<void> {
    if (!isSafeArtifactRef(runId, caseKey)) throw new Error(`referencia de MDD no válida: ${runId}/${caseKey}`);
    await (await this.getBackend()).put(runId, caseKey, markdown);
  }

  async getMarkdown(runId: string, caseKey: string): Promise<string | undefined> {
    if (!isSafeArtifactRef(runId, caseKey)) return undefined;
    return this.read<string | undefined>(undefined, (backend) => backend.get(runId, caseKey));
  }

  async hasMarkdown(runId: string, caseKey: string): Promise<boolean> {
    if (!isSafeArtifactRef(runId, caseKey)) return false;
    return this.read(false, (backend) => backend.has(runId, caseKey));
  }

  /** Claves de archivo (`evalFileKeys`) con markdown guardado para la corrida, ordenadas. */
  async listCaseKeys(runId: string): Promise<string[]> {
    if (!isSafeMddEvalId(runId)) return [];
    return this.read<string[]>([], (backend) => backend.listCaseKeys(runId));
  }

  private getBackend(): Promise<MddEvalArtifactBackend> {
    this.backendPromise ??= this.createBackend();
    return this.backendPromise;
  }

  private async createBackend(): Promise<MddEvalArtifactBackend> {
    const ttl = resolveMddEvalArtifactTtlSeconds();
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.logger.log("MDD eval artefactos: sin REDIS_URL — almacén en memoria (solo desarrollo)");
      return new InMemoryMddEvalArtifactBackend(ttl);
    }
    try {
      // ioredis llega hoisted vía bullmq; import dinámico para no cargarlo sin Redis (mismo patrón que MddJobEventsService).
      const mod = (await import("ioredis")) as unknown as { default?: MddEvalRedisCtor; Redis?: MddEvalRedisCtor };
      const Ctor = mod.default ?? mod.Redis;
      if (!Ctor) throw new Error("ioredis no exporta un constructor");
      const client = new Ctor(url, { maxRetriesPerRequest: 2 });
      client.on?.("error", (error: unknown) => this.warnOnce(error));
      return new RedisMddEvalArtifactBackend(client, ttl);
    } catch (error) {
      this.logger.error(`MDD eval artefactos: Redis no disponible, solo disco: ${errorText(error)}`);
      return new UnavailableMddEvalArtifactBackend(errorText(error));
    }
  }

  private async read<T>(fallback: T, operation: (backend: MddEvalArtifactBackend) => Promise<T>): Promise<T> {
    try {
      const value = await operation(await this.getBackend());
      this.degraded = false;
      return value;
    } catch (error) {
      this.warnOnce(error);
      return fallback;
    }
  }

  private warnOnce(error: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    this.logger.warn(`MDD eval artefactos: Redis no responde, se sirve solo desde disco (${errorText(error)})`);
  }
}
