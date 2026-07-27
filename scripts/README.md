# Scripts

Scripts de utilidad para el monorepo.

## rotate-master-key

Re-cifra API keys BYOK almacenadas hacia `TOKEN_ACTIVE_KEY_VERSION`.

**Tablas:** `user_provider_configs`, `provider_instances`.

**Requisitos de entorno:**

- `DATABASE_URL` — PostgreSQL (misma BD que el API en prod)
- `TOKEN_MASTER_KEYS` — JSON con **todas** las versiones presentes en BD (p. ej. `{"1":"...","2":"..."}`)
- `TOKEN_ACTIVE_KEY_VERSION` — versión destino (debe existir en el JSON)

**Uso:**

```bash
pnpm run rotate-master-key
```

**Dokploy (sin SSH):** Terminal web del contenedor `theforge-api`:

```bash
cd /app && pnpm run rotate-master-key
```

Documentación completa: [README.md § Cifrado de tokens BYOK](../README.md#cifrado-de-tokens-byok-claves-maestras).

## ensure-infra.js

Asegura runtime Docker (Colima en Mac si hace falta) y contenedores:

| Contenedor | Puerto host |
|------------|-------------|
| `theforge-db` | 5432 |
| `theforge-redis-queue` | 6381 |

Usado por `dev:local` y `dev:api`. Ver [README-LOCAL.md](../README-LOCAL.md).

## wait-for-api.js

Antes de `vite`, hace polling a `GET /health` en el API (por defecto `http://127.0.0.1:3000/health`) hasta que responda o agote el timeout (120s). Lo usa `@theforge/web` en `pnpm run dev` / `dev:local` para que el proxy no reciba `ECONNREFUSED` mientras Nest compila.

Variables opcionales: `PORT` / `API_PORT`, `API_WAIT_HOST`, `API_WAIT_TIMEOUT_MS`, `API_WAIT_INTERVAL_MS`.

Si solo levantas el front (`dev:web`), el API debe estar ya en marcha o el script fallará con timeout.

## ensure-postgres.js

Asegura que Colima (runtime de contenedores) y el contenedor Docker `theforge-db` (Postgres) estén en ejecución. **Preferir `ensure-infra.js`** (Postgres + Redis cola).

1. **Colima:** si no está corriendo, ejecuta `colima start --cpu 2 --memory 4`.
2. **Postgres:** si el contenedor no existe, lo crea; si existe pero está parado, lo inicia; si ya está Up, no hace nada.

Se usa desde el script `dev:local` del `package.json` raíz. Requiere Colima y Docker CLI instalados.

## Redis de cola (BullMQ) y `REDIS_URL`

En **Docker Compose** (`docker-compose.yml`) el servicio **`theforge-redis-queue`** expone Redis 6379 **solo en la red interna** del stack; el API recibe `REDIS_URL=redis://theforge-redis-queue:6379` por defecto.

**Producción:** `REDIS_URL` es obligatorio (`NODE_ENV=production`). El entrypoint y `main.ts`/`worker.ts` abortan si falta.

**Procesos separados:** `theforge-api` (`THEFORGE_RUNTIME_ROLE=http`) encola jobs; `theforge-worker` (`THEFORGE_RUNTIME_ROLE=worker`) ejecuta workers BullMQ (MDD, entregables, legacy). Desarrollo local: `THEFORGE_RUNTIME_ROLE=all` en un solo `nest start`.

- **Local sin Compose:** levanta Redis (p. ej. `redis-server` o un contenedor en `localhost:6379`) y en `.env` define `REDIS_URL=redis://localhost:6379`. Si `REDIS_URL` está vacío en dev, la API usa cola in-memory (no usar en prod).

## audit-falkor-sdd.mjs (obsoleto)

Script legacy para auditar FalkorDB SDD (retirado del API en v1.7.0). Usar coherencia §3/§4 vía Workshop (`generation-status.sddGraph`) o `MddCoherenceService` en código.
