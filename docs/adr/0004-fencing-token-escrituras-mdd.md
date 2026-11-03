# ADR 0004: Fencing token en las escrituras del MDD

- **Estado:** Aceptado e implementado (2026-11-03), lote 2 de calidad del MDD, rama `fix/calidad-mdd-lote-2`.
- **Ámbito:** `apps/api/src/modules/ai-analysis/checkpoint/thread-run-lock.service.ts`, `persist` en `apps/api/src/modules/ai-analysis/ai-analysis.service.ts`, `apps/api/src/modules/projects/project-mdd-persist.service.ts` y el modelo `Stage` (`packages/database/schema.prisma`).
- **Referencias:** deuda TOCTOU de `docs/adr/0003-lease-por-hilo-falla-cerrado.md`; migración `packages/database/migrations/20261103120000_stage_mdd_lease_fence/migration.sql`.

## Contexto

El lease por hilo (ADR 0003) impide que dos turnos MDD corran sobre la misma etapa, pero su comprobación es local. `isHeld()` lee un estado en proceso que solo cambia al renovar. Si el lease vence y otro proceso lo toma, el turno original no lo sabe hasta el siguiente renew y puede seguir escribiendo `mddContent`.

La ventana está en `persist`. `ai-analysis.service.ts:688-692` comprueba `isLeaseHeld()` y, si el lease sigue, llama a `persistMddFromBackgroundJob` (línea 705). Entre ambas cosas, la ruta de `project-mdd-persist.service.ts` ejecuta `prepareMddForOutput` (línea 155) y `mddUpdatePipeline.process` (línea 181), que tardan segundos antes del `stage.update`. Una comprobación previa con `GET` del token en Redis no cierra la ventana: el lease puede vencer justo después de la lectura y antes de la escritura.

## Decisión

1. **Contador monotónico en Redis.** Clave `mdd:thread-fence`. No hay siembra al arrancar: `FENCE_LUA` hace `INCR` y, si el contador quedó por debajo de `Date.now()` (primera ejecución o flush de Redis), lo sube al reloj antes de devolverlo. La semilla con la hora evita que el contador vuelva a números bajos.
2. **Fence estampado al adquirir.** Cada `acquire` exitoso ejecuta `FENCE_LUA` y guarda el resultado como `fence` del lease. Un turno posterior siempre recibe un fence mayor que los anteriores.
3. **Reclamo de la etapa.** Al adquirir, el turno escribe `Stage.mddLeaseFence = fence` solo si el valor guardado es nulo o menor. Un turno viejo no pisa el reclamo de uno más nuevo.
4. **Escritura condicionada.** Cada escritura del MDD usa `updateMany({ where: { id, OR: [{ mddLeaseFence: null }, { mddLeaseFence: { lte: fence } }] } })`. Si `count === 0`, lanza `MddWriteFencedError`, y el persister lo traduce a `{ ok: false, reason: "lease_lost" }`, igual que una pérdida de lease.
5. **Tipos.** En TypeScript el fence es `number`. `BigInt` aparece solo en Prisma (`mddLeaseFence BigInt?`) y la conversión se hace en el repositorio. Un `number` cubre enteros hasta 2^53, de sobra para `Date.now()` más incrementos.
6. **Modo sin Redis.** Sin `REDIS_URL` (desarrollo y tests), el lock en proceso usa la misma idea: el fence es `max(anterior + 1, Date.now())` en memoria y el mismo `updateMany` condicional. Es correcto porque sin Redis solo existe un proceso.

## Consecuencias

- La migración es aditiva y nullable (`ADD COLUMN IF NOT EXISTS`). Debe aplicarse antes del código que escribe `mddLeaseFence`. Las filas existentes quedan en `NULL`, y `NULL` no bloquea ninguna escritura.
- Durante el rollout, una réplica antigua no reclama ni comprueba el fence, así que sus escrituras no están protegidas hasta que se actualice.
- Un flush de Redis no hace retroceder el contador: `FENCE_LUA` sube el valor a `Date.now()` cuando queda por debajo, así que el fence nuevo supera a los previos mientras el reloj avance.
- `LEASE_LOST` no cambia para la web: el fence reutiliza el mismo código de error que la pérdida de lease.
- **Límites (fuera de alcance, no protegidos por el fence):**
  - El checkpoint de LangGraph: el estado del grafo se sigue guardando sin fence. El lease sigue evitando la concurrencia, pero un turno viejo puede escribir su checkpoint.
  - El PATCH del editor web, que escribe `mddContent` directamente.
  - Escrituras derivadas: change-log y snapshots de delivery gate. Los snapshots se escriben sin fence en `project-mdd-persist.service.ts:166`, `:305` y `:431` (deuda D-4 del handoff).
  - Los tools del Manager (`patch_mdd_section`, `propose_mdd_amendment`) escriben con `projects.update` → `persistMddFromPatch`; no reciben el fence por firma, pero `persistMddFromPatch` y `persistMddFromBackgroundJob` lo toman del contexto del lease activo (`common/mdd-lease-context.ts`, fijado por `runExclusive` y por el stream HTTP), así que dentro de un turno quedan condicionadas por `mddLeaseFence`. Un PATCH del editor fuera de lease sigue sin fence (límite declarado).
  - El fence no sale en las respuestas que usan `toApiProject` de `apps/api/src/modules/projects/project-api.util.ts`, que lo omite de cada etapa. `project-merge.service.ts` y `project-notion-portability.service.ts` tienen su propio `toApiProject` y todavía lo exponen como número (deuda D-3 del handoff). Como red de seguridad, los `BigInt` se serializan como número (`common/json-bigint.ts`).

## Alternativas descartadas

- **`assertHeld()` con `GET` previo.** La comprobación y la escritura siguen separadas por segundos de trabajo (`prepareMddForOutput` y el pipeline). No cierra la ventana.
- **Versión optimista por contenido o hash** (`WHERE mddContent = <valor leído>`). Detecta cambios, pero no sabe qué turno escribió: dos turnos que producen el mismo texto pasan, y un turno viejo puede ganar si el contenido coincide.
- **Bloquear el PATCH del editor web mientras hay un turno.** Cambia el comportamiento visible del editor y no cubre la carrera entre turnos MDD, que es el problema.
