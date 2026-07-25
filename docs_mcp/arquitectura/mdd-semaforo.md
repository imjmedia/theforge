---
id: mdd-semaforo
title: MDD y Semáforo
category: Arquitectura
last_updated: 2026-06-29
---

# MDD y Semáforo

> **AI Context Brief:** El MDD (Master Design Document) es la "constitución" SDD de 7 secciones de una etapa; el semáforo mide su calidad/listeza. Hay dos capas de semáforo: una viva (UI) y otra persistida (gate de entregables). Léelo antes de tocar scoring o gates.

## 1. Uso Básico (Quick Start)

```typescript
// Semáforo VIVO (calidad MDD + costo) — web pide a la API de estimación:
//   POST /ai-analysis/estimation  -> liveMetrics.status: "red" | "yellow" | "green"
import { useWorkshopStore } from "@/store/workshopStore";
const status = useWorkshopStore((s) => s.liveMetrics?.status);

// Gate PERSISTIDO (entregables SDD) — Prisma Stage.status:
//   enum Status { ROJO, AMARILLO, VERDE }
const stageStatus = useWorkshopStore((s) => s.project?.status);
```

## 2. API & Contrato de Tipos (Specs)

| Capa                         | Archivo                                                          | Tipo / valores                                  | Comportamiento                                                  |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| **Viva (UI: calidad+costo)** | `apps/api/src/modules/ai-analysis/estimation/estimation.service.ts` (+ `.types.ts`) | `SemaphoreStatusLive = "red" \| "yellow" \| "green"` | `calculateLiveMetrics()` puntúa el MDD. Umbrales `PRECISION_RED_MAX=85`, `PRECISION_GREEN_MIN=90`; verde requiere trazabilidad ≥90% y `gapCount≤5` (`meetsIntegralLiveGreenCriteria`). |
| **Persistida (gate SDD)**    | `apps/api/src/modules/engine/semaphore.service.ts`              | Prisma `enum Status { ROJO, AMARILLO, VERDE }`  | `SemaphoreService.evaluate()` gatea por `ComplexityLevel` + presencia de entregables + MDD JSON (HIGH). |

```typescript
// estimation.types.ts
export type SemaphoreStatusLive = "red" | "yellow" | "green";

// estimation.service.ts (regla de color)
const hasGreenCriteria = meetsIntegralLiveGreenCriteria({ precision, consistencyScore, crossDocumentGapCount: gapCount });
status = hasGreenCriteria ? "green" : precision >= PRECISION_RED_MAX ? "yellow" : "red";
```

**Prisma** (`packages/database/schema.prisma`): `Stage.status`, `Stage.precisionScore`, modelo `Estimation` (horas/MXN, no color). **UI:** `WorkshopView.tsx` (columna 3) + `WorkshopMetricsColumnInner.tsx`.

## 3. Decisiones de Diseño y Restricciones

- **Regla 1:** No confundas las dos capas: **viva** = `"red"/"yellow"/"green"` (calidad MDD en tiempo real); **persistida** = `ROJO/AMARILLO/VERDE` (gate de entregables en BD). Tienen fuentes y reglas distintas.
- **Regla 2:** El umbral de "verde" exige `gapCount === 0`; no marques verde solo por precisión alta.
- **Regla 3:** El MDD tiene 7 secciones (Blueprint, modelo §3, API §4, seguridad §5, integración/infra §6/§7…); respeta esa estructura al generarlo o editarlo.
- **Regla 4:** El gate persistido depende de `ComplexityLevel` (LOW/MEDIUM/HIGH); HIGH exige MDD JSON estructurado.
