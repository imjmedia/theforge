# Despliegue en Coolify

TheForge usa el mismo `docker-compose.yml` que en Dokploy, con un **override** que quita la red externa `dokploy-network` (específica de Dokploy).

## Compose

```bash
docker compose -f docker-compose.yml -f docker-compose.coolify.yml up --build
```

En **Coolify** (v4+):

1. Nuevo recurso → **Docker Compose**.
2. Repositorio + rama.
3. Si la UI permite **varios archivos compose**, añade:
   - `docker-compose.yml`
   - `docker-compose.coolify.yml`
4. Si solo acepta un archivo, usa el comando custom de build/deploy con el merge anterior, o copia manualmente el contenido fusionado (`docker compose … config`).

Validar el merge en local antes de subir:

```bash
docker compose -f docker-compose.yml -f docker-compose.coolify.yml config
```

## Routing (recomendado: igual que Dokploy)

Coolify expone servicios con Traefik/Caddy. Configura **un dominio** con dos rutas:

| Ruta | Servicio | Puerto contenedor | Notas |
|------|----------|-------------------|--------|
| `/` | `theforge-web` | `80` | Solo estáticos + SPA (`apps/web/nginx.conf`) |
| `/api` | `theforge-api` | `3000` | **Strip prefix** `/api` (Nest escucha en raíz) |

El frontend usa `API_BASE = /api` por defecto; no hace falta `VITE_API_URL` en build si el path routing está bien.

**SSE / chat stream (`POST /api/ai-orchestrator/chat/stream`)** y **NDJSON MDD (`POST /api/ai-analysis/mdd/stream/manager` y `…/mdd/stream/resume`; la regeneración de una sección va por jobs, `POST /api/ai-analysis/mdd/jobs`):** el LLM puede tardar minutos sin enviar tokens. En Traefik (Dokploy/Coolify) sube el timeout de lectura del servicio API (p. ej. `traefik.http.services.theforge-api.loadbalancer.responseforwarding.flushinterval=1s` y `readTimeout` / `idleTimeout` ≥ 3600s si tu versión lo expone). Nginx del repo ya usa `proxy_read_timeout 3600s` en `nginx.local.conf` / `docker/nginx-fullstack.conf`. La API emite comentarios SSE `: keepalive` cada 15s en chat; los streams MDD NDJSON emiten `{ type: "progress" }` cada 15s mientras el agente LLM trabaja.

### Alternativa: un solo servicio público (nginx proxy)

Si Coolify no permite path split en tu plan:

1. En `docker-compose.coolify.yml`, descomenta el `volumes` de `theforge-web` que monta `nginx.local.conf`.
2. Enruta **todo** el dominio → `theforge-web:80`.
3. Ese nginx hace `proxy_pass` de `/api/` → `theforge-api:3000`.

## Variables de entorno

Inyecta las mismas que en Dokploy (servicio **`theforge-api`** como mínimo):

| Variable | Obligatoria prod |
|----------|------------------|
| `JWT_SECRET` | Sí (mínimo 32 caracteres, `openssl rand -hex 32`; el stack no arranca sin él) |
| `POSTGRES_PASSWORD` | Sí (contraseña del rol `theforge`; `openssl rand -hex 24`; el stack no arranca sin ella) |
| `TOKEN_MASTER_KEYS` | Sí |
| `TOKEN_ACTIVE_KEY_VERSION` | Sí |
| `CORS_ORIGINS` | Sí (dominio Coolify + localhost dev si aplica) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Sí (OTP login) |
| `OPENROUTER_API_KEY` | Opcional servidor; BYOK en UI |
| `THEFORGE_MCP_URL`, tokens MCP | Si usas Ariadne |
| `REDIS_URL` | Ya en compose: `redis://theforge-redis-queue:6379` |
| `FALKORDB_SDD_URL` | Ya en compose: `redis://theforge-falkor-sdd:6379` |

`DATABASE_URL` viene fijada en compose hacia `theforge-db` y se construye con `POSTGRES_PASSWORD`. Si el volumen de Postgres ya existía, la contraseña anterior sigue vigente hasta rotarla con `ALTER USER theforge PASSWORD '...'` (Postgres solo aplica `POSTGRES_PASSWORD` al inicializar el volumen). No sobrescribas el **CMD/entrypoint** del API (`docker-entrypoint.sh` ejecuta migraciones Prisma).

## Healthchecks

- **API / MCP:** probe **dentro** del contenedor → `http://localhost:3000/health` (no uses la IP del host).
- **Web:** `http://localhost:80/` (override Coolify/local; en Dokploy prod sigue DNS `theforge-web`).

## Servicios opcionales

- **`theforge-mcp`:** expón path `/mcp` si Hermes/Cursor deben llamar al MCP HTTP.
- **`theforge-adminer`:** perfil `tools` (no arranca por defecto) y sin red `dokploy-network`. No le asignes dominio ni lo expongas a internet; actívalo solo puntualmente con `--profile tools`.

## Dokploy vs Coolify

| | Dokploy | Coolify |
|---|---------|---------|
| Compose | `docker-compose.yml` | `docker-compose.yml` + `docker-compose.coolify.yml` |
| Red externa | `dokploy-network` | Ninguna (red bridge del stack) |
| Proxy | Traefik Dokploy | Traefik/Caddy Coolify |
| Local full-docker | `docker-compose.local.yml` | — |

Ver también [README-LOCAL.md](../README-LOCAL.md) (dev nativo y compose local).
