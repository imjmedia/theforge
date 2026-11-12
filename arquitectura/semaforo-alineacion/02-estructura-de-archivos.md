# 02 — Estructura de archivos

[← README](./README.md) · Anterior: [03-arquitectura-y-diseno.md](./03-arquitectura-y-diseno.md) · Siguiente: [05-casos-limite.md](./05-casos-limite.md)

Leyenda: `[nuevo]` archivo creado; `[modifica]` archivo existente que cambia. **No hay `[elimina]`**: lo que se retira (por ejemplo `syncStageSemaphoreFromLiveMetrics`, `effectiveStatus`, `applySddPrecisionGates`, la rama DF paralela) son símbolos dentro de archivos que se modifican. `projects/conformance-gaps.util.ts` queda como re-export `@deprecated`.

## 1. Árbol

```
.
├── CHANGELOG.md                                                        [modifica] línea en ## [Unreleased] por paso
├── docs/
│   ├── adr/0007-nucleo-unico-semaforo-mdd.md                           [nuevo]
│   └── notebooklm/THEFORGE-INDEX.md                                    [modifica] §4–§5
├── docs_mcp/arquitectura/mdd-semaforo.md                               [modifica]
├── packages/
│   ├── shared-types/src/
│   │   ├── index.ts                                                    [modifica] export semaphore
│   │   ├── readiness-audit.util.ts                                     [modifica] isHumanGap por prefijo; topes @deprecated
│   │   ├── readiness-audit.util.spec.ts                                [modifica] casos de prefijo
│   │   └── semaphore/
│   │       ├── scale.ts                                                [nuevo] umbrales y statusFromScore
│   │       ├── completeness-phase.ts                                   [nuevo] fases, derivativesState por perfil, pesos, integral
│   │       ├── evaluate.ts                                             [nuevo] evaluateMddSemaphore (orden de reglas)
│   │       ├── deliverables-gate.ts                                    [nuevo] evaluateDeliverablesGate
│   │       ├── verdict.schema.ts                                       [nuevo] tipos + zod del veredicto
│   │       ├── hash-normalize.ts                                       [nuevo] normalizeMddForHash
│   │       ├── index.ts                                                [nuevo] barrel
│   │       └── semaphore.spec.ts                                       [nuevo] tablas, propiedad «ninguna regla sube el color», fases
│   └── business-rules/src/
│       ├── cost-drivers.ts                                             [nuevo] countCostDrivers(mdd)
│       ├── cost-drivers.spec.ts                                        [nuevo] conteos (PostgreSQL ≠ POST, CREATE TABLE, §4 anclado)
│       ├── cost-parity.characterization.spec.ts                        [nuevo] P0
│       └── index.ts                                                    [modifica] export
├── apps/
│   ├── api/
│   │   ├── scripts/recalc-stage-semaphores.ts                          [nuevo] backfill --dry-run --limit --project
│   │   └── src/
│   │       ├── config/<archivo de config tipada existente>             [modifica] flag DELIVERABLES_GATE_REQUIRE_GREEN (el implementador ubica el archivo; candidato env.schema.ts)
│   │       └── modules/
│   │           ├── ai-analysis/
│   │           │   ├── ai-analysis.service.ts                          [modifica] streams con evaluador, complejidad real, clearLiveDraft al cancelar
│   │           │   ├── ai-analysis.controller.ts                       [modifica] respuesta con semaphore/persistedStale/deliverablesGate
│   │           │   ├── nodes/mdd-manager/manager-state-handlers.ts     [modifica] evaluador
│   │           │   ├── mdd/mdd-manual-audit.service.ts                 [modifica] hash persistido + sync
│   │           │   ├── utils/
│   │           │   │   ├── mdd-delivery-gate.util.ts                   [modifica] D14 sin rama muerta
│   │           │   │   ├── mdd-delivery-gate-context.util.ts           [nuevo] resolveDeliveryGateContext
│   │           │   │   ├── mdd-delivery-gate-context.util.spec.ts      [nuevo]
│   │           │   │   └── mdd-delivery-gate-guard.util.ts             [modifica] cuerpo 409 con gate
│   │           │   └── estimation/
│   │           │       ├── README.md                                   [modifica]
│   │           │       ├── estimation.service.ts                       [modifica] fachada, sin sync, costo vía business-rules
│   │           │       ├── estimation.types.ts                         [modifica] semaphore, persistedStale, alias
│   │           │       ├── completeness.util.ts                        [modifica] pesos por fase
│   │           │       ├── consistency.util.ts                         [modifica] Spec solo fuente
│   │           │       ├── brd-mdd-traceability.util.ts                [modifica] fuente única de trazabilidad
│   │           │       ├── mdd-draft-hash.util.ts                      [modifica] usa normalizeMddForHash
│   │           │       ├── estimation-design-first.util.ts             [modifica] fases como entradas; sin minSemaphore paralelo
│   │           │       ├── estimation.design-first.spec.ts             [modifica]
│   │           │       ├── live-semaphore-status.util.ts               [modifica] mapeo único live↔DB
│   │           │       ├── mdd-section-detectors.util.ts               [nuevo] detectReferenceSections/computeConsistencyGaps anclados
│   │           │       ├── semaphore-inputs.factory.ts                 [nuevo] buildSemaphoreInputs
│   │           │       ├── __fixtures__/semaphore/                     [nuevo] 6 fixtures
│   │           │       │   ├── mermaid-flowchart-then-er.md
│   │           │       │   ├── postgres-sin-post.md
│   │           │       │   ├── fallo-red-sin-bloqueo.md
│   │           │       │   ├── email-verify-sin-mfa.md
│   │           │       │   ├── endpoints-en-contexto-sin-s4.md
│   │           │       │   └── design-first-fase3-pendiente.json
│   │           │       └── __tests__/
│   │           │           ├── consistency.util.spec.ts                [modifica]
│   │           │           ├── estimation-auditor-hash.spec.ts         [modifica] CL-05
│   │           │           ├── mdd-section-detectors.util.spec.ts      [nuevo]
│   │           │           ├── semaphore-inputs.factory.spec.ts        [nuevo]
│   │           │           ├── estimation-semaphore.characterization.spec.ts [nuevo] P0
│   │           │           ├── estimation-semaphore.spec.ts            [nuevo] equivalencia, sin escrituras
│   │           │           └── estimation-stream-parity.spec.ts        [nuevo] P6
│   │           ├── engine/
│   │           │   ├── README.md                                       [modifica]
│   │           │   ├── conformance-gaps.util.ts                        [nuevo] movido desde projects
│   │           │   ├── cost-calculator.service.ts                      [modifica] delega en business-rules
│   │           │   ├── mdd-internal-audit.util.ts                      [modifica] D20–D22, Mermaid múltiple
│   │           │   ├── mdd-internal-audit.util.spec.ts                 [modifica]
│   │           │   ├── mdd-update-pipeline.service.ts                  [modifica] sin color de fallback; gate con contexto único
│   │           │   ├── semaphore.service.ts                            [modifica] solo degradadores Figma/Constitución
│   │           │   └── semaphore.service.spec.ts                       [modifica]
│   │           └── projects/
│   │               ├── README.md                                       [modifica]
│   │               ├── conformance-gaps.util.ts                        [modifica] re-export @deprecated
│   │               ├── deliverables-cascade.service.ts                 [modifica]
│   │               ├── project-brd.service.ts                          [modifica]
│   │               ├── project-conformance.service.ts                  [modifica]
│   │               ├── project-deliverable-gate.service.ts             [modifica] puerta compartida + delegación
│   │               ├── project-deliverable-gate.service.spec.ts        [nuevo]
│   │               ├── project-estimation-recalc.service.ts            [modifica] countCostDrivers
│   │               ├── project-mdd-persist.service.ts                  [modifica] sync etapa editada, hash del snapshot
│   │               ├── project-merge.service.ts                        [modifica]
│   │               ├── project-semaphore-composite.util.ts             [modifica] adaptador del veredicto
│   │               ├── project-semaphore-composite.util.spec.ts        [nuevo] (P0 caracterización + P7)
│   │               ├── project-update.service.ts                       [modifica]
│   │               ├── projects.module.ts                              [modifica] provider
│   │               ├── projects.service.ts                             [modifica]
│   │               ├── stage-semaphore-sync.service.ts                 [nuevo] único escritor (CAS)
│   │               ├── stage-semaphore-sync.service.spec.ts            [nuevo]
│   │               └── stage-semaphore-writers.inventory.spec.ts       [nuevo] lista permitida de escritores
│   └── web/src/
│       ├── utils/
│       │   ├── workshopSemaphoreStatus.ts                              [modifica] lee semaphore
│       │   ├── workshopSemaphoreStatus.spec.ts                         [nuevo]
│       │   └── costCalculator.ts                                       [modifica] countCostDrivers
│       ├── views/WorkshopMetricsColumnInner.tsx                        [modifica] sin effectiveStatus; canGenerate=deliverablesGate
│       └── store/workshop/
│           ├── slice-deliverables.ts                                   [modifica] fetchEstimation no pisa project.status con draft
│           ├── types.ts                                                [modifica] tipo semaphore
│           └── helpers/mdd-chat-event.ts                               [modifica] semaphore del done
```

Rutas base: `apps/api/src/modules/ai-analysis/estimation/` se abrevia `estimation/`; `apps/api/src/modules/engine/` → `engine/`; `apps/api/src/modules/projects/` → `projects/`.

## 2. Archivo → responsabilidad → paso

Un archivo puede aparecer en varios pasos. Cuando el plan no asigna un paso de forma explícita, se indica «(inferido)». En [tasks/TASKS.md](./tasks/TASKS.md) los pasos P1, P4, P5, P8 y P9 están divididos en fichas `a`/`b` (1a/1b, 4a/4b, 5a/5b, 8a/8b, 9a/9b) para no superar 8 archivos por ficha; «P5» en esta tabla cubre 5a y 5b.

| Archivo | Responsabilidad tras el cambio | Pasos |
|---|---|---|
| `packages/shared-types/src/semaphore/scale.ts` | Umbrales 85/90 y `statusFromScore` | P1 |
| `packages/shared-types/src/semaphore/completeness-phase.ts` | `resolveCompletenessPhase`, `derivativesState` por perfil, `DOC_WEIGHTS_BY_PHASE`, `computeIntegralScore` | P1 |
| `packages/shared-types/src/semaphore/evaluate.ts` | `evaluateMddSemaphore` (puntaje → gate → conformidad y gaps → tope DF → derivados → puerta) | P1 |
| `packages/shared-types/src/semaphore/deliverables-gate.ts` | `evaluateDeliverablesGate` (reglas high/low_medium/design_first/legacy) | P1 |
| `packages/shared-types/src/semaphore/verdict.schema.ts` | Tipos y `mddSemaphoreVerdictSchema` (zod) | P1 |
| `packages/shared-types/src/semaphore/hash-normalize.ts` | `normalizeMddForHash` (sin `node:crypto`) | P1 |
| `packages/shared-types/src/semaphore/index.ts` | Barrel | P1 |
| `packages/shared-types/src/semaphore/semaphore.spec.ts` | Tablas, propiedad «ninguna regla sube el color», fases; CL-01, CL-02, CL-06, CL-20, CL-26, CL-33 | P1 |
| `packages/shared-types/src/index.ts` | Exporta `semaphore` | P1 |
| `packages/shared-types/src/readiness-audit.util.ts` | `isHumanGap` por prefijo; topes `READINESS_*_AMARILLO_CAP` `@deprecated`; `applyCompositeReadinessGates` reemplazado por el núcleo | P4, P7 (inferido para el reemplazo) |
| `packages/shared-types/src/readiness-audit.util.spec.ts` | Casos de prefijo (CL-32) | P4 |
| `packages/business-rules/src/cost-drivers.ts` | `countCostDrivers(mdd)`: contador único de entidades/pantallas/endpoints | P2 |
| `packages/business-rules/src/cost-drivers.spec.ts` | Conteos (PostgreSQL ≠ POST, CREATE TABLE, §4 anclado); CL-31 | P2, P13 |
| `packages/business-rules/src/cost-parity.characterization.spec.ts` | Caracterización de las 3 vías de costo; se actualiza al unificar | P0, P13 |
| `packages/business-rules/src/index.ts` | Export de `countCostDrivers` | P2 |
| `estimation/mdd-section-detectors.util.ts` | `detectReferenceSections`/`computeConsistencyGaps` anclados a `^##\s+\d\.` (extraídos de `estimation.service.ts:113-191`, `:531-599`) | P3 |
| `estimation/__tests__/mdd-section-detectors.util.spec.ts` | CL-09, CL-10 | P3 |
| `estimation/__fixtures__/semaphore/*.md` (5) | Fixtures de detectores | P3 |
| `estimation/__fixtures__/semaphore/design-first-fase3-pendiente.json` | Fixture DF (CL-24) | P12 (inferido; el plan lo lista entre las 6 fixtures) |
| `estimation/semaphore-inputs.factory.ts` | `buildSemaphoreInputs` (carga etapa/proyecto una vez; perfil, `derivativesState`, Auditor por hash, contexto del gate, conformidad, gaps deduplicados) | P5, P12 (perfil DF) |
| `estimation/__tests__/semaphore-inputs.factory.spec.ts` | CL-14, CL-21 | P5 |
| `estimation/__tests__/estimation-semaphore.characterization.spec.ts` | Fija comportamiento actual; casos `// CAMBIA EN Pn` | P0 (se actualiza en el paso que cambia cada caso) |
| `estimation/__tests__/estimation-semaphore.spec.ts` | Equivalencia live = composite = sync; GET/POST sin escrituras; CL-01, CL-03, CL-04, CL-18, CL-19, CL-28 | P5, P8 |
| `estimation/__tests__/estimation-stream-parity.spec.ts` | Stream `done` = POST | P6 |
| `estimation/estimation.service.ts` | Fachada fábrica → núcleo → costo; sin escritura; sin rama DF paralela; `evaluateForStream`; `saveMddAuditSnapshot` con hash canónico | P3 (solo imports), P5, P6, P8, P9, P12, P13 |
| `estimation/estimation.types.ts` | `LiveMetricsResult` con `semaphore`, `persistedStale`, alias `@deprecated` | P5 |
| `estimation/completeness.util.ts` | Pesos por fase | P5 |
| `estimation/consistency.util.ts` | Spec solo fuente, nunca destino | P4 |
| `estimation/__tests__/consistency.util.spec.ts` | Casos RF-10 | P4 |
| `estimation/brd-mdd-traceability.util.ts` | Fuente única de trazabilidad BRD→MDD | P4 |
| `estimation/mdd-draft-hash.util.ts` | Usa `normalizeMddForHash` | P9 |
| `estimation/estimation-design-first.util.ts` | Fases como entradas del núcleo; sin `minSemaphore` paralelo | P12 |
| `estimation/estimation.design-first.spec.ts` | CL-23, CL-24, CL-25 | P12 |
| `estimation/__tests__/estimation-auditor-hash.spec.ts` | Ampliado con CL-05 | P9 |
| `estimation/live-semaphore-status.util.ts` | Mapeo único live↔DB | P8 (ficha 8a, subtarea 8a.6) |
| `estimation/README.md` | Documentación del módulo | P15 |
| `ai-analysis/utils/mdd-delivery-gate.util.ts` | Sin rama amarilla muerta (D14) | P4 |
| `ai-analysis/utils/mdd-delivery-gate-context.util.ts` | `resolveDeliveryGateContext` (perfil único) | P4 (función); callers en P5, P7, P8, P10 |
| `ai-analysis/utils/mdd-delivery-gate-context.util.spec.ts` | Mismo MDD → mismo `ok`/`blockers`/`score` | P4 |
| `ai-analysis/utils/mdd-delivery-gate-guard.util.ts` | Cuerpo 409 con `gate`; `ERR_DELIVERABLES_GATE` | P10 |
| `ai-analysis/ai-analysis.service.ts` | Streams con evaluador; complejidad real; `clearLiveDraft` al cancelar | P6 |
| `ai-analysis/ai-analysis.controller.ts` | Respuesta con `semaphore`, `persistedStale`, `deliverablesGate` | P8, P10 |
| `ai-analysis/nodes/mdd-manager/manager-state-handlers.ts` | Usa el evaluador | P6 |
| `ai-analysis/mdd/mdd-manual-audit.service.ts` | Hash persistido + sync tras `saveMddAuditSnapshot` | P9 |
| `engine/mdd-internal-audit.util.ts` | D20–D22, Mermaid múltiple | P3 |
| `engine/mdd-internal-audit.util.spec.ts` | CL-11, CL-12, CL-13 | P3 |
| `engine/conformance-gaps.util.ts` | Gaps de conformidad (movido desde `projects/`) | P5 |
| `engine/semaphore.service.ts` | Solo degradadores `figmaGateOk` y Constitución; sin buckets ni `applySddPrecisionGates` | P7 |
| `engine/semaphore.service.spec.ts` | Degradadores | P7 |
| `engine/mdd-update-pipeline.service.ts` | Sin color de fallback; gate con contexto único en ambas ramas | P7 |
| `engine/cost-calculator.service.ts` | Delega en business-rules | P13 |
| `engine/README.md` | Documentación del módulo | P15 |
| `projects/conformance-gaps.util.ts` | Re-export `@deprecated` | P5 |
| `projects/project-semaphore-composite.util.ts` | Adaptador del veredicto + `reasons` y conteos | P7 |
| `projects/project-semaphore-composite.util.spec.ts` | Caracterización (P0) + CL-16, CL-17 | P0, P7 |
| `projects/project-conformance.service.ts` | Usa composite adaptador | P7 |
| `projects/stage-semaphore-sync.service.ts` | Único escritor de `Stage.status`/`precisionScore` (CAS) | P8 |
| `projects/stage-semaphore-sync.service.spec.ts` | CL-08, CL-15, CL-30 | P8, P9 |
| `projects/stage-semaphore-writers.inventory.spec.ts` | Lista permitida de escrituras de `mddContent`/`brdContent`/`specContent`; CL-29 | P9 |
| `projects/projects.module.ts` | Provider del sync | P8 |
| `projects/project-deliverable-gate.service.ts` | Delegación (`refreshStageSemaphoreFromProject` `@deprecated`) + puerta compartida tras flag | P8, P10 |
| `projects/project-deliverable-gate.service.spec.ts` | CL-22 | P10 |
| `projects/project-mdd-persist.service.ts` | Sync etapa editada; hash del snapshot | P8 |
| `projects/project-update.service.ts` | Sync etapa editada | P8 |
| `projects/projects.service.ts` | Sync tras persistencia | P9 |
| `projects/project-brd.service.ts` | Sync tras BRD | P9 |
| `projects/deliverables-cascade.service.ts` | Sync solo al final o en error | P9 |
| `projects/project-merge.service.ts` | Sync tras merge/clear | P9 |
| `projects/project-estimation-recalc.service.ts` | `countCostDrivers` + estado del veredicto | P13 |
| `projects/README.md` | Documentación del módulo | P15 |
| `apps/api/src/config/<config tipada>` | Flag `DELIVERABLES_GATE_REQUIRE_GREEN` (default false) | P10 |
| `apps/api/scripts/recalc-stage-semaphores.ts` | Backfill `--dry-run`, `--limit`, `--project` | P14 |
| `apps/web/src/utils/workshopSemaphoreStatus.ts` | Lee `semaphore` | P11 |
| `apps/web/src/utils/workshopSemaphoreStatus.spec.ts` | Helper web | P11 |
| `apps/web/src/utils/costCalculator.ts` | `countCostDrivers` | P13 |
| `apps/web/src/views/WorkshopMetricsColumnInner.tsx` | Sin `effectiveStatus` ni regex de derivados; `canGenerate = deliverablesGate.allowed`; nota, insignia borrador, aviso `persistedStale` | P11 |
| `apps/web/src/store/workshop/slice-deliverables.ts` | `fetchEstimation` actualiza `project.status` solo si `source==='persisted'` | P11 |
| `apps/web/src/store/workshop/types.ts` | Tipo `semaphore` | P11 |
| `apps/web/src/store/workshop/helpers/mdd-chat-event.ts` | `semaphore` del `done` | P11 |
| `docs/adr/0007-nucleo-unico-semaforo-mdd.md` | ADR publicado (borrador en [06](./06-riesgos-y-decisiones.md#5-borrador-adr-0007--núcleo-único-del-semáforo-del-mdd)) | P15 |
| `docs/notebooklm/THEFORGE-INDEX.md` | §4–§5 alineadas al código | P15 |
| `docs_mcp/arquitectura/mdd-semaforo.md` | Alineado al código | P15 |
| `CHANGELOG.md` | Línea en `## [Unreleased]` por paso; consolidado en P15 | P0–P16 |

## 3. Archivos que NO deben tocarse

| Zona | Motivo |
|---|---|
| `packages/database/schema.prisma` y migraciones | J14: versión del cálculo en `shortTermContext.semaphoreSync`, sin migración. |
| `legacy-flow/*` | Fuera de alcance, salvo lo que el inventario de escritores (P9) obligue a añadir a la lista permitida o al sync. |
| Prompts del Auditor LLM | Fuera de alcance. |
| `apps/api/src/modules/projects/sdd-integration.service.ts` | Tercer indicador; solo se documenta. |
| Tarifas en `packages/business-rules/src/cost-estimation.ts` | Solo se reutiliza `computeCostEstimation`; las tarifas no cambian. |
| `assertDesignFirstDeliverableGate` | La puerta DF la invoca tal cual. |

Escritores existentes de `Stage.status` que **no** forman parte del sync y se conservan (copia/reset/import): `project-stage.service.ts:116-143`, `project-clone.util.ts:26`, `project-notion-import.util.ts:153,:190`, `project-notion-portability.service.ts:261,:316`. Deben quedar en la lista permitida del inventario (P9).
