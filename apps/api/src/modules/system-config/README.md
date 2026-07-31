# system-config

Configuración de plataforma persistida en `AppConfig` y editable desde **Ajustes → Sistema** (solo `super_admin`).

## API

| Método | Ruta | Rol |
|--------|------|-----|
| `GET` | `/admin/system-config` | `super_admin` |
| `GET` | `/admin/system-config/reveal/:key` | `super_admin` — valor efectivo de un campo `secret` (p. ej. copiar token ForgeOps) |
| `PATCH` | `/admin/system-config` | `super_admin` |

Prioridad en runtime: **BD → env → default** (`platform-config.runtime.ts`).

Catálogo allowlist y textos de ayuda (por categoría y por campo): `packages/shared-types/src/system-config.ts` (`SYSTEM_CONFIG_CATEGORIES`, `SYSTEM_CONFIG_DEFINITIONS`).

Categoría **`auth` (Correo y acceso):** SMTP, `web_domain`, `forgeops_provision_secret` — consumidos por `AuthService` vía `platform-config.runtime`.

**Fuera de alcance:** claves API, modelos, embeddings y fallbacks de chat → **Ajustes → Proveedores** (BYOK/tenant).

**Migración Dokploy (v1.3.0+):** [`docs/DOKPLOY-MIGRACION-CONFIG-SISTEMA.md`](../../../docs/DOKPLOY-MIGRACION-CONFIG-SISTEMA.md)

## Archivos

- `system-config.service.ts` — CRUD allowlist + recarga de overrides en memoria.
- `system-config.controller.ts` — REST admin.
- `platform-config.runtime.ts` — resolución síncrona para el resto del API.
