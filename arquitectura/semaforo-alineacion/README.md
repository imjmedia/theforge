# Semáforo del MDD alineado

| Campo | Valor |
|---|---|
| Fecha | 2026-11-11 |
| Modo | Modificación (sobre código existente) |
| Repo | `imjmedia/theforge` (monorepo pnpm 9.15.9 + Turborepo) |
| Rama base | `master` (commit `06a0d161`) |
| Estado | **Aprobado, sin ejecutar** |
| Autor del plan | `planificador`, con dictámenes de `experto-backend-nestjs` y `experto-arquitectura` |
| Decisiones de producto | J1–J15 (Jorge, 2026-11-11), ver [06-riesgos-y-decisiones.md](./06-riesgos-y-decisiones.md) |
| Pasos | P0–P16 en 22 fichas (P1, P4, P5, P8 y P9 divididos en a/b; ver [tasks/TASKS.md](./tasks/TASKS.md)) |

> **Ariadne:** el grafo estaba `stale` (último indexado 2026-11-04) y **no se usó** para planear. Todas las rutas y líneas `archivo:línea` salen de lectura directa del código en `06a0d161`. Quien ejecute debe resincronizar Ariadne (`get_sync_status` → resync) antes de usar `validate_before_edit` / `detect_changes`, y si el grafo contradice el código, manda el código.

## Resumen

1. Hoy el semáforo del MDD (color rojo/amarillo/verde y % titular) se calcula en **al menos cuatro lugares** con reglas distintas: la capa viva (`estimation.service.ts`), `SemaphoreService`, el composite de readiness y la web (`effectiveStatus`). El mismo contenido puede verse verde en el panel, amarillo en el composite y rojo en la lista. La exploración encontró 27 defectos (D1–D27).
2. El cambio crea un **núcleo puro** en `packages/shared-types/src/semaphore/` (`evaluateMddSemaphore`, `evaluateDeliverablesGate`, escala única 85/90, completitud por fase) que consumen panel, lista, composite, streams y la puerta de entregables.
3. Un MDD perfecto puede ser **verde antes de la cascada** (completitud `pre_cascade`: MDD 0.5 / BRD 0.3 / Spec 0.2) con la nota «MDD listo; genera entregables».
4. Solo lo **persistido** escribe `Stage.status`/`precisionScore`, a través de un único escritor (`StageSemaphoreSyncService`, CAS por `Stage.updatedAt`) sobre la **etapa editada**. GET y POST de estimación ya no escriben.
5. Detectores heurísticos corregidos (PostgreSQL ≠ POST, Mermaid múltiple, «fallo», `/verify`), costo con **una sola fórmula** en `business-rules`, Design-First por el mismo evaluador, y la web solo refleja `semaphore`.
6. La puerta de entregables «exigir verde» queda tras el flag `DELIVERABLES_GATE_REQUIRE_GREEN` (apagado al desplegar; se enciende tras backfill y revisar `--dry-run`).

## Índice

| Documento | Contenido |
|---|---|
| [tasks/HANDOFF.md](./tasks/HANDOFF.md) | Entrega al ejecutor: precondiciones, reglas de ejecución, orden |
| [01-PRD.md](./01-PRD.md) | Problema, mapa actual, defectos D1–D27, objetivos, usuarios, historias, RF-01…RF-22, RNF-01…RNF-07 |
| [02-estructura-de-archivos.md](./02-estructura-de-archivos.md) | Árbol `[nuevo]`/`[modifica]`, archivo → responsabilidad → paso, zonas que no se tocan |
| [03-arquitectura-y-diseno.md](./03-arquitectura-y-diseno.md) | Componentes, flujo de datos, contratos, escala, completitud por fase, sync CAS, puerta, flags, patrones, alternativas |
| [04-plan-de-pruebas.md](./04-plan-de-pruebas.md) | Pirámide, matriz RF → prueba → comando, fixtures, mocks, criterios de salida, verificación visual y backfill |
| [05-casos-limite.md](./05-casos-limite.md) | CL-01…CL-33 con prueba y paso |
| [06-riesgos-y-decisiones.md](./06-riesgos-y-decisiones.md) | Riesgos, supuestos, decisiones J1–J15, dictámenes y conflictos, borrador ADR-0007, preguntas abiertas, discrepancias |
| [tasks/TASKS.md](./tasks/TASKS.md) | Fichas de ejecución P0–P16 en orden |

## Orden de lectura recomendado

1. [README](./README.md) (este archivo)
2. [tasks/HANDOFF.md](./tasks/HANDOFF.md)
3. [01-PRD.md](./01-PRD.md)
4. [03-arquitectura-y-diseno.md](./03-arquitectura-y-diseno.md)
5. [02-estructura-de-archivos.md](./02-estructura-de-archivos.md)
6. [05-casos-limite.md](./05-casos-limite.md)
7. [04-plan-de-pruebas.md](./04-plan-de-pruebas.md)
8. [06-riesgos-y-decisiones.md](./06-riesgos-y-decisiones.md)
9. [tasks/TASKS.md](./tasks/TASKS.md)

## Reglas transversales

- Cada paso añade su línea en `CHANGELOG.md` bajo `## [Unreleased]` (así se llama la sección en este repo) **en el mismo cambio**.
- Sin commit, push ni deploy salvo pedido explícito de Jorge.
- No existe `docs:check` en el repo; la verificación de documentación es manual (P15).
- La ejecución del backfill en producción requiere aprobación de Jorge (fuera de alcance de este paquete).
- Dependencias entre pasos: P0 → P1; P1 → todos; P2 → P13; P3, P4 → P5; P5 → P6, P7, P8, P12; P8 → P9, P10; P10 → P11; P14 tras P9; P15 tras todo; P16 último. **P8 y P9 se despliegan juntos.**
