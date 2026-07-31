# auth

Auth multi-usuario con OTP por email + JWT. Cada `User` tiene su propio `mcpSecret` (API key M2M).

## Endpoints

### Públicos (`@Public()`)

- **`POST /auth/otp/request`** — body `{ email }` (requerido). Si el email **existe** en la tabla `User`, genera un OTP de 6 dígitos y lo envía por SMTP (o lo loguea en dev). Si no existe, devuelve `{ ok: true }` igualmente (anti-enumeración). Throttle: 1 envío por minuto por email.
- **`POST /auth/otp/verify`** — body `{ email, code }`. Valida el OTP contra el email, busca el `User`, asegura `mcpSecret` y emite JWT (`sub` = `User.id`, `email`, `role`).
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
- **`POST /users`** — body `{ email, name?, role? }`. Crea usuario y genera `mcpSecret`.
- **`PATCH /users/:id`** — body `{ email?, name? }` (al menos uno). Actualiza el nombre y/o el correo. El email se normaliza (trim + lowercase) y debe ser único (`400` si ya existe). Devuelve `{ id, email, role, name }`.
- **`PATCH /users/:id/role`** — body `{ role }` (`super_admin` | `admin` | `developer`). Cualquier `admin` o `super_admin` puede asignar o quitar `super_admin`. No permite degradarse a sí mismo a `developer` (`403`).
- **`DELETE /users/:id`** — elimina usuario (cascada sobre projects/sessions). No permite borrar la propia cuenta (`403`).
- **`GET /users/:id/mcp-secret`** — ver `mcpSecret` de cualquier usuario.
- **`POST /users/:id/mcp-secret/regenerate`** — rotar `mcpSecret` de cualquier usuario.

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

## Notas

- Un administrador **no puede** eliminar su cuenta ni bajar su propio rol a `developer` por API (evita lock-out); otro admin debe hacerlo.
- `mcpSecret`: 32 bytes hex (64 chars). Único por usuario, rotable. Si un usuario lo compromete, regenerar invalida el anterior.
- **Passport:** `JwtStrategy` (`passport-jwt`) valida el Bearer; `JwtAuthGuard` global respeta `@Public()`.
- `UserContextInterceptor` + `AsyncLocalStorage` propagan `userId` y `role` por petición (`getRequestUserId`, `getRequestUserRole`).
