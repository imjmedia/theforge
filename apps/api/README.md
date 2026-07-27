# @theforge/api

Backend NestJS de TheForge.

- **Módulos:** Projects (incluye **`GET/POST/PATCH …/projects/:projectId/stages`** — crear/actualizar etapa responden `{ stage }`; **`POST …/generate-deliverables`** cascada por `complexity`; generación/preview de **Contratos API** bloqueada si el Blueprint no cubre el §3 del MDD; MDD por etapa con `stageId` en PATCH), Sessions, AI (adapter OpenRouter), Engine (cost-calculator, semáforo, conformance). **Ai-orchestrator:** `POST /ai-orchestrator/welcome` acepta `stageId` opcional (contexto MDD alineado a la etapa). **Ai-analysis:** checkpoints LangGraph / `mdd/thread` por `projectId` + `mddStageId`.
- **DB:** Prisma + PostgreSQL (schema en `packages/database`).
- **IA:** multi-proveedor BYOK/tenant vía **`UserProviderConfig`** e **`ProviderInstance`** (UI **Ajustes → Proveedores de IA**). Runtime: `resolvePrimaryChatRuntime` / `AIFactory.create()` — **sin claves ni modelos en env**. Techo global `max_tokens`: **Ajustes → Sistema** o `LLM_MAX_TOKENS`. Ver [`multi_provider_spec.md`](../../multi_provider_spec.md). Passport **`JwtStrategy`** + `JwtAuthGuard` global; `UserContextInterceptor` + `AsyncLocalStorage` propagan `userId` y `role` del JWT a `ProjectsService` / `SessionsService` (filtrado por propiedad). `JWT_SECRET` obligatorio en producción. **OTP por email:** el correo viene en el body del request y se valida contra la tabla `User` (anti-enumeración: si el email no existe, devuelve `ok` sin enviar nada). `SMTP_*` obligatorias en producción. Cada usuario tiene su propio `mcpSecret` (API key M2M para el MCP server, rotable desde la UI por el dueño o por un admin). El primer admin se crea desde la UI (SetupView) cuando `GET /auth/has-users` devuelve `false`. Las envs `EMAIL_OTP` / `AUTH_ALLOWED_OTP_EMAIL` están deprecadas.

**CORS:** `CORS_ORIGINS` (coma) obligatorio si `NODE_ENV=production`; `docker-compose` incluye por defecto `https://theforge.kreoint.mx`, `WEB_DOMAIN` y localhost (Vite). Sobreescribe en Dokploy si el front vive en otro origen.

**BullMQ:** `REDIS_URL` obligatorio en `NODE_ENV=production`. Colas: `theforge-deliverables`, `theforge-mdd`, `theforge-legacy-deliverables`. Sin Redis: fallback in-memory solo en desarrollo.

**Runtime:** `THEFORGE_RUNTIME_ROLE=all|http|worker`. Compose prod: `theforge-api` (`http`, encola) + `theforge-worker` (`worker`, consume; **misma imagen** `theforge-api:compose`, sin segundo build). Local: `all`.

**Deploy:** el entrypoint ejecuta `migrate deploy` en la API; el worker omite migraciones y espera a que la API esté healthy. Healing Prisma (P3009, drift) solo corre si `migrate deploy` falla. Detalle: [`docker/README.md`](../../docker/README.md).

**Concurrencia:** configurable en **Ajustes → Sistema** (o env legacy): MDD (default 2, max 8), entregables (default 2), legacy entregables (default 1). Ver `modules/system-config/`.

**Configuración de plataforma:** tunables operativos (LLM, MCP, flags legacy, debug) en `GET/PATCH /admin/system-config` + tabla `AppConfig`. Prioridad: BD → env → default. Migración Dokploy: [`docs/DOKPLOY-MIGRACION-CONFIG-SISTEMA.md`](../../docs/DOKPLOY-MIGRACION-CONFIG-SISTEMA.md).

**SSRF (scrape):** `url-ssrf-guard.ts` — resolución DNS y `ip-range-check`; usado en `scrape-cheerio.tool.ts` y `ScraperService`. Proyectos **legacy** + MCP: `THEFORGE_MCP_URL`, tokens MCP; pipeline evidencia-primero y topes en variables `LEGACY_*` (ver raíz `.env.example` y `docs/notebooklm/LEGACY-EVIDENCE-CONTEXT.md`).

## Despliegue (Docker / Dokploy)

- **ENTRYPOINT** `docker-entrypoint.sh`: … migraciones … arranca `main.js` (HTTP) o `worker.js` (BullMQ) según `THEFORGE_RUNTIME_ROLE`.
- En la UI de Dokploy (o cualquier plataforma), **no** sustituir el comando de arranque por `node dist/main.js` solo: se saltarían las migraciones. Usar la imagen tal cual o un comando que invoque el mismo entrypoint.
- **BYOK / cifrado:** obligatorias `TOKEN_MASTER_KEYS` + `TOKEN_ACTIVE_KEY_VERSION`. Rotación de clave maestra: `cd /app && npm run rotate-master-key` en la terminal del contenedor (o desde el monorepo con `DATABASE_URL` de prod). Guía: [README raíz § Cifrado de tokens BYOK](../../README.md#cifrado-de-tokens-byok-claves-maestras). Si perdiste la clave vieja: nuevo `TOKEN_MASTER_KEYS`, `WIPE_BYOK_ON_START=1` en Dokploy, redeploy, quitar la variable, reconfigurar keys en UI.
- Opcional: `WAIT_FOR_POSTGRES_ATTEMPTS` (default 90), `WAIT_FOR_POSTGRES_DELAY_MS` (default 1000).
- **P3009** (`stage_sdd_deliverables`): el entrypoint intenta `migrate resolve --rolled-back` automáticamente antes de `deploy`. Otra migración atascada: `PRISMA_RESOLVE_ROLLED_BACK` o [packages/database/README.md](../../packages/database/README.md).
