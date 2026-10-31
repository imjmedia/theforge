# MDD background jobs

Cola de generación/regeneración del MDD desacoplada del SSE del navegador.

## Cola

- Nombre BullMQ: `theforge-mdd` (`MddQueueService`, `mdd-queue.service.ts`).
- Con `REDIS_URL` (**obligatorio en production**): jobs persistentes en Redis.
- Sin Redis: cola in-memory secuencial por proyecto (**solo desarrollo**).
- Worker: `THEFORGE_RUNTIME_ROLE=worker` (`dist/worker.js`) o monolito `all`. Concurrencia: `MDD_BULLMQ_CONCURRENCY` (default **2**, max 8).

## Modos (`MddJobMode`)

| Modo | Origen | Generador |
|------|--------|-----------|
| `pipeline` | Greenfield — benchmark → MDD | `streamMddAnalysis` |
| `manager` | Greenfield — chat Manager (turno nuevo) | `streamMddAnalysisWithManager` vía `runMddChatTurn` (ver «Chat vía cola») |
| `resume` | Greenfield — chat Manager (respuesta del usuario sobre un `threadId`) | `streamMddResume` vía `runMddChatTurn` |
| `section` | Greenfield — `/seguridad`, etc. | `streamMddRegenerateSection` |
| `upstream-sync` | Greenfield — cambios DBGA/BRD/Benchmark | `streamMddUpstreamSync` (§1–§7 selectivas; restaura estrictamente las secciones fuera de alcance) |
| `legacy` | Proyectos `LEGACY` | `LegacyCoordinatorService.generateMdd` |

Un solo job MDD activo o en cola por proyecto (`assertCanEnqueue` → 409 si busy).

**Encolar sustituye jobs activos:** al `POST …/mdd/jobs`, `preemptActiveMddJobsForProject` aborta y marca **failed** cualquier job `active` del mismo proyecto (`Reemplazado por un job MDD más reciente`). Evita el error BullMQ `could not renew lock` cuando se cancela y se relanza sin esperar al worker anterior.

## Persistencia

`AiAnalysisService.runMddGenerationJob` persiste borradores (`draft`) y resultado final (`done`) en BD vía `projects.persistMddFromBackgroundJob`:

- **Borradores:** `prepareMddForOutput` con `formatForPersist: false` (sin `formatDocumentMarkdown`); guardado directo en stage **sin** delivery gate.
- **Nodo `prepare_output` (streaming):** mismo modo gate — valida SSOT/gate sin reformatear el borrador del grafo.
- **Final (`done`):** `formatForPersist: true` + pipeline completo (`MddUpdatePipelineService`) con gate de entrega, semáforo y estimación.

El Workshop ya no depende de `persistMddContent` tras encolar.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/ai-analysis/mdd/jobs` | Encola greenfield (`pipeline` \| `manager` \| `resume` \| `section` \| `section-pipeline` \| `upstream-sync`) |
| `GET` | `/ai-analysis/mdd/config` | `{ chatViaQueue }` (env `MDD_CHAT_VIA_QUEUE`, default `"1"`) |
| `GET` | `/ai-analysis/mdd/jobs/:jobId/events?projectId=&cursor=N` | NDJSON de eventos del turno de chat con cursor (replay + cola en vivo) |
| `GET` | `/ai-analysis/mdd/upstream-sync/analysis?projectId=&stageId=` | Diff upstream vs baseline MDD (secciones recomendadas) |
| `POST` | `/ai-analysis/mdd/upstream-sync/accept-baseline?projectId=&stageId=` | Re-ancla baseline sin regenerar MDD (acknowledge humano) |
| `GET` | `/ai-analysis/mdd/jobs/:jobId` | Estado del job |
| `GET` | `/projects/:id/mdd-jobs/:jobId` | Alias polling (web) |
| `DELETE` | `/projects/:id/mdd-jobs/:jobId` | Cancela job encolado o aborta pipeline activo (flag Redis + `AbortSignal` entre nodos; poll 500 ms) |

Al cancelar un job **activo**: abort cooperativo entre nodos; el banner se libera cuando el worker termina de abortar. **No** se borra `AgentStateCheckpoint` / LangGraph ni se rota `threadId` (cancelación → `UnrecoverableError`, sin reintentos BullMQ). Tras detener, reanuda con `mdd/stream/resume` y el `threadId` del proyecto.
| `GET` | `/projects/:id/generation-status` | Incluye `mddJobs[]` y `mddUpstreamSync` (banner Workshop) |
| `POST` | `/projects/:id/legacy/generate-mdd` | Encola legacy por defecto (`?queue=false` sync) |
| `GET` | `/projects/:id/legacy/mdd-jobs/:jobId` | Polling legacy |

SSE (`POST …/mdd/stream`, `…/stream/manager`, `…/regenerate-section`) sigue disponible; el Workshop usa jobs por defecto.

## Chat vía cola (`manager` / `resume`)

El turno del chat con Manager corre en el worker BullMQ (no dentro del request HTTP), así que sobrevive al cierre de la pestaña y al reinicio de una réplica del API. La UX del Workshop no cambia: el mismo `handleMddChatEvent` procesa los eventos con ambos transportes.

**Flag:** `MDD_CHAT_VIA_QUEUE` (default `"1"`; `0`/`false`/`off`/`no` lo apagan). El Workshop lo lee de `GET /ai-analysis/mdd/config`; apagado (o API sin el endpoint) usa el NDJSON legacy `mdd/stream/manager|resume`, intacto.

**Job:** `runMddChatTurn` toma el lease por hilo (`ThreadRunLockService`, misma clave que los streams HTTP: `projectId:stageId`); si está ocupado lanza `ThreadBusyError` (no reintentable). Persiste en `done` exactamente como el stream (`runGuardedMddStream` → `persistedOnServer`). Se encola con `attempts: 1` (un turno no es idempotente) y sin preemptar un turno vivo del mismo proyecto (409 si lo hay; solo se liberan jobs huérfanos sin lock).

**Relay de eventos:** cada evento del generador (`progress`, `draft`, `interrupt`, `done`, `error`, `blocked`) se agrega a la lista Redis `mdd:job-events:<jobId>` (JSON por entrada, TTL 24 h) y se avisa por el canal homónimo. Solo se conservan los últimos 3 `draft` (los anteriores pasan a `noop` para que los cursores sigan siendo índices estables). Sin `REDIS_URL`: array + `EventEmitter` en proceso (solo dev). El worker garantiza un evento terminal aunque el turno falle o se cancele (`error` con `code: "CANCELLED"`, `THREAD_BUSY`, …).

**Lectura:** `GET /ai-analysis/mdd/jobs/:jobId/events?projectId=&cursor=N` responde NDJSON: reproduce desde el índice `N`, sigue en vivo hasta un evento terminal (`done`, `error`, `interrupt`, `blocked`) o hasta que el cliente se desconecta (el job NO se cancela). Cada línea lleva `cursor` (índice de la siguiente entrada); `{"type":"heartbeat","cursor":N}` cada 15 s. Si el job murió sin evento terminal (fallido, huérfano, expirado) emite un `error` sintético.

**Interrupt → `waiting_user` → `resume`:** al emitirse `interrupt` (preguntas del Manager o plan para aprobar) el job se completa con `{ outcome: "interrupt", status: "waiting_user", threadId, interrupt }`. La respuesta del usuario encola un job `resume` (`threadId`, `userMessage`, `mddContent?`, `images?`) sobre el mismo hilo (checkpoint LangGraph). Los eventos del `interrupt` quedan 24 h en Redis: quien recarga antes de procesarlo lo recupera desde su cursor.

**Cancelar:** `DELETE /projects/:id/mdd-jobs/:jobId` (flag Redis + `AbortSignal`, ver arriba). El Workshop (`cancelMddJob`) además deja de leer eventos y olvida el estado guardado.

**Workshop:** `activeChatJobId` + `activeChatJobCursor` en el store; el par `{ jobId, cursor }` se persiste en `localStorage` (`theforge:mdd-chat-job:<projectId>:<stageId|_>`, caduca a 24 h). Al cargar el proyecto, `resumeMddChatJob` consulta `GET …/mdd/jobs/:jobId` y, si el servidor lo conoce, reabre los eventos desde el cursor guardado; si no existe (404/400) borra el estado. Los cortes de red se reintentan con backoff reabriendo desde el último cursor.

**Prueba manual (cerrar pestaña a mitad de turno):**

1. Con `REDIS_URL` y el worker activos, abre un proyecto y manda al chat MDD un mensaje que delegue en agentes (p. ej. «Regenera §3 y §4»).
2. Cuando el banner muestre progreso, cierra la pestaña (o reinicia el API).
3. Espera unos segundos/minutos (el job sigue en `theforge-mdd`; `GET /ai-analysis/mdd/jobs/<id>` → `active` → `completed`).
4. Reabre el proyecto: el Workshop reanuda los eventos desde el cursor guardado, muestra el progreso restante y aplica el resultado (`done` con `persistedOnServer`, o el `interrupt` con preguntas / plan pendiente de aprobar).
5. Con `MDD_CHAT_VIA_QUEUE=0` el comportamiento es el legacy (cerrar la pestaña aborta el turno).

## Progreso acumulado

El job guarda `MddJobProgressState` (`steps[]` completados + `active` en curso). El poll ya no pierde nodos rápidos entre intervalos de 2 s. Eventos `phase: "active"` al iniciar nodo; `phase: "done"` al completar (pipeline greenfield vía `onNodeStart` en `createMddGraph`).

## Frontend

- `apps/web/src/utils/pollMddJob.ts` — `enqueueAndPollMddJob`, `enqueueAndPollLegacyMdd`.
- `workshopStore`: `generateMddFromBenchmark`, `generateMddUpstreamSync`, `legacyGenerateMdd`, regeneración §N vía cola.
- `MddRegenerateDialog` / `MddUpstreamSyncBanner` — elegir pipeline completo vs sync incremental.

## Baseline upstream

Tras `pipeline`, `section`, `upstream-sync` o restauración desde caché upstream exitosa, `MddUpstreamSyncService.captureBaseline` persiste en `Stage.mddUpstreamBaseline` (hashes + snapshots 32k de DBGA/BRD/Benchmark) para detectar cambios posteriores. Los hashes ignoran la cabecera de fechas (`theforge-doc`) para no marcar desincronización por metadatos solamente.

**Acknowledge sin regenerar:** `POST /ai-analysis/mdd/upstream-sync/accept-baseline?projectId=&stageId=` (`acceptBaseline`) re-ancla el baseline al upstream actual **sin** modificar `mddContent`. Lo usa el banner Workshop «Marcar MDD como sincronizado» tras paste/alineación manual. No hay auto-accept al guardar el MDD.

## Caché documento (upstream sin cambios)

Modo `pipeline`: antes de ejecutar el grafo LLM, `MddUpstreamSyncService.tryRestoreFromUpstreamCache` compara hashes actuales de DBGA, BRD y Benchmark contra `mddUpstreamBaseline`. Si hay MDD guardado, baseline previo y **ningún upstream cambió** (`pendingSync === false`):

1. Se omite el pipeline LLM (~45 min).
2. Se reutiliza `stage.mddContent` existente.
3. `persistMddFromBackgroundJob` repara formato (`peelDocumentBodyForPersist` → `prepareMddForOutput` → `storeMddMarkdownForPersist`) y ejecuta el pipeline determinista de entrega (gate + semáforo). **Sin cabecera de fechas** en el markdown del MDD.
4. Se actualiza `mddUpstreamBaseline` (mismo criterio que pipeline LLM completo).

Progreso del job: `phase: "cache"`. Requiere haber completado al menos una generación previa que capturó baseline (primera regeneración tras el deploy sigue siendo pipeline completo).

**No aplica caché** cuando:

- `forceFullPipeline: true` en el job (Workshop «Regenerar MDD completo» / `generateMddFromBenchmark`).
- El MDD guardado falla el delivery gate (p. ej. §1/§2 faltantes) — se fuerza pipeline LLM para reconstruirlo.

## Gates

`ProjectGenerationGuardService` incluye `mddQueue.isProjectBusy()` en `mddStreamActive` para bloquear entregables downstream mientras corre un job MDD.

## Reinicio del API / jobs huérfanos

BullMQ persiste jobs en Redis. Si el proceso **worker** muere con un job `active`, el lock puede vivir hasta `lockDuration` (15 min) y la UI sigue mostrando «en ejecución».

En `onModuleInit` del **worker** (`THEFORGE_RUNTIME_ROLE=worker|all`), `recoverBullMqJobsAfterWorkerRestart` marca **failed** solo jobs `active` **sin lock Redis** (huérfanos reales). **No** elimina `waiting`/`delayed` (`removeQueued=false` por defecto): con varias réplicas, el reinicio de un worker no debe vaciar la cola de los demás. El contenedor **HTTP** no ejecuta recuperación (no mata jobs que el worker sigue procesando). El worker MDD usa `maxStalledCount=0` y en `stalled` no reencola el pipeline.

**Cancelación desde HTTP:** jobs `active` en el worker reciben flag Redis + abort cooperativo (igual que entregables), no `forceFail` mientras el worker mantiene el lock.

**Shutdown graceful (redeploy worker):** en `onModuleDestroy` (SIGTERM) se abortan jobs locales, se fuerza `failed` en Redis (`Worker detenido…`) y se cierra el worker con `close(true)`.

**Polling:** `GET …/mdd-jobs/:jobId` reconcilia jobs `active` huérfanos (sin lock Redis ni worker local) vía `reconcileOrphanBullMqActiveJob`.

**Lock renewal:** si el worker pierde el lock (redeploy solapado, preempt), BullMQ emite `could not renew lock for job N`; el worker lo registra como `warn` (no `error`).

**Estado atascado:** reinicia el worker o pulsa **Cancelar generación**; jobs huérfanos `active` sin lock se fallan al instante en poll/cancel.
