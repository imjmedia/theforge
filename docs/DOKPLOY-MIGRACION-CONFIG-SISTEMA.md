# Migración Dokploy — configuración de plataforma (v1.3.0+)

Guía operativa para pasar tunables de **Environment** en Dokploy a **Ajustes → Sistema** (`AppConfig`), dejando en env solo bootstrap e infraestructura.

Relacionado: [`apps/api/src/modules/system-config/README.md`](../apps/api/src/modules/system-config/README.md), [`.env.example`](../.env.example).

---

## Resumen

| Antes (v1.2.x) | Después (v1.3.0+) |
|----------------|-------------------|
| Decenas de variables en Dokploy por servicio | Env mínimo + UI **Ajustes → Sistema** |
| Cambio = editar env + redeploy | Cambio = guardar en UI (efecto inmediato en API) |
| Sin historial centralizado | Valores en tabla `AppConfig` (PostgreSQL) |

**Prioridad runtime:** valor en BD (UI) → variable env (override legacy) → default del catálogo.

---

## Qué **no** quitar de Dokploy (obligatorio / bootstrap)

Estas variables **siguen en env**; no están en la pantalla Sistema (o no deben moverse por seguridad):

### Servicio `theforge-api` y `theforge-worker`

| Variable | Motivo |
|----------|--------|
| `NODE_ENV` | Modo Node |
| `DATABASE_URL` | Prisma / PostgreSQL |
| `REDIS_URL` | BullMQ (obligatorio en production) |
| `THEFORGE_RUNTIME_ROLE` | `http` (API) o `worker` (worker) |
| `PORT` | Puerto HTTP (solo API) |
| `CORS_ORIGINS` | CORS producción |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Auth |
| `TOKEN_MASTER_KEYS`, `TOKEN_ACTIVE_KEY_VERSION` | Cifrado en servidor de tokens guardados en UI (no es configuración de proveedor) |
| `MCP_M2M_SECRET` | Auth MCP ↔ API (header por cliente; opcional en env) |
| `FALKORDB_URL` / `FALKORDB_SDD_URL` | Grafo SDD (si aplica) |

**Migrar a Ajustes → Sistema → Correo y acceso:** `WEB_DOMAIN`, `SMTP_*`, `FORGEOPS_PROVISION_SECRET` (prioridad UI > env).

### Servicio `theforge-mcp` (`packages/mcp-server`)

| Variable | Motivo |
|----------|--------|
| `MCP_M2M_SECRET` | Mismo secreto que la API |
| `THEFORGE_API_URL` | URL interna del API (`http://theforge-api:3000`) |
| `MCP_AUTH_TOKEN` / `MCP_X_M2M_TOKEN` | Si el MCP exige auth hacia Ariadne (opcional) |

### Build `theforge-web`

| Variable | Motivo |
|----------|--------|
| `VITE_API_URL` | Base API en build (típ. `/api` con Traefik) |

### Transitorias (solo cuando aplique)

| Variable | Motivo |
|----------|--------|
| `PRISMA_RESOLVE_ROLLED_BACK` | Desbloqueo migración Prisma |
| `WIPE_BYOK_ON_START` | Rotación de `TOKEN_MASTER_KEYS` perdida (quitar tras un deploy) |

---

## Qué **sí** migrar a Ajustes → Sistema

Tras desplegar **v1.3.0**, copia estos valores desde Dokploy a la UI **antes** de borrarlos del env (si no, caerás al default del catálogo).

### Orden recomendado en la UI

1. **Integraciones** — sin esto fallan legacy/MCP  
   - `THEFORGE_MCP_URL` → *TheForge MCP — URL*  
   - `TAVILY_API_KEY` → Scout web (opcional)  
   - Brownfield: `ARIADNE_BROWNFIELD_CONVERGE_*`

2. **MCP y caché** — timeouts y caché de contexto  
   - `THEFORGE_MCP_TIMEOUT_MS`, `THEFORGE_MCP_ASK_CODEBASE_TIMEOUT_MS`  
   - `TECH_DOCS_MCP_*` (URL default Context7, timeout, max librerías)  
   - `THEFORGE_LIST_PROJECTS_CACHE_MS`, `THEFORGE_CONTEXT_*`

3. **LLM y LangGraph** — throughput y límites de plataforma  
   - `LLM_MAX_TOKENS`, `LANGGRAPH_RECURSION_LIMIT`  
   - `AGENT_EVALUATOR_LEGACY`  
   - Modelos, embeddings y fallback 429 → **Ajustes → Proveedores** (no env ni Sistema)

4. **Colas BullMQ** — **requieren reinicio del worker** tras guardar  
   - `MDD_BULLMQ_CONCURRENCY`  
   - `DELIVERABLES_BULLMQ_CONCURRENCY`  
   - `LEGACY_DELIVERABLES_BULLMQ_CONCURRENCY`

5. **Legacy / brownfield** — flags de pipeline (solo si los tenías custom en env)  
   - `LEGACY_EVIDENCE_FIRST_CONTEXT`, `LEGACY_ANALYZER_*`, `LEGACY_SDD_INDEX_GATE`, etc.  
   - `LEGACY_DELIVERABLES_SECTION_MERGE`, `MDD_PROPOSED_COMPONENT_DIAGRAM`

6. **Depuración** — dejar en `0` en prod salvo incidente  
   - `DEBUG_MCP`, `DEBUG_MDD_SECTION3`, `DEBUG_MCP_MAX_*`  
   - `OTP_DEV_EXPOSE_CODE` → **nunca** `1` en producción

> **Ariadne por usuario:** URL/token MCP de Ariadne siguen en **Ajustes → Ariadne** (por usuario/admin), no en Sistema. La URL global `THEFORGE_MCP_URL` es la de plataforma.

---

## Lista completa de env migrables (catálogo v1.3.0)

Puedes **eliminar** estas claves de Dokploy (`theforge-api` / `theforge-worker`) una vez guardadas en UI:

```
THEFORGE_MCP_URL
TECH_DOCS_MCP_DEFAULT_URL
TAVILY_API_KEY
ARIADNE_BROWNFIELD_CONVERGE_AUTO
ARIADNE_BROWNFIELD_CONVERGE_MODE
ARIADNE_BROWNFIELD_CONVERGE_PERSIST
LLM_MAX_TOKENS
LANGGRAPH_RECURSION_LIMIT
AGENT_EVALUATOR_LEGACY
MDD_BULLMQ_CONCURRENCY
DELIVERABLES_BULLMQ_CONCURRENCY
LEGACY_DELIVERABLES_BULLMQ_CONCURRENCY
THEFORGE_MCP_TIMEOUT_MS
THEFORGE_MCP_ASK_CODEBASE_TIMEOUT_MS
TECH_DOCS_MCP_TIMEOUT_MS
TECH_DOCS_MCP_MAX_LIBRARIES
THEFORGE_LIST_PROJECTS_CACHE_MS
THEFORGE_CONTEXT_CACHE
THEFORGE_CONTEXT_CACHE_TTL_MS
THEFORGE_CONTEXT_CACHE_MAX_ENTRIES
THEFORGE_CONTEXT_REVISION
THEFORGE_CONTEXT_PREPEND_MAX_CHARS
MDD_PROPOSED_COMPONENT_DIAGRAM
LEGACY_EVIDENCE_FIRST_CONTEXT
LEGACY_ANALYZER_COMPACT
LEGACY_ANALYZER_REQUIRE_GRAPH_HITS
LEGACY_SDD_INDEX_GATE
LEGACY_MDD_COMPONENT_DIAGRAM
LEGACY_DELIVERABLES_SECTION_MERGE
DEBUG_MCP
DEBUG_MDD_SECTION3
DEBUG_MCP_MAX_REQUEST_CHARS
DEBUG_MCP_MAX_RESPONSE_CHARS
OTP_DEV_EXPOSE_CODE
```

---

## Qué **sigue** solo en env (fuera del catálogo UI v1.3.0)

No borres estas si las usas; la pantalla Sistema **no** las gestiona aún:

- **`LEGACY_*`** restantes (topes de evidencia, entregables, rollup, etc.) — ver [`LEGACY-EVIDENCE-CONTEXT.md`](notebooklm/LEGACY-EVIDENCE-CONTEXT.md)
- **`ARIADNE_INGEST_URL`**, **`THEFORGE_SERVICE_JWT`**
- **`ARIADNE_MCP_URL`** — alias legacy; preferir `THEFORGE_MCP_URL` en UI
- **`MCP_AUTH_TOKEN`**, **`MCP_X_M2M_TOKEN`** — auth hacia MCP externo
- **`LLM_DEBUG`** — trazas LLM en consola

> **Proveedores IA (claves, modelos, embeddings, fallbacks):** solo **Ajustes → Proveedores** — nunca en env ni en Sistema.

---

## Checklist paso a paso (Dokploy)

### Fase 0 — Pre-requisitos

- [ ] Merge/despliegue de **v1.3.0** (PR #466 o tag equivalente)
- [ ] Usuario con rol **`super_admin`** (Setup inicial o `PATCH /users/:id/role`)
- [ ] Backup del bloque **Environment** actual de `theforge-api` y `theforge-worker` (copiar/pegar a un archivo local)

### Fase 1 — Copiar valores a la UI (sin borrar env aún)

- [ ] Login → **Ajustes → Sistema**
- [ ] Por cada variable migrable que tengas en Dokploy, pegar el mismo valor en el campo correspondiente
- [ ] **Guardar** y comprobar badge **«Guardado»** (origen BD)
- [ ] Probar integración crítica: proyecto legacy + MCP (doc. partida, job MDD)

### Fase 2 — Limpiar env en Dokploy

- [ ] En **theforge-api**: quitar variables de la [lista migrable](#lista-completa-de-env-migrables-catálogo-v130)
- [ ] En **theforge-worker**: quitar las mismas que aplique (sobre todo BullMQ y MCP timeouts si las duplicaste)
- [ ] **No** tocar bootstrap ([tabla obligatoria](#qué-no-quitar-de-dokploy-obligatorio--bootstrap))
- [ ] Redeploy API (+ worker si cambiaste concurrencia BullMQ)

### Fase 3 — Verificación post-migración

- [ ] API arranca sin error (`REDIS_URL`, `JWT_SECRET`, `TOKEN_MASTER_KEYS` presentes)
- [ ] `GET /admin/system-config` (como super_admin) refleja valores esperados
- [ ] Job MDD en cola completa (worker vivo con `THEFORGE_RUNTIME_ROLE=worker`)
- [ ] Legacy: `THEFORGE_MCP_URL` resuelve desde BD (brownfield / doc. partida)
- [ ] Opcional: quitar override env de una clave y confirmar que gana el valor UI

### Fase 4 — Rollback rápido

Si algo falla tras borrar env:

1. Restaurar el backup de Environment en Dokploy  
2. Redeploy  
3. Opcional: en UI, vaciar claves conflictivas (PATCH con `null`) para que gane env de nuevo  

---

## Servicios Dokploy (referencia rápida)

| Servicio | Rol | Env mínimo + notas |
|----------|-----|-------------------|
| **theforge-api** | `THEFORGE_RUNTIME_ROLE=http` | Bootstrap + tunables en UI |
| **theforge-worker** | `THEFORGE_RUNTIME_ROLE=worker` | Mismo `DATABASE_URL`, `REDIS_URL`, cifrado `TOKEN_MASTER_KEYS`; reiniciar tras cambiar concurrencia en UI |
| **theforge-mcp** | MCP server | `MCP_M2M_SECRET`, `THEFORGE_API_URL` |
| **theforge-web** | Estáticos | Build con `VITE_API_URL`; sin tunables de plataforma |

---

## Notas

- **Compose local:** `docker-compose.yml` puede seguir pasando `${MDD_BULLMQ_CONCURRENCY:-2}` etc.; en dev el env gana si no hay valor en BD. Para alinear con prod, usa la UI o deja env vacío y confía en defaults.
- **Secretos:** Tavily se enmascara en GET; al editar otros campos no hace falta reescribir el secreto.
- **Documentación viva:** catálogo fuente en `packages/shared-types/src/system-config.ts`.
