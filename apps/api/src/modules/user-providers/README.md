# User Providers

Gestión de proveedores LLM por instancia de tenant y configuración BYOK personal. Cada usuario/tenant puede tener múltiples instancias de proveedores con modelos específicos para cada rol (chat, auditor, embeddings, visión, STT).

## Conceptos

- **Provider Instance** — instancia compartida de tenant (`ProviderInstance`): OpenAI, Anthropic, Gemini, etc. Configurable por admin con API key, modelos por rol, y visibilidad para usuarios.
- **BYOK Config** — configuración personal del usuario (`UserProviderConfig`): API key propia + modelo de chat.
- **User AI Settings** — preferencias del usuario: cuál instancia usar, si habilitar embeddings, etc.

## Resolución de runtime

1. `activeTenantInstanceId` del usuario (instancia marcada como "Activa")
2. Instancia `isTenantDefault` del equipo
3. Primera instancia `enabledForUsers` alfabéticamente
4. Fallback: BYOK personal del usuario (`activeProvider`)

## Capa

- **`user-providers.service.ts`** — resolución de runtime, settings CRUD, catálogo.
- **`provider-instances.service.ts`** — CRUD de instancias de tenant.
- **`provider-config.helpers.ts`** — builders de base URL, Cloudflare account ID, etc.
- **`user-providers.controller.ts`** — endpoints de settings y configs personales.
- **`provider-instances.controller.ts`** — admin CRUD de instancias.