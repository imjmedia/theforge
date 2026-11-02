# Auditoría de seguridad — 2026-11-02 (app + secretos + infra)

Alcance: `app` + `secretos` + `infra` (sin `deps`, cubierto en `auditoria-2026-11-02.md`) · Rama `master` · Commit: `bfb3b21f` (árbol limpio) · Herramientas: lectura estática del código (`grep`, `sed`), `git grep` y `git log -p` acotado para secretos, Dokploy MCP **solo lectura** (`overview-domains`, sin leer variables de entorno). Ariadne no usado (no hay `.ariadne-project`). No se ejecutaron exploits ni peticiones contra entornos desplegados.

Contexto: el repo no tiene `AGENTS.md` ni `CLAUDE.md` en la raíz. El modelo de acceso real, deducido del código, es:

- Roles globales `super_admin` > `admin` > `developer` (`apps/api/src/common/roles.ts`).
- No hay organizaciones ni tenants. El aislamiento es por **proyecto**: `Project.userId` (dueño) más `visibility` `PRIVATE`/`SHARED` (`packages/database/schema.prisma:327-335`).
- Un proyecto `SHARED` lo leen y editan todos los usuarios por diseño.

Hallazgos de la auditoría anterior que siguen vigentes y no se repiten aquí: **ID-001** (XSS Mermaid `loose` + JWT en `localStorage`), **ID-002**, **ID-003**, **ID-004** (devDependencies y `puppeteer` en la imagen), **ID-005**, ID-006, ID-007 e ID-008. La numeración de este reporte empieza en ID-101.

## Resumen ejecutivo

| Severidad | Total | IDs |
|---|---|---|
| Crítica | 2 | ID-101, ID-102 |
| Alta | 5 | ID-103, ID-104, ID-105, ID-106, ID-107 |
| Media | 8 | ID-108 a ID-115 |
| Baja | 8 | ID-116 a ID-123 |
| Info | 2 | ID-124, ID-125 |

Riesgos principales:

1. **ID-101 / ID-102 (críticas, condicionales a la configuración desplegada):**
   - el entrypoint del API sustituye un `JWT_SECRET` ausente por un literal publicado en el repo, lo que anula la verificación de producción y permite forjar un JWT `super_admin`;
   - Adminer está publicado en un dominio público (`adminer-maxprime.obp.mx`, verificado en Dokploy) frente a un Postgres cuya contraseña en el compose es un literal versionado.
2. **ID-103 (alta):** la autorización por proyecto se implementa servicio a servicio y falta en varios endpoints (gaps de documentación, legacy, plugin-data, ui-screens, estimación, change-log, memoria episódica). Además, los IDs de proyecto se pueden enumerar: los IDs de job de BullMQ son secuenciales y `GET /ai-analysis/mdd/jobs/:jobId` no tiene control de acceso.
3. **ID-104 / ID-106 (altas):**
   - SSRF con lectura parcial de la respuesta desde un contenedor conectado a `dokploy-network`, donde también están los demás servicios de producción. `POST /admin/ariadne-config/test` no exige rol admin.
   - El servidor MCP HTTP comparte **un único JWT global** entre peticiones concurrentes de distintos usuarios.

## Hallazgos

### [CRÍTICA] ID-101 — `JWT_SECRET` con valor por defecto público: se pueden forjar tokens `super_admin`
- **Evidencia:**
  - `apps/api/docker-entrypoint.sh:100-102`: si `JWT_SECRET` está vacío, hace `export JWT_SECRET="loca…"` (literal versionado) y solo emite un `WARN`.
  - `docker-compose.yml:84` y `:162`: `JWT_SECRET: ${JWT_SECRET:-loca…}`, el mismo literal como valor por defecto en `theforge-api` y `theforge-worker`.
  - La protección del código (`apps/api/src/modules/auth/auth.module.ts:22-26`, `jwt.strategy.ts:16-18`: "JWT_SECRET is required in production") nunca salta, porque la variable siempre llega definida.
  - `jwt.strategy.ts:26-31`: `validate()` confía en `sub` y `role` del payload sin consultar la BD.
- **Impacto:** si el servicio en Dokploy no define `JWT_SECRET`, cualquiera que lea el repo (público, con fork `imjmedia` y upstream `kreodevs`) firma un HS256 con `role: "super_admin"` y obtiene control total de la instancia, incluidas `GET /admin/system-config` (revelar secretos), la instalación de plugins (ID-107) y todos los proyectos.
- **Remediación sugerida:**
  1. Eliminar el fallback del entrypoint y del compose (`${JWT_SECRET:?JWT_SECRET requerido}`), y que el arranque falle si falta o mide menos de 32 bytes.
  2. Rechazar explícitamente los valores conocidos (`dev-only-insecure-jwt-secret` y el literal del compose).
  3. Si en algún momento se desplegó sin la variable, rotar `JWT_SECRET`: eso invalida todas las sesiones.
- **Alcanzable / explotable:** alcanzable sí. Explotable **no verificado**: depende de si Dokploy define `JWT_SECRET`. No se leyeron las variables de entorno del despliegue para no exponer secretos.

### [CRÍTICA] ID-102 — Adminer publicado en Internet frente a Postgres con credenciales literales en el compose
- **Evidencia:**
  - Dokploy (`overview-domains`, solo lectura): el compose "MaxPrime (The Forge)" publica `adminer-maxprime.obp.mx` → puerto 8080 (Adminer) con HTTPS.
  - `docker-compose.yml:250-266`: `theforge-adminer` en `dokploy-network`, con servidor, usuario y BD precargados (`ADMINER_DEFAULT_*`).
  - `docker-compose.yml:32-34`: `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` literales (`theforge`); `:80` y `:155`: `DATABASE_URL` con la misma contraseña.
  - El `Dockerfile` raíz (`:21`, `:51-54`) y `docker/entrypoint-full.sh:29` repiten la credencial. Ya se había observado de pasada en "No auditado" de la auditoría anterior.
- **Impacto:** si la contraseña desplegada sigue siendo la del compose, cualquier persona en Internet entra con permisos de escritura a toda la BD. Ahí están:
  - `User.mcpSecret` en claro (ID-110), que permite suplantar a cualquier usuario vía `/auth/mcp-login`, incluido `super_admin`;
  - los tokens de Ariadne y Context7, los secretos SMTP/Tavily/ForgeOps de `AppConfig` y todos los documentos.

  Aunque la contraseña se haya cambiado, Adminer público sigue siendo una superficie de fuerza bruta sin rate limiting.
- **Remediación sugerida:**
  1. Retirar el dominio público de Adminer (o protegerlo con forward-auth/SSO de Dokploy o una lista de IP) y quitar Adminer del compose de producción.
  2. Sacar las credenciales de Postgres del compose: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}` y `DATABASE_URL` desde Dokploy.
  3. Rotar la contraseña de Postgres y todos los `mcpSecret`.
- **Alcanzable / explotable:** publicación verificada (Dokploy). Contraseña efectiva **no verificada**: no se leyeron las variables ni se probó el login.

### [ALTA] ID-103 — Autorización por proyecto ausente en múltiples endpoints (IDOR) y enumeración de IDs
- **Evidencia:** no hay guard ni interceptor que ate `:projectId` al usuario. Cada servicio decide por su cuenta (`loadAccessibleProjectWithStages`, `project-access.util.ts:8-25`). Rutas verificadas **sin** comprobación de dueño ni `SHARED`:
  - **Lectura:**
    - `GET /projects/:projectId/change-log` (`change-log.service.ts:33-45`): resumen de 120 caracteres de cada cambio, con email y nombre de los autores.
    - `GET /ai-analysis/estimation` y `GET /ai-analysis/token-usage[/events]` (`ai-analysis.controller.ts:111-135`, `:866-900`; `estimation.service.ts:925-945` hace `project.findUnique` sin filtro).
    - `GET /agent-supervisor/episodic/:projectId` (`agent-supervisor.service.ts:32-38`, `:130-133`).
    - `GET /plugins/projects/:id/plugin-data/:pluginId` (`plugins.controller.ts:177-190`).
    - `GET /projects/:p/stages/:s/agent-session-log` (`agent-session-log.service.ts:32-38`).
  - **Escritura o efectos:**
    - `PUT /plugins/projects/:id/plugin-data/:pluginId` (`plugins.controller.ts:192-212`).
    - `POST /projects/:id/ui-screens/sync` (`ui-screens.service.ts:43-62`): lee el MDD ajeno, regenera el entregable y devuelve su contenido.
    - Gaps de documentación `GET/POST/approve/reject` (`documentation-gap.service.ts:679-684`): `assertStageAccess` solo comprueba que la etapa pertenezca al proyecto, no el acceso del usuario. `approveGap` encola una reconciliación LLM que **reescribe entregables** (`:448-480`, `:622-660`), y `reportGap` acepta texto libre que se convierte en feedback de esa reconciliación (prompt injection dirigida).
    - `POST /projects/:projectId/legacy/generate-mdd` con cola (`legacy-flow.controller.ts:158-176`): encola sin comprobar acceso. `mdd-queue.service.ts:783-792` primero **cancela los jobs activos del proyecto** (`preemptActiveMddJobsForProject`), lo que permite un DoS sobre proyectos ajenos.
  - **IDs cruzados:** `stageId` del body no se ata a `projectId` en el flujo legacy (`legacy-coordinator.service.ts:123,206,231,262,472,491,588`; `legacy-stage-context.service.ts:62-66`). Un usuario con un proyecto LEGACY propio pasa el `stageId` de otro proyecto y:
    - lee su `codebaseDoc`, que `generateFromCodebase` (`:572-668`) envía al LLM y devuelve;
    - o sobrescribe su `legacyChangeState` (`updateCodebaseDoc`, `:228-241`).
  - **Enumeración de IDs:**
    - `GET /ai-analysis/mdd/jobs/:jobId` (`ai-analysis.controller.ts:512-519`) no comprueba acceso. El job se crea con `queue.add(...)` sin `jobId` (`mdd-queue.service.ts:798`), así que BullMQ asigna IDs secuenciales `1, 2, 3…`. La respuesta incluye `projectId`, `stageId` y `threadId` (`mdd-queue.service.ts:145-176`, `:1042-1054`).
    - `POST /theforge/resolve-forge-project-for-ariadne` (`project-ariadne-link.service.ts:30-53`, `:118-128`) busca entre **todos** los proyectos sin filtrar por usuario y devuelve id, nombre y etapas de candidatos ajenos (409 `candidates`).
- **Impacto:** cualquier usuario autenticado (rol `developer`) puede descubrir los UUID de proyectos privados y después leer metadatos y contenido derivado, alterar entregables vía reconciliación, sobrescribir estado legacy y cancelar generaciones de otros usuarios.
- **Remediación sugerida:**
  1. Un `ProjectAccessGuard` (o interceptor) declarativo, p. ej. `@ProjectScoped("projectId")`, que cargue el proyecto y aplique dueño o `SHARED` (y dueño o admin para borrar). Aplicarlo a **todas** las rutas con `:projectId`/`:id`/`projectId` en query o body.
  2. Atar siempre `stageId` a `projectId` (`findFirst({ where: { id: stageId, projectId } })`).
  3. Usar `jobId: randomUUID()` en `queue.add` y comprobar acceso al `projectId` del job antes de devolver su estado.
  4. Filtrar `resolve-forge-project-for-ariadne` por proyectos accesibles.
  5. Añadir tests de autorización por endpoint (usuario B sobre proyecto privado de A → 404).
- **Alcanzable / explotable:** sí, con cualquier cuenta. Verificado estáticamente en cada ruta citada; no probado dinámicamente.

### [ALTA] ID-104 — SSRF desde el API, que está conectado a `dokploy-network`
- **Evidencia:**
  - `apps/api/src/modules/admin/admin.controller.ts:7-12, 38-108`: `POST /admin/ariadne-config/test` **no llama a `requireAdmin()`**. Hace `fetch(url)` POST a una URL arbitraria y devuelve hasta 200 caracteres del cuerpo en el error (`:68`, `:97`). `POST /admin/tech-docs-config/test` (`:14-35`) también acepta URL libre.
  - URL por usuario usadas por el servidor:
    - `PUT /auth/ariadne-config` (`auth.service.ts:702-712`) → `theforge.service.ts:250-264` envía el JSON-RPC al `ariadneMcpUrl` del usuario y su respuesta alimenta el flujo;
    - `techDocsMcpUrl` (`technology-docs-mcp-client.service.ts:157-163`);
    - `baseUrl` BYOK libre (`provider-config.helpers.ts:75`, `user-providers.service.ts:354`), usado en chat LLM y en `audio.service.ts:56-69`.
  - Webhook converge: `body.webhookUrl` (`sdd-integration.service.ts:1033-1055`), POST ciego sin guard.
  - El guard del scraper (`scraper/url-ssrf-guard.ts`) valida solo la URL inicial, pero el fetch usa `redirect: "follow"` (`scraper.service.ts:43`, `scrape-cheerio.tool.ts:25`). Un 302 hacia `169.254.169.254` o un host interno lo evita. También hay TOCTOU con DNS rebinding (resuelve y luego `fetch` vuelve a resolver). La tool `scrape_url` la invoca el LLM, así que es alcanzable por prompt injection indirecta.
  - `docker-compose.yml:74-76`: `theforge-api` está en `dokploy-network`. Ahí conviven los servicios de producción listados en Dokploy: RabbitMQ management (`:15672`), jsreport (`:5488`), ERP, SSO, Adminer, etc.
- **Impacto:** cualquier usuario autenticado puede sondear y enviar POST a servicios internos de toda la plataforma Dokploy, no solo de The Forge, y leer fragmentos de la respuesta. Si el host tiene metadata cloud, también es alcanzable por la vía de redirección.
- **Remediación sugerida:**
  1. `requireAdmin()` en ambos endpoints de test.
  2. Un cliente HTTP saliente único con:
     - el guard `assertPublicHttpUrl` en **cada salto** (`redirect: "manual"` y revalidación);
     - IP fijada tras resolver (agent con `lookup` propio);
     - lista de bloqueo ampliada (`198.18.0.0/15`, multicast/reservadas, IPv4 mapeada en IPv6).
  3. Aplicarlo a URL de usuario (Ariadne, Context7, BYOK `baseUrl`, webhook).
  4. Quitar `theforge-api` de `dokploy-network` si Traefik puede enrutar por la red del compose, o crear una red dedicada solo con Traefik.
  5. No devolver cuerpos remotos en los errores.
- **Alcanzable / explotable:** sí, con cualquier cuenta (sin necesidad de admin). No probado dinámicamente.

### [ALTA] ID-105 — OTP de 6 dígitos sin límite de intentos ni rate limiting
- **Evidencia:**
  - `auth.service.ts:587-603`: `verifyOtp` compara contra el `Map` en memoria. No cuenta intentos fallidos ni invalida el código tras N errores, y el código vive 10 minutos (`:27`).
  - No hay `@nestjs/throttler`, `helmet` ni `limit_req` en `docker/nginx-fullstack.conf` / `apps/web/nginx.conf`: `grep` sin resultados en `apps/api/src`; `apps/api/package.json` no los declara.
  - El reenvío solo se limita a 1/min por email (`:252-256`); cada solicitud genera un código nuevo.
- **Impacto:** 10^6 combinaciones por ventana de 10 minutos. A unos cientos de peticiones por segundo (la ruta no toca la BD hasta acertar) se obtiene una probabilidad alta de acierto en una o pocas ventanas, lo que da toma de cuenta de cualquier email registrado, incluido `super_admin`. El JWT resultante dura 7 días (ID-109).
- **Remediación sugerida:**
  1. Contador de intentos por email y por IP (p. ej. 5 fallos → invalidar el código).
  2. `ThrottlerModule` global con límites estrictos en `/auth/*`, con almacenamiento en Redis para que funcione con varias réplicas.
  3. Comparación en tiempo constante.
  4. Opcional: código de 8 caracteres alfanuméricos.
- **Alcanzable / explotable:** sí, sin autenticación. No probado (se requeriría una prueba de carga contra producción).

### [ALTA] ID-106 — El servidor MCP HTTP comparte un único JWT entre usuarios concurrentes
- **Evidencia:**
  - `packages/mcp-server/src/mcp-api-client.ts:6-8`: `let jwtToken`, `lastClientSecret` y `tokenExpiresAt` a nivel de módulo.
  - `login()` (`:10-38`) los sobrescribe en cada petición. `authHeaders()` (`:41-45`) usa el valor global vigente.
  - `packages/mcp-server/src/index.ts:164-193`: por cada POST hace `await login(clientSecret)` y después `await handleJSONRPC(json)` en el mismo proceso.
  - El reintento ante 401 (`:62-64`, `:96-98`) hace `login()` con el `lastClientSecret` de **otro** usuario.
  - Expuesto públicamente en `maxprime.obp.mx/mcp` (Dokploy). Las tools incluyen `delete_project`, `merge_projects`, `patch_project` y `get_project`.
- **Impacto:** si las peticiones de dos usuarios se solapan (las tools tardan hasta 120 s), las llamadas del primero salen con el JWT del segundo. Un usuario con rol bajo puede lanzar tools largas y repetidas para capturar la identidad de un admin activo (leer sus proyectos privados, borrar o fusionar en su nombre), o al revés: causar acciones involuntarias de otros usuarios.
- **Remediación sugerida:**
  1. Eliminar el estado global y pasar un contexto por petición (`AsyncLocalStorage` o parámetro) con el JWT del llamante.
  2. Caché de tokens por hash del secret, con TTL alineado a la expiración real del JWT.
  3. Test de concurrencia con dos secrets.
- **Alcanzable / explotable:** alcanzable sí (condición de carrera determinista en el código). Explotación no probada.

### [ALTA] ID-107 — Plugins: código de terceros ejecutado en el proceso del API y en el navegador de todos, sin firma obligatoria
- **Evidencia:**
  - Instalación por `requireAdmin()`, no `super_admin` (`plugins.controller.ts:89-121`), desde ZIP subido, `downloadUrl` HTTPS arbitraria (`plugin-install.service.ts:310-322`, sin guard SSRF) o portal de licencias.
  - Firma **opcional**: `PLUGINS_REQUIRE_SIGNATURE` vale `false` por defecto (`config/plugins.config.ts:23`) y solo se verifica si el manifest trae `signature` (`plugin-packaging.util.ts:213`).
  - La firma es **HMAC simétrica** (`:141-162`), así que cualquier instancia con el secreto puede firmar.
  - Carga con `await import()` en el proceso Nest (`plugin-loader.service.ts:126`), con acceso a `process.env` (`TOKEN_MASTER_KEYS`, `JWT_SECRET`), Prisma y red. El contenedor corre como root (ID-111).
  - El bundle `workshopUi` se sirve desde el origen del API (`plugins.controller.ts:66-79`) y la SPA lo ejecuta en **todos** los navegadores con `import(blobUrl)` (`apps/web/src/plugin-ui/load-installed-workshop-ui.ts:36,61`), donde el JWT está en `localStorage` (ID-001).
  - Mitigaciones existentes: JSZip 3.10.1 sanea `..` (zip-slip), `folderNameForPlugin` normaliza el id y `readAsset` valida el nombre.
- **Impacto:** un `admin` (o quien obtenga ese rol vía ID-101, ID-105 o ID-108) consigue RCE persistente en el API y el worker, descifra todas las claves BYOK y ejecuta XSS almacenado sobre todos los usuarios. Un plugin legítimo comprometido en origen tiene el mismo alcance.
- **Remediación sugerida:**
  1. Exigir `super_admin` y firma **asimétrica** (Ed25519) con clave pública fijada en el código; `PLUGINS_REQUIRE_SIGNATURE=true` por defecto en producción.
  2. Lista de plugins permitidos por id y hash.
  3. Ejecutar los plugins en `worker_threads` o un proceso sin acceso a `TOKEN_MASTER_KEYS`.
  4. Servir `workshopUi` desde otro origen (iframe con sandbox) en vez de `import()` en el origen principal.
- **Alcanzable / explotable:** sí para admin. Por diseño, no hay vulnerabilidad sin rol admin.

### [MEDIA] ID-108 — Un `admin` puede escalar a `super_admin` y suplantar a cualquiera
- **Evidencia:**
  - `auth.controller.ts:217-222` → `auth.service.ts:914-930`: con `requireAdmin()` se puede asignar `super_admin` a cualquiera, incluido uno mismo.
  - `createUser` acepta `role: "super_admin"` (`:1035`).
  - `GET /users/:id/mcp-secret` (`auth.controller.ts:242-246`, `auth.service.ts:885-898`) devuelve el `mcpSecret` de cualquier usuario, también `super_admin`, y con él se obtiene su JWT vía `/auth/mcp-login`.
  - `deleteUser` y `updateRole` permiten a un admin degradar o borrar a un `super_admin`.
- **Impacto:** la separación admin/super_admin (revelar secretos de sistema, grants de modelos) es nula.
- **Remediación sugerida:** solo `super_admin` puede asignar `super_admin`, ver o rotar el secret de otro usuario y modificar a un `super_admin`. Registrar en auditoría los cambios de rol.
- **Alcanzable / explotable:** sí con rol admin.

### [MEDIA] ID-109 — JWT de 7 días sin revocación; rol tomado del token
- **Evidencia:**
  - `auth.module.ts:20`: `expiresIn` por defecto `7d`.
  - `jwt.strategy.ts:26-31`: no consulta la BD. Un usuario borrado o degradado conserva acceso y rol hasta 7 días.
  - `mcpLogin` (`auth.service.ts:629-647`) emite el mismo tipo de token de 7 días (el cliente MCP asume 55 minutos).
  - No hay refresh token, lista de revocación ni `tokenVersion`.
- **Impacto:** no se puede cortar el acceso de una cuenta comprometida o dada de baja. Amplifica ID-101, ID-105 e ID-106.
- **Remediación sugerida:** access token de 15-60 minutos más refresh token rotativo en cookie `HttpOnly`/`Secure`/`SameSite` (lo que también resuelve el agravante de ID-001); `tokenVersion` en `User` comprobado en `validate()`; y rol leído de la BD (con caché corta).
- **Alcanzable / explotable:** sí.

### [MEDIA] ID-110 — Credenciales de larga vida guardadas en claro en la BD
- **Evidencia:**
  - `schema.prisma:22,29,33,381`: `User.mcpSecret`, `ariadneMcpToken`, `techDocsMcpToken` y `Project.convergeWebhookSecret` en texto plano.
  - `mcpLogin` busca `where: { mcpSecret: secret }` (`auth.service.ts:630-632`); el secret no se hashea y `GET /auth/mcp-secret` lo devuelve en cualquier momento (`:663-678`).
  - `AppConfig` guarda `smtp_pass`, `tavily_api_key` y `forgeops_provision_secret` sin cifrar (`system-config.service.ts:101-105`; `packages/shared-types/src/system-config.ts:122-232`).
  - Solo las claves BYOK usan `TokenCryptoService` (AES-256-GCM).
- **Impacto:** cualquier lectura de la BD (ID-102, backup, Adminer) da suplantación inmediata de todos los usuarios vía MCP, más las credenciales de terceros.
- **Remediación sugerida:**
  - `mcpSecret`: guardar solo el hash SHA-256, mostrarlo una única vez al generarlo, prefijo identificable (`tfm_…`) y fecha de expiración.
  - Resto de tokens y secretos de `AppConfig`: cifrar con `TokenCryptoService` e incluirlos en `scripts/rotate-master-key.ts`.
- **Alcanzable / explotable:** requiere acceso a la BD (ver ID-102).

### [MEDIA] ID-111 — Imágenes y despliegue: root, sin `HEALTHCHECK`, imagen monolítica con credenciales y `db push`
- **Evidencia:**
  - `apps/api/Dockerfile:48-71`, `apps/web/Dockerfile:31-42` y `packages/mcp-server/Dockerfile:31-42`: sin `USER`, así que corren como root.
  - `apps/api/Dockerfile:68-69`: `HEALTHCHECK` desactivado. El compose lo suple para api, web y mcp, pero no para `theforge-worker`.
  - Bases por etiqueta mutable (`node:20-alpine`, `nginx:alpine`, `postgres:15-alpine`), sin digest.
  - `Dockerfile` raíz (contenedor único Postgres + API + nginx):
    - `ENV POSTGRES_PASSWORD` literal (`:51-54`);
    - `prisma db push --accept-data-loss` incondicional (`docker/entrypoint-full.sh:25`);
    - la API como root (`:34`).
  - `.dockerignore` no excluye `.env*` (ya anotado en la auditoría anterior).
  - Volúmenes `theforge_db_data`, `theforge_plugins` y `theforge_plugin_data` (`docker-compose.yml:279-283`) sin estrategia de respaldo declarada en el repo.
- **Impacto:** una RCE (ID-107, dependencias de ID-004) obtiene root dentro del contenedor y escritura en todo `/app`. La imagen monolítica puede borrar datos al arrancar.
- **Remediación sugerida:**
  1. `USER node` (o `nginx`) en las etapas finales, con `chown` solo de los directorios escribibles (`/app/plugins-enabled`, `/app/data`).
  2. Fijar las imágenes base por digest.
  3. `HEALTHCHECK` también en el worker.
  4. Retirar el `Dockerfile` monolítico o alinearlo con el entrypoint del API (`THEFORGE_ALLOW_DB_PUSH`).
  5. Añadir `.env*` a `.dockerignore` y documentar backups en Dokploy.
- **Alcanzable / explotable:** no es una vulnerabilidad directa; agrava otras.

### [MEDIA] ID-112 — Sin cabeceras de seguridad HTTP en web ni API
- **Evidencia:**
  - `apps/web/nginx.conf` y `docker/nginx-fullstack.conf` no definen `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors` ni `Referrer-Policy`.
  - El API no usa `helmet` (`main.ts`).
  - El MCP responde `Access-Control-Allow-Origin: *` (`packages/mcp-server/src/index.ts:139`).
- **Impacto:** sin defensa en profundidad frente a ID-001 e ID-107 (no hay CSP), clickjacking del panel de administración, y fuga del OTP de la URL de magic link vía `Referer` (ID-122).
- **Remediación sugerida:** cabeceras en nginx (CSP `default-src 'self'; script-src 'self'` más los orígenes necesarios, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`), HSTS en Traefik y `helmet()` en Nest.
- **Alcanzable / explotable:** sí (configuración observable). Complementa ID-001, sin repetirlo.

### [MEDIA] ID-113 — `otp_dev_expose_code` sin guarda de producción: un interruptor anula toda la autenticación
- **Evidencia:**
  - `auth.service.ts:55-57`: `otpDevExposeCode()` no comprueba `NODE_ENV`.
  - `:541-547`: si está activo, `POST /auth/otp/request` (público) devuelve `devCode` para **cualquier** email registrado. También aplica en ForgeOps (`:411-419`).
  - Se activa desde Ajustes → Sistema (super_admin) o con la variable `OTP_DEV_EXPOSE_CODE` (`packages/shared-types/src/system-config.ts:493-499`; la propia descripción advierte el riesgo).
- **Impacto:** un error de configuración, o un super_admin comprometido, convierte la instancia en "login con solo el email".
- **Remediación sugerida:** ignorar la opción si `NODE_ENV === "production"` (o exigir además una variable de entorno inmutable) y registrar un error al arrancar si está activa.
- **Alcanzable / explotable:** solo si se activa. Estado en producción no verificado.

### [MEDIA] ID-114 — Uploads y cuerpos sin límite: DoS de memoria por usuario autenticado
- **Evidencia:**
  - `audio.controller.ts:47-56` y `plugins.controller.ts:89-91`: `FileInterceptor` sin `limits`. Multer guarda en memoria sin tope de tamaño; `PLUGINS_MAX_UPLOAD_BYTES` se comprueba después de bufferizar (`plugin-install.service.ts:94`).
  - `main.ts:78-79`: `json`/`urlencoded` de 50 MB, más `httpServer.timeout` de 10 minutos (`:83`).
- **Impacto:** unas pocas peticiones concurrentes agotan la memoria del contenedor del API.
- **Remediación sugerida:** `limits: { fileSize }` en cada interceptor (audio ~25 MB, plugins = `maxUploadBytes`); 50 MB solo en las rutas MDD que lo necesitan; `client_max_body_size` explícito en nginx/Traefik.
- **Alcanzable / explotable:** sí con cualquier cuenta. No probado.

### [MEDIA] ID-115 — Clave de OpenRouter en el historial de git
- **Evidencia:** el commit `b2ea7191` añadió `auth.json` con `credential_pool.openrouter[0].access_token` = `sk-o…`. Sigue alcanzable desde `origin/master` y otras ramas remotas. El commit `4e1d9b79` dejó de trackearlo, pero no se purgó el historial. `SECURITY.md` dice que la clave fue deshabilitada.
- **Impacto:** si la revocación no se completó, la clave es utilizable por cualquiera con acceso al repo o a sus forks.
- **Remediación sugerida:** confirmar la revocación en OpenRouter. Purgar con `git filter-repo --path auth.json --invert-paths` según `SECURITY.md`, coordinado con forks (`imjmedia`, `kreodevs`). Activar secret scanning y push protection en GitHub.
- **Alcanzable / explotable:** no verificado (no se probó la clave).

### [BAJA] ID-116 — `register-first-admin` público con condición de carrera
- **Evidencia:** `auth.controller.ts:176-186` y `auth.service.ts:979-1016`: `count()` seguido de `create()` sin transacción ni lock. Crea un `super_admin` y devuelve su `mcpSecret`.
- **Impacto:** en una instancia recién desplegada, el primero que llegue toma el control. Dos peticiones simultáneas pueden crear dos `super_admin`.
- **Remediación sugerida:** exigir un token de bootstrap de un solo uso por variable de entorno, o crear el primer admin por CLI. Transacción `serializable`.
- **Alcanzable / explotable:** solo mientras no haya usuarios.

### [BAJA] ID-117 — Grupos de proyecto globales editables por cualquier usuario
- **Evidencia:** `project-groups.controller.ts:17-34`: sin comprobación de rol. `remove` reasigna los proyectos de todos los usuarios al grupo por defecto (`project-groups.service.ts:113-117`).
- **Impacto:** integridad y organización del dashboard de todos los usuarios; sin fuga de datos.
- **Remediación sugerida:** `requireAdmin()` en create, update, delete y move.
- **Alcanzable / explotable:** sí.

### [BAJA] ID-118 — Sesiones de entrevista legacy con ID predecible y sin dueño
- **Evidencia:** `change-interview.service.ts:729-731`: `int_${Date.now()}_${Math.random()…6}`. `getStatus`, `continueChat`, `confirmScope` y `cancelInterview` (`:234-248`) buscan solo por `sessionId`, sin `userId` ni proyecto.
- **Impacto:** lectura o manipulación de entrevistas ajenas si se adivina el ID (~31 bits de `Math.random` más una marca de tiempo aproximada).
- **Remediación sugerida:** `randomUUID()`, guardar `userId`/`projectId` en la sesión y validarlos en cada operación.
- **Alcanzable / explotable:** difícil, pero factible a escala.

### [BAJA] ID-119 — CI sin permisos explícitos y deploy automático sin gate
- **Evidencia:**
  - `.github/workflows/ci.yml` no tiene bloque `permissions:`, así que hereda el valor por defecto del repo, que puede ser escritura.
  - Acciones fijadas por etiqueta (`@v4`), no por SHA.
  - Usa `pull_request` (no `pull_request_target`) y no inyecta secretos: los forks no acceden a secretos (correcto).
  - `docker-compose.yml:13`: el webhook de Dokploy despliega en cada push a `master`, independientemente del resultado de CI.
- **Remediación sugerida:** `permissions: contents: read`, fijar acciones por SHA y desplegar solo tras CI verde (GitHub Environments o deploy desde Actions).
- **Alcanzable / explotable:** no directamente.

### [BAJA] ID-120 — Validación de entrada inconsistente
- **Evidencia:**
  - No hay `ValidationPipe` global (`main.ts`). Varios bodies se tipan sin validar: `setAriadneConfig`/`setTechDocsConfig` (`auth.controller.ts:136-140`, `:148-152`), `updateRole`/`createUser` (`:217-230`), `admin.controller.ts:9,16`, legacy `stageId`.
  - `limit` sin parsear con seguridad en `change-log.controller.ts:16`.
- **Impacto:** errores 500, tipos inesperados en Prisma y URL sin validar (relacionado con ID-104).
- **Remediación sugerida:** esquemas zod en todos los bodies y queries (el patrón `parseBody` ya existe) o un `ZodValidationPipe` global.

### [BAJA] ID-121 — Rotación de clave maestra incompleta y tag GCM sin longitud fija
- **Evidencia:**
  - `scripts/rotate-master-key.ts:87-110` rota `UserProviderConfig` y `ProviderInstance`, pero no `UiMcpInstance.tokenCiphertext` (`schema.prisma:118-119`).
  - `token-crypto.service.ts:43-44`: `createDecipheriv` sin `authTagLength`, por lo que acepta tags truncados.
- **Impacto:** al retirar una versión de clave, los tokens de UI MCP quedan indescifrables. El tag truncado debilita la integridad si un atacante puede escribir en la BD.
- **Remediación sugerida:** incluir `UiMcpInstance` en la rotación y pasar `{ authTagLength: 16 }` validando `tag.length === 16`.

### [BAJA] ID-122 — Datos personales y OTP en logs y URL
- **Evidencia:**
  - `auth.service.ts:531`: registra los emails no registrados que solicitan OTP (y `:440`, `:574`).
  - `:290`: el magic link lleva `otp` y `email` en la query string, lo que los expone en logs de proxy, historial y `Referer`.
  - `OTP_DEV_EXPOSE_CODE` registra el email (`:544`).
- **Remediación sugerida:** enmascarar emails en logs; magic link con un token de un solo uso distinto del OTP, enviado en el fragmento (`#`) o por POST.

### [BAJA] ID-123 — CORS de producción con orígenes de desarrollo y de un dominio ajeno por defecto
- **Evidencia:** `docker-compose.yml:114`: el valor por defecto de `CORS_ORIGINS` incluye `http://localhost:5173`, `http://127.0.0.1:5173` y `https://theforge.kreoint.mx`, con `credentials: true` (`main.ts:74-75`).
- **Impacto:** bajo hoy, porque la autenticación es por Bearer y no por cookie. Pasa a ser relevante si se migra a cookies (ID-109).
- **Remediación sugerida:** sin valor por defecto en el compose; definir los orígenes solo en Dokploy.

### [INFO] ID-124 — `tasks-to-issues` usa el `GITHUB_TOKEN` del servidor sobre un repositorio elegido por el usuario
- **Evidencia:** `sdd-integration.service.ts:1069-1135`: `body.owner`/`body.repo` libres con `Authorization: Bearer ${GITHUB_TOKEN}`.
- **Impacto:** si se configura `GITHUB_TOKEN` (no está en el compose), cualquier usuario crea issues en cualquier repo al que el token tenga acceso (confused deputy).
- **Remediación sugerida:** lista de repos permitidos o token por usuario.

### [INFO] ID-125 — `docs-mcp-server` sin autenticación
- **Evidencia:** `packages/docs-mcp-server/src/index.ts:95-126`: HTTP en `0.0.0.0` sin auth. Sirve solo documentación precargada y busca por mapa, sin path traversal (`docs-store.ts`). No aparece en los compose.
- **Remediación sugerida:** si se publica, ponerlo detrás de Traefik con auth, o aceptar que es documentación pública.

## Fortalezas (controles que ya están bien)

- **Guard global** `JwtAuthGuard` (`app.module.ts:72`) con lista blanca `@Public()`. Endpoints públicos, todos intencionales:
  - `GET /health`;
  - `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/mcp-login` y `/auth/sso/login`;
  - `POST /auth/forgeops/provision-user` (M2M con `timingSafeEqual`, `forgeops-provision-auth.util.ts`);
  - `GET /auth/has-users`;
  - `POST /auth/register-first-admin` (ver ID-116).

  No hay webhooks entrantes públicos.
- Rutas de administración con comprobación de rol: `system-config` (super_admin), `admin/worker-jobs`, `users/*`, eval MDD, instalación de plugins, `ui-mcp` y `provider-instances`.
- `passport-jwt` con `ignoreExpiration: false`; HS256 con secreto de texto, sin aceptar `none`.
- OTP generado con `crypto.randomInt`, `mcpSecret` con `randomBytes(32)`. La solicitud de OTP no permite enumerar emails registrados.
- **Cifrado BYOK** AES-256-GCM con IV aleatorio, versionado de claves y fallo cerrado si falta `TOKEN_MASTER_KEYS` (`crypto.config.ts`, `docker-entrypoint.sh:95-97`).
- Sin SQL crudo: no hay `$queryRaw`/`$executeRaw` en `apps/api/src`, todo pasa por Prisma.
- `child_process` solo con argumentos fijos: `git rev-parse` en eval y `spawn(process.execPath, [entry, "lint", …])` con la entrada por stdin.
- **Rutas de archivo**: IDs de eval validados por regex (`mdd-eval-run-store.util.ts:39-43`), `readAsset` de plugins con `basename`, JSZip 3.10.1 con saneamiento contra zip-slip.
- CORS obligatorio en producción (`main.ts:39-53`).
- Guard SSRF del scraper con resolución DNS y rangos privados (incompleto: ver ID-104).
- La BD y Redis del compose no están en `dokploy-network` ni publican puertos en producción (los puertos solo aparecen en `docker-compose.override.yml`/`local.yml`).
- `prisma db push` desactivado por defecto en la imagen del API (`docker-entrypoint.sh:287-292`).
- `.env` y `auth.json` en `.gitignore`. `.env.example` solo con placeholders. `git grep` sin claves reales en el árbol actual (solo fixtures de specs).
- Sesiones de chat filtradas por `userId` (`sessions.service.ts:457-459`). Proyectos, integración y notion con control de dueño o `SHARED`.
- CI con `pull_request` (no `pull_request_target`) y sin secretos expuestos a forks.

## Verificado sin hallazgos

- Secretos en el árbol actual (`git grep` de patrones `sk-…`, `ghp_`, `AKIA`, `AIza`, `ari_`, `tvly-` y claves privadas): solo fixtures de tests.
- Últimos 300 commits (`git log -p`): sin claves Anthropic, OpenRouter ni `ari_` añadidas. El único caso es el commit `b2ea7191`, fuera de esa ventana (ID-115).
- Logs: no se registran valores de `apiKey`, `mcpSecret` ni contraseñas, solo eventos.
- `docs-mcp-server`: sin path traversal (búsqueda por mapa de URI).
- XSS en la web: el único sumidero `dangerouslySetInnerHTML` es el de ID-001.

## No auditado (y por qué)

- **Variables de entorno reales en Dokploy** (`JWT_SECRET`, `POSTGRES_PASSWORD`, `PLUGINS_REQUIRE_SIGNATURE`, `OTP_DEV_EXPOSE_CODE`): leerlas habría traído secretos al contexto. Determinan si ID-101, ID-102 e ID-113 son explotables hoy. Jorge debe comprobarlas en la UI de Dokploy.
- **Correspondencia exacta** entre el compose "MaxPrime (The Forge)" de Dokploy y este `docker-compose.yml`: el nombre del servicio sugiere que es este repo o un derivado (MaxPrime es un repo hermano). No se leyó la configuración del compose desplegado.
- **Cabeceras y TLS efectivos en Traefik** (HSTS, redirección HTTP→HTTPS) y middlewares de Dokploy: no se hicieron peticiones a producción.
- **Revisión exhaustiva** de los 71 endpoints de `projects.controller.ts`, los 35 de `ai-analysis` y los 16 de `project-integration`. Se muestrearon: la mayoría de `projects` usa `loadAccessibleProjectWithStages`, pero no se verificaron uno a uno los que reciben `stageId` (p. ej. `project-stage.service.ts:237`, `project-deliverable-generators.service.ts:1494`, `project-integration.service.ts:614,842,955,1175`). Hay que revisarlos con el guard de ID-103.
- **Ejecución en el worker:** `runWithRequestUser*` fija `role: "admin"` para todos los jobs (`request-user.store.ts:28-35`). No se trazó qué comprobaciones de rol se ejecutan dentro de jobs encolados por usuarios `developer`.
- **Prompt injection indirecta** de extremo a extremo (scraper, Ariadne, documentos → tools con efectos): se identificaron las rutas (ID-103 `reportGap`, ID-104 `scrape_url`), pero no se evaluó cada tool LLM con efectos.
- **Dependencias** (`deps`): fuera de alcance por instrucción; ver la auditoría anterior.
- **Pruebas dinámicas** (fuerza bruta de OTP, SSRF, carrera MCP): prohibidas por el alcance (solo análisis estático).
