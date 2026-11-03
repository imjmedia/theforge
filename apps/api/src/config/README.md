# Configuración del entorno (`apps/api/src/config`)

`env.schema.ts` es la fuente de verdad de las variables de entorno que lee la API. `validateEnv` corre en `ConfigModule.forRoot` al arrancar: si una variable es inválida, el proceso aborta con la lista de variables y motivos, nunca con sus valores.

## Variables

| Variable | Obligatoria | Default | Notas |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test` o `production`. Las reglas de producción dependen de este valor. |
| `THEFORGE_RUNTIME_ROLE` | no | `all` | `all`, `http` o `worker`. Con `all` o `http` se exige `CORS_ORIGINS` en producción. |
| `JWT_SECRET` | en producción | (ninguno) | Mínimo 32 caracteres; rechaza los literales de `KNOWN_INSECURE_JWT_SECRETS`. Fuera de producción el código cae a un valor de desarrollo. |
| `JWT_EXPIRES_IN` | no | `7d` | Caducidad del JWT. No hay refresh ni logout revocable (pendiente, ID-208). |
| `DATABASE_URL` | en producción | (ninguno) | Conexión a PostgreSQL. |
| `REDIS_URL` | en producción | (ninguno) | BullMQ, OTP y rate limit de auth. |
| `TOKEN_MASTER_KEYS` | en producción | (ninguno) | Cifrado de las claves de proveedores (BYOK). |
| `CORS_ORIGINS` | en producción, si el rol sirve HTTP | (ninguno) | Lista de orígenes separada por comas. |
| `TRUST_PROXY` | no | `1` | Entero ≥ 0: número de proxies de confianza delante de la API. Afecta a `req.ip` y al rate limit por IP. |
| `THREAD_RUN_LOCK_TTL_MS` | no | `1200000` | Entero ≥ 1000 (ms): TTL del lease por hilo del harness MDD (`ThreadRunLockService`). El lease se renueva cada 60 s; el TTL solo decide cuánto tarda en liberarse un lease huérfano tras caerse el proceso. |
| `LANGGRAPH_MDD_AUDITOR_NODE_BUDGET_MS` | no | `360000` | Entero ≥ 15000 (ms): presupuesto wall-clock total del nodo Auditor (varias invocaciones y tools). |
| `LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS` | no | `180000` | Entero ≥ 15000 (ms): presupuesto wall-clock total del Manager por turno (structured output o invoke+parse, reparación incluida). |
| `LANGGRAPH_MDD_CRITIC_BUDGET_MS` | no | `120000` | Entero ≥ 15000 (ms): presupuesto wall-clock total de la llamada del Architect Critic (reparación incluida). |
| `LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS` | no | `120000` | Entero ≥ 15000 (ms): presupuesto del nodo de consistencia cruzada. Un valor menor no deja intentos. |

`POSTGRES_PASSWORD` no la lee la API: la exige `docker-compose*.yml` (`${POSTGRES_PASSWORD:?…}`) y se usa dentro de `DATABASE_URL` en el compose.

## Reglas de producción

- `validateEnv` exige `JWT_SECRET` (≥ 32 y no literal conocido), `DATABASE_URL`, `REDIS_URL` y `TOKEN_MASTER_KEYS`; y, si el rol sirve HTTP, `CORS_ORIGINS`.
- `apps/api/docker-entrypoint.sh` repite la comprobación de `JWT_SECRET` antes de arrancar: vacío, menor de 32 caracteres o literal conocido termina con `exit 1`.
- Las variables no declaradas se aceptan (`passthrough`).
- `LANGGRAPH_MDD_*_BUDGET_MS` se validan aquí al arrancar (entero ≥ 15000). Los nodos las leen de `process.env` en `ai-analysis/utils/mdd-llm-timeout.util.ts`; si no están definidas, aplican los defaults de la tabla.
- `THREAD_RUN_LOCK_TTL_MS` llega validado como número; el lease por hilo lo normaliza a string al leerlo.

## Pruebas

`env.schema.spec.ts` (en esta carpeta) cubre las reglas de producción, `THEFORGE_RUNTIME_ROLE`, `TRUST_PROXY`, `THREAD_RUN_LOCK_TTL_MS` y los presupuestos `LANGGRAPH_MDD_*_BUDGET_MS` (un valor de 10000 ms es inválido).
