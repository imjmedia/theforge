# AI Analysis / Checkpoint

Persistencia de estado de grafos LangGraph con checkpointer. Permite retomar ejecuciones interrumpidas y cachear resultados de nodos.

## Capa

- **`checkpointer.service.ts`** — servicio de checkpoint con PostgresSaver envuelto en `fenced-checkpointer.ts` (fence MDD, ADR 0004 D-6).
- **`fenced-checkpointer.ts`** — omite `put` / `putWrites` si `Stage.mddLeaseFence` > `configurable.mddLeaseFence`; purga hilos obsoletos al reanudar.
- **`langgraph-checkpoint-setup.util.ts`** — configuración del checkpointer para grafos MDD/DBGA.
- **`node-cache.service.ts`** — caché de nodos en memoria: evita re-ejecutar nodos con mismos inputs (hash-based). Tope `NODE_CACHE_MAX_ENTRIES` = 200 con evicción LRU; `stats()` expone aciertos, fallos y evicciones. `runWithNodeCacheDisabled(fn)` la desactiva dentro de un contexto (el eval la usa por defecto).
- **`node-cache-key.ts`** — clave de caché por nodo: incluye nodo, entrada, cadena de modelos y `MDD_PROMPT_VERSION` (SHA-256 de `prompts/mdd/*.md` + `prompts/benchmark/*.md`, ver `prompts/compute-mdd-prompt-version.ts`). Cualquier cambio en esos prompts invalida entradas previas sin bump manual.
- **`node-input-hash.ts`** — hashing determinista de inputs de nodo.
- **`thread-run-lock.service.ts`** — lease por hilo (`projectId:stageId`) con Redis: `SET NX PX` con TTL (`THREAD_RUN_LOCK_TTL_MS`, 20 min por defecto), renovado cada 60 s y liberado con compare-and-delete. Es reentrante por contexto async.

## Lease por hilo (`ThreadRunLockService`)

- Con `REDIS_URL`, si Redis no está listo en 5 s o el `SET` falla, `acquire` lanza `LOCK_UNAVAILABLE` (reintentable en jobs de pipeline; `ThreadBusyError` si el hilo está ocupado, no reintentable). Nunca concede exclusión local.
- Sin `REDIS_URL` (solo desarrollo y tests) usa un Map en proceso.
- El lease expone `signal` (abortado con `LEASE_LOST` solo ante una pérdida confirmada: renovación rechazada, liberación sin token propio o TTL vencido sin renovar) e `isHeld()`. Un error transitorio al renovar solo se registra y se reintenta en el siguiente tick.
- `persist` (en `ai-analysis.service.ts`) comprueba el lease antes de escribir; si se perdió, no escribe (`lease_lost`).
- Modos con lease: `section`, `section-pipeline` y `upstream-sync` corren completos bajo el lease (lote 2b, `runMddGenerationJob` en `ai-analysis.service.ts`). Ya no hay modos del hilo sin exclusión.

## Fence (fencing token)

- Cada lease trae `fence: number`: entero creciente entre leases, también entre claves distintas. Sirve para descartar escritores viejos.
- Con Redis el contador es `THREAD_FENCE_KEY` (`mdd:thread-fence`). El fence se obtiene con `FENCE_LUA`: `INCR` y, si el valor queda por debajo de `Date.now()`, lo sube al reloj antes de devolverlo. Así un flush de Redis nunca da un fence menor que los ya escritos. No hay `SET NX` de siembra.
- Sin `REDIS_URL` (desarrollo y tests) el fence es `max(anterior + 1, Date.now())` en memoria, calculado en cada `acquire`.
- Si la obtención del fence falla, `acquire` libera el lease tomado (compare-and-delete) y lanza `LOCK_UNAVAILABLE` con «No se pudo obtener el fence del hilo MDD». Nunca concede un lease sin fence.
- La vista reentrante copia el `fence` del lease exterior. `runExclusive` pasa el lease como segundo argumento: `fn(signal, lease)`.

## Contexto del fence y límites

- El lease fija un contexto `AsyncLocalStorage` (`apps/api/src/common/mdd-lease-context.ts`) con `fence` y `key`. Lo fijan `runExclusive` (job y chat en cola) y `runGuardedMddStream` (stream HTTP). `persistMddFromPatch` y `persistMddFromBackgroundJob` lo leen cuando no llega un fence explícito, así que los tools del Manager quedan condicionados por `mddLeaseFence`.
- `acquire` directo no fija ese contexto: quien lo use y necesite fence debe fijarlo.
- El checkpoint LangGraph (`fenced-checkpointer.ts`) recibe `mddLeaseFence` y `mddStageId` en `config.configurable` en los streams/jobs MDD con Manager. Un turno cuyo fence quedó por debajo del de la etapa no persiste checkpoint; al reanudar con fence obsoleto se purga el hilo (warn).
