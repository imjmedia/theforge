# Docker (The Forge)

Archivos de soporte para el stack multi-servicio (`docker-compose.yml`).

| Archivo | Uso |
|---------|-----|
| `nginx-fullstack.conf` | Contenedor legacy único (`Dockerfile` raíz) |
| `entrypoint-full.sh` | Entrypoint Postgres + API + Nginx en un solo contenedor |

## Optimización de deploy (Dokploy / HDD)

El compose oficial construye **3 imágenes** (no 4): `theforge-api`, `theforge-web`, `theforge-mcp`.  
`theforge-worker` reutiliza **`theforge-api:compose`** (misma imagen, sin segundo `pnpm build`).

| Medida | Efecto |
|--------|--------|
| Imagen compartida api/worker | ~25–35 % menos tiempo de build cuando la API era el cuello de botella |
| BuildKit + caché pnpm (`syntax=docker/dockerfile:1.4`) | `pnpm install` más rápido entre deploys si el lockfile no cambió |
| `.dockerignore` ampliado | Menos contexto enviado al daemon (tests, docs, `.github`) |
| Entrypoint fast-path | `migrate deploy` primero; healing Prisma solo si falla |
| Worker sin migraciones | El worker arranca tras API healthy; no duplica round-trips a Postgres |

En el servidor, asegura **BuildKit** activo (Docker ≥ 23 lo trae por defecto):

```bash
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
```

En Dokploy no suele hacer falta configurarlo manualmente. Con disco mecánico, la caché de capas en el host sigue siendo lenta: un SSD para `/var/lib/docker` o el directorio de datos de Dokploy reduce mucho el tiempo restante.

## Servicios

Ver [`docker-compose.yml`](../docker-compose.yml) y [`apps/api/README.md`](../apps/api/README.md) (runtime `http` / `worker`).
