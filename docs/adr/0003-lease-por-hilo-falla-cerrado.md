# ADR 0003: Lease por hilo que falla cerrado

- **Estado:** aceptada (2026-11-03), lote 2 de calidad del MDD, rama `fix/calidad-mdd-lote-2`.
- **Ámbito:** `apps/api/src/modules/ai-analysis/checkpoint/thread-run-lock.service.ts`, `apps/api/src/common/redis/connect-ioredis-ready.ts`, `persist` en `ai-analysis.service.ts` y los turnos MDD (streams HTTP y `mdd/mdd-queue.service.ts`).
- **Referencias:** H5 y H6 de `docs/handoffs/2026-11-02-auditoria-global.md`; `apps/api/src/modules/ai-analysis/checkpoint/README.md`; `docs/handoffs/2026-11-03-calidad-mdd-lote2-handoff.md`.

## Contexto

Un hilo MDD (proyecto + etapa) comparte un único checkpoint de LangGraph. Dos turnos concurrentes (stream del manager y resume, stream y job de BullMQ, dos pestañas) escriben el mismo estado y se pisan (`auditorScore`, `mddDraft`, flags de gate).

El lock anterior tenía un fallo abierto (H5). Con `enableOfflineQueue: false`, el primer `SET` ocurría antes de `ready`, ioredis lo rechazaba y el código caía a un `Map` en proceso. Dos procesos o dos réplicas podían entonces tomar el mismo hilo. Además, un lease perdido durante el turno no abortaba nada, y `persist` ignoraba si el suelo anti-wipe había rechazado el documento (H6): el turno se perdía en silencio.

## Decisión

1. **Lease en Redis.** `SET key token NX PX ttl`, renovado cada 60 s, liberado con compare-and-delete. Es reentrante por contexto async (AsyncLocalStorage), para que un job que ya tiene el lease llame a los streams internos sin bloquearse.
2. **Falla cerrado.** Con `REDIS_URL`, si Redis no está listo en 5 s o el `SET` falla, `acquire` lanza `LOCK_UNAVAILABLE`. Nunca concede exclusión local. El `Map` en proceso solo existe sin `REDIS_URL` (desarrollo y tests); en producción `REDIS_URL` es obligatoria (`apps/api/src/config/env.schema.ts`).
3. **Pérdida confirmada.** El lease expone `signal` (abortado con `LEASE_LOST`) e `isHeld()`, y el turno aborta. Es pérdida confirmada cuando la renovación devuelve 0 (el token ya no es el nuestro), cuando la liberación no encuentra nuestro token o cuando el TTL venció sin poder renovarse. Un error transitorio al renovar solo se registra y se reintenta en el siguiente tick.
4. **`persist` comprueba el lease** antes de escribir; si se perdió, no escribe (`lease_lost`).
5. **Códigos y reintentos.** `LOCK_UNAVAILABLE` es reintentable en jobs de pipeline (máx. 2 intentos de BullMQ). `LEASE_LOST` y `ThreadBusyError` no son reintentables. Los turnos de chat se encolan con `attempts: 1`, porque no son idempotentes: en ellos `LOCK_UNAVAILABLE` termina el turno con error.
6. **Web.** `LEASE_LOST` y `LOCK_UNAVAILABLE` descartan el resultado del turno y restauran el editor al estado previo, con aviso.

## Consecuencias

- Con Redis caído, los turnos MDD fallan con `LOCK_UNAVAILABLE` en vez de correr sin exclusión. Se prefiere un turno fallido a dos escrituras sobre el mismo hilo.
- Un turno de chat que choca con Redis caído termina en error sin reintento automático; el usuario lo repite a mano.
- `THREAD_RUN_LOCK_TTL_MS` (20 min por defecto) solo decide cuánto tarda en liberarse un lease huérfano tras caerse un proceso. Como el lease se renueva cada 60 s, no limita la duración de un turno.
- Redis ya era obligatorio en producción para BullMQ; este cambio no añade una dependencia nueva, pero hace que su caída también frene los turnos de chat.
- **TOCTOU (cerrado en el lote 2b por ADR 0004).** El lease puede vencer entre la comprobación de `persist` y la escritura. El fencing token (ADR 0004) condiciona cada escritura del MDD a la etapa, así que un turno que perdió el lease no puede escribir `mddContent`.
- La carrera TOCTOU del lease queda cerrada para el MDD por el fencing token (ADR 0004). El checkpoint de LangGraph sigue sin fence.
- **Modos sin lease (resuelto en el lote 2b).** `section`, `section-pipeline` y `upstream-sync` toman el lease completo (`runMddGenerationJob`, `withThreadLease`).

## Alternativas descartadas

- **Lock en proceso como respaldo de Redis.** Dos réplicas no se ven entre sí, así que el respaldo reintroduce el fallo abierto (H5). Se descarta.
- **Fencing token en este lote.** Cierra el TOCTOU, pero toca el checkpointer y el esquema. Se pospuso a un ADR propio, que es el ADR 0004 (implementado en el lote 2b).
- **Lock sin TTL (solo liberación explícita).** Un proceso caído dejaría el hilo bloqueado para siempre. El TTL con renovación es el compromiso elegido.
- **Lease por job en vez de por hilo.** Dos jobs distintos sobre el mismo hilo seguirían pisándose. La unidad de exclusión es el hilo.
