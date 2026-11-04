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
| `DESIGN_FIRST_ENABLED` | no | `false` | Activa creación y escritura Design-First (release N+1; CL-21). |
| `FIGMA_API_BASE_URL` | no | `https://api.figma.com` | Base HTTPS fija de la API de Figma (anti-SSRF); rechaza `http://`. |
| `DESIGN_FIRST_FIGMA_TIMEOUT_MS` | no | `60000` | Entero positivo (ms): timeout HTTP hacia Figma. |
| `DESIGN_FIRST_FIGMA_MAX_NODES` | no | `5000` | Entero positivo: tope de nodos por importación Figma (RNF-04). |
| `DESIGN_FIRST_VISION_BUDGET_MS` | no | `120000` | Entero ≥ 15000 (ms): presupuesto wall-clock de visión pantalla→ScreenSpec (RNF-05). |
| `DESIGN_FIRST_DATANEEDS_BUDGET_MS` | no | `120000` | Entero ≥ 15000 (ms): presupuesto wall-clock de propuesta de necesidades de datos (RNF-05). |
| `DESIGN_FIRST_MAX_IMAGES` | no | `8` | Entero positivo: imágenes por solicitud de visión (RNF-04). |
| `DESIGN_FIRST_MAX_SPEC_BYTES` | no | `524288` | Entero positivo: tamaño máximo del JSON `designSpec` (512 KiB, RNF-04). |
| `COMPILER_FIRST_BLUEPRINT` | no | `false` | Si `true`, Blueprint intenta compilador PAG antes del LLM. |
| `COMPILER_FIRST_API_CONTRACTS` | no | `true` | Si `false`, desactiva compilador en contratos API. |
| `COMPILER_FIRST_LOGIC_FLOWS` | no | `true` | Si `false`, desactiva compilador en logic flows. |
| `COMPILER_FIRST_INFRA` | no | `true` | Si `false`, desactiva compilador en infra. |

`POSTGRES_PASSWORD` no la lee la API: la exige `docker-compose*.yml` (`${POSTGRES_PASSWORD:?…}`) y se usa dentro de `DATABASE_URL` en el compose.

## Reglas de producción

- `validateEnv` exige `JWT_SECRET` (≥ 32 y no literal conocido), `DATABASE_URL`, `REDIS_URL` y `TOKEN_MASTER_KEYS`; y, si el rol sirve HTTP, `CORS_ORIGINS`.
- `apps/api/docker-entrypoint.sh` repite la comprobación de `JWT_SECRET` antes de arrancar: vacío, menor de 32 caracteres o literal conocido termina con `exit 1`.
- Las variables no declaradas se aceptan (`passthrough`).
- `LANGGRAPH_MDD_*_BUDGET_MS` se validan aquí al arrancar (entero ≥ 15000). Los nodos las leen de `process.env` en `ai-analysis/utils/mdd-llm-timeout.util.ts`; si no están definidas, aplican los defaults de la tabla.
- `DESIGN_FIRST_*`, `FIGMA_API_BASE_URL` y `COMPILER_FIRST_*` se validan aquí; los servicios Design-First y `AiService` leen los flags vía `ConfigService` (helper `config/compiler-first.config.ts` para entregables compilados).
- `THREAD_RUN_LOCK_TTL_MS` llega validado como número; el lease por hilo lo normaliza a string al leerlo.

## Pruebas

`env.schema.spec.ts` (en esta carpeta) cubre las reglas de producción, `THEFORGE_RUNTIME_ROLE`, `TRUST_PROXY`, `THREAD_RUN_LOCK_TTL_MS`, los presupuestos `LANGGRAPH_MDD_*_BUDGET_MS` (un valor de 10000 ms es inválido) y las variables Design-First / `COMPILER_FIRST_*`.
