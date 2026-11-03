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

`POSTGRES_PASSWORD` no la lee la API: la exige `docker-compose*.yml` (`${POSTGRES_PASSWORD:?…}`) y se usa dentro de `DATABASE_URL` en el compose.

## Reglas de producción

- `validateEnv` exige `JWT_SECRET` (≥ 32 y no literal conocido), `DATABASE_URL`, `REDIS_URL` y `TOKEN_MASTER_KEYS`; y, si el rol sirve HTTP, `CORS_ORIGINS`.
- `apps/api/docker-entrypoint.sh` repite la comprobación de `JWT_SECRET` antes de arrancar: vacío, menor de 32 caracteres o literal conocido termina con `exit 1`.
- Las variables no declaradas se aceptan (`passthrough`).

## Pruebas

`env.schema.spec.ts` (en esta carpeta) cubre las reglas de producción, `THEFORGE_RUNTIME_ROLE` y `TRUST_PROXY`.
