# Handoff: calidad del MDD, lote 2 (incluye lote 2b), 2026-11-03

- **Rama:** `fix/calidad-mdd-lote-2`. Cambios sin commit sobre `master` (e4d4abe2). Sin bump de versión. Sin desplegar.
- **Origen:** `docs/handoffs/2026-11-02-auditoria-global.md` §3 (H1–H6, B8, O5, O10, O14) y la deuda que dejó el lote 2a.
- **Decisiones de diseño:** `docs/adr/0002-reparacion-mermaid-solo-si-el-parser-rechaza.md` (Mermaid), `docs/adr/0003-lease-por-hilo-falla-cerrado.md` (lease) y `docs/adr/0004-fencing-token-escrituras-mdd.md` (fence, aceptado e implementado).
- **Entradas de changelog:** bloque «Calidad del MDD (lote 2)» de `[Unreleased]` en `CHANGELOG.md`. Las viñetas del 2b están marcadas con **Breaking** cuando rompen contrato.

## 1. Resumen ejecutivo

El lote 2 cierra las seis deudas que la auditoría global dejó abiertas en el MDD y las que el propio lote 2a dejó pendientes. En concreto:

1. **Escrituras sin exclusión ni fence.** Los modos `section`, `section-pipeline` y `upstream-sync` escribían el hilo sin lease. Ahora corren completos bajo el lease por hilo, y toda escritura del MDD que ocurre dentro de un turno lleva un fencing token (`Stage.mddLeaseFence`, ADR 0004). Un turno que perdió la etapa ante otro más reciente no puede escribir.
2. **Llamadas LLM sin tope real.** El presupuesto del Auditor, del Manager, del Critic y de la consistencia cruzada es ahora un deadline de nodo (`deadlineMs`). Al agotarse, el Auditor queda «sin nota» y el turno sigue; el Manager delega; el Critic no aporta feedback; la consistencia cruzada conserva el paso determinista.
3. **Reparación de Mermaid que cambiaba el contenido del usuario.** Se retiraron 13 reglas del registro, se acotaron 3 y el oráculo de preservación exige que un diagrama válido salga igual. De 67 válidos del corpus que cambiaban, queda 1 (`spec-054`).
4. **Endpoint HTTP duplicado.** `POST /ai-analysis/mdd/stream/regenerate-section` queda **retirado** (breaking). La regeneración de una sección va por `POST /ai-analysis/mdd/jobs` con `mode: "section"`.
5. **Web que podía descartar trabajo del usuario o mostrar un documento que no se guardó.** El editor queda en solo lectura durante la generación, la restauración tras un `blocked` o un `LEASE_LOST` respeta la edición previa al turno y `LEASE_LOST`/`LOCK_UNAVAILABLE` recargan o avisan según el caso.
6. **Telemetría y eval ciegos a las llamadas fallidas.** `TokenUsage` guarda latencia, intentos, resultado, coste conocido, estimación y modelo real. El resumen y el eval cuentan las llamadas fallidas aparte, y el eval distingue «sin nota» de «infraestructura caída» de «salida inválida».

**Estado:** implementado y verificado en local con las suites de esta pasada (ver §7). No desplegado. Antes de desplegar hay que aplicar dos migraciones y revisar variables de entorno (ver §6). **No se ejecutó la corrida 3 del eval**; cuando se haga, sus cifras no son comparables con la corrida 2 (ver §7).

## 2. Estado de verificación de este documento

- Cada afirmación de este handoff y de los READMEs se contrastó con el diff (`git diff master`) y con el código actual. Las referencias `archivo:línea` corresponden a la versión del árbol de trabajo al cierre de esta pasada.
- Esta pasada ejecutó las suites y los typecheck que figuran en §7.1 y el oráculo de §7.2. No ejecutó la corrida del eval, la concordancia jsdom/Chrome ni el arranque de la API contra una base de datos de producción.
- Lo que no pudo verificarse se marca como «no verificado» en el texto o en la deuda.

## 3. Qué se hizo, por paso

Los pasos son los del plan de lote 2b (17 pasos en 6 carriles, con el 12b como corrección de 12). Los archivos son los del árbol de trabajo.

| Paso | Qué | Archivos principales | Decisión o nota |
|---|---|---|---|
| 1 | Resolución única del hilo MDD (`resolveMddThread`), fallando cerrado | `apps/api/src/modules/ai-analysis/ai-analysis.service.ts` (`resolveMddThread`, ~645–672) | Si la BD no responde o el proyecto no existe, lanza `LOCK_UNAVAILABLE`. El job escribe sobre la etapa resuelta; `data.stageId` del cliente es solo una pista. El resume y el chat con checkpoint usan `threadStageId` y no re-resuelven. |
| 2 | Modos `section`, `section-pipeline`, `upstream-sync` bajo lease completo; señal del lease al contexto LLM | `ai-analysis.service.ts` (`runMddGenerationJob`, `withThreadLease`, `consume`, `leasedSignal`) | El lease cubre corrección de patrones, stream y cierre. `consume` lanza `ThreadLeaseLostError` si el lease se pierde. `THREAD_BUSY` no se reintenta en estos modos. |
| 3 | Borrar la rama muerta `manager`/`resume` de `runMddGenerationJob` | `ai-analysis.service.ts` (en `master` estaba en el `switch`, ~2906) | Esos modos van por `runMddChatTurn` desde `mdd-queue.service.ts` (`isMddChatJobMode`). |
| 4 | Retirar el handler HTTP `regenerate-section` | `apps/api/src/modules/ai-analysis/ai-analysis.controller.ts` (en `master`, ~702–765) | `streamMddRegenerateSection` queda como método interno que usan los jobs. La web ya enviaba `mode: "section"` por jobs. |
| 5 | ADR 0004, migración y columna del fence | `docs/adr/0004-…`, `packages/database/migrations/20261103120000_stage_mdd_lease_fence/migration.sql`, `packages/database/schema.prisma` (`Stage.mddLeaseFence BigInt?`), `packages/database/scripts/safe-schema-sync.sql` (bloque 11) | Migración aditiva, columna nullable. |
| 6 | Fence monotónico en el lock | `apps/api/src/modules/ai-analysis/checkpoint/thread-run-lock.service.ts` (`FENCE_LUA`, `THREAD_FENCE_KEY = "mdd:thread-fence"`, `memoryFence`) | Con Redis: `INCR` con suelo en `Date.now()`, así un flush de Redis no hace retroceder el contador. Sin Redis (dev y tests): `max(anterior + 1, Date.now())`. Si el fence no se obtiene, el lease tomado se libera y se lanza `LOCK_UNAVAILABLE`. |
| 7 | Fence en la persistencia del MDD | `apps/api/src/modules/projects/project-mdd-persist.service.ts` (`mddFenceWhere`, `claimMddWriteFence`, `updateStageMdd`, `throwFenceMiss`); `apps/api/src/modules/projects/projects.service.ts` (`claimMddWriteFence`, ~465) | `updateMany` condicionado a `mddLeaseFence IS NULL OR <= fence`. Cero filas: `NotFoundException` si la etapa no existe; `MddWriteFencedError` si existe con un fence mayor. |
| 8 | Cableado del fence en el servicio | `ai-analysis.service.ts` (`claimMddFenceUnderLease` ~684–695, `runGuardedMddStream` ~855–985, `withThreadLease` ~3257, `runMddChatTurn` ~3547, `createMddPersister` ~722) | Reclamo al adquirir en los tres caminos (stream HTTP, job, chat en cola). El persistidor traduce `MddWriteFencedError` a `lease_lost`. |
| 9 | `deadlineMs` en `invokeLlmStructured` | `apps/api/src/modules/ai-analysis/utils/mdd-llm-structured.util.ts` (`DeadlineExceededError`, `MIN_ATTEMPT_BUDGET_MS = 15000`) | Resultado `reason: "deadline"`. No se invoca un intento con menos de 15 s de presupuesto. Si el presupuesto no alcanza para reparar, el resultado es `invalid` (es un fallo de calidad, no de presupuesto). |
| 10 | Presupuestos reales por nodo | `apps/api/src/modules/ai-analysis/utils/mdd-llm-timeout.util.ts` (defaults), `nodes/mdd-auditor.node.ts` (`deadlineMs: auditorNodeBudgetMs`, ~274), `nodes/mdd-manager/manager-llm-turn.ts` (`turnBudget`, ~250), `nodes/mdd-architect-critic.node.ts` (~144), `nodes/mdd-cross-consistency.node.ts` (~117), `config/env.schema.ts`, `.env.example` | Auditor 360 s, Manager 180 s por turno, Critic y consistencia cruzada 120 s, cada uno con `maxAttempts: 2` salvo Manager (`maxAttempts: 1` en el structured output y reintento de parseo con reparación). Los cuatro se validan como enteros ≥ 15000 al arrancar. |
| 11 | Medición de reglas Mermaid por ablación | Resultado en `docs/adr/0002-…` (addendum 2026-11-03) | El script de medición no está versionado en el diff; el addendum conserva la tabla. Criterio: borrar si `repairLost = 0` y `preservationGained > 0`; acotar si repara y cambia válidos sin perder reparaciones. |
| 12 | Retirar y acotar reglas Mermaid | `packages/shared-types/src/mermaid.ts` (`MERMAID_BODY_RULES` ~2323–2640, `normalizeMermaidDiagramBody(raw, { disabledRules })`, `listMermaidBodyRuleNames`) | 13 reglas retiradas, 3 acotadas (`quote-flowchart-spaced-labels`, `quote-flowchart-edge-labels`, `er-pk-fk-commas`). Válidos que cambian: 67 → 4. |
| 12b | Acotar `PK FK` sin coma y recuperar el suelo | `mermaid.ts` (`repairErDiagramPkFkCommas`, ~637); `apps/api/src/modules/engine/mdd-pre-render.ts` | `PK, FK` válido ya no se reescribe ni se rechaza. `spec-033` (`uuid id PK FK`) vuelve a repararse. Válidos que cambian: 4 → 1 (`spec-054`). |
| 13 | Editor web en solo lectura durante el stream; restauración condicional | `apps/web/src/views/workshop/WorkshopMddPanel.tsx` (`mddStreaming`, ~72–74; `readOnly` ~370; Guardar/Cancelar `disabled` ~344); `apps/web/src/store/workshop/helpers/mdd-chat-event.ts` (`lastAppliedDraft`, `userEditBeforeTurn`, `discardedResultPatch`, `leaseLostPatch`) | `mddStreaming` usa `isMddStreamingLoading` (`helpers/mdd-chat-event.ts`); «Auditar MDD» y el envío de respuestas de la auditoría manual también se deshabilitan durante el stream (H2). |
| 14 | `failedCalls` en agregados | `apps/api/src/modules/ai-analysis/token-usage/token-usage.service.ts`; `apps/api/src/modules/ai-analysis/eval/mdd-eval-nest-deps.ts` (~125); `mdd-eval-runner.ts` (~173–185) | `llmCalls` cuenta solo `ok` e `invalid`. `error`, `timeout` y `abort` van a `failedLlmCalls` sin coste. |
| 15 | `failedLlmCalls` y campos de Auditor en el DTO y la web del eval | `apps/api/src/modules/ai-analysis/eval/mdd-eval-dto.util.ts` (~93–130); `apps/web/src/components/mdd-eval/MddEvalRunResults.tsx` (~178, ~244, ~260) | El primer intento omitía `auditorOutcome`, `auditorUnavailableCount` e `infraDegraded` en el DTO; se corrigió dentro del propio paso 15 tras revisarlo. |
| 16 | `TokenUsageSummary` compartido y tarjeta con fallidas | `packages/shared-types/src/token-usage-api.ts` (nuevo, exportado en `index.ts`); `apps/web/src/components/TokenUsageCard.tsx` | Rótulos «coste estimado» y «coste desconocido»; «(+N fallidas)» con tooltip. |

### 3.1 Correcciones posteriores a los pasos

Tras la revisión y el QA del lote se hicieron estas correcciones. Cada una está en el código actual.

- **C1 — `BigInt` en JSON.** El fence es `BigInt` en Prisma y `JSON.stringify` lanzaba. Se añadió `common/json-bigint.ts` (`installBigIntJsonSupport()` en `apps/api/src/main.ts` y `apps/api/src/worker.ts`) y `omitMddLeaseFence` en `apps/api/src/modules/projects/project-api.util.ts`, usado por `toApiProject`. Los `BigInt` seguros se serializan como número; un valor fuera de `MAX_SAFE_INTEGER` lanza `RangeError`.
- **A2/A3 — fence por contexto.** Los tools del Manager (`patch_mdd_section`, `propose_mdd_amendment`) escriben con `projects.update` → `persistMddFromPatch` sin recibir el fence por firma. Se añadió `apps/api/src/common/mdd-lease-context.ts` (`runWithMddLeaseContext`, `getActiveMddLeaseFence`). `runExclusive` y el stream HTTP lo fijan; `persistMddFromPatch` y `persistMddFromBackgroundJob` lo leen cuando no llega fence explícito.
- **W1 — Guardar y Cancelar durante el stream.** Quedan deshabilitados mientras `mddStreaming`.
- **Presupuesto del Manager compartido.** Structured output, parseo con reparación y cada vuelta de `search_memory` consumen el mismo `turnBudget` (`manager-llm-turn.ts`), no uno nuevo por etapa.
- **Fence y modo Map.** El contador en memoria pasó a `max(anterior + 1, Date.now())` para que no quede por debajo del reloj tras mezclar modos.
- **G1 — suelo de reparación 30 → 29.** `quoteFlowchartSpacedLabels` «reparaba» `broken-fc_label_unclosed_bracket` (`A[Inicio --> B[Fin]`) fusionando dos nodos y una arista en uno. Esa reparación cambiaba el significado: se aceptó bajar el suelo a 29/58, con la justificación en `mermaid-corpus.spec.ts` y en el addendum del ADR 0002.
- **Auditor y motivo por turno.** `auditorUnavailableReason` se reinicia en cada nodo del Auditor (`nodes/mdd-auditor.node.ts`, ~377) y se propaga en los eventos `done` de los streams (`ai-analysis.service.ts`, ~1428 y ~1821).
- **Revisión, segunda vuelta.** Un hallazgo alto: si el usuario tenía cambios sin guardar antes del turno, `LEASE_LOST` recargaba el proyecto desde el servidor y los perdía. Se corrigió con `userEditBeforeTurn` en `helpers/mdd-chat-event.ts` (~134): en ese caso se conserva el snapshot con aviso y no se recarga. Tres hallazgos medios de esa vuelta no están detallados en el registro del lote; no se incluyen aquí.

## 4. Decisiones y alternativas descartadas

### 4.1 Decisiones tomadas (lote 2a, se mantienen)

- Borrar entero `repairFlowSectionsToMermaid`.
- Telemetría en columnas nuevas de `TokenUsage` (no en JSON).
- Los pases scoped de HIGH registran una estimación marcada (`estimated: true`).
- Suelo anti-wipe → `blocked` con `MDD_PERSIST_FLOOR` o `MDD_PERSIST_TOO_SHORT`, sin `persistedOnServer`.
- Auditor sin JSON válido tras una reparación → `unavailable`: sin nota, no bloquea, `auditorDecision: "done"`, no vuelve a `clarifier`.
- Dual approval solo como hallazgo; el borrador ya no se reescribe.
- Lease perdido y confirmado aborta el turno (`LEASE_LOST`).
- Preservación estricta en el corpus, salvo espacios.

### 4.2 Desviaciones respecto a la auditoría global

- **Hallazgo 5 (Auditor sin JSON):** la auditoría proponía `auditorRan: false`. Se mantiene `auditorRan: true` (`mdd-auditor.node.ts`, `buildStructuralAuditorResult`) para no re-ejecutar el Auditor en bucle. El resultado se distingue con `auditorOutcome`.
- **Hallazgo 8 (lock):** la auditoría proponía `THREAD_BUSY` o reencolar. Se implementó `LOCK_UNAVAILABLE`. Es reintentable solo en jobs de pipeline (`MAX_ATTEMPTS = 2`, `mdd-queue.service.ts`); los turnos de chat se encolan con `attempts: 1` y terminan en `error`.

### 4.3 Alternativas descartadas

- **`assertHeld()` con un `GET` previo al persist** (ADR 0004). La comprobación y la escritura siguen separadas por segundos de pipeline; no cierra la ventana TOCTOU.
- **Versión optimista por contenido o hash** (`WHERE mddContent = <valor leído>`) (ADR 0004). No sabe qué turno escribió; dos turnos con el mismo texto pasan.
- **Bloquear el PATCH del editor mientras hay un turno** (ADR 0004). Cambia el comportamiento visible y no cubre la carrera entre turnos.
- **Lock en proceso como respaldo de Redis** (ADR 0003). Dos réplicas no se ven: reintroduce H5.
- **Lock sin TTL** (ADR 0003). Un proceso caído dejaría el hilo bloqueado para siempre.
- **Lease por job en vez de por hilo** (ADR 0003). Dos jobs sobre el mismo hilo seguirían pisándose.
- **Fencing token en el lote 2a** (ADR 0003). Se pospuso a su propio ADR; se implementó en el 2b.
- **Parser de Mermaid en runtime en este lote** (ADR 0002). Requiere `worker_threads`, timeout y degradación. Fase 2.
- **Regenerar con el LLM cuando el parser rechaza** (ADR 0002). Gasta tokens, cambia el documento entero y no es determinista. Fase 3.
- **Quitar el reparador de Mermaid por completo** (ADR 0002). Los LLM producen fences rotos con frecuencia.
- **Mantener el endpoint `regenerate-section` por compatibilidad.** Se retiró. El Workshop ya usaba jobs; `docs/THE-FORGE-V1-RELEASE.md` lo afirmaba (y estaba desactualizado al decir que el endpoint «permanece para compatibilidad»).
- **Tabla 1:1 para el fence** en lugar de la columna `Stage.mddLeaseFence`. No aparece en el ADR 0004; se registra porque figura en el encargo del lote. La columna evita un join en cada escritura del persistidor.
- **Retener chunks vacíos en `ChainedFallbackChatModel`** para no enviarlos. Se reenvían al instante: sirven de latido al idle timeout de los modelos con razonamiento. El fallback solo se bloquea tras el primer chunk con contenido (lote 2a).

## 5. Contratos que cambian

### 5.1 Eventos de stream y de job

- `blocked` con `code`: `MDD_PERSIST_FLOOR` | `MDD_PERSIST_TOO_SHORT`. El documento no se guardó: la web restaura el estado previo al turno. **Sin `persistedOnServer`.**
- `error` con `code`: `LOCK_UNAVAILABLE` | `LEASE_LOST` | `THREAD_BUSY` | `CANCELLED`. `LOCK_UNAVAILABLE` y `LEASE_LOST` se tratan como descarte de resultado (ver §3, paso 13).
- `done.auditorOutcome`: `scored` | `unavailable`. Si es `unavailable`, no hay `auditorScore` y se muestra «sin nota», nunca 0. `done.auditorUnavailableReason` puede ser `invalid` | `transport` | `error` | `deadline`.
- `auditorGaps.score` es nullable y `status: "NO_EVALUADO"` cuando no hay nota.
- Errores de job: `LOCK_UNAVAILABLE` es reintentable en pipeline (dos intentos); `LEASE_LOST` y `MddPersistBlockedError` no (`UnrecoverableError`).

### 5.2 Endpoints

- **Retirado (breaking):** `POST /ai-analysis/mdd/stream/regenerate-section`. Sustituto: `POST /ai-analysis/mdd/jobs` con `{ mode: "section", projectId, section: 1–7, mddContent?, gapReasons? }`. `section-pipeline` solo acepta la sección 5.
- `POST /ai-analysis/mdd/jobs` valida el modo: `pipeline | manager | resume | section | section-pipeline | upstream-sync`.
- `GET /ai-analysis/token-usage`: añade `failedCalls`, `estimatedCalls` y `costUnknown` por documento y por modelo (aditivo).
- Respuestas de proyecto: `stages[].mddLeaseFence` se omite en `toApiProject` de `project-api.util.ts`. **No** se omite en `project-merge.service.ts` ni en `project-notion-portability.service.ts` (deuda D-3).

### 5.3 DTO y tipos del eval

- Por caso (`MddEvalRunRecordDto`): `failedLlmCalls` y `auditorOutcome`. El tipo interno del registro tiene además `auditorUnavailableReason` (`mdd-eval.types.ts:125`), pero `mdd-eval-dto.util.ts` no lo copia al DTO (deuda D-22).
- Resumen (`MddEvalAggregatesDto`): `totalFailedLlmCalls`, `auditorUnavailableCount`, `auditorInvalidCount`, `infraDegraded`. `avgAuditor` promedia solo casos `scored`.
- `@theforge/shared-types`: nuevos `auditorOutcomeSchema` / `AuditorOutcome` (`mdd-eval-api.ts`), `MDD_TOP_SECTION_TITLE` (`repair-glued-headings.ts`), `token-usage-api.ts` (`TokenUsageSummary` y contadores).
- `@theforge/shared-types`: **retirados** `looksLikeJsonFlattenFlowchart`, `webhookSyncFlowchartBody`, `repairFlattenedWebhookFlowchart`, `repairFlowSectionsToMermaid` (archivo `repair-flow-sections.ts`), `normalizeErDiagramPgTypes`, `repairSequenceArrowParties`, `normalizeSequenceActivationOrder` y `erDiagramHasPkFkComma`.
- `apps/api` (interno): `fixDualApprovalSchemaInDraft` y `RELATION_LABELS` retirados.
- `normalizeMermaidDiagramBody(raw, options?)`: acepta `{ disabledRules }`. Las reglas estructurales no se pueden deshabilitar.

### 5.4 Variables de entorno

- Nuevas, opcionales, enteros ≥ 15000 ms, validadas al arrancar: `LANGGRAPH_MDD_AUDITOR_NODE_BUDGET_MS` (360000), `LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS` (180000), `LANGGRAPH_MDD_CRITIC_BUDGET_MS` (120000), `LANGGRAPH_MDD_CROSS_CONSISTENCY_BUDGET_MS` (120000). Están en `.env.example` (comentadas) y en `apps/api/src/config/README.md`.
- `THREAD_RUN_LOCK_TTL_MS`: opcional, entero ≥ 1000, default 1 200 000 (20 min). Llega validado como número desde `ConfigService`; el servicio lo normaliza a string antes de usarlo.
- `REDIS_URL`: obligatoria en producción (ya lo era para BullMQ). Ahora también es imprescindible para los turnos MDD.

### 5.5 Base de datos

- `Stage.mddLeaseFence BIGINT` nullable (`20261103120000_stage_mdd_lease_fence`).
- `TokenUsage`: `latencyMs INT`, `attempts INT`, `outcome TEXT`, `costKnown BOOL`, `estimated BOOL`, `modelActual TEXT`, todas nullable (`20261103000000_token_usage_telemetry`).
- Claves Redis nuevas: `mdd:thread-fence` (contador del fence). El lease usa `mdd:thread-lock:<projectId>:<stageId|_>`.

### 5.6 Telemetría de llamadas

- `[MDD:LlmCall]`: una línea JSON por invocación (nodo, etiqueta, modelo configurado y real, tokens, latencia, intentos y resultado).
- Resultado (`outcome`): `ok` | `timeout` | `abort` | `error` | `invalid`. `timeout` cubre el deadline; `abort` cubre la cancelación del turno (incluida la que llega durante el backoff); `invalid` cubre salidas fuera de esquema del Manager y del validador.
- `skipCost`: un `error` sin salida parcial (p. ej. 400, 401/403, cuota, 5xx) no se factura: la fila tiene tokens 0 y `costKnown` false. `abort`, `timeout` o un error con salida parcial conservan una estimación chars/4 con coste (`estimated: true`).

## 6. Pasos antes del deploy (en este orden)

1. **Migraciones primero.** Aplicar `packages/database/migrations/20261103000000_token_usage_telemetry/migration.sql` y después `packages/database/migrations/20261103120000_stage_mdd_lease_fence/migration.sql`. Ambas son `ADD COLUMN IF NOT EXISTS`, aditivas y nullable. Equivalentes en `packages/database/scripts/safe-schema-sync.sql` (bloques 10b y 11) si el despliegue usa el script de sincronización. Sin la de `TokenUsage`, las escrituras de telemetría fallan: el servicio solo loguea `No se pudo persistir TokenUsage` y suma `failedWrites` (`getTelemetryHealth()`), sin error visible para el usuario.
2. **Código de API y worker juntos.** El ADR 0004 advierte que las réplicas antiguas escriben sin fence durante el rollout. Desplegar API y worker en la misma ventana y lo antes posible.
3. **Redis.** `REDIS_URL` debe apuntar a la misma instancia para API y worker: el lease y el fence son compartidos entre réplicas. Sin Redis operativo, los turnos MDD fallan con `LOCK_UNAVAILABLE`. Un turno de chat no se reintenta; un job de pipeline reintenta una vez.
4. **Revisar `LANGGRAPH_MDD_*_BUDGET_MS` en Dokploy/Coolify.** Si alguna está definida, debe ser un entero ≥ 15000; si no lo es, la API no arranca (`validateEnv`). Si no están definidas, aplican los defaults de §5.4.
5. **`THREAD_RUN_LOCK_TTL_MS` (opcional).** Solo decide cuánto tarda en liberarse un lease huérfano tras caerse un proceso; el lease se renueva cada 60 s.
6. **Ningún cambio de variable obligatoria nueva.** Solo `REDIS_URL` pasa a ser imprescindible para los turnos MDD, que ya era obligatoria en producción.
7. **Clientes del endpoint retirado.** Buscar consumidores externos de `POST …/mdd/stream/regenerate-section` antes de desplegar. En este repo no queda ninguno (`apps/web` usa jobs); la documentación de despliegue sí lo citaba y se actualizó.
8. **Web y API juntas.** La web nueva interpreta `blocked` con código, `LOCK_UNAVAILABLE` y `LEASE_LOST`. Una web antigua mostraría esos eventos como error genérico.
9. **Prompts.** `MDD_PROMPT_VERSION` = `2026-11-03` (`apps/api/src/modules/ai-analysis/prompts/prompt-version.ts`). Este lote no editó prompts en el diff. Si el despliegue cambia algún prompt, subir la versión; si no, la caché de nodos puede servir salidas de un prompt anterior.
10. **Build de `shared-types` antes de los tests del oráculo.** El oráculo lee `packages/shared-types/dist-cjs`: `pnpm --filter @theforge/shared-types build`.
11. **Después del deploy.** Revisar `[MDD:LlmCall]` en los logs; comprobar que las filas nuevas de `TokenUsage` traen `latencyMs` no nulo; contar `LOCK_UNAVAILABLE` y `LEASE_LOST` en los primeros turnos.

## 7. Cómo verificar

### 7.1 Comandos ejecutados en esta pasada (todos en verde)

```
cd apps/api && node scripts/run-tests.mjs
cd packages/shared-types && node scripts/run-tests.mjs          # tras: pnpm --filter @theforge/shared-types build
cd apps/web && node scripts/run-tests.mjs
cd apps/api && npx tsc --noEmit -p tsconfig.json
cd apps/web && npx tsc -b --noEmit
```

Resultados de esta pasada:

- API: 6166 tests, 6165 pass, 0 fail, 1 skipped.
- shared-types: 701 tests, 701 pass.
- web: 276 tests, 276 pass.
- `tsc` de API y de web: sin errores.
- El `dist-cjs` de shared-types era posterior a `mermaid.ts`; no se recompiló en esta pasada.

### 7.2 Oráculo de Mermaid

```
cd apps/api && node scripts/run-tests.mjs --test-path-pattern=mermaid-oracle
```

- Imprime `BASELINE reparación repairMermaidBlockBody: 29/58`. Es el suelo de regresión (`REPAIR_BASELINE_MIN = 29`).
- Corpus: 270 diagramas (58 inválidos, 212 válidos).

Estricto (ignora `PRESERVATION_KNOWN_CHANGES`):

```
cd apps/api && MERMAID_PRESERVATION_STRICT=1 node scripts/run-tests.mjs --test-path-pattern=mermaid-oracle
```

- Falla exactamente el caso `spec-054-mermaid-fix` en las cuatro etapas que normalizan: `shared.normalizeMermaidInDocument`, `shared.formatDocumentMarkdown`, `api.sanitizeMermaidInDraft` y `api.prepareMddMarkdownForPersist`. Es el único válido que cambia. Cualquier otro fallo en este modo es una regresión.

Foto del formateador:

```
cd apps/api && node scripts/run-tests.mjs --test-path-pattern=format-snapshot
```

Regenerar la foto solo con `UPDATE_SNAPSHOTS=1` y revisar el diff de `__snapshots__/`.

Concordancia jsdom frente a Chrome (no se ejecutó; requiere Chrome de puppeteer): `node apps/api/scripts/mermaid-oracle-concordance.mjs`.

### 7.3 Arranque en producción

No verificado en esta pasada. Para comprobarlo: `NODE_ENV=production` con `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `TOKEN_MASTER_KEYS` y `CORS_ORIGINS` válidos; la API debe arrancar. Con un `LANGGRAPH_MDD_*_BUDGET_MS` de 1000, debe fallar con la lista de variables inválidas (`env.schema.spec.ts` lo cubre en la suite).

## 8. Cómo leer la corrida 3 del eval

**No es comparable con la corrida 2** en coste, `avgAuditor`, `passRate` ni markdown. Se retiraron reglas de Mermaid, el grafo one-shot quedó en serie y la caché de nodos está desactivada en el eval (`runWithNodeCacheDisabled`).

Orden de lectura:

1. **`infraDegraded`.** Si es `true`, más del 20 % de los casos quedaron sin nota del Auditor por causas de infraestructura (`unavailable` con motivo distinto de `invalid`). La corrida mide infraestructura caída, no calidad. Repetirla antes de sacar conclusiones.
2. **`auditorUnavailableCount`.** Casos sin nota, incluidas las salidas de calidad.
3. **`auditorInvalidCount`.** Subconjunto de `auditorUnavailableCount` con motivo `invalid` (el Auditor respondió, pero no con un JSON válido tras reparar). **No cuenta para `infraDegraded`.**
4. **`avgAuditor`.** Promedia solo casos `scored`. Un caso sin nota no vale 0.
5. **`failedLlmCalls` y `totalFailedLlmCalls`.** Llamadas `error`, `timeout` o `abort`. No suman a `llmCalls` ni tienen coste. Un caso con solo fallos aparece sin coste, no con $0 medido.
6. **Coste.** Filas `estimated: true`: tokens por chars/4. Filas `costKnown: false`: modelo sin tarifa en el catálogo; el coste 0 **no** significa gratis, y la tarjeta muestra «coste desconocido». Las llamadas `skipCost` suman 0 tokens.
7. **Versión de prompts:** `2026-11-03`.

## 9. Deuda restante

Cada punto indica archivo y línea. Los marcados «heredado» vienen del lote 2a y no se reverificaron en esta pasada.

- **D-1 — CERRADA en la segunda vuelta de corrección (H3).** `runAgentToolsRound` (`apps/api/src/modules/ai-analysis/utils/mdd-agent-tools-invoke.ts`) recibe `budget { deadlineAt, now }` del turno del Manager, no invoca si quedan < 15 s (`budgetExhausted: true`) y cada llamada va por `invokeLlmWithRetry` con `timeoutMs = min(restante, timeout LLM)`. Queda sin acotar la ejecución de la tool en sí (`tool.invoke`): una tool lenta aún puede exceder el turno.
- **D-2 — PATCH del editor sin lease ni fence (límite declarado en ADR 0004).** `apps/api/src/modules/projects/project-update.service.ts:133` (`update`) recibe `mddContent` en `:139` y lo escribe sin `mddLeaseFence`: el camino no referencia el fence. Un PATCH fuera de turno puede pisar un turno en curso.
- **D-3 — El fence sale en algunas respuestas.** `apps/api/src/modules/projects/project-merge.service.ts:45` define su propio `toApiProject` (sin `omitMddLeaseFence`) y lo usa en `:132`. `apps/api/src/modules/projects/project-notion-portability.service.ts:36` tiene otro `toApiProject` igual. En ambos, `stages[].mddLeaseFence` viaja como número por `json-bigint`. No es un 500, pero contradice la frase del ADR 0004 («el fence no sale en las respuestas de la API»). El clone (`project-clone.util.ts`) no copia el campo.
- **D-4 — Snapshots de delivery gate sin fence.** `apps/api/src/modules/projects/project-mdd-persist.service.ts:166` (`throwMddPipelineBadRequest`, llamado desde `persistMddFromPatch` en `:388`), `:305` (éxito de `persistMddFromBackgroundJob`) y `:431` (éxito de `persistMddFromPatch`) llaman a `persistMddDeliveryGateSnapshot` sin fence. En `:166` puede escribir un turno ya zombi. En `:305` y `:431` solo se alcanza tras una escritura fenceada correcta: la ventana es corta. Corregir pasando `fence`.
- **D-5 — `claimMddWriteFence` no reclama si el proyecto no tiene etapa primaria.** `apps/api/src/modules/projects/projects.service.ts:473` (`if (!targetId) return;`). Un turno sobre ese proyecto corre sin fence. Caso raro: el proyecto debería tener etapas.
- **D-6 — Checkpoint de LangGraph sin fence.** El estado del grafo se guarda sin fence (límite declarado en ADR 0004). Un turno viejo puede escribir su checkpoint; el lease evita la concurrencia, pero no protege el checkpoint frente a un zombi.
- **D-7 — `spec-054`, único válido que cambia.** `packages/shared-types/src/mermaid.ts:2378` (`par-ticipant`) y `:2466` (`block-balance`). Son interdependientes: quitar una rompe el caso. Solución de fondo en la Fase 2 o 3 del oráculo.
- **D-8 — Comas tipográficas `PK，FK` ya no se normalizan.** `packages/shared-types/src/mermaid.ts:637` (`repairErDiagramPkFkCommas`) solo trata la forma `PK FK` sin coma.
- **D-9 — Clone, merge y Notion: cobertura parcial.** Solo las cubre `json-bigint` (ver D-3). Clone copia campos explícitos y no incluye el fence (verificado).
- **D-10 — Comentarios que hablan de «siembra».** `apps/api/src/modules/ai-analysis/checkpoint/thread-run-lock.service.spec.ts:149` dice «siembra del fence: SET … NX», y `thread-run-lock.service.ts:44` dice «(siembra o `INCR` fallan)». El código usa `FENCE_LUA` y no siembra. Cosmético: los tests pasan. Los dos comentarios están fuera de los archivos que este lote permitió editar.
- **D-11 — CERRADA (H7).** `WorkshopMddPanel.tsx` importa `isMddStreamingLoading` de `helpers/mdd-chat-event.ts`; no queda copia en línea.
- **D-12 — Comentario de `auditorInfraCount`.** `apps/api/src/modules/ai-analysis/eval/mdd-eval.types.ts:157` dice «true si `auditorUnavailableCount` supera el 20 %». El cálculo real (`mdd-eval-runner.ts:400–414`) excluye `invalid`. El comentario es inexacto; corregirlo en el próximo toque del archivo.
- **D-13 — Presupuesto de `MDD_PROMPT_VERSION` manual.** `apps/api/src/modules/ai-analysis/prompts/prompt-version.ts`. Subirla al editar prompts es responsabilidad de quien edita. Un hash del contenido de `prompts/` lo evitaría (no implementado).
- **D-14 — Marcador `**Beneficios de las`** (heredado). Sigue en `packages/shared-types/src/repair-pasted-markdown.ts:73`, `:286` y `:344`: es una regla de cliente que no se retiró. Verificado en esta pasada.
- **D-15 — Goldens de `isBareSectionTitle`** (heredado, hallazgo 13 de la auditoría): faltan los casos con año y los títulos sin numeración. No reverificado.
- **D-16 — `mdd-scoped-stream`: `attempts` desde 1** (heredado). No reverificado.
- **D-17 — Adaptadores de chat sin latencia** (heredado). `apps/api/src/modules/ai/adapters/`. No reverificado.
- **D-18 — Oráculo en runtime.** La API no ejecuta el parser de Mermaid; la garantía es el spec de CI (Fase 2, `apps/api/src/modules/mermaid-oracle/README.md`).
- **D-19 — `MDD_WRITE_FENCED` fuera del flujo de la web.** El persistidor lo traduce a `lease_lost`. No verificado el camino de los tools del Manager (`persistMddFromPatch` dentro de un turno), que podría propagar la excepción tal cual.
- **D-20 — Migración antes que el código.** Riesgo operativo (§6, paso 1 y 2), no de código.
- **D-21 — CHANGELOG del lote 2a.** La viñeta que dice «registra por motivo los 66 válidos» está desactualizada; la viñeta del 2b lo corrige con el dato actual (1 válido). No se reescribió la existente.
- **D-22 — Motivo del Auditor fuera del DTO del eval.** `apps/api/src/modules/ai-analysis/eval/mdd-eval-dto.util.ts` no copia `auditorUnavailableReason` (sí está en `mdd-eval.types.ts:125`). El resumen solo distingue `auditorInvalidCount`.
- **D-23 — Etiquetas de log `[MDD regenerate-section]`.** `apps/api/src/modules/ai-analysis/ai-analysis.service.ts` (~2514–2856) conserva el prefijo del nombre antiguo en los logs. Cosmético; no cambia comportamiento.

## 10. Glosario de códigos

| Código | Origen | Qué significa | Qué hace la web | Reintento en job |
|---|---|---|---|---|
| `LOCK_UNAVAILABLE` | `ThreadLockUnavailableError` (`thread-run-lock.service.ts`) | Redis no está listo, falló el `SET`, falló la obtención del fence o no se pudo resolver la etapa del hilo. Nada se ejecutó. | Restaura el estado previo al turno, sin recargar (con edición previa, la conserva con aviso). | Sí, una vez en pipeline (`MAX_ATTEMPTS = 2`). Chat: no. |
| `LEASE_LOST` | `ThreadLeaseLostError` | El lease se perdió con confirmación (renovación rechazada, compare-and-delete sin token propio, TTL vencido), o la etapa tiene un fence mayor, o el persistidor devolvió `lease_lost`. El resultado se descarta. | Recarga el proyecto desde el servidor si no hubo edición del usuario; si la hubo, la conserva con aviso. | No. |
| `THREAD_BUSY` | `ThreadBusyError` | Otro turno ya tiene el lease del hilo. | Mensaje `THREAD_BUSY_MESSAGE`; el manejo concreto en la UI no se reverificó. | No. |
| `MDD_PERSIST_FLOOR` | `ai-analysis.service.ts:180`; regla en `utils/mdd-draft-persist-floor.util.ts` (`evaluateMddDraftPersistFloor`) | Suelo anti-wipe: un borrador intermedio (no el cierre) queda por debajo de un porcentaje mínimo del documento guardado. En el cierre no aplica salvo `enforceFloorOnFinalize`. | `blocked`: restaura el editor; no hay `persistedOnServer`. | No (`MddPersistBlockedError` en el cierre del job). |
| `MDD_PERSIST_TOO_SHORT` | `ai-analysis.service.ts:184` | El resultado tiene menos de 48 caracteres útiles y ya hay documento guardado. Sin documento previo no se emite `blocked` (`nothingToPreserve`). | `blocked`: igual que `MDD_PERSIST_FLOOR`. | No. |
| `MDD_WRITE_FENCED` | `MddWriteFencedError` (`project-mdd-persist.service.ts:47`) | Una escritura fenceada no afectó filas porque la etapa tiene un fence mayor. El persistidor lo traduce a `lease_lost`. | No llega a la web por ese camino (ver D-19). | No. |
| `CANCELLED` | `executeChatJob` (`mdd-queue.service.ts`) | Cancelación del usuario o del administrador. | Terminal del relay (`error` con `code: "CANCELLED"`); el tratamiento en la UI no se reverificó. | No. |
| `PROJECT_LEVEL_FORBIDDEN` | `apps/api/src/common/access/project-access.service.ts:12` (lote 1) | Acción reservada al dueño del proyecto (403). | Mensaje de permisos. | No. |

Motivos del Auditor (`auditorUnavailableReason`): `invalid` (sin JSON válido tras reparar; cuenta como calidad), `transport` (fallo de red o proveedor), `error` (excepción no clasificada), `deadline` (presupuesto del nodo agotado).

Motivos del resultado de un LLM (`reason` de `invokeLlmStructured`): `transport`, `invalid`, `aborted`, `deadline`.

## Segunda vuelta de corrección (2026-11-03, tras la revisión del 2b)

- **H1 (alta, web):** con cambios sin guardar previos al turno, `LEASE_LOST` ya no recarga desde el servidor (perdía la edición): restaura el snapshot, `synced: false` y avisa que hay una versión más nueva. La recarga (`fetchProject` con `preferServerMdd`) solo ocurre cuando el editor solo contenía salida del stream. `LOCK_UNAVAILABLE` nunca recarga y muestra su propio aviso (H4). Tabla completa de decisión en `apps/web/src/store/workshop/helpers/mdd-chat-event.spec.ts` (17 casos).
- **H2:** «Auditar MDD» y el envío de respuestas de la auditoría manual deshabilitados durante el stream (`MddManualAudit.tsx` recibe `disabled`).
- **H3:** presupuesto del turno del Manager aplicado también a la ronda de tools (`runAgentToolsRound` devuelve `{ text, budgetExhausted }`).
- **H6:** crear, editar, transicionar y listar etapas ya no devuelven `mddLeaseFence` (`omitMddLeaseFence` exportada de `project-api.util.ts`).
- **H8:** `ai-analysis.service.ts` importa `ProjectsService`, `MddWriteFencedError` y `pickPrimaryStage` desde `projects/index.ts`.
- Specs añadidos: S1 (el generador del stream HTTP ve `getActiveMddLeaseFence()`), S2 (`ProjectsService.claimMddWriteFence`), S3 (matriz web), S4 (`search_memory` que agota el presupuesto).
