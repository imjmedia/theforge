import { Injectable, Logger } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { MDD_PROMPT_VERSION } from "../prompts/prompt-version.js";
import type { MDDStateType } from "../state/index.js";
import { buildNodeCacheKey, stableStringify } from "./node-cache-key.js";

export { stableStringify };

// ---------------------------------------------------------------------------
// In-memory node cache with TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  output: Partial<MDDStateType>;
  ts: number; // Date.now()
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Tope de entradas del cache en memoria; al superarlo se evicta la menos usada recientemente (LRU). */
export const NODE_CACHE_MAX_ENTRIES = 200;

/** Contadores para logs/observabilidad. */
export interface NodeCacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  /** Entradas expulsadas por superar `maxEntries` (LRU). */
  evictions: number;
  /** Entradas retiradas por TTL vencido. */
  expired: number;
}

/** Superficie mínima que necesita `wrapCache`; la implementan el servicio y sus vistas con alcance. */
export interface NodeCacheLike {
  key(nodeName: string, projectId: string | undefined, fields: Record<string, unknown>): string;
  get(key: string): Partial<MDDStateType> | undefined;
  set(key: string, output: Partial<MDDStateType>): void;
}

const nodeCacheBypass = new AsyncLocalStorage<true>();

/**
 * Ejecuta `fn` con la caché por nodo desactivada (ni lee ni escribe) para todo el contexto asíncrono.
 * Lo usa el eval: cada corrida debe medir el pipeline real, no salidas cacheadas.
 */
export function runWithNodeCacheDisabled<T>(fn: () => T): T {
  return nodeCacheBypass.run(true, fn);
}

export function isNodeCacheDisabled(): boolean {
  return nodeCacheBypass.getStore() === true;
}

/** Campos de salida que cuentan como "contenido producido" por un nodo LLM cacheable. */
const CACHEABLE_CONTENT_KEYS = ["mddDraft", "mddStructured", "securitySectionMd", "integrationSectionMd"] as const;

/**
 * Un resultado solo es cacheable si es un éxito con contenido: no vacío, sin `lastStepFailed`
 * y con al menos uno de mddDraft/mddStructured/securitySectionMd/integrationSectionMd no vacío.
 * Así un reintento nunca re-emite un fallo (o un `{}`) sin llamar al LLM.
 */
export function isCacheableNodeOutput(output: Partial<MDDStateType> | undefined | null): boolean {
  if (!output || typeof output !== "object") return false;
  const rec = output as Record<string, unknown>;
  if (Object.keys(rec).length === 0) return false;
  if (rec.lastStepFailed !== undefined && rec.lastStepFailed !== null) return false;
  return CACHEABLE_CONTENT_KEYS.some((k) => {
    const v = rec[k];
    if (typeof v === "string") return v.trim().length > 0;
    if (v && typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
    return false;
  });
}

/**
 * Lightweight in-memory cache for LLM-node outputs.
 *
 * Keys are `node:<nodeName>:<hash12>` (ver `buildNodeCacheKey`): SHA-256 de nodo + entrada +
 * cadena de modelos + `MDD_PROMPT_VERSION`.  Cache survives within a single server instance;
 * on restart the first generation is always cold (acceptable).
 *
 * TTL is reset on every `get()` hit so actively-used entries stay warm. El tamaño está acotado a
 * `NODE_CACHE_MAX_ENTRIES` con evicción LRU (el orden de inserción del `Map` es el orden de uso).
 */
@Injectable()
export class NodeCacheService {
  private readonly logger = new Logger(NodeCacheService.name);
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries = NODE_CACHE_MAX_ENTRIES;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expired = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ttlMs = DEFAULT_TTL_MS;
    this.cleanupTimer = setInterval(() => this.evictStale(), 5 * 60 * 1000);
    // Ensure the timer reference is used so TS doesn't complain
    if (this.cleanupTimer) {
      // no-op: keep the interval alive for the service lifetime
    }
  }

  // ---- public API ---------------------------------------------------------

  /**
   * Build a deterministic cache key from the node name and a set of
   * state fields.  Only the fields the node actually reads should be
   * passed; `projectId` is always included to isolate projects.
   * `models` es la cadena de modelos efectiva del nodo (vacía si no se conoce).
   */
  key(nodeName: string, projectId: string | undefined, fields: Record<string, unknown>, models = ""): string {
    return buildNodeCacheKey({
      node: nodeName,
      input: { projectId: projectId ?? "__global__", ...fields },
      models,
      promptVersion: MDD_PROMPT_VERSION,
    });
  }

  /**
   * Vista de la caché con la cadena de modelos del grafo fijada: comparte almacén y contadores con
   * este servicio, pero sus claves incluyen `models`.
   */
  scoped(models: string): NodeCacheLike {
    return {
      key: (nodeName, projectId, fields) => this.key(nodeName, projectId, fields, models),
      get: (k) => this.get(k),
      set: (k, output) => this.set(k, output),
    };
  }

  /** Retrieve cached output.  Returns `undefined` on miss or stall. */
  get(key: string): Partial<MDDStateType> | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() - entry.ts > this.ttlMs) {
      this.store.delete(key);
      this.expired++;
      this.misses++;
      return undefined;
    }
    // Touch — reset TTL y mueve la entrada al final (más reciente) para el LRU
    entry.ts = Date.now();
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.output;
  }

  /** Store a node output; expulsa la entrada menos usada recientemente al superar el tope. */
  set(key: string, output: Partial<MDDStateType>): void {
    this.store.delete(key);
    this.store.set(key, { output, ts: Date.now() });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
      this.evictions++;
    }
  }

  /** Contadores y tamaño actuales (para logs). */
  stats(): NodeCacheStats {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expired: this.expired,
    };
  }

  /** Invalidate all entries for a given node name (e.g. after a model change). */
  invalidateNode(nodeName: string): void {
    const prefix = `node:${nodeName}:`;
    const keysToDelete: string[] = [];
    this.store.forEach((_, k) => {
      if (k.startsWith(prefix)) keysToDelete.push(k);
    });
    keysToDelete.forEach((k) => this.store.delete(k));
  }

  /** Invalidate every cached entry (e.g. user forces regeneration). */
  invalidateAll(): void {
    this.store.clear();
    this.logger.log(`Node cache cleared. stats=${JSON.stringify(this.stats())}`);
  }

  /** Current number of cached entries. */
  get size(): number {
    return this.store.size;
  }

  // ---- private ------------------------------------------------------------

  private evictStale(): void {
    const now = Date.now();
    let removed = 0;
    const keysToDelete: string[] = [];
    this.store.forEach((v, k) => {
      if (now - v.ts > this.ttlMs) {
        keysToDelete.push(k);
        removed++;
      }
    });
    keysToDelete.forEach((k) => this.store.delete(k));
    if (removed > 0) {
      this.expired += removed;
      this.logger.log(`Evicted ${removed} stale entries (${this.store.size} remain). stats=${JSON.stringify(this.stats())}`);
    }
  }
}