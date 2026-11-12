# AI Analysis / Estimation

Módulo de estimación en vivo: semáforo del MDD, costo MXN y desglose de precisión para el Workshop.

## Capas

| Pieza | Archivo | Rol |
| ----- | ------- | --- |
| **Núcleo** | `@theforge/shared-types/semaphore` | `evaluateMddSemaphore`, escala 85/90, completitud por fase, `evaluateDeliverablesGate`. |
| **Fábrica** | `semaphore-inputs.factory.ts` | `buildSemaphoreInputs` / `buildSemaphoreInputsFromLoaded` → entradas persistidas + `inputsHash`. |
| **Fachada** | `estimation.service.ts` | `calculateLiveMetrics`, `getLiveMetricsForProject`, `evaluateForStream`; delega fábrica → núcleo → `computeCostEstimation` + `countCostDrivers`. |
| **Persistencia** | `projects/stage-semaphore-sync.service.ts` | Único escritor de `Stage.status` / `precisionScore` (CAS); GET/POST de estimación **no escriben** (RF-12). |
| **Tipos** | `estimation.types.ts` | `LiveMetricsResult` con `semaphore: MddSemaphoreVerdict`, `persistedStale?`; alias `status` / `precision` `@deprecated`. |
| **Utilidades** | `completeness.util.ts`, `consistency.util.ts`, `live-semaphore-status.util.ts` | Completitud por fase, consistencia BRD→MDD, mapeo live↔Prisma `Status`. |

## Contratos HTTP

- `GET /ai-analysis/estimation` y `POST /ai-analysis/estimation` devuelven `semaphore`, `persistedStale`, métricas de costo y alias históricos.
- `persistedStale=true` cuando `shortTermContext.semaphoreSync.inputsHash` difiere del hash actual (p. ej. BRD cambiado sin sync).

## Pruebas

- `__tests__/estimation-semaphore.spec.ts` — P5b y P8b (sin escrituras en GET/POST).
- `__tests__/estimation-semaphore.characterization.spec.ts` — golden de fixtures `eval/mdd`.
