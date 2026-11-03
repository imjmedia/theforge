# Handoff: seguridad lote 1 (2026-11-02)

- **Rama:** `fix/seguridad-lote-1`. Cambios sin commit sobre `master`. No desplegado.
- **Origen:** `docs/seguridad/auditoria-2026-11-02-app-infra.md` (ID-101 a ID-125). Verificación independiente del lote: `docs/seguridad/auditoria-2026-11-02-lote1.md`.
- **Decisión de diseño:** `docs/adr/0001-autorizacion-por-proyecto.md`.

## Qué se hizo

- **Autorización por proyecto** (`apps/api/src/common/access/`): política pura, `ProjectAccessGuard`, `@ProjectScoped` y cobertura por defecto en `route-coverage.spec.ts`.
- **Auth:** OTP en Redis con 5 fallos, rate limit con 429 y `Retry-After`, 503 en producción sin Redis, `tokenVersion` (claim `tv`) y rol leído de la BD.
- **Configuración:** `apps/api/src/config/env.schema.ts` valida el entorno al arrancar; `docker-entrypoint.sh` aborta sin `JWT_SECRET` válido.
- **Jobs:** ids con prefijo y UUID; denegación en 404; stream SSE con tope de 6 h.
- **MCP:** el secret viaja por petición; no hay JWT global.
- **Compose:** sin defaults para `JWT_SECRET` ni `POSTGRES_PASSWORD`; Adminer en el perfil `tools`, fuera de `dokploy-network`.

## Decisiones del usuario

- **SHARED:** un no dueño tiene `read` y `contribute`. `spend` (LLM) y `manage` (borrado, ajustes) son solo del dueño.
- **Revocación:** rotar el secret MCP, cambiar el rol o cambiar el email revoca los JWT previos. Asignar el mismo rol no revoca.
- **Admin:** no ve proyectos `PRIVATE` ajenos. `allowAdmin` solo da `manage` sobre un `SHARED` ajeno, para borrar.

## Pasos operativos antes del deploy

1. **Dokploy (`theforge-api` y `theforge-worker`):** `JWT_SECRET` con al menos 32 caracteres (`openssl rand -hex 32`). Sin él, el entrypoint termina con `exit 1`.
2. **`NODE_ENV=production`** en `theforge-api` (ID-211: hoy el fallo cerrado depende de que la variable llegue al contenedor).
3. **`POSTGRES_PASSWORD`** (`openssl rand -hex 24`, solo hex). Un volumen de Postgres ya inicializado conserva la contraseña anterior: ejecutar `ALTER USER theforge PASSWORD '<valor>'` antes del deploy.
4. **`TOKEN_MASTER_KEYS`:** obligatoria en producción (cifrado de claves de proveedores).
5. **`DATABASE_URL` y `REDIS_URL`:** presentes en producción.
6. **`CORS_ORIGINS`:** orígenes de la web, si el rol sirve HTTP.
7. **`TRUST_PROXY`:** `1` con Traefik; `2` si hay CDN delante.
8. **Adminer:** quitar el dominio público en Dokploy (el informe de lote 1 señala `adminer-maxprime.obp.mx`) y detener o borrar el contenedor `theforge-adminer` si sigue vivo.
9. **Migración:** aplicar `20261102210000_add_user_token_version` (`packages/database/migrations/`). El `Dockerfile` raíz usa `db push` (pendiente): confirmar que la columna `tokenVersion` existe antes de levantar la API.
10. **Después del deploy:** revisar los logs de arranque, `GET /health` del API y un login OTP de prueba. Si el MCP usa un secret rotado, actualizar su configuración.

## Contratos que cambian (web y MCP)

- **Jobs:** toda denegación responde `404 Job no encontrado` (antes 400 o 403). Afecta al polling de la web y a las tools MCP que consultan jobs.
- **400 pasa a 404:** `GET /ai-analysis/mdd/jobs/:jobId`, `GET /ai-analysis/phase0/state/:threadId` y las sesiones de entrevista legacy (`Session not found`).
- **403 `PROJECT_LEVEL_FORBIDDEN`:** cuerpo `{ code, level, message }` en las acciones `spend` para colaboradores. La web omite el de la bienvenida; el resto debe mostrarlo como falta de permiso.
- **Auth:** 429 con `Retry-After` en OTP, `mcp-login`, SSO, ForgeOps y registro del primer admin; 503 en producción sin Redis. El cliente MCP no reintenta un 429.
- **`POST /auth/mcp-secret/regenerate`** devuelve `{ mcpSecret, accessToken }`. La web debe guardar el `accessToken` nuevo.
- **Estado MDD:** `failed` es terminal. Un cliente que esperaba `retrying` tras un fallo debe esperar `delayed`, que es lo que BullMQ reporta mientras reintenta.
- **SSE de entregables:** evento `timeout` tras 6 h.

## Verificación

- **Hecho:** lectura del diff y contraste de cada punto de este documento y del CHANGELOG con el código.
- **Pendiente:** `pnpm typecheck` y `pnpm test` en el monorepo, y la migración sobre una base de prueba. El informe de lote 1 indica 62/62 en cinco specs ejecutados; no es la suite completa.

## Pendientes conocidos

Del informe de lote 1 (`auditoria-2026-11-02-lote1.md`):

- **ID-212 (ALTA):** parte operativa de ID-102. Siguen el dominio de Adminer en Dokploy, un posible contenedor previo, la contraseña efectiva sin `ALTER USER`, el literal en `Dockerfile` (líneas 21, 52 y 54) y la rotación de `mcpSecret`.
- **ID-201 (MEDIA):** el informe describe `POST /sessions/:id/chat` sin guard de nivel. El working tree actual llama `authorizeSession(id, "spend")` (`sessions.controller.ts`, línea 81). Confirmar que la auditoría se repite sobre este estado.
- **ID-202 (MEDIA):** el informe cita un bucket de 20/min para `mcp-login`. El código usa 600/60 s por IP y 20/60 s por secret (`auth-rate-limit.guard.ts`). Confirmar el valor real con el tráfico del MCP.
- **ID-203 (MEDIA):** el bloqueo dirigido por email es un trade-off aceptado y documentado en `auth/README.md`.
- **ID-205 (BAJA):** el SSE de entregables no revalida el acceso tras pasar el proyecto a `PRIVATE` (se autoriza solo al abrir; tope 6 h). ID-206 quedó cerrado: `convergeWebhookSecret` llega `null` a colaboradores en `GET /projects/:id` y `GET /sessions/:id`.
- **ID-207 (BAJA):** un admin puede rotar el secret o cambiar el email de otro admin, y entrar como él.
- **ID-208 y ID-209 (BAJA):** JWT de 7 días sin refresh ni logout revocable; techo de unos 1.440 intentos de OTP al día por email.
- **ID-204, ID-210, ID-211, ID-213, ID-214, ID-215:** valores no string en specs opcionales; condición de carrera de `register-first-admin` (ID-116); dependencia de `NODE_ENV`; dependencia de `TRUST_PROXY`; `GET /projects/favorites` inalcanzable; `.dockerignore` sin `.env*`.

Del código y del CHANGELOG:

- CORS por defecto en `docker-entrypoint.sh` cuando `CORS_ORIGINS` llega vacío (ID-123).
- Rol `admin` fijo del worker.
- `mcp-client-context.ts`: `clientName` global.
- `DELETE /projects/:id` sigue exigiendo admin, aunque el dueño sea `developer` (paridad con el comportamiento anterior).
- `Dockerfile` raíz con `db push`.

Fuera del alcance del lote (informe app-infra): ID-104, ID-107, ID-110 a ID-112, ID-114, ID-115, ID-117, ID-119 a ID-125.
