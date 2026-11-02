# Auditoría de seguridad — 2026-11-02 (Lote 1)

Alcance: `app` + `secretos` + `infra` sobre el diff del Lote 1 (`git diff master`, cambios sin commitear en la rama `fix/seguridad-lote-1`) · Commit base: `d6e88ca1` (HEAD y `master` local; el encargo citaba `bfb3b21f`) · Herramientas: lectura estática, `git diff`, `grep` de patrones de secretos con valores enmascarados, ejecución local de 5 specs (`node --import tsx --test`: 62/62 en verde), Dokploy MCP de solo lectura (`overview-domains`). Sin `deps`, sin pruebas dinámicas ni tráfico contra entornos desplegados.

Referencia previa: `docs/seguridad/auditoria-2026-11-02-app-infra.md` (ID-101..ID-125).

## Resumen ejecutivo

El Lote 1 cierra la mayor parte de lo que prometía. Los cambios de más peso son cuatro:

- Un guard declarativo (`@ProjectScoped`) cubierto por un spec de cobertura que deniega por defecto.
- Una política única (`canAccessProject`).
- OTP en Redis con tope atómico de intentos.
- `tokenVersion` con rol leído de la BD, y validación del entorno que falla cerrado en producción.

Quedan tres cosas importantes:

1. **ID-102 sigue a medias en la parte operativa.** El dominio `adminer-maxprime.obp.mx` sigue configurado en Dokploy (verificado hoy, solo lectura). Además, la contraseña efectiva de Postgres no cambia hasta ejecutar `ALTER USER`.
2. **Hay un desvío de la nueva política `spend`.** `POST /sessions/:id/chat` equivale a `/ai-orchestrator/chat`, pero solo exige ser dueño de la sesión. Esa sesión la puede crear cualquier colaborador `SHARED` (`contribute`) (ID-201).
3. **El rate limit por IP introduce dos DoS funcionales:**
   - todo el tráfico `mcp-login` sale del contenedor MCP y comparte un único bucket de 20/min (ID-202);
   - el bucket por email permite bloquear el login de una cuenta concreta sin credenciales (ID-203).

### Conteo por severidad

| Severidad | Introducidos o residuales del lote | Preexistentes que persisten | Total |
|---|---|---|---|
| CRÍTICA | 0 | 0 | 0 |
| ALTA | 0 | 1 (ID-212, parte operativa de ID-102) | 1 |
| MEDIA | 3 (ID-201, ID-202, ID-203) | 0 | 3 |
| BAJA | 4 (ID-204, ID-207, ID-208, ID-209) | 3 (ID-205, ID-206, ID-210) | 7 |
| INFO | 2 (ID-211, ID-213) | 2 (ID-214, ID-215) | 4 |

### Veredicto por ID remediado

| ID | Tema | Veredicto | Evidencia principal | Qué falta |
|---|---|---|---|---|
| ID-101 | `JWT_SECRET` por defecto | **CERRADO** (repo) | `config/env.schema.ts:54-61` (obligatorio, ≥32, lista negra), `app.module.ts:49` (`validate`), `docker-entrypoint.sh:100-124` (`require_jwt_secret`), `docker-compose.yml:87,165` (`${JWT_SECRET:?…}`) | Operativo: rotar `JWT_SECRET` si alguna vez se desplegó sin la variable (no verificable). El fallback `dev-…` sigue en `auth.module.ts:23` y `jwt.strategy.ts:34` fuera de producción (ID-211). |
| ID-102 | Adminer público y contraseña literal | **PARCIAL** | Repo: `docker-compose.yml:35,82,158` (`${POSTGRES_PASSWORD:?…}`), `:257` (`profiles: ["tools"]`), sin `dokploy-network` | El dominio de Adminer sigue activo en Dokploy. El contenedor previo puede seguir vivo. La contraseña efectiva no rota sin `ALTER USER`. El literal persiste en `Dockerfile:21,52,54` (ver ID-212). |
| ID-103 | IDOR por proyecto | **CERRADO** (vectores listados) | Guard `common/access/project-access.guard.ts:38-76`; todos los vectores de ID-103 decorados; `route-coverage.spec.ts:64-66` (`PENDING` vacío) en verde; `resolve-forge…` filtrado (`project-ariadne-link.service.ts:123-135`) | Residuales: ID-201 (rutas `/sessions/:id/*` fuera de la heurística), ID-204 (valores no string), ID-205 (sesión tras revocar `SHARED`). |
| ID-105 | Fuerza bruta OTP | **CERRADO** | `auth-redis.store.ts:44-58` (cuenta antes de comparar), `:87-92` (`timingSafeEqual` sobre SHA-256), `:176-183`; `auth-rate-limit.guard.ts:19-21,57-70`; `auth.service.ts:542,605` | Residual: techo de unas 1.440 conjeturas/día por email (ID-209) y bloqueo dirigido (ID-203). |
| ID-108 | admin → super_admin | **CERRADO** | `common/roles.ts:28-50`; `auth.service.ts:910,930,951,974,1063,1094`; `auth.controller.ts:220-256` pasan `getRequestUserRole()` | Residual horizontal entre admins (ID-207). |
| ID-109 | JWT no revocable | **PARCIAL** | `jwt.strategy.ts:42-60` (rol y email desde la BD, `tv` comparado); `tokenVersion` se incrementa en rol, email y rotación de secret (`auth.service.ts:697,932,954,985`); migración idempotente | Caducidad de 7 días sin refresh ni logout que revoque; caché de 30 s por réplica (ID-208). |
| ID-113 | `otp_dev_expose_code` en prod | **CERRADO** | `otp-dev-expose.util.ts:6-9`; `auth.service.ts:63-72` (aplica a OTP y ForgeOps) | Depende de `NODE_ENV=production`, fijado en `apps/api/Dockerfile:54` (ID-211). |
| Jobs | IDs secuenciales | **CERRADO** | `jobId` = prefijo + `randomUUID()` en `mdd-queue.service.ts:801-803`, `deliverables-queue.service.ts:886-888`, `legacy-deliverables-queue.service.ts:183-186`; `getJobAccessRef` + `assertJobAccess` (`projects/job-access.util.ts:27-49`), siempre 404; `ai-analysis.controller.ts:95-107,522-603`; `legacy-flow.controller.ts:198-269` | Los jobs antiguos con id numérico siguen en Redis, pero ahora pasan por la comprobación de acceso. |

## Hallazgos

### [MEDIA] ID-201 — Desvío del nivel `spend` vía `POST /sessions/:id/chat`

- **Evidencia:**
  - `sessions.controller.ts:16-20`: `POST /sessions` solo exige `contribute`, así que un no dueño de un proyecto `SHARED` puede crear una sesión.
  - `sessions.controller.ts:44-77`: `POST /sessions/:id/chat` no lleva `@ProjectScoped`.
  - `ai-orchestrator.service.ts:526-555`: `chatBySessionId` carga la sesión solo por `{ id, userId }` (`sessions.service.ts:458-460,495-502`) y llama a `chat()`, el mismo flujo que `POST /ai-orchestrator/chat`. Ese flujo está decorado con `level: "spend"` (`ai-orchestrator.controller.ts:23`).
  - `route-coverage.spec.ts:40` excluye el prefijo `sessions` de la heurística, por eso el spec no lo detecta.
- **Impacto:** un colaborador `SHARED` ejecuta turnos LLM del Workshop: HITL de complejidad, persistencia de documentos devueltos por la IA, ingest SDD y supervisor. Eso contradice la decisión "spend solo dueño". `AiService` usa las credenciales del solicitante (`ai.service.ts:380`), pero los subflujos que resuelven el usuario por proyecto (p. ej. `ai-analysis.service.ts:451-461`) usan las del dueño. No se verificó qué subflujos del chat caen en cada caso.
- **Remediación sugerida:**
  1. Que `chatBySessionId` (y `appendMessage`/`clearChat` por id) exija `assertProject(actor, session.projectId, "spend" | "contribute")`.
  2. O añadir un decorador que resuelva el proyecto desde la sesión.
  3. Sacar `sessions` de `NON_PROJECT_ID_PREFIXES` y declarar exenciones explícitas.
- **Alcanzable / explotable:** sí, con una cuenta colaboradora en un proyecto `SHARED`. Verificado estáticamente.

### [MEDIA] ID-202 — `mcp-login` comparte un único bucket de IP: DoS del MCP sin credenciales

- **Evidencia:**
  - `auth-rate-limit.guard.ts:19,57-63`: 20 peticiones/min por `req.ip` en todas las rutas de auth.
  - El MCP llama a `POST /auth/mcp-login` desde su contenedor (`packages/mcp-server/src/mcp-api-client.ts:3,20-24`; `docker-compose.yml:233`) sin reenviar la IP del cliente. Lo hace en cada petición con un secret distinto al cacheado (`index.ts:164-185`).
  - Con `trust proxy = 1` (`main.ts:75`) y conexión directa, `req.ip` es la IP del contenedor MCP.
- **Impacto:** unas 21 peticiones/min sin autenticar a `https://maxprime.obp.mx/mcp`, con cualquier valor en `MCP_M2M_SECRET`, agotan el bucket. El `mcp-login` de **todos** los usuarios MCP responde 429 mientras dure el ataque. El uso legítimo multiusuario también puede rozar el límite. Se suma a ID-106 (estado global del cliente MCP).
- **Remediación sugerida:**
  1. Que el MCP reenvíe `X-Forwarded-For` del cliente original (y la API confíe en ese salto), o limitar `mcp-login` por huella del secret con un tope de IP mayor para la red interna.
  2. Rate limit propio en el servidor MCP antes de llamar a la API.
- **Alcanzable / explotable:** sí, sin autenticación. No probado dinámicamente.

### [MEDIA] ID-203 — Bloqueo dirigido del login de cualquier cuenta conociendo su email

- **Evidencia:**
  - `auth-rate-limit.guard.ts:20-21,65-70`: el bucket por email es global (no por IP): 5 por 10 min en `otp/request` y 10 por 10 min en `otp/verify`.
  - `auth-redis.store.ts:50-56,180-183`: 5 verificaciones fallidas descartan el OTP vigente.
- **Impacto:** con 5 peticiones cada 10 minutos (desde cualquier IP) el atacante impide que la víctima solicite un OTP (429). Con 5 `verify` erróneos invalida el código recién enviado. Aplica a `super_admin`, que solo podría entrar por `mcp-login`.
- **Remediación sugerida:**
  1. Que `otp/request` sobre el límite responda 200 silencioso sin enviar (como el reenvío de 60 s), no 429.
  2. Llaves de `verify` por (email, IP), más un tope global alto por email con alerta.
  3. Registrar los bloqueos.
- **Alcanzable / explotable:** sí, sin autenticación.

### [BAJA] ID-204 — El guard omite (no rechaza) valores no string en specs opcionales

- **Evidencia:**
  - `project-access.guard.ts:91-95` devuelve `null` si el valor no es string.
  - Con `optional: true` el spec se salta (`:54-56`); con `stage.optional` se salta la comprobación de etapa (`:61-67`).
  - Varios handlers pasan `body.stageId` crudo al servicio: `legacy-flow.controller.ts:43,62,113,129,145,161,225,294`, `plugins.controller.ts:229,240`, `change-interview.controller.ts:31`.
  - No hay `ValidationPipe` global.
- **Impacto:** hoy no hay fuga demostrada. Los servicios legacy hacen `stageId.trim()` (TypeError, 500) o `findUnique` (Prisma rechaza objetos). En `plugins…/generate` el objeto llega al contexto del plugin (`plugin-artifact.service.ts:99`), cuyo uso no se auditó. Un `findFirst({ where: { id: stageId } })` futuro abriría inyección de operadores Prisma (`{"not": ""}`).
- **Remediación sugerida:** si la clave existe y no es un string no vacío, responder 400 (también en specs opcionales), y normalizar `stageId` en los handlers.
- **Alcanzable / explotable:** alcanzable; explotación no verificada.

### [BAJA] ID-205 — Acceso por sesión sobrevive a la revocación de `SHARED` (preexistente)

- **Evidencia:**
  - `sessions.service.ts:495-502`: `GET /sessions/:id` devuelve `include: { project: true }`, la fila completa del proyecto (contenidos a nivel proyecto y `convergeWebhookSecret`), sin volver a comprobar el acceso.
  - El SSE de entregables comprueba el acceso una sola vez y vive hasta 6 h (`deliverables-sse.util.ts`; `projects.controller.ts:264-281`).
- **Impacto:** cuando el dueño pasa el proyecto a `PRIVATE`, un excolaborador sigue leyendo la fila del proyecto con su `sessionId`.
- **Remediación sugerida:** proyectar solo los campos necesarios, comprobar `read` sobre `session.projectId` en `findOne`, y revalidar el acceso de forma periódica en streams largos.
- **Alcanzable / explotable:** sí, tras una revocación.

### [BAJA] ID-206 — `convergeWebhookSecret` expuesto a lectores `SHARED` (preexistente)

- **Evidencia:** `project-api.util.ts:27-37` (`toApiProject` esparce toda la fila), usado por `GET /projects/:id` (`projects.service.ts:150-163`). También ID-205.
- **Impacto:** un colaborador puede firmar webhooks válidos hacia el receptor del dueño.
- **Remediación sugerida:** omitir los secretos en la serialización (lista de exclusión central) y cifrarlos en reposo (ID-110).
- **Alcanzable / explotable:** sí, con acceso de lectura `SHARED`.

### [BAJA] ID-207 — Suplantación horizontal entre admins

- **Evidencia:** `roles.ts:44-50` permite a un `admin` gestionar a otro `admin`. Con eso puede leer o rotar su `mcpSecret` (`auth.service.ts:901-917`) y cambiarle el email (`:967-985`), y luego entrar como él vía `mcp-login` u OTP. Un admin puede crear admins (`:1063`), que heredan esa capacidad.
- **Impacto:** no hay escalada a `super_admin`, pero la auditoría de acciones entre admins no es fiable.
- **Remediación sugerida:** que solo `super_admin` vea o rote secretos y cambie el email de un `admin`, y registrar los cambios de rol.
- **Alcanzable / explotable:** sí, con rol admin.

### [BAJA] ID-208 — JWT de 7 días sin refresh ni logout revocable; caché de 30 s por réplica

- **Evidencia:** `auth.module.ts:21` (`7d` por defecto); `jwt-user-cache.ts:24` (TTL 30 s, invalidación solo local, documentada en `:16-21`); no hay endpoint de "cerrar sesiones".
- **Impacto:** un token robado vale 7 días salvo que se rote el secret o cambie rol o email. En réplicas, una degradación tarda hasta 30 s en aplicarse.
- **Remediación sugerida:** access token de 15-60 min más refresh rotativo en cookie `HttpOnly`, y un endpoint de logout que incremente `tokenVersion`.
- **Alcanzable / explotable:** requiere un token robado.

### [BAJA] ID-209 — Techo residual de fuerza bruta OTP sin tope diario

- **Evidencia:** `AUTH_RATE_LIMIT_EMAIL_VERIFY` = 10 por 10 min (`auth-rate-limit.guard.ts:21`); reemisión de OTP cada 60 s (`auth.service.ts:542`) que reinicia el contador de intentos (`auth-redis.store.ts:131-134`).
- **Impacto:** unas 1.440 conjeturas/día por email (p ≈ 0,14 %/día; ≈ 4 %/mes) para un atacante persistente que rota IP. Cada ciclo envía correos a la víctima.
- **Remediación sugerida:** tope diario por email (p. ej. 30 fallos/24 h con bloqueo y alerta), o código alfanumérico de 8 caracteres.
- **Alcanzable / explotable:** teórico, lento.

### [BAJA] ID-210 — `register-first-admin` sigue con condición de carrera (preexistente, ID-116)

- **Evidencia:** `auth.service.ts:1025-1038`: `count()` y `create()` sin transacción. El lote solo añadió el rate limit (`auth.controller.ts:186`).
- **Impacto:** en una instancia recién desplegada, dos peticiones simultáneas pueden crear dos `super_admin`.
- **Remediación sugerida:** token de bootstrap de un solo uso por variable de entorno, o transacción `serializable`.
- **Alcanzable / explotable:** solo mientras no haya usuarios.

### [ALTA] ID-212 — Parte operativa de ID-102 pendiente (preexistente)

- **Evidencia:**
  - Dokploy (`overview-domains`, solo lectura, hoy): el compose "MaxPrime (The Forge)" sigue teniendo el dominio `adminer-maxprime.obp.mx` → puerto 8080, `enabled: true`.
  - Aunque el compose ya no levanta Adminer (`profiles: ["tools"]`), `docker compose up` no detiene un contenedor ya existente de un servicio con perfil inactivo. No se verificó si sigue corriendo.
  - `docker-compose.yml:33-34` (comentario): Postgres conserva la contraseña con la que se inicializó el volumen.
  - `Dockerfile:21,52,54` (imagen monolítica) mantiene la credencial literal.
- **Impacto:** si el contenedor sigue vivo y la contraseña no se rotó, el riesgo crítico original continúa.
- **Remediación sugerida:**
  1. Eliminar el dominio en Dokploy y detener o borrar el contenedor `theforge-adminer`.
  2. `ALTER USER theforge WITH PASSWORD …` con el valor nuevo de `POSTGRES_PASSWORD`.
  3. Rotar los `mcpSecret`.
  4. Quitar el literal del `Dockerfile` raíz.
- **Alcanzable / explotable:** publicación del dominio verificada; contenedor y contraseña efectiva no verificados.

### [INFO] ID-211 — Todo el fallo cerrado depende de `NODE_ENV=production`

- **Evidencia:** `env.schema.ts:49`, `auth-redis.store.ts:274`, `otp-dev-expose.util.ts:7`, `docker-entrypoint.sh:103`. `NODE_ENV` viene de `apps/api/Dockerfile:54`, pero `env_file: .env` (`docker-compose.yml:73-75`) o Dokploy pueden sobrescribirlo. Fuera de producción, `auth.module.ts:23`/`jwt.strategy.ts:34` firman con `dev-…`. El compose sigue exigiendo un `JWT_SECRET` no vacío, aunque sea corto.
- **Remediación sugerida:** fijar `NODE_ENV: production` en el bloque `environment` de `theforge-api` en el compose (ya está en el worker, `:160`) y registrar un error si `NODE_ENV` no es `production` con `THEFORGE_RUNTIME_ROLE` desplegado.

### [INFO] ID-213 — El rate limit por IP depende de la topología

- **Evidencia:** `main.ts:75` (`trust proxy` = 1). Es correcto para Traefik → API directo (`maxprime.obp.mx/api` → 3000). Con la imagen monolítica (`docker/nginx-fullstack.conf:21-26`) detrás de Traefik, o con una CDN delante, `req.ip` sería la IP del proxy intermedio: un bucket global de 20/min para todos. Los contenedores de `dokploy-network` hablan directo con `theforge-api:3000` y pueden fijar `X-Forwarded-For` a voluntad.
- **Remediación sugerida:** documentar el número de saltos por despliegue y usar una lista de IP confiables en lugar de un número.

### [INFO] ID-214 — `GET /projects/favorites` inalcanzable (preexistente, funcional)

- **Evidencia:** `projects.controller.ts:314` (`GET :id`) se registra antes que `:853` (`GET favorites`). Ahora el guard responde 404 "Project not found". Ningún cliente lo usa.

### [INFO] ID-215 — `.dockerignore` no excluye `.env*` (preexistente)

- **Evidencia:** `.dockerignore` (sin entradas `.env`); `apps/api/Dockerfile:30` (`COPY apps/api apps/api`).
- **Impacto:** un `apps/api/.env` local acabaría dentro de la imagen.

## Bypasses del guard revisados (punto 2 del encargo)

- **Campo leído frente a campo usado:**
  - En todas las rutas decoradas el guard lee la misma clave que usa el handler: `projectId`, `forgeProjectId` en `theforge.controller.ts:65-75`, `id`.
  - El guard recorta espacios y el handler también. Si no lo hace, Prisma no encuentra el proyecto (sin desvío).
  - El `threadId` de reanudación MDD está ligado a `projectId` (`ai-analysis.service.ts:1619-1622,1676-1678`).
  - Los hilos de Fase 0 y de auditoría se comprueban contra el proyecto autorizado (`ai-analysis.controller.ts:110-123`; los mapas `states`/`threadProjectId` se mantienen sincronizados).
- **`optional: true` sin `projectId`:**
  - `ai-analysis/start|stream` y `ai/preferences/learn-from-mdd` permiten omitir `projectId`. En ese caso el servicio usa al solicitante (`ai-analysis.service.ts:451-461`) y no carga datos de otro proyecto.
  - Riesgo residual: ID-204.
- **`from: "body"` en multipart:** sin hallazgo. Nest 10 omite su body-parser porque `main.ts:81-82` ya registró `jsonParser`/`urlencodedParser` de `express@5` (body-parser 2.2.2, que deja `req.body = undefined` si no parsea). El guard responde 400 (`project-access.guard.ts:81-86`). Ninguna ruta multipart lleva `from: "body"`.
- **Rutas sin decorar ni exención:** ninguna según el spec. El hueco real está en la heurística, que excluye `sessions` (ID-201).
- **Clientes:**
  - La web envía `projectId` en query/body en las rutas que ahora lo exigen (`Phase0InterviewPanel.tsx:175,219`, `MddManualAudit.tsx:138-143`, `mdd-chat-queue.ts:116`, `slice-clarify.ts:42,95`).
  - El MCP envía `projectId`/`forgeProjectId` con los nombres correctos. `stageId: ""` cae en la rama opcional.
  - No se halló un DoS funcional por nombre de campo. Solo se vio un 404 preexistente en `legacy/generate-as-is-manual`, que no existe en la API.

## Fortalezas

- **Política pura y única:**
  - `canAccessProject` (`project-access.policy.ts:36-47`); admin nunca ve `PRIVATE` ajeno.
  - Se reutiliza en los servicios (`project-access.util.ts`, `sessions.service.ts`, `integration*.service.ts`, `project-notion-portability.service.ts`).
- **El guard falla cerrado:** sin `req.user` responde 403; si falta el id, 404 indistinguible; comprueba la etapa contra el proyecto.
- **`route-coverage.spec.ts` deniega por defecto:** lee la metadata real de Nest, `PENDING` solo puede encoger y no se pueden combinar `@Public` y `@ProjectScoped`.
- **OTP robusto:**
  - Contador incrementado antes de comparar (Lua atómico) y consumo único (`DEL` atómico).
  - Comparación en tiempo constante.
  - 503 ante cualquier error de Redis; el test "nunca permite" está en verde.
- **Revocación de JWT:** rol y email desde la BD, `tv` en todos los `signAsync` (`auth.service.ts:636,662,812`), y `tokenVersion` incrementado en los cambios sensibles.
- **Validación de entorno con zod:** lista las variables sin imprimir valores; el worker usa el mismo `AppModule`.
- **Migración idempotente:** `ADD COLUMN IF NOT EXISTS` en la migración y en `safe-schema-sync.sql`; el healing del entrypoint no se tocó.
- **Secretos:** el `grep` de patrones sobre las líneas añadidas solo encontró el fallback de desarrollo conocido (`docker-entrypoint.sh:120`, `dev-…`). `.env.example` no trae valores reales; su `JWT_SECRET` de la sección local mide 20 caracteres y la validación de producción lo rechaza.

## Verificado sin hallazgos

- Algoritmo JWT: `jsonwebtoken@9.0.3` con secreto string solo acepta HS*; no hay verificaciones de JWT fuera de passport.
- `PATCH /projects/:id` con `contribute` no permite cambiar ajustes (visibilidad, webhooks, tipo): `project-update.service.ts:153-169`.
- `merge`, `findAll`, `favorites` y `generation-summary` filtran por usuario o por `read`.
- Cancelación de jobs: solo quien encoló o `manage`; la ruta debe coincidir con el proyecto del job.
- Specs ejecutados en local: `route-coverage`, `project-access.guard`, `auth-redis.store`, `auth-rate-limit.guard`, `env.schema` (62/62).

## No auditado (y por qué)

- `deps`: excluido por el encargo.
- Variables efectivas en Dokploy (`NODE_ENV`, `JWT_SECRET`, `POSTGRES_PASSWORD`): no se leyeron para no exponer secretos.
- Si el contenedor de Adminer sigue en ejecución: no se consultó el estado de contenedores.
- Configuración `forwardedHeaders` de Traefik, y si hay una CDN delante de `obp.mx`: afecta a ID-213.
- Uso de `stageId` dentro del código de plugins de terceros (ID-204).
- Qué credenciales LLM consume cada subflujo de `AiOrchestratorService.chat` (ID-201).
- Pruebas dinámicas o de carga: fuera de los límites del encargo.

---

## Segunda pasada — 2026-11-02

Alcance: `app` sobre el mismo diff (`git diff master`, rama `fix/seguridad-lote-1`, sin commitear) tras las correcciones de ID-201, ID-202/ID-106, la semántica 403 `PROJECT_LEVEL_FORBIDDEN`, ID-206 y los ajustes de auth · Commit base: `d6e88ca1` · Herramientas: lectura estática, `git diff master`, `grep`, specs locales (`node --import tsx --test`): `sessions.controller.access`, `project-access.service`, `auth-rate-limit.guard`, `route-coverage` (44/44) y `packages/mcp-server/src/mcp-api-client.spec.ts` (8/8). Sin `deps`, sin Dokploy, sin pruebas dinámicas.

### Veredictos actualizados

| ID | Sev. original | Veredicto | Evidencia | Qué falta |
|---|---|---|---|---|
| ID-201 | MEDIA | **CERRADO** | `sessions.controller.ts:24-27` (`authorizeSession`), `:44` `GET :id` read, `:54` `POST :id/messages` spend con imágenes / contribute sin, `:81` `POST :id/chat` spend (antes de parsear imágenes o llamar al orquestador), `:113` `PATCH :id/context` contribute; `sessions.service.ts:496-503` (`getSessionProjectId` con `sessionScope`); `route-coverage.spec.ts:33-37,300-304` (`sessions` fuera de la lista de exclusión). La condición de visión coincide con la del servicio (`sessions.service.ts:534`). | — |
| ID-202 | MEDIA | **PARCIAL → BAJA** | `auth-rate-limit.guard.ts:31,33,78-93`: cubeta `ip-mcp` de 600/min y 20/min por `sha256(secret)`. El MCP cachea el JWT por secret 50 min efectivos (`mcp-api-client.ts:8-10,65-69`). | Sigue siendo un DoS sin credenciales, ahora a 10 req/s: cada secret inválido enviado a `/mcp` provoca un `mcp-login` (no hay caché negativa, `index.ts:183-191`) y todos comparten la IP del contenedor. Los usuarios con token en caché no se ven afectados; los logins nuevos y las renovaciones reciben 429 durante la ventana. Remediación: límite por IP del cliente en el propio servidor MCP antes de llamar a la API (IP real desde Traefik), o caché negativa breve por `sha256(secret)`. |
| ID-106 | — (preexistente) | **CERRADO** | `mcp-api-client.ts:21-23,31,41-45`: sin JWT global; token por petición vía `AsyncLocalStorage`; `index.ts:194` envuelve cada JSON-RPC HTTP en `runWithMcpSecret`. | Residual de estado global no relacionado con credenciales: ID-217. |
| ID-203 | MEDIA | **ABIERTO (aceptado)** | Documentado como trade-off en `auth-rate-limit.guard.ts:26-27`; lógica sin cambios (`:96-101`). | Decisión de producto; mantener en el registro de riesgos. |
| ID-204 | BAJA | **ABIERTO** | `project-access.guard.ts:109`: un valor no string sigue devolviendo `null` y, con `optional`, la comprobación se omite. | Responder 400 si la clave existe y no es string no vacío. |
| ID-205 | BAJA | **PARCIAL** | La ruta de sesión queda cerrada: `GET /sessions/:id` exige `read` sobre `session.projectId` en cada petición (`sessions.controller.ts:44`), así que pasar a `PRIVATE` corta el acceso (404). | El SSE de entregables (`deliverables-sse.util.ts:4,38`) sigue sin revalidar durante el stream; impacto acotado al estado de un job. |
| ID-206 | BAJA | **PARCIAL** | `GET /projects/:id` cerrado: `project-api.util.ts:42` pone `convergeWebhookSecret: null` salvo `isOwner`, y `projects.service.ts:156` lo calcula; `project-merge` y `notion-portability` usan el valor por defecto (nulo). | **Vía residual:** `sessions.service.ts:505-511` (`findOne`) devuelve `include: { project: true }`, la fila cruda del proyecto con `convergeWebhookSecret`. Un colaborador `SHARED` crea su propia sesión (`POST /sessions`, contribute) y la lee con `GET /sessions/:id` (read). Remediación: `select` explícito del proyecto en `findOne`, o pasar la fila por la misma lista de exclusión. |
| ID-207 | BAJA | **ABIERTO** | `roles.ts:44-50` sin cambios: un `admin` sigue gestionando a otro `admin`. | — |
| ID-208 | BAJA | **PARCIAL** | Carrera en proceso cerrada con generación por usuario (`jwt-user-cache.ts:22-24,55-79`). | JWT de 7 días sin refresh ni logout revocable; desfase de 30 s entre réplicas. |
| ID-209 | BAJA | **ABIERTO** | `auth-redis.store.ts:139-141`: `setOtp` sigue borrando el contador de fallos al emitir un OTP nuevo; el `locked` persistente (`:45-61`) solo afecta al OTP descartado. | Tope diario por email. |
| ID-210 | BAJA | **ABIERTO** | `auth.service.ts:1040-1051`: `count()` y `create()` sin transacción. | — |
| ID-211 | INFO | **PARCIAL** | `TOKEN_MASTER_KEYS` obligatoria en producción (`env.schema.ts:4-5`). | `NODE_ENV: production` sigue solo en el worker (`docker-compose.yml:160`), no en `theforge-api`. |
| ID-212 | ALTA | **NO REVERIFICADO** | Operación de Dokploy, fuera del alcance `app` de esta pasada. | Ver la primera pasada. |
| ID-213 | INFO | **PARCIAL** | `TRUST_PROXY` configurable (`env.schema.ts:41-48`, `main.ts:76-78`). | Ver ID-219. |
| ID-215 | INFO | **ABIERTO** | `.dockerignore` sigue sin entradas `.env*`. | — |

### Respuestas a las preguntas del encargo

1. **¿El 403 permite enumerar proyectos `PRIVATE`? No.** En `project-access.service.ts:70-84` el orden es: (a) proyecto inexistente → 404 (`:74`); (b) si falta el nivel pedido, el 403 solo se emite cuando `canAccessProject(actor, project, "read")` es verdadero (`:76`); en otro caso, 404 (`:84`). Para un `PRIVATE` ajeno, `read` es falso (`project-access.policy.ts:43-44`), y `allowAdmin` no interviene en esa comprobación de lectura. En el guard, el 403 se lanza antes de comprobar la etapa (`project-access.guard.ts`), así que tampoco revela etapas. Los jobs convierten tanto el 404 como el 403 de nivel en "Job no encontrado" (`job-access.util.ts:46-50`, `ai-analysis.controller.ts:100-111`). El 403 solo distingue "no puedes" de "no existe" en proyectos que el actor ya puede leer.
2. **¿La cubeta de 600/min abre fuerza bruta de secrets? No.** Todos los caminos de generación usan `randomBytes(32)` (`auth.service.ts:620,696,811,1065-1066`), es decir, 256 bits (≈1,16·10^77 valores). A 600/min por IP salen 8,64·10^5 intentos/día por IP. Incluso con 10^6 IP y 10^4 usuarios (la búsqueda acepta el secret de cualquier usuario, `auth.service.ts:650-652`), la probabilidad de acierto es de unos 7·10^-62 por día. El riesgo real del perfil es el DoS (ID-202), no la adivinación.
3. **¿El contexto ALS del MCP puede fugar entre peticiones concurrentes? No.**
   - `inflightLogins` y `tokenCache` están indexados por `sha256(secret)` (`mcp-api-client.ts:21-23,97-108`): una promesa compartida solo la esperan peticiones con el mismo secret y resuelve el token de ese mismo secret.
   - `requestLogin` no lee el ALS (`:71-88`), y cada `await` reanuda en el contexto de quien espera.
   - `refreshAfter401` toma el hash del contexto de la petición (`:121-126`).
   - La caché solo guarda logins exitosos, con tope de 500 y evicción (`:53-63`).
   - Sin contexto, las tools fallan cerradas (`:47-50`).
4. **¿`MCP_M2M_SECRET` en stdio introduce un secret nuevo en el entorno? No.** La variable ya estaba documentada como obligatoria (`.env.example:63`, `docs/notebooklm/THEFORGE-MCP-SERVER.md:23,68`). En `master`, el modo stdio llamaba a `login()` sin secret y fallaba. Ahora la usa (`index.ts:219-230`) y, si falta, falla cerrado. Es el `mcpSecret` personal del usuario en su IDE local; `.cursor/*` está en `.gitignore`. Ver ID-218 por la documentación contradictoria.
5. **¿El `accessToken` de la rotación queda en logs? No.** El servicio registra solo el `userId` (`auth.service.ts:712`). La API no tiene interceptores que registren respuestas (solo `user-context.interceptor.ts`). La web lo guarda en `localStorage` igual que en el login (`apps/web/src/components/AccountConfigCard.tsx:84-88`, preexistente). La rotación hecha por un admin no devuelve token (`auth.service.ts:931-949`). Un JWT robado no gana capacidad nueva: antes ya podía rotar el secret y hacer `mcp-login`.
6. **¿`authorizeSession` consulta la sesión con scope de usuario antes de revelar nada? Sí.** `getSessionProjectId` filtra por `{ id, userId }` (`sessions.service.ts:458-460,496-503`) y responde 404 "Session not found" antes de tocar el proyecto. En `POST :id/messages` el body se valida antes (`sessions.controller.ts:52`), pero esa validación no depende de la sesión y no revela nada. Lo que sí queda es ID-206: `findOne` devuelve la fila cruda del proyecto.

### Hallazgos nuevos o residuales de la corrección

#### [INFO] ID-216 — El gate HTTP del MCP acepta un secret rotado mientras su JWT siga en caché
- **Evidencia:** `index.ts:183-191` solo comprueba que `login(clientSecret)` devuelve un token, y `mcp-api-client.ts:98-101` lo sirve desde la caché sin consultar la API.
- **Impacto:** tras rotar un secret, el antiguo sigue pasando el gate hasta 50 min para `initialize` y `tools/list`. Cualquier llamada a la API recibe 401, el reintento hace `mcp-login` con el secret antiguo y falla, así que no hay acceso a datos. El comportamiento ya existía en `master`.
- **Remediación sugerida:** opcional. Invalidar la entrada de caché ante un 401 de `mcp-login`, o acortar el TTL.
- **Alcanzable / explotable:** alcanzable; sin acceso a datos.

#### [INFO] ID-217 — Estado global residual en el servidor MCP (`clientName`)
- **Evidencia:** `packages/mcp-server/src/mcp-client-context.ts:4-8` (`let clientName`), fijado en `index.ts:66` desde `initialize`.
- **Impacto:** con usuarios concurrentes, el target de gobernanza autodetectado de uno puede aplicarse a otro. Es una mezcla funcional, no de credenciales.
- **Remediación sugerida:** guardarlo en el mismo `AsyncLocalStorage` o pasarlo por argumento.
- **Alcanzable / explotable:** sí; sin impacto de seguridad.

#### [INFO] ID-218 — Documentación y compose contradicen el fallo cerrado del MCP
- **Evidencia:**
  - `packages/mcp-server/src/mcp-tools.doc.ts:14` afirma que sin `MCP_M2M_SECRET` el servidor arranca "sin auth"; hoy las tools fallan con "Falta el secret MCP de la petición".
  - `docker-compose.yml:118-119` declara `MCP_M2M_SECRET` en `theforge-api` como "secreto compartido para validar login MCP", pero la API no lee esa variable: `mcp-login` valida contra `User.mcpSecret`. Es preexistente.
- **Impacto:** invita a poner un secret en el entorno del servicio sin ningún uso, y a creer que existe un modo sin auth.
- **Remediación sugerida:** corregir el comentario y retirar la variable del servicio API.
- **Alcanzable / explotable:** no.

#### [INFO] ID-219 — `TRUST_PROXY` sin tope superior
- **Evidencia:** `env.schema.ts:42-48` acepta cualquier entero ≥ 0.
- **Impacto:** un valor mayor que los saltos reales hace que `req.ip` salga de `X-Forwarded-For` controlado por el cliente, lo que permite rotar la cubeta del rate limit de auth (incluidos `mcp-login` y OTP) con cada petición.
- **Remediación sugerida:** documentar el valor por topología y rechazar valores mayores de, por ejemplo, 3, o aceptar una lista de IP/CIDR de confianza.
- **Alcanzable / explotable:** solo con una mala configuración.

### Conteo tras la segunda pasada

| Severidad | Abiertos o parciales |
|---|---|
| CRÍTICA | 0 |
| ALTA | 1 (ID-212, operativo, no reverificado) |
| MEDIA | 1 (ID-203, aceptado) |
| BAJA | 8 (ID-202, ID-204, ID-205, ID-206, ID-207, ID-208, ID-209, ID-210) |
| INFO | 8 (ID-211, ID-213, ID-214, ID-215, ID-216, ID-217, ID-218, ID-219) |

Cerrados en esta pasada: ID-201 e ID-106.

### No auditado en esta pasada
- `deps` e `infra`/Dokploy (ID-212): excluidos por el encargo.
- Consumo de credenciales LLM en los subflujos de `chat()`: ya no es relevante para ID-201, porque `spend` exige ser dueño.
- Pruebas dinámicas del DoS de ID-202: fuera de los límites del encargo.

> **Actualización posterior a la segunda pasada (hilo principal):** ID-206 queda CERRADO. `SessionsService.findOne` (`apps/api/src/modules/sessions/sessions.service.ts`) devuelve `convergeWebhookSecret: null` a quien no es dueño del proyecto; spec `sessions.service.find-one.spec.ts`.
