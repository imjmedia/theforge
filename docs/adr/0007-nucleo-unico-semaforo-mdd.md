# ADR-0007 — Núcleo único del semáforo MDD

## Estado

Aceptado (2026-11-12).

## Contexto

El color del MDD, la lista de proyectos, el panel Workshop, la puerta de entregables y el costo se calculaban con rutas paralelas (composite 78/82, `SemaphoreService` LOW/MEDIUM, `syncStageSemaphoreFromLiveMetrics`, contadores de costo distintos).

## Decisión

1. **Un solo evaluador** en `packages/shared-types/src/semaphore/` (`evaluateMddSemaphore`).
2. **Entradas** vía `buildSemaphoreInputs` / fachadas `calculateLiveMetrics` / `evaluateForStream`.
3. **Escritura de etapa** solo `StageSemaphoreSyncService.syncFromPersisted` (CAS).
4. **GET/POST estimación** no escriben `Stage`; exponen `persistedStale`.
5. **Costo** `computeCostEstimation` + `countCostDrivers` en `@theforge/business-rules`.
6. **Degradadores** Figma/Constitución en `SemaphoreService` (sin buckets de color).
7. Puerta compartida `evaluateDeliverablesGate`; flag `DELIVERABLES_GATE_REQUIRE_GREEN` apagado por defecto.

## Consecuencias

- Mismas entradas persistidas → panel GET = lista = composite = puerta (invariante).
- POST con borrador usa `source:'draft'`; streams usan `source:'stream'`.
- Alias `@deprecated` en métricas vivas hasta retirada acordada (J15).

## Alternativas descartadas

- Mantener `applyCompositeReadinessGates` y topes 78/82 (J9).
- Seguir escribiendo etapa desde GET/POST (D25).
