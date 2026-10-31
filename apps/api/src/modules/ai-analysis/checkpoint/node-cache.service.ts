import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { MDDStateType } from "../state/index.js";

// ---------------------------------------------------------------------------
// In-memory node cache with TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  output: Partial<MDDStateType>;
  ts: number; // Date.now()
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Campos de salida que cuentan como "contenido producido" por un nodo LLM cacheable. */
const CACHEABLE_CONTENT_KEYS = ["mddDraft", "mddStructured", "securitySectionMd", "integrationSectionMd"] as const;

/**
 * Serialización JSON estable (claves ordenadas recursivamente). Evita el bug del replacer-array de
 * `JSON.stringify`, que filtra claves anidadas y descartaba `projectId` del hash.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

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
 * Keys are `node:<nodeName>:<hash12>` where hash is SHA-256 of the
 * node's input fields.  Cache survives within a single server instance;
 * on restart the first generation is always cold (acceptable).
 *
 * TTL is reset on every `get()` hit so actively-used entries stay warm.
 */
@Injectable()
export class NodeCacheService {
  private readonly logger = new Logger(NodeCacheService.name);
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
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
   */
  key(nodeName: string, projectId: string | undefined, fields: Record<string, unknown>): string {
    const raw = stableStringify({ projectId: projectId ?? "__global__", ...fields });
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
    return `node:${nodeName}:${hash}`;
  }

  /** Retrieve cached output.  Returns `undefined` on miss or stall. */
  get(key: string): Partial<MDDStateType> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    // Touch — reset TTL on active entries
    entry.ts = Date.now();
    return entry.output;
  }

  /** Store a node output. */
  set(key: string, output: Partial<MDDStateType>): void {
    this.store.set(key, { output, ts: Date.now() });
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
    this.logger.log("Node cache cleared.");
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
      this.logger.log(`Evicted ${removed} stale entries (${this.store.size} remain).`);
    }
  }
}