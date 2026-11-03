# common (`apps/api/src/common`)

Utilidades transversales de la API: acceso por proyecto, conexiones compartidas, filtros y guards que usan varios módulos. Este índice cubre las piezas del lote 2 de calidad del MDD; el resto de carpetas se documenta en su propio archivo o en el código.

## Piezas del lote 2 (2026-11-03)

| Pieza | Qué es | Quién la usa |
|---|---|---|
| `access/` | Política y guard de acceso por proyecto (`ProjectAccessService`, `PROJECT_LEVEL_FORBIDDEN`, decorador `@ProjectScoped`). Ver `access/README.md` y ADR 0001. | Controllers de proyectos y de MDD. |
| `redis/connect-ioredis-ready.ts` | Devuelve un cliente ioredis solo cuando está `ready` (`enableOfflineQueue: false`, tope de espera 5 s). Ver `redis/README.md`. | Almacén de auth (`modules/auth/auth-redis.store.ts`) y lease por hilo MDD (`ai-analysis/checkpoint/thread-run-lock.service.ts`). |
| `mdd-lease-context.ts` | Contexto `AsyncLocalStorage` del lease MDD activo: `fence` y `key`. Lo fijan `runExclusive` y `runGuardedMddStream`; lo leen `persistMddFromPatch` y `persistMddFromBackgroundJob` cuando no llega un fence explícito. | `ai-analysis` y `projects` (ADR 0004). |
| `json-bigint.ts` | `installBigIntJsonSupport()`: define `BigInt.prototype.toJSON` para los valores seguros (como `Stage.mddLeaseFence`). Un valor fuera de `Number.MAX_SAFE_INTEGER` lanza `RangeError`. Se llama al arrancar en `main.ts` y `worker.ts`. | Toda la API. |

## Otras piezas

- `bullmq-*.ts`: configuración de workers BullMQ, recuperación de jobs huérfanos tras reiniciar el worker y opciones de jobs largos.
- `decorators/`, `guards/`, `filters/`, `interceptors/`, `roles.ts`, `request-user.store.ts`: piezas de autenticación, roles y respuestas HTTP.

Pruebas: cada pieza tiene sus `*.spec.ts` junto al archivo (`json-bigint.spec.ts`, `mdd-lease-context.spec.ts`, `redis/connect-ioredis-ready.spec.ts`).
