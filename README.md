<div align="center">
  <img src="docs/assets/theforge-logo.png" alt="TheForge" width="128" height="128" />
  <h3>TheForge</h3>
  <p>Monorepo NestJS + React (Vite) + Prisma con motor LLM, semáforo MDD y estimación MXN.<br/>Despliegue Dokploy-ready con Docker.</p>
</div>

<div align="center">

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat&colorA=0a0a0a)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-0a0a0a.svg?style=flat&colorA=0a0a0a)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/%E2%9C%88-TypeScript-0a0a0a.svg?style=flat&colorA=0a0a0a)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/%E2%9C%94-PRs%20Welcome-0a0a0a.svg?style=flat&colorA=0a0a0a)](./CONTRIBUTING.md)

</div>

<br/>

> **TheForge** es un motor de estimación y documentación para proyectos de software. Analiza codebases con LLM vía OpenRouter, genera MDD con semáforo de complejidad y produce entregables estructurados — todo en MXN.

<br/>

<div align="center">

**[Arquitectura](./docs/notebooklm/THEFORGE-INDEX.md)** · **[Plugins](./docs/PLUGINS.md)** · **[Blueprint](./blueprint.md)** · **[Changelog](./CHANGELOG.md)** · **[Release v1.0.0](./docs/THE-FORGE-V1-RELEASE.md)** · **[GitHub Release](https://github.com/kreodevs/theforge/releases/tag/v1.0.0)**

</div>

<br/>

---

## Estructura del Monorepo

```
theforge/
├── apps/
│   ├── api/          — NestJS: proyectos, sesiones, AI (OpenRouter), engine
│   └── web/          — React (Vite) + Tailwind
├── packages/
│   ├── database/     — Prisma schema y client
│   ├── shared-types/ — DTOs e interfaces (Zod)
│   └── config/       — TS, ESLint, Tailwind base
└── docker/
```

---

## Desarrollo

Clona el repositorio e instala dependencias:

```bash
git clone https://github.com/kreodevs/theforge.git
cd theforge
corepack enable
pnpm install
```

Activa los githooks (recomendado, una vez):

```bash
pnpm run setup:githooks
```

Activa `prepare-commit-msg` (limpia trailers `Co-authored-by:` de agentes IA) y
`pre-commit` (rebuild automático de `@theforge/shared-types` cuando cambian
`apps/api/**` o `packages/shared-types/**`). Sin el pre-commit, el
`tsc --noEmit` puede emitir falsos positivos `TS2305: has no exported member`
porque las apps leen tipos desde `dist/*.d.ts`. Si lo necesitas a mano:
`pnpm typecheck` (turbo `^build` + `test:types`). Detalle en
[`packages/shared-types/README.md`](./packages/shared-types/README.md).

Configura la base de datos:

```bash
# Renombra .env.example a .env y ajusta DATABASE_URL
pnpm run db:generate
pnpm run db:push
pnpm run dev
```

| Servicio | URL                     |
|----------|-------------------------|
| API      | http://localhost:3000   |
| Web      | http://localhost:5173   |

---

## Docker

| Perfil | Comando |
|--------|---------|
| **Dokploy (prod)** | `docker compose up --build` |
| **Local full-docker** | `pnpm run compose:local` o merge con `docker-compose.local.yml` |
| **Coolify** | Ver [docs/DEPLOY-COOLIFY.md](./docs/DEPLOY-COOLIFY.md) |

Build: 3 imágenes (`api`, `web`, `mcp`); el worker reutiliza la imagen de la API. Ver [docker/README.md](./docker/README.md) para tiempos de deploy en HDD.

Desarrollo nativo: [README-LOCAL.md](./README-LOCAL.md).

Un solo contenedor legacy (Postgres + API + Web): ver `Dockerfile` raíz (no usado por el compose multi-servicio).

---

## Cifrado de tokens BYOK (claves maestras)

TheForge cifra en servidor las **API keys** que los usuarios guardan en Ajustes (BYOK personal) y las que define un `super_admin` en **instancias tenant** (`ProviderInstance`). Eso **no** es el JWT de sesión ni el `mcpSecret`.

| Variable | Rol |
|----------|-----|
| `TOKEN_MASTER_KEYS` | JSON `{ "1": "<base64>", "2": "..." }` — mapa versión → clave AES-256 (32 bytes en base64) |
| `TOKEN_ACTIVE_KEY_VERSION` | Versión usada al **cifrar tokens nuevos** (debe existir en el JSON) |
| `tokenKeyVersion` (en BD) | Versión con la que se **cifró cada fila** (`user_provider_configs`, `provider_instances`) |

Al **descifrar**, el API usa la versión guardada en la fila. Al **cifrar** (guardar o actualizar una clave en la UI), usa `TOKEN_ACTIVE_KEY_VERSION`. Varias versiones pueden coexistir en el mismo entorno.

Implementación: `apps/api/src/modules/crypto/` (AES-256-GCM). Más contexto BYOK: [`multi_provider_spec.md`](./multi_provider_spec.md).

### Generar una clave nueva

```bash
openssl rand -base64 32
```

La salida es una entrada del JSON (p. ej. versión `"1"` en el primer despliegue).

**Primera instalación** (sin filas cifradas en BD):

```env
TOKEN_MASTER_KEYS={"1":"<salida-de-openssl>"}
TOKEN_ACTIVE_KEY_VERSION=1
```

En Dokploy: Environment del servicio **theforge-api** → una línea JSON → redeploy.

### Escenarios al cambiar claves

| Escenario | Qué poner en env | Efecto en tokens ya guardados |
|-----------|------------------|-------------------------------|
| **1. Primera vez** | Solo `"1"`, activa `1` | N/A |
| **2. Rotación correcta** | `"1"` vieja + `"2"` nueva, activa `2`, luego `pnpm run rotate-master-key` | Siguen OK con v1 hasta migrar; tras el script todo en v2 |
| **3. Coexistencia v2 + v3** | `"2"` y `"3"` en JSON, activa `3` | v2 sigue descifrando; nuevos guardados en v3; migración opcional con el script |
| **4. Solo subir versión activa** | Activas `3` pero no existe `"3"` en JSON | **Nuevos** fallan al cifrar; viejos OK si su versión sigue en el JSON |
| **5. Reemplazar valor de la misma versión** | Mismo `"1"`, otro base64 | **Irrrecuperables** — re-ingresar API keys en la UI; o un deploy con `WIPE_BYOK_ON_START=1` (entrypoint) y luego **quitar** la variable |
| **6. Quitar una versión del JSON** | Borras `"2"` sin migrar | Filas con `tokenKeyVersion=2` fallan al usar el proveedor |
| **7. `TOKEN_MASTER_KEYS` vacío** | — | El API **no arranca** |

```text
                    ¿Hay datos cifrados en BD?
                              │
              ┌───────────────┴───────────────┐
              NO                              SÍ
              │                               │
         Definir v1                      ¿Qué quieres?
         y arrancar                           │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
              Añadir vN nueva            Cambiar valor              Borrar vN
              + rotate-master-key          de "N" en env              del env
                    │                         │                         │
              Recomendado                 IRRECUPERABLE              Falla descifrado
              en producción               (re-ingresar keys)         en filas vN
```

### Rotación recomendada (ej. v1 → v2)

1. Genera clave v2: `openssl rand -base64 32`.
2. En Dokploy / `.env`, **mantén** la clave `"1"` actual y añade `"2"`:

   ```env
   TOKEN_MASTER_KEYS={"1":"<clave-actual>","2":"<clave-nueva>"}
   TOKEN_ACTIVE_KEY_VERSION=2
   ```

3. Redeploy del API.
4. Migra la base de datos (misma `DATABASE_URL` que usa prod):

   ```bash
   export DATABASE_URL="postgresql://..."
   export TOKEN_MASTER_KEYS='{"1":"...","2":"..."}'
   export TOKEN_ACTIVE_KEY_VERSION=2
   pnpm run rotate-master-key
   ```

   Salida esperada: líneas por tabla y `total rotated=N`.

5. Prueba un proveedor BYOK / instancia tenant en la UI.
6. Opcional: cuando todo esté en v2, quita `"1"` del JSON y redeploy.

### Ejecutar la rotación

| Dónde | Comando |
|-------|---------|
| Monorepo (local o CI) | `pnpm run rotate-master-key` (requiere `pnpm install` y `pnpm run db:generate`) |
| Contenedor API (Dokploy) | Terminal web del servicio **theforge-api** → `cd /app && pnpm run rotate-master-key` |

El contenedor ya incluye `scripts/rotate-master-key.ts` y hereda `DATABASE_URL`, `TOKEN_MASTER_KEYS` y `TOKEN_ACTIVE_KEY_VERSION` del entorno de Dokploy. **No sustituyas** el entrypoint del API por `node dist/main.js` solo (ver [`apps/api/README.md`](./apps/api/README.md)).

**Sin SSH al VPS:** usa la terminal web de Dokploy en el contenedor del API, o ejecuta el script desde tu máquina si `DATABASE_URL` apunta a Postgres (túnel o puerto expuesto temporalmente con firewall).

**Importante:** el script debe ver en `TOKEN_MASTER_KEYS` **todas** las versiones que existen en BD (p. ej. si hay filas en v2 y activas v3, el JSON necesita `"2"` y `"3"`).

### Preguntas frecuentes

**¿Tokens en v2 y activa v3 siguen funcionando?**  
Sí, si `"2"` sigue en `TOKEN_MASTER_KEYS`. Solo los **nuevos** guardados usan v3.

**¿Puedo tener v1, v2 y v3 a la vez en env?**  
Sí. Quita una versión solo cuando ninguna fila la use o tras migrar con `rotate-master-key`.

**¿Qué tablas migra el script?**  
`user_provider_configs` y `provider_instances`.

---

## Variables de Entorno

<details>
<summary><b>Core</b></summary>

| Variable | Default | Qué hace |
|---|---|---|
| `NODE_ENV` | `development` | Modo Node/Nest |
| `PORT` | `3000` | Puerto HTTP del API |
| `DATABASE_URL` | — | PostgreSQL (Prisma) |
| `JWT_SECRET` | — | **Obligatorio en prod.** Firma JWT |
| `JWT_EXPIRES_IN` | `7d` | Caducidad del token |
| `CORS_ORIGINS` | — | Orígenes CORS permitidos |

</details>

<details>
<summary><b>OpenRouter / LLM</b></summary>

| Variable | Default | Qué hace |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Clave principal |
| `OPENROUTER_CHAT_MODEL` | `nousresearch/hermes-3-llama-3.1-405b` | Modelo de chat |
| `OPENROUTER_CHAT_MODEL_FALLBACK` / `OPENROUTER_CHAT_MODEL_FALLBACKS` | — | Modelo(s) de respaldo (opcional; sin definir = un solo modelo) |
| `OPENROUTER_CHAT_FALLBACK_ON_429` | `1` (si hay fallbacks) | `0` desactiva pasar al siguiente modelo tras 429 |
| `OPENROUTER_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Modelo de embeddings |
| `TAVILY_API_KEY` | — | Búsqueda web Scout (opcional) |

En producción con **BYOK**, los modelos activos se configuran en **Ajustes → Proveedores → instancia activa** (OpenRouter). Las variables `OPENROUTER_*` anteriores son fallback de plataforma / desarrollo.

#### Generación de Tasks — qué modelo usa cada fase

| Fase | Campo en Ajustes | Rol |
|------|------------------|-----|
| Redactor (`tasks.md`) | **Modelo de chat** | Markdown YAML en lotes (~24 ítems del plan) |
| Planner (plan JSON) | **Modelo auditor / planner** (vacío = chat) | JSON estricto, cobertura API/pantallas |
| Auditor LLM (umbral 92) | **Modelo auditor / planner** | Puntúa calidad |
| Reparación parche | **Modelo auditor / planner** | 1 llamada si solo falla el auditor |
| Reparación regen | **Modelo de chat** | Regenera todos los lotes (más lento) |

**Regla:** en proyectos HIGH, separa **chat** (redactor) y **auditor/planner**. Si auditor/planner está vacío, el mismo modelo genera y se audita a sí mismo.

#### Combos OpenRouter recomendados (Tasks)

Verifica slugs en [openrouter.ai/models](https://openrouter.ai/models). Guía ampliada: [`docs/TASKS-OPENROUTER-MODELS.md`](./docs/TASKS-OPENROUTER-MODELS.md).

**Económico** (~25–45 min en ~90 ítems)

| Campo | Modelo |
|-------|--------|
| Chat (redactor) | `google/gemini-2.5-flash-preview` o `openai/gpt-4o-mini` |
| Auditor / planner | `openai/gpt-4o-mini` o `anthropic/claude-3.5-haiku` |
| Respaldo | `google/gemma-3-27b-it:nitro` |

**Equilibrado** (~15–30 min; recomendado proyectos HIGH / ForgeOps)

| Campo | Modelo |
|-------|--------|
| Chat (redactor) | `anthropic/claude-sonnet-4` o `openai/gpt-4o` |
| Auditor / planner | `openai/gpt-4o-mini` o `google/gemini-2.5-flash-preview` |
| Respaldo | `google/gemma-3-27b-it:nitro` |

**Máxima calidad** (~20–40 min; menos ciclos de repair)

| Campo | Modelo |
|-------|--------|
| Chat (redactor) | `anthropic/claude-sonnet-4` o `google/gemini-2.5-pro-preview` |
| Auditor / planner | `openai/gpt-4o` o `anthropic/claude-sonnet-4` |
| Respaldo | `openai/gpt-4o-mini` |

Tuning opcional del pipeline (API / Dokploy):

| Variable | Default | Efecto |
|----------|---------|--------|
| `TASKS_REDACTOR_BATCH_SIZE` | `24` | Ítems por lote → menos llamadas LLM |
| `TASKS_REDACTOR_CONCURRENCY` | `2` | Lotes en paralelo (máx. 4) |
| `TASKS_PIPELINE_MAX_REPAIRS` | `2` | Reparaciones si el doc no está truncado |
| `TASKS_PIPELINE_MAX_REPAIRS_TRUNCATED` | `3` | Reparaciones si hubo truncado |
| `TASKS_REPAIR_STAGNANT_DELTA` | `3` | Corta repairs si el score LLM no mejora |

</details>

<details>
<summary><b>BYOK — TOKEN_MASTER_KEYS y rotación</b></summary>

| Variable | Default | Qué hace |
|---|---|---|
| `TOKEN_MASTER_KEYS` | — | **Obligatorio.** JSON versión → clave 32 bytes base64 |
| `TOKEN_ACTIVE_KEY_VERSION` | `1` | Versión al cifrar tokens nuevos |

Guía completa: sección [Cifrado de tokens BYOK](#cifrado-de-tokens-byok-claves-maestras). Rotación: `pnpm run rotate-master-key`.

</details>

<details>
<summary><b>MCP AriadneSpecs, Cache, FalkorDB, Deliverables y más</b></summary>

Ver referencia completa en [`.env.example`](./.env.example).

</details>

---

## Documentación

- [Guía de plugins](./docs/PLUGINS.md) — Crear, instalar y distribuir plugins
- [Arquitectura de plugins](./docs/ARCHITECTURE_PLUGINS.md) — Contratos técnicos del framework de plugins
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Guía de contribución, PRs y tests
- [docs/JSDOC.md](./docs/JSDOC.md) — Convenciones de documentación
- [Índice de arquitectura](./docs/notebooklm/THEFORGE-INDEX.md)
- [Tasks — modelos OpenRouter y tiempo de generación](./docs/TASKS-OPENROUTER-MODELS.md)
- [Blueprint](./blueprint.md) · [MDD](./mdd.md)
- [Multi-proveedor BYOK](./multi_provider_spec.md) · [Rotación de claves](#cifrado-de-tokens-byok-claves-maestras)

---

## Cross-Project Table References

El **Software Architect** puede importar tablas SQL de otro proyecto de TheForge durante la generación del MDD usando la tool `get_project_tables`.

### Cómo usarlo

En el chat del MDD (o en el BRD), incluye la instrucción:

> Usa `get_project_tables('PROJECT_ID', ['tabla1', 'tabla2'])` para importar las definiciones de tablas compartidas.

**Parámetros:**

| Parámetro | Requerido | Descripción |
|-----------|-----------|-------------|
| `projectId` | ✅ | ID del proyecto de referencia (UUID de TheForge) |
| `tableNames` | ❌ | Lista opcional de nombres de tablas a importar. Si se omite, importa todas. |

### Ejemplo

En el BRD escribes:

```markdown
## Integraciones

El sistema de suscripciones necesita las tablas compartidas del proyecto "Gestión de Usuarios".
Usa `get_project_tables('abc123', ['usuarios', 'pagos', 'suscripciones'])` para traer las definiciones.
```

El Software Architect invoca la tool y las tablas aparecen en §3 (Modelo de Datos) del nuevo proyecto.

### Mecanismo

1. El SA detecta la instrucción y llama `get_project_tables(projectId, tableNames?)`
2. La tool obtiene el MDD del proyecto de referencia desde la API
3. Extrae las sentencias `CREATE TABLE` de §3 del proyecto origen
4. Filtra por `tableNames` si se especificaron
5. Devuelve el SQL listo para integrar en §3 del proyecto nuevo

Ver CHANGELOG v0.5.0.

### Converge webhook (brownfield CI)

`POST /projects/:id/converge/trigger` ejecuta converge y, opcionalmente, envía el resultado a un webhook HTTP.

| Prioridad | URL usada |
|-----------|-----------|
| 1 | `webhookUrl` en el body del request |
| 2 | `Project.convergeWebhookUrl` (editable en Workshop → panel Integración) |
| 3 | Variable de entorno `CONVERGE_WEBHOOK_URL` |

Opcional: `Project.convergeWebhookSecret` firma el payload con HMAC-SHA256 en la cabecera `X-TheForge-Signature: sha256=<hex>`.

---

## Contribución

- Reporta bugs o propone features en [Issues](https://github.com/kreodevs/theforge/issues)
- Abre un PR siguiendo la guía en [CONTRIBUTING.md](./CONTRIBUTING.md)
- Comparte el proyecto si te ha sido útil

## Gracias a todos los colaboradores ❤

[![Contributors](https://contrib.rocks/image?repo=kreodevs/theforge)](https://github.com/kreodevs/theforge/graphs/contributors)

---

**Licencia:** [Apache License 2.0](./LICENSE) · **Aviso:** [NOTICE](./NOTICE) · **Autores:** [AUTHORS.md](./AUTHORS.md)