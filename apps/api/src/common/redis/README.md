# common/redis

Utilidades compartidas para conectar a Redis con ioredis.

## `connect-ioredis-ready.ts`

`connectIoredisReady(url, { name, readyTimeoutMs?, maxRetriesPerRequest?, commandTimeoutMs?, createClient? })` devuelve un cliente ioredis **solo cuando está `ready`**.

- Usa `enableOfflineQueue: false`: sin cola offline, un comando emitido antes de `ready` falla ("Stream isn't writeable"). El helper espera `ready` con tope (`readyTimeoutMs`, 5 s por defecto).
- Si no llega a `ready`, desconecta el cliente y lanza el error. Quien llama no debe cachear la promesa rechazada: el siguiente intento abre una conexión limpia.
- `maxRetriesPerRequest` vale 2 por defecto, para no reintentar sin fin.
- `createClient` existe solo para tests (inyecta un cliente falso).

Quién lo usa:

- `apps/api/src/modules/auth/auth-redis.store.ts`: almacén del OTP y del rate limit de auth.
- `apps/api/src/modules/ai-analysis/checkpoint/thread-run-lock.service.ts`: lease por hilo MDD. Con `REDIS_URL`, si el helper no entrega un cliente listo, el `acquire` lanza `LOCK_UNAVAILABLE` (falla cerrado).

Pruebas: `connect-ioredis-ready.spec.ts` (esta carpeta).
