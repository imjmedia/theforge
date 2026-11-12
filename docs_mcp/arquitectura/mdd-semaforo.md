---
id: mdd-semaforo
title: MDD y Semáforo
category: Arquitectura
last_updated: 2026-11-12
---

# MDD y Semáforo

> **AI Context Brief:** Un único núcleo (`evaluateMddSemaphore` en `@theforge/shared-types/semaphore`) alimenta panel GET/POST, lista de proyectos, composite y puerta de entregables. `StageSemaphoreSyncService` es el único escritor de color en BD (CAS). Tercer indicador aparte: heurísticas en `sdd-integration.service.ts` (~731–746) para analyze/repo-handoff — fuera del semáforo del Workshop.

## 1. Uso básico

```typescript
// Panel Workshop — GET/POST /ai-analysis/estimation (no escriben Stage):
const metrics = await fetchEstimation(projectId, stageId);
// metrics.semaphore.status: "red" | "yellow" | "green"
// metrics.persistedStale?: true si la lista puede estar desfasada

// Lista / gate — Prisma Stage.status: ROJO | AMARILLO | VERDE
// Escrito solo por StageSemaphoreSyncService.syncFromPersisted
```

## 2. Contratos

| Capa | Fuente | Valores |
| ---- | ------ | ------- |
| **Viva (UI)** | `EstimationService.getLiveMetricsForProject` → núcleo | `semaphore.status`, `semaphore.headline`, `persistedStale` |
| **Persistida** | `StageSemaphoreSyncService` | Prisma `Status`; `shortTermContext.semaphoreSync.inputsHash` |
| **Costo** | `countCostDrivers` + `computeCostEstimation` | Misma fórmula en panel, web y `ProjectEstimationRecalcService` |

Escala única: verde ≥90 integral/titular según fase, amarillo ≥85 (`packages/shared-types/src/semaphore/scale.ts`). El color **no** exige `gapCount === 0`; los blockers del delivery gate fuerzan rojo vía núcleo.

Alias `@deprecated` en respuestas: `status` = `semaphore.status`, `precision` = integral o titular.

## 3. Restricciones

- GET/POST estimación: **sin escrituras** en BD (RF-12).
- PATCH MDD/BRD/entregables: sync con la **etapa editada**, no solo la primaria.
- Durante cascada activa: no sync intermedio; una vez al final (`deliverables-cascade.service.ts`).
- Inventario CI: `stage-semaphore-writers.inventory.spec.ts`.

## 4. Referencias

- ADR [`0007`](../../docs/adr/0007-nucleo-unico-semaforo-mdd.md)
- Plan: `arquitectura/semaforo-alineacion/`
