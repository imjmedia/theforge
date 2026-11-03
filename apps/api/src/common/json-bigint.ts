/**
 * Serialización JSON de `BigInt` (red de seguridad global).
 *
 * Prisma devuelve `BigInt` en columnas `BigInt` (p. ej. `Stage.mddLeaseFence`) y `JSON.stringify` lanza
 * `TypeError` con ellos. Todos los BigInt del esquema son fences derivados de `Date.now()` más incrementos
 * pequeños, que caben en `Number.MAX_SAFE_INTEGER` (≈ 9e15 ms, unos 285 000 años desde epoch), así que se
 * serializan como número. Si algún valor superara ese máximo, se lanza `RangeError` en vez de perder
 * precisión en silencio.
 */
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/** Define `BigInt.prototype.toJSON` si no existe. Idempotente: llamarla varias veces no cambia nada. */
export function installBigIntJsonSupport(): void {
  if (typeof (BigInt.prototype as { toJSON?: unknown }).toJSON === "function") return;
  Object.defineProperty(BigInt.prototype, "toJSON", {
    configurable: true,
    writable: true,
    value: function bigIntToJson(this: bigint): number {
      if (this > MAX_SAFE_BIGINT || this < MIN_SAFE_BIGINT) {
        throw new RangeError(
          `El BigInt ${this.toString()} supera Number.MAX_SAFE_INTEGER y no puede serializarse a JSON sin perder precisión`,
        );
      }
      return Number(this);
    },
  });
}
