# Auditoría global de The Forge — 2026-11-02

Rama `master`, commit `bfb3b21f`, árbol limpio. Solo lectura: no se modificó código. Seis pasadas en paralelo (QA, harness IA, backend NestJS, frontend React, arquitectura del monorepo, seguridad app+secretos+infra). Los hallazgos de severidad crítica y alta se verificaron a mano contra el código antes de incluirlos; los reproducibles se reprodujeron. El reporte de seguridad completo (25 hallazgos nuevos, ID-101..ID-125) está en [`docs/seguridad/auditoria-2026-11-02-app-infra.md`](../seguridad/auditoria-2026-11-02-app-infra.md); el de dependencias y Mermaid en [`auditoria-2026-11-02.md`](../seguridad/auditoria-2026-11-02.md).

## 1. Estado real de las verificaciones (QA)

| Verificación | Resultado |
|---|---|
| Typecheck api, web, shared-types | VERDE |
| Tests api | VERDE · 4278 pass / 0 fail / 1 skip (292 specs) |
| Tests web | VERDE · 262 / 262 (36 specs) |
| Tests shared-types | VERDE · 659 / 659 (71 specs) |
| Tests mcp-server | VERDE · 24 / 24 |
| Tests business-rules | ROJO · `mdd-ia-cost-reference.spec.ts` importa `vitest` (no instalado) |
| Lint api y web | ROJO · no existe `eslint.config.*` en ninguno de los dos; ESLint no arranca. El único config (`packages/config/eslint.config.mjs`) no lo consume nadie |
| Build web y api | VERDE · 6 chunks web > 500 kB (entrada 1,59 MB; `subset-shared` 1,8 MB) |
| `pnpm audit --prod` | 2 críticos, 58 altos, 86 moderados, 23 bajos |

CI (`.github/workflows/ci.yml`) no corre typecheck ni lint, y de las specs corre 7/71 de shared-types, 7/292 de la API y ninguna de mcp-server ni business-rules. Un push a `master` despliega solo en Dokploy (`docker-compose.yml:13`).

## 2. Fortalezas (proteger)

- **Aborto real hasta el LLM.** La señal viaja por AsyncLocalStorage, el backoff es cancelable y un aborto no se reintenta (`utils/mdd-llm-stream-invoke.util.ts`, `mdd-llm-retry.util.ts`). Timeout de inactividad más tope duro en streaming.
- **Bucle del gate de entrega acotado** por tope, fingerprint repetido y target sin blockers (`mdd-delivery-gate-loop.util.ts`). Caché por nodo que no guarda vacíos ni fallos.
- **Chat MDD por cola robusto** en ambos extremos: tombstones `noop` que no mueven cursores, evento terminal garantizado y `onIdle` sintético en la API; cursor persistido, backoff acotado y `AbortController` en la web.
- **Lease por hilo en Lua** (compare-and-delete, renovación, reentrancia por ALS) y purga de checkpoints transaccional bajo advisory lock.
- **Contrato del oráculo Mermaid** que distingue `unavailable` de `invalid`, con tope y `AbortSignal`; spec de corpus con 267 diagramas en CI y la regla "original válido no se toca".
- **Una sola semántica de fences dentro de la API** (`fence-scan.util.ts`) usada por rúbrica, gate y persistencia.
- **BYOK bien cifrado**: AES-256-GCM, IV aleatorio, versión de clave por fila, fail-fast sin `TOKEN_MASTER_KEYS`, rotación reejecutable.
- **Guard JWT global** con `@Public()` solo en health y auth; secreto ForgeOps con `timingSafeEqual`; sin SQL crudo; `child_process` solo con argumentos fijos.
- **API y worker separados** con la misma imagen (`THEFORGE_RUNTIME_ROLE`), recuperación de jobs huérfanos respetando locks, `UnrecoverableError` y reintentos acotados.
- **Monorepo sano en lo macro**: dependencias apps→packages sin ciclos entre paquetes, una sola versión de zod/prisma/nestjs/mermaid, 26/26 módulos Nest con README, `business-rules` como fuente única de costos.
- **Refactor de god files cumplido en su mayoría** (`WorkshopView` 5917→2829, `workshopStore` 5319→55, `mdd-sanitize` 6065→144, `projects.service` 3809→483).
- **Frontend**: guardas de proyecto contra respuestas viejas en `fetchProject`, `fetchGenerationStatus` y chat genérico; autosave que no pisa ediciones en curso; `MddViewer` memoizado por sección; `MddEvalPanel` con abort y `requireAdmin()` en sus 8 endpoints.

## 3. Bugs verificados — críticos y altos

Todos comprobados a mano en el código (los marcados «repro» se ejecutaron).

### Producto: calidad del MDD

| ID | Sev. | Dónde | Qué pasa |
|---|---|---|---|
| H1 | crítica (repro) | `packages/shared-types/src/mermaid.ts:2628-2664`, aplicado en `:2711`; corre en cada persist (`persist-pipeline.ts:386`) | `looksLikeJsonFlattenFlowchart` dispara con cualquier `flowchart TD` válido que tenga ≥8 nodos `sN(...)` y **sustituye el diagrama por un webhook inventado** ("Recibir evento… tenant"). Un flujo de citas de 8 pasos sale como webhook genérico. No pasa por el parser: contradice la regla de oro de la Fase 1. |
| H2 | alta | `utils/mdd-auditor-gaps.util.ts:75`, `nodes/mdd-auditor.node.ts:147-170` | Si el Auditor LLM falla o devuelve JSON inválido con las 7 secciones presentes, `score = 0`, `RECHAZADO`, `auditorRan: true`. Con secciones faltantes da 50-65: escala invertida. El panel y el eval lo cuentan como nota real. |
| H3 | alta | `graph/mdd-graph.ts:608-609`, `state/mdd-state.annotation.ts:12-26` | En el grafo one-shot (Regenerar MDD y el eval) `cross_consistency_checker` y `diagram_injector` corren en paralelo sobre el mismo borrador y el reductor se queda con la última escritura: se pierde el parche de consistencia o el ER inyectado. La Cirugía III solo lo corrigió en el grafo con Manager. La tercera corrida del eval mide un pipeline con esta pérdida. |
| H4 | alta | `mdd/mdd-queue.service.ts:1036`; igual en `deliverables-queue.service.ts:933`, `legacy-deliverables-queue.service.ts:240` | Un job que falla con `UnrecoverableError` queda con `attemptsMade < attempts` y se reporta `retrying`. La web sondea hasta 6-24 h y el admin muestra "Reintentando" ante un fallo definitivo. |
| H5 | alta | `checkpoint/thread-run-lock.service.ts:98,138-143,162` | Primer `acquire` tras arrancar (o tras caída de Redis): `enableOfflineQueue:false` + `SET` antes de `ready` → ioredis rechaza y se cae a un Map en proceso. El lock **falla abierto** entre API y worker. |
| H6 | media | `ai-analysis.service.ts:675-679` | Si el suelo anti-wipe rechaza el `done`, `persist()` devuelve `false` y se ignora: la web marca `synced` y el turno se pierde en silencio. |

### Aislamiento entre usuarios y autenticación (backend + seguridad)

| ID | Sev. | Dónde | Qué pasa |
|---|---|---|---|
| S1 | crítica | `apps/api/docker-entrypoint.sh:100-102`, `docker-compose.yml:84,162` | Sin `JWT_SECRET` en Dokploy la API arranca con un literal del repo (solo WARN). Anula el guard de `auth.module.ts`, y `jwt.strategy.ts:26` confía en el rol del token: cualquiera que lea el repo firma un `super_admin`. |
| S2 | crítica | `docker-compose.yml:251-255` + dominio en Dokploy | Adminer en `dokploy-network` con dominio público; contraseña de Postgres literal en el compose; en la BD los `mcpSecret` están en claro. |
| S3 | crítica | `projects.controller.ts:213,261`; `ai-analysis.controller.ts:512` | Jobs BullMQ con IDs secuenciales; `GET /projects/jobs/:jobId` y `mdd/jobs/:jobId` devuelven estado, `result`, `failedReason` y `projectId` sin comprobar dueño; `DELETE /projects/jobs/:jobId` cancela jobs ajenos. |
| S4 | crítica | `documentation-gap.service.ts:679` (`assertStageAccess` solo mira `stage.projectId`) | `approve` de un gap en un proyecto PRIVATE ajeno encola una reconciliación LLM que reescribe documentos de la víctima. |
| S5 | alta | `ai-analysis.controller.ts` (0 usos de `loadAccessibleProjectWithStages`), `ai-analysis.service.ts:451-461` | Cualquier usuario encola o streamea MDD sobre un proyecto ajeno **con las credenciales LLM del dueño** y sobrescribe su MDD. |
| S6 | alta | `change-log.service.ts:39`, `agent-session-log.service.ts:35`, `plugins.controller.ts:177,192`, `ui-screens.service.ts:44`, `plan-validation.service.ts:36,99`, `legacy-coordinator.service.ts:231`, `legacy-transition.service.ts:46` | IDOR de lectura/escritura: change-log, logs de agentes, `pluginData`, `uiScreensContent`, validación de planes, estado legacy por `stageId` sin atar al proyecto, stage "Baseline" en proyecto ajeno. No existe un guard común. |
| S7 | alta | `auth/auth.service.ts:914,1035` | `updateUserRole` no compara el rol del actor: un `admin` se asciende a `super_admin`, crea super_admins o lee el `mcpSecret` de uno. |
| S8 | alta | `auth/auth.service.ts:601`; no hay `ThrottlerModule` | OTP de 6 dígitos, 10 min, sin contador de intentos ni rate limiting. |
| S9 | alta | `jwt.strategy.ts:26` | El JWT (7 días) no se revoca ni relee el usuario: un usuario borrado o degradado sigue operando con el rol viejo. |
| S10 | alta | `admin/admin.controller.ts:7`; `sdd-integration.service.ts:1033`; scraper con `redirect: follow` | SSRF: `POST /admin/ariadne-config/test` sin `requireAdmin` devuelve 200 caracteres de la respuesta; URLs de Ariadne/Context7/`baseUrl`/webhook configurables por usuario; la API está en `dokploy-network`. |
| S11 | alta | `auth/auth.service.ts:56,545` | `otp_dev_expose_code` sin guarda de producción: activado, `/auth/otp/request` devuelve el código de cualquier email. |
| S12 | alta | `packages/mcp-server/src/mcp-api-client.ts:6-8` | El servidor MCP guarda **un único JWT global**: con peticiones concurrentes un usuario actúa con el token de otro (incluye `delete_project` y `merge_projects`). |
| S13 | alta | plugins (`PLUGINS_REQUIRE_SIGNATURE` apagado por defecto) | Un `admin` instala plugins sin firma que corren dentro de la API (root, ve `TOKEN_MASTER_KEYS`) y cuyo bundle UI corre en el navegador de todos. |
| S14 | media | historial git, commit `b2ea7191` | Clave de OpenRouter en el historial; `SECURITY.md` dice revocada pero el historial no se purgó. Confirmar la revocación. |

### Operación y datos (arquitectura)

| ID | Sev. | Dónde | Qué pasa |
|---|---|---|---|
| A1 | alta | `apps/api/docker-entrypoint.sh:117-131,205-245`; `scripts/safe-schema-sync.sql` | Tres fuentes de verdad del esquema. El "healing" marca migraciones como aplicadas viendo una sola columna (p. ej. `project_merge_suite` con 6 DDL se da por aplicada por `archivedAt`). Si falta `dist`, compila al arrancar. |
| A2 | alta | `Dockerfile` raíz `:47-71`, `docker/entrypoint-full.sh:25` | Imagen monolítica con credenciales literales en `ENV` y `prisma db push --accept-data-loss` en cada arranque: justo lo que se prohibió por borrar checkpoints de LangGraph. Es el Dockerfile por defecto si alguien apunta Dokploy a la raíz. |
| A3 | alta | 21 pares de módulos Nest con importación mutua, 69 `forwardRef`; `apps/api/Dockerfile:43` | Sin API pública por módulo (396 de 631 imports entre módulos apuntan a internos). El build **falla si desaparece `forwardRef`** de `deliverables-queue.service.js`: el parche del ciclo es regla de build. |
| A4 | alta | `ci.yml`, `turbo.json:31` | CI sin typecheck, sin lint y con una fracción de specs, mientras `master` despliega solo. |
| A5 | media | `fence-scan.util.ts`, `markdown-table.ts:377`, `mermaid-oracle.ts:169`, `markdown-repair.ts:10`, `mdd-architect-critic-outline.util.ts:150`, `mdd-api-contracts-chunk.util.ts:232`, `mermaid.ts:1384`, `brd-mermaid-validate.util.ts:36` | Siguen conviviendo ≥8 escáneres de fences con reglas distintas (varios por paridad, el bug ya corregido en el pipeline). La regla canónica vive en `apps/api`, así que la web y shared-types no pueden reutilizarla. |
| A6 | media | `ai-analysis.service.ts` | 3156 líneas, 36 dependencias inyectadas. El baseline del GOD-REFACTOR lo tenía en 2227: creció 42 %. |

### Frontend

| ID | Sev. | Dónde | Qué pasa |
|---|---|---|---|
| F1 | crítica | `utils/apiClient.ts:147-185`, `helpers/persist-field.ts:155,167,172` | Cola offline: clave solo por `field` (sin proyecto ni etapa), el replay no envía `stageId` (la API cae en `pickPrimaryStage`: el MDD de una etapa secundaria se escribe en la primaria), sin versión ni timestamp (reenvía contenido de días antes sobre lo regenerado), no se limpia en logout y no actualiza el store. |
| F2 | alta | `lib/api.ts:3`, `lib/mermaid-api.ts:12` | «Regenerar con IA» siempre falla: `lib/api` tiene base `""` y llama `/ai/mermaid/regenerate`; la ruta real es `/api/ai/mermaid/regenerate`. Los otros 8 consumidores de `lib/api` anteponen `/api` a mano, así que fijar `VITE_API_URL` los rompería. Hay dos clientes HTTP incompatibles (`lib/api.ts` y `utils/apiClient.ts`). |
| F3 | alta | `store/workshop/slice-session-chat.ts:1127-1336` | Si el stream del chat genérico se cierra sin `done` ni `error` (timeout de proxy, caída de API) el taller queda bloqueado: `streamingUserMessage` no se limpia e `isWorkshopAgentsBusy` sigue en true. |
| F4 | alta | `store/workshop/slice-mdd.ts:95-135,182,198,565` | Generar MDD en A, salir y abrir B: el progreso de A aparece en B, B queda bloqueado y al terminar A se borra `loading` de B. `enqueueAndPollMddJob` no recibe `signal` y los `set` no pasan por `shouldApplyWorkshopUpdate`. |
| F5 | media | `App.tsx:483-494,579,693,715,736`; `ChatContainer.tsx:826-886`; `useDashboardGenerationSummary.ts:62`; `pollMddJob.ts:84-87` | Borrado masivo que se detiene a medias; errores de grupos/reordenar solo en consola; micrófono que sigue activo tras desmontar; badges del dashboard congelados tras un error de red; polling que sigue 15 h tras un 401. |

Hallazgos de severidad media y baja adicionales (30 de backend, 14 de frontend, 16 de arquitectura, 13 del harness) quedan en los dictámenes de cada auditor; los más relevantes aparecen en las oportunidades.

## 4. Oportunidades priorizadas

| # | Impacto | Esfuerzo | Qué |
|---|---|---|---|
| 1 | alto | S | **`ProjectAccessGuard` + `@ProjectScoped`** que resuelva el acceso al `:projectId` antes del handler, eliminar los `findUnique({where:{id}})` sueltos y una prueba e2e de matriz IDOR (usuario B contra proyecto PRIVATE de A) por ruta. Cierra S3-S6. |
| 2 | alto | S | **Fallar cerrado en producción**: `exit 1` sin `JWT_SECRET`, rechazar `otp_dev_expose_code`, validar el entorno con zod en `ConfigModule`. Throttler en `/auth/*` y contador de OTP en Redis. Matriz de roles en `updateUserRole`/`createUser`/`getUserMcpSecretAdmin`. `JwtStrategy.validate` relee el usuario o usa `tokenVersion`. Cierra S1, S7-S9, S11. |
| 3 | alto | S | **Quitar Adminer del compose de producción** (o sin dominio y con auth) y sacar la contraseña de Postgres del compose. Cierra S2. |
| 4 | alto | S | **Borrar `looksLikeJsonFlattenFlowchart`/`repairFlattenedWebhookFlowchart`** y las demás reglas de cliente (`mermaid.ts:1785`, `repair-dbga-markdown.ts:208`, `repair-pasted-markdown.ts:506-529`): toda reparación Mermaid solo cuando el parser rechace, con caso en el corpus. Cierra H1. |
| 5 | alto | S | **Auditor sin JSON ⇒ `auditorRan:false` y sin nota**; `isResponseValid` que valide el esquema zod con 1-2 reintentos re-inyectando el error (Auditor, Manager, Critic). Cierra H2. |
| 6 | alto | S | **Serializar `cross_consistency_checker` → `diagram_injector`** en el grafo one-shot como ya hace el grafo con Manager. Cierra H3; hacerlo antes de la tercera corrida del eval. |
| 7 | alto | S | **Estado `failed` como terminal** en los tres mapeos de job y `res.on("close")` en los SSE; IDs de job con UUID y `userId` en el payload validado en GET/DELETE/stream. Cierra H4, S3. |
| 8 | alto | S | **Lock que falle cerrado**: esperar `ready` antes del primer `SET`, con error de Redis devolver THREAD_BUSY o reencolar, lease perdido aborta la señal del turno. Cierra H5. |
| 9 | alto | S | **CI completo**: `pnpm typecheck`, `pnpm lint`, `pnpm test` en todos los workspaces y `docker build` de la API; `dependsOn: ["^build"]` en `test:types`. Restaurar `eslint.config.*` en api y web (hoy `react-hooks/exhaustive-deps` nunca corre sobre 139 `useEffect`). Cierra A4. |
| 10 | alto | S | **Retirar el `Dockerfile` raíz, `entrypoint-full.sh` y `nginx-fullstack.conf`** (o renombrar a `.legacy` sin `db push`). Cierra A2. |
| 11 | alto | M | **Rediseñar la cola offline de la web**: clave proyecto+etapa+campo, enviar `stageId`, versión o línea base, limpiar en logout, avisar al usuario. Cierra F1. |
| 12 | alto | M | **Un solo cliente HTTP en web** (`apiClient`, borrar `lib/api.ts`) y **una sola utilidad de streaming** SSE/NDJSON con `AbortSignal`, vaciado del buffer, evento sintético de fin y guarda de proyecto (hoy 4 copias). Cierra F2-F4. |
| 13 | alto | M | **Detectar truncado** (`finish_reason`/`stop_reason = length`, 0 ocurrencias hoy) y pedir continuación o regenerar el bloque, en vez de maquillar el ```sql sin cerrar con reparación de fences. |
| 14 | alto | M | **Trazabilidad por llamada LLM**: nodo/capacidad (`withTokenUsageContextPatch` en `wrapNodeStart`), modelo real, intentos, latencia, resultado y coste o `unknown`; `runWithTokenUsageContext` también en los streams HTTP (`ai-analysis.controller.ts:237,545,593,645,706`, hoy sin coste). |
| 15 | alto | M | **Esquema con una sola fuente**: job `theforge-migrate` en compose (`depends_on: service_completed_successfully`), congelar el healing y `safe-schema-sync.sql`, baseline nuevo, borrar `prisma/migrations` huérfana. Merece ADR. Cierra A1. |
| 16 | alto | M | **Un solo escáner de fences en shared-types** (mover `fence-scan.util.ts`), los demás como adaptadores, spec de concordancia sobre el mismo corpus. Cierra A5. |
| 17 | medio | M | Servidor MCP con token por petición (no global), firma obligatoria de plugins y rol `super_admin` para instalarlos, `helmet`/CSP/HSTS, límite de tamaño en multer, cifrar `mcpSecret` (hash), tokens de Ariadne/Context7/webhook y secretos de `AppConfig`. Utilidad SSRF común (bloqueo de rangos privados, sin `redirect: follow`, timeout). Cierra S10, S12, S13 y medias de seguridad. |
| 18 | medio | M | `$transaction` en merge de proyectos, patchLink y `remove`; `pluginData` atómico (`jsonb_set` o lock optimista); invalidación de la caché de `platform-config` en el worker. |
| 19 | medio | L | **Cortar los ciclos Nest**: barrel público por módulo, `dependency-cruiser` o `no-restricted-imports` en CI, utils puras de `engine`/`ai` a un paquete `mdd-core`; después quitar el gate de `Dockerfile:43`. Partir `AiAnalysisService` como se hizo con `ProjectsService`. |
| 20 | medio | L | Web: TanStack Query con el cliente único, estructura por features (`WorkshopView` 2829 líneas, `App.tsx` 1700 con 49 `useState`), react-hook-form + zod reutilizando `createProjectSchema` de shared-types, carga diferida de Settings/Users/Setup/Login (la pantalla de login paga el chunk de 1,59 MB), tests de componentes. |
| 21 | medio | S | Docker: `USER node`, `pnpm deploy --prod` en runner, etiquetas con versión menor, `HEALTHCHECK` en imagen, `/health/live` y `/health/ready` (hoy `ok` siempre) y healthcheck del worker. |
| 22 | bajo | S | Política de reintento LLM (no reintentar 400/401/403, respetar `Retry-After` en 429); clave de caché por nodo con modelo y versión de prompt y tope de tamaño; `AGENTS.md` raíz con pnpm/turbo, zonas congeladas y las reglas de este informe; ADRs: dependencias entre módulos, estrategia de esquema, regla canónica de fences, resolución `src` vs `dist`, contrato de plugins. |

## 5. Decisiones abiertas para Jorge

1. **SHARED ⇒ ¿escritura con credenciales del dueño?** Hoy sí (S5). Recomendación: el LLM corre con las credenciales de quien pide la acción y SHARED es solo lectura.
2. **Suelo anti-wipe rechazado** (H6): emitir `error`/`blocked` en vez de `done` con `persistedOnServer`.
3. **Variables de Dokploy** que deciden si S1, S2 y S11 son explotables hoy: `JWT_SECRET`, `POSTGRES_PASSWORD`, `PLUGINS_REQUIRE_SIGNATURE`, `OTP_DEV_EXPOSE_CODE`. Revisar en la UI de Dokploy (no se leyeron).
4. **Revocación de la clave de OpenRouter** del commit `b2ea7191`: confirmar; durante la auditoría la clave apareció en la salida de un comando local del sub-agente (no en ningún archivo).
5. **Ruido de plataforma en los MDD** (outbox/security_events/refresh_tokens, bloque "UI/UX Design Intent"): sigue siendo decisión de producto.

## 6. Orden sugerido

- **Lote 1 (seguridad, 1-2 días):** oportunidades 1, 2, 3 y 7. Hasta entonces, no exponer la instancia a usuarios que no confíen entre sí.
- **Lote 2 (calidad del MDD, antes de la tercera corrida del eval):** 4, 5, 6, 8 y 14.
- **Lote 3 (red de seguridad):** 9 y 10, y después 11 y 12 en la web.
- **Lote 4 (fondo):** 13, 15, 16 y el resto por valor/esfuerzo.

## 7. Qué no se verificó

- Nada se ejecutó en navegador ni contra un LLM; H3 se deduce del grafo y el reductor, no se observó.
- Drift real entre `schema.prisma` y la base (requiere `prisma migrate diff`).
- Variables reales de Dokploy y cabeceras efectivas de Traefik.
- Revisión endpoint por endpoint de `projects` (71 rutas) y `project-integration`: muestreo.
- `packages/docs-mcp-server`, `plugin-ui/` y `mdd-scoped-stream.util.ts` solo por encima.
