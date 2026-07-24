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
| `manager` | Greenfield — chat Manager (arranque) | `streamMddAnalysisWithManager` |
| `section` | Greenfield — `/seguridad`, etc. | `streamMddRegenerateSection` |
| `upstream-sync` | Greenfield — cambios DBGA/BRD/Benchmark | `streamMddUpstreamSync` (§1–§7 selectivas; restaura estrictamente las secciones fuera de alcance) |
| `legacy` | Proyectos `LEGACY` | `LegacyCoordinatorService.generateMdd` |

Un solo job MDD activo o en cola por proyecto (`assertCanEnqueue` → 409 si busy).

## Persistencia

`AiAnalysisService.runMddGenerationJob` persiste borradores (`draft`) y resultado final (`done`) en BD vía `projects.persistMddFromBackgroundJob`:

- **Borradores:** `prepareMddForOutput` con `formatForPersist: false` (sin `formatDocumentMarkdown`); guardado directo en stage **sin** delivery gate.
- **Nodo `prepare_output` (streaming):** mismo modo gate — valida SSOT/gate sin reformatear el borrador del grafo.
- **Final (`done`):** `formatForPersist: true` + pipeline completo (`MddUpdatePipelineService`) con gate de entrega, semáforo y estimación.

El Workshop ya no depende de `persistMddContent` tras encolar.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/ai-analysis/mdd/jobs` | Encola greenfield (`pipeline` \| `manager` \| `section` \| `upstream-sync`) |
| `GET` | `/ai-analysis/mdd/upstream-sync/analysis?projectId=&stageId=` | Diff upstream vs baseline MDD (secciones recomendadas) |
| `GET` | `/ai-analysis/mdd/jobs/:jobId` | Estado del job |
| `GET` | `/projects/:id/mdd-jobs/:jobId` | Alias polling (web) |
| `DELETE` | `/projects/:id/mdd-jobs/:jobId` | Cancela job encolado o aborta pipeline activo (flag Redis + `AbortSignal` entre nodos; poll 500 ms) |

Al cancelar un job **activo**: el banner y `generation-status.busy` se liberan de inmediato (job en estado «cancelling»); el worker termina el paso LLM en curso y aborta entre nodos. Tras abort, `assertCanEnqueue` permite una nueva generación.
| `GET` | `/projects/:id/generation-status` | Incluye `mddJobs[]` y `mddUpstreamSync` (banner Workshop) |
| `POST` | `/projects/:id/legacy/generate-mdd` | Encola legacy por defecto (`?queue=false` sync) |
| `GET` | `/projects/:id/legacy/mdd-jobs/:jobId` | Polling legacy |

SSE (`POST …/mdd/stream`, `…/stream/manager`, `…/regenerate-section`) sigue disponible; el Workshop usa jobs por defecto.

## Progreso acumulado

El job guarda `MddJobProgressState` (`steps[]` completados + `active` en curso). El poll ya no pierde nodos rápidos entre intervalos de 2 s. Eventos `phase: "active"` al iniciar nodo; `phase: "done"` al completar (pipeline greenfield vía `onNodeStart` en `createMddGraph`).

## Frontend

- `apps/web/src/utils/pollMddJob.ts` — `enqueueAndPollMddJob`, `enqueueAndPollLegacyMdd`.
- `workshopStore`: `generateMddFromBenchmark`, `generateMddUpstreamSync`, `legacyGenerateMdd`, regeneración §N vía cola.
- `MddRegenerateDialog` / `MddUpstreamSyncBanner` — elegir pipeline completo vs sync incremental.

## Baseline upstream

Tras `pipeline`, `section`, `upstream-sync` o restauración desde caché upstream exitosa, `MddUpstreamSyncService.captureBaseline` persiste en `Stage.mddUpstreamBaseline` (hashes + snapshots 32k de DBGA/BRD/Benchmark) para detectar cambios posteriores. Los hashes ignoran la cabecera de fechas (`theforge-doc`) para no marcar desincronización por metadatos solamente.

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

BullMQ persiste jobs en Redis. Si el proceso API/worker muere con un job `active`, el lock puede vivir hasta `lockDuration` (15 min) y la UI sigue mostrando «en ejecución».

En `onModuleInit`, `recoverBullMqJobsAfterWorkerRestart` marca `active` como **failed** (`Proceso API reiniciado; vuelve a generar el MDD`) y elimina `waiting`/`delayed` obsoletos. El worker MDD usa `maxStalledCount=0` y en `stalled` no reencola el pipeline.

**Ahora mismo (estado atascado):** reinicia el API con este fix o pulsa **Cancelar generación** en el banner (jobs huérfanos `active` sin worker local se fallan al instante). No hace falta `redis-cli FLUSHDB`.
