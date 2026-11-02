# auth

Auth multi-usuario con OTP por email + JWT. Cada `User` tiene su propio `mcpSecret` (API key M2M).

## Endpoints

### Públicos (`@Public()`)

- **`POST /auth/otp/request`** — body `{ email }` (requerido). Si el email **existe** en la tabla `User`, genera un OTP de 6 dígitos y lo envía por SMTP (o lo loguea en dev). Si no existe, devuelve `{ ok: true }` igualmente (anti-enumeración). Throttle: 1 envío por minuto por email. El OTP vive en Redis (`AuthRedisStore`, TTL 10 min); sin `REDIS_URL` solo hay modo memoria fuera de producción, y en producción sin Redis las rutas responden 503.
- **`POST /auth/otp/verify`** — body `{ email, code }`. Valida el OTP contra el email (máx. 5 intentos por código; al 5º fallo se descarta y hay que pedir otro), busca el `User`, asegura `mcpSecret` y emite JWT (`sub` = `User.id`, `email`, `role`).
- **`POST /auth/mcp-login`** — body `{ secret }`. Intercambia un `mcpSecret` por JWT del usuario dueño del secret. Usado por el MCP server.
- **`POST /auth/sso/login`** — body `{ token }`. Login vía SSO externo (`SSO_URL/verify`). Crea/actualiza usuario local.
- **`GET /auth/has-users`** — `{ hasUsers: boolean }`. Usado por el `SetupView` para detectar primer arranque.
- **`POST /auth/register-first-admin`** — body `{ email, name? }`. Crea el primer usuario con rol `super_admin` (solo si la tabla `User` está vacía). Genera `mcpSecret` automáticamente.
- **`POST /auth/forgeops/provision-user`** — M2M desde **ForgeOps** para instancias compartidas. Header `Authorization: Bearer <FORGEOPS_PROVISION_SECRET>`. Body `{ email, name?, role?, loginUrl?, resendIfExists? }`. Crea el usuario (`developer` por defecto; `admin` opcional) o, si ya existe, reenvía acceso (`resendIfExists: false` omite el correo). Envía email de bienvenida con OTP + magic link (misma plantilla que login). Requiere `FORGEOPS_PROVISION_SECRET` y SMTP en producción. Respuesta: `{ created, user, accessEmailSent, devCode? }`.

### Autenticados (JWT)

- **`GET /auth/me`** — perfil del usuario autenticado.
- **`GET /auth/mcp-secret`** — devuelve el `mcpSecret` propio (lo genera si falta).
- **`POST /auth/mcp-secret/regenerate`** — rota el `mcpSecret` propio.

### Admin-only (`/users`)

- **`GET /users`** — lista usuarios (`{ id, email, role, name, hasMcpSecret, createdAt }[]`).
- **`POST /users`** — solo admin. Body `{ email, name?, role? }`. Crea usuario y genera `mcpSecret`. Crear un `super_admin` solo lo hace un `super_admin` (`403`).
- **`PATCH /users/:id`** — solo admin; sobre un `super_admin`, solo otro `super_admin`. Body `{ email?, name? }` (al menos uno). Actualiza el nombre y/o el correo. El email se normaliza (trim + lowercase) y debe ser único (`400` si ya existe). Cambiar el email revoca los JWT del usuario. Devuelve `{ id, email, role, name }`.
- **`PATCH /users/:id/role`** — solo admin. Body `{ role }` (`super_admin` | `admin` | `developer`). Solo un `super_admin` asigna o quita `super_admin` (`403` al resto de admins). Nadie cambia su propio rol (`403`, «No puedes cambiar tu propio rol»). Asignar el mismo rol que ya tiene el usuario no revoca sus sesiones.
- **`DELETE /users/:id`** — solo admin; elimina usuario (cascada sobre projects/sessions). No permite borrar la propia cuenta (`403`).
- **`GET /users/:id/mcp-secret`** — solo admin: ver el `mcpSecret` de un usuario. Sobre un `super_admin`, solo lo ve otro `super_admin`.
- **`POST /users/:id/mcp-secret/regenerate`** — solo admin: rotar el `mcpSecret` de un usuario (revoca sus JWT). Sobre un `super_admin`, solo otro `super_admin`.

## Validación del JWT y revocación (`tokenVersion`)

`JwtStrategy.validate` no confía en el rol del token: relee al `User` (id, email, rol, `tokenVersion`) y devuelve los datos de BD. Usuario inexistente o `tv` distinto de `User.tokenVersion` → 401. La lectura se cachea 30 s por proceso (`JwtUserCache`, tope 1000 entradas; en varias réplicas el desfase máximo es ese TTL).

- Los JWT llevan el claim `tv` (= `User.tokenVersion` al firmar). Un token sin `tv` equivale a 0, así que los emitidos antes de esta versión siguen válidos mientras `tokenVersion` sea 0.
- `tokenVersion` sube (`+1`) al rotar el `mcpSecret` (propio o por admin; la primera generación no lo sube), al cambiar el rol y al cambiar el email. Eso revoca todas las sesiones del usuario. Al rotar el secret propio (`POST /auth/mcp-secret/regenerate`) la respuesta es `{ mcpSecret, accessToken }`: el `accessToken` nuevo va firmado con el `tv` incrementado y la web lo guarda para que su sesión no se cierre. Asignar el mismo rol que ya tiene el usuario no sube `tokenVersion`.
- `AuthService` invalida la caché en cada mutación de rol, email, secret o borrado, y tras el upsert de SSO.
- `JwtUserCache` lleva una generación por usuario: `invalidate` la incrementa y `set(userId, user, generación)` se descarta si cambió (una lectura de BD anterior a la rotación no puede dejar la fila vieja en caché). Si el `tv` del token es mayor que el cacheado, `JwtStrategy` relee la BD una vez antes de rechazar (caso multi-réplica).

## SMTP y ForgeOps (Ajustes → Sistema → Correo y acceso)

Prioridad runtime: **valor guardado en UI** → **env Dokploy** → default.

Campos: `web_domain`, `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_pass`, `smtp_from`, `forgeops_provision_secret`.

Variables env legacy (siguen como fallback): `SMTP_*`, `WEB_DOMAIN`, `FORGEOPS_PROVISION_SECRET`.

`OTP_DEV_EXPOSE_CODE` vive en Ajustes → Sistema → Depuración (`otp_dev_expose_code`).

```http
POST /auth/forgeops/provision-user
Authorization: Bearer <forgeops_provision_secret>
Content-Type: application/json

{
  "email": "dev@cliente.com",
  "name": "Nombre Apellido",
  "role": "developer",
  "loginUrl": "https://theforge.kreoint.mx",
  "resendIfExists": true
}
```

Idempotente por email: usuario nuevo → correo de bienvenida; existente → reenvío de OTP (salvo `resendIfExists: false`). No asigna `super_admin` vía este endpoint.

## Límite de peticiones (rutas públicas)

`AuthRateLimitGuard` (ventana fija en Redis) cubre otp/request, otp/verify, mcp-login, sso/login, register-first-admin y forgeops/provision-user: 20 peticiones/60 s por IP y, si el body trae `email`, 5/10 min por email (10/10 min en `otp/verify`). Al superarlo responde `429` con `Retry-After`. Requiere `trust proxy` (configurado en `main.ts`) y que `AuthModule` importe `AuthSecurityModule`.

- `mcp-login` usa un perfil propio: el servidor MCP sale desde la misma IP interna, así que la cubeta por IP es amplia (600/60 s) y el límite fino es por `sha256(secret)` (20/60 s); el secret nunca se guarda en claro en Redis.
- Tras 5 fallos de OTP el código se descarta y los intentos siguientes responden `Demasiados intentos; solicita un código nuevo` hasta que caduque el OTP o se solicite uno nuevo.
- **Trade-off aceptado:** la cubeta por email (5 `otp/request` / 10 min) permite retrasar el login de una cuenta concreta desde IPs rotadas; a cambio no se puede inundar de OTP a la víctima.
- `TRUST_PROXY` (entero ≥ 0, default 1, validado en `config/env.schema.ts`) define cuántos proxies inversos de confianza hay delante; `req.ip` y el rate limit dependen de él. `REDIS_URL`/`NODE_ENV` los lee `AuthRedisStore` vía `ConfigService`.

## Notas

- Un administrador **no puede** eliminar su cuenta ni bajar su propio rol a `developer` por API (evita lock-out); otro admin debe hacerlo.
- `mcpSecret`: 32 bytes hex (64 chars). Único por usuario, rotable. Si un usuario lo compromete, regenerar invalida el anterior.
- **Passport:** `JwtStrategy` (`passport-jwt`) valida el Bearer; `JwtAuthGuard` global respeta `@Public()`.
- `UserContextInterceptor` + `AsyncLocalStorage` propagan `userId` y `role` por petición (`getRequestUserId`, `getRequestUserRole`).
