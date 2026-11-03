import { Injectable } from "@nestjs/common";

/** Datos de `User` que `JwtStrategy.validate` necesita en cada petición. */
export interface JwtCachedUser {
  id: string;
  email: string;
  role: string;
  tokenVersion: number;
}

interface CacheEntry {
  user: JwtCachedUser;
  expiresAt: number;
}

/**
 * Caché en memoria (por proceso) del usuario que respalda al JWT, para no consultar la BD en cada petición.
 * TTL corto (30 s) y tope de entradas con evicción simple (se purgan caducadas y luego la más antigua).
 * `AuthService` la invalida al mutar rol, email, secret MCP o al borrar el usuario; en despliegues con varias
 * réplicas la invalidación solo alcanza al proceso local, así que el desfase máximo en las demás es el TTL.
 *
 * Generación por usuario (anti-carrera): quien va a leer la BD toma antes `generation(userId)` y la pasa a
 * `set`. Si entre la lectura y el `set` hubo un `invalidate` (rotación de secret, cambio de rol…), el `set` se
 * descarta: así una lectura anterior a la mutación no puede dejar en caché la fila vieja.
 */
@Injectable()
export class JwtUserCache {
  static readonly TTL_MS = 30_000;
  static readonly MAX_ENTRIES = 1000;

  /** Tope de generaciones recordadas; al superarlo se reinicia el contador (los `set` en vuelo se descartan). */
  static readonly MAX_GENERATIONS = 10_000;

  private readonly entries = new Map<string, CacheEntry>();
  private readonly generations = new Map<string, number>();
  private seq = 0;
  private baseline = 0;

  /** Reloj inyectable por herencia en pruebas. */
  protected now(): number {
    return Date.now();
  }

  get(userId: string): JwtCachedUser | undefined {
    const entry = this.entries.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(userId);
      return undefined;
    }
    return entry.user;
  }

  /** Generación actual del usuario; cambia con cada `invalidate` (y con `clear`). */
  generation(userId: string): number {
    return Math.max(this.baseline, this.generations.get(userId) ?? 0);
  }

  /**
   * Guarda el usuario. Con `generation` (leída ANTES de consultar la BD) el guardado se ignora si el usuario
   * fue invalidado entretanto; devuelve `false` en ese caso.
   */
  set(userId: string, user: JwtCachedUser, generation?: number): boolean {
    if (generation !== undefined && generation !== this.generation(userId)) return false;
    // Reinsertar mueve la clave al final del orden de inserción (la más reciente).
    this.entries.delete(userId);
    if (this.entries.size >= JwtUserCache.MAX_ENTRIES) {
      this.evict();
    }
    this.entries.set(userId, { user, expiresAt: this.now() + JwtUserCache.TTL_MS });
    return true;
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
    if (this.generations.size >= JwtUserCache.MAX_GENERATIONS && !this.generations.has(userId)) {
      this.generations.clear();
      this.baseline = ++this.seq;
    }
    this.generations.set(userId, ++this.seq);
  }

  clear(): void {
    this.entries.clear();
    this.generations.clear();
    this.baseline = ++this.seq;
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= JwtUserCache.MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
