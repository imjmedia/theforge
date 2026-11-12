# 06 — Riesgos y decisiones

[← README](./README.md) · Anterior: [04-plan-de-pruebas.md](./04-plan-de-pruebas.md) · Siguiente: [tasks/TASKS.md](./tasks/TASKS.md)

## 1. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Lista desfasada si una persistencia no llama al sync | Media | **Alto** | Spec de inventario en CI (`stage-semaphore-writers.inventory.spec.ts`), `persistedStale` en GET y script de backfill. P8 y P9 se despliegan juntos. |
| R2 | 409 masivos al activar la puerta | Alta si se enciende sin preparar | **Alto** | Flag `DELIVERABLES_GATE_REQUIRE_GREEN` apagado al desplegar; backfill `--dry-run` y revisión del informe antes de encenderlo (J11). |
| R3 | Cambios visibles de color y costo en proyectos existentes | Alta | **Alto** | Golden de costo y caracterización P0; diferencias documentadas en `CHANGELOG.md`. |
| R4 | Rendimiento del POST de estimación | Media | Medio | Gaps cruzados solo en `post_cascade`; entradas cargadas una vez; medir p95 en P5 (RNF-01 ≤ 1.5×). |
| R5 | Retirar señales HIGH de `SemaphoreService` elimina señales documentadas en INDEX §4.2 | Cierta (decisión) | Medio | J9 aceptado; se documenta en ADR-0007 y se actualiza INDEX §4 en P15. |
| R6 | `normalizeMddForHash` debe replicar la normalización del editor web (`cleanDocForWorkshop` vive en web) | Media | Medio | Si no se puede compartir, el borrador cae a regex (sin gaps del Auditor) y la UI lo marca como borrador; ver pregunta abierta Q3. |

## 2. Supuestos

**Del orquestador (aceptados en GATE 1):**
- D2: «sin BRD» (consistencia 50/70 = no medida) es neutro en todas las ramas.
- D14: un blocker del delivery gate = rojo (borrar rama amarilla muerta, corregir tipo y doc).
- D7, D9, D10, D16–D22, D24, D26 se corrigen sin decisión de producto.

**Del planificador (aceptados):**
- Las razones nunca bajan el titular; solo limitan el color. Excepción: tope DF (J6).
- La tolerancia única de 5 gaps absorbe la de gaps humanos.
- `acknowledgeGaps` no salta la falta de Spec (J13).

## 3. Decisiones de Jorge (J1–J15)

| # | Tema | Decisión |
|---|---|---|
| J1 | Color sin Auditor (D1/D27) | Completitud por fase: `pre_cascade` pondera solo documentos previos al MDD (MDD, BRD, Spec); `post_cascade` pondera todo. Un MDD perfecto debe poder ser verde antes de la cascada. |
| J2 | Fuente única (D3/D4/D5) | Composite ALINEADO: sigue devolviendo `status` y `precisionScore`, pero iguales al veredicto del núcleo; escala viva (ningún tope amarillo <85); tolerancia única de gaps; sin doble puerta ni doble conteo; sin ignorar derivados pendientes. |
| J3 | Derivados pendientes (D6) | Verde + nota «MDD listo; genera entregables». El composite no lista «conformidad incompleta» en ese estado. `canGenerate` y color usan la misma señal. |
| J4 | Costo (D11/D12) | `packages/business-rules` fuente única: panel, fallback web y `Estimation` persistida usan `computeCostEstimation` + un solo contador (`countCostDrivers`). Buffer 1.25 si no es verde. |
| J5 | Conformidad (D15) | Regla del CHANGELOG: `ok:false` o >3 endpoints faltantes impide verde. Se elimina `conformancePenalty`. |
| J6 | Design-First (D13) | Igual que NEW (delivery gate + conformidad). Tope 40 al titular (incluido `auditorScore`) y a lo persistido mientras fases 2–3 no estén ok. Borrar `!hasMdd ||` muerto. |
| J7 | Sync Stage (D25/D8/D23) | Solo lo persistido escribe `Stage.status`/`precisionScore`. GET y POST no escriben. El sync corre sobre la etapa editada. |
| J8 | Puerta HIGH | Regla compartida en backend (HIGH: gate ok + verde + Spec; LOW/MEDIUM: bootstrap o verde con Spec; DF: `assertDesignFirstDeliverableGate`; LEGACY: MDD o `codebaseDoc`), expuesta como `semaphore.deliverablesGate`; la web solo refleja. |
| J9 | Señales HIGH de `SemaphoreService` | Retirarlas del color: solo quedan degradadores Figma/UX y bloqueantes de Constitución. `edge_cases`/`field_types`, alivio `sddDomainGraphOk` y buckets 70/82/92/95 dejan de influir. |
| J10 | Pesos pre-cascada | MDD 0.5 / BRD 0.3 / Spec 0.2. La falta de BRD/Spec penaliza solo en HIGH; LOW y MEDIUM renormalizan. |
| J11 | Flag de puerta | `DELIVERABLES_GATE_REQUIRE_GREEN` apagada al desplegar; se enciende tras el backfill y revisar `--dry-run`. |
| J12 | Reglas residuales | Se retiran «>8 endpoints faltantes → rojo» y la tolerancia separada de gaps humanos (>3 → amarillo 78). Una sola regla de conformidad y una sola tolerancia de 5 gaps deduplicados. |
| J13 | `acknowledgeGaps` | Puede saltar blockers del MDD y la falta de verde (con log). NO la falta de Spec en HIGH. |
| J14 | Versionado del cálculo | `shortTermContext.semaphoreSync = { version: 1, inputsHash, computedAt }` en `Stage`; sin migración Prisma. |
| J15 | Alias | `status`/`precision`/`auditorScore`/`mddQualitySource`/`deliveryGate` en `LiveMetricsResult` `@deprecated`; se retiran en la siguiente versión tras migrar web y MCP `get_estimation`. |

## 4. Dictámenes de expertos y conflictos

### 4.1 `experto-backend-nestjs` — viable con condiciones
- Núcleo puro; sync en `projects/` inyectando `EstimationModule` (no AiAnalysis).
- CAS por `Stage.updatedAt`.
- Extender `assertDeliverablesAllowed` conservando el 409.
- Un solo perfil de delivery gate.
- Backfill idempotente.
- Flag para la puerta.
- Prueba explícita de que GET/POST no escriben.

### 4.2 `experto-arquitectura` — viable con condiciones
- Núcleo en shared-types con extractores en la API.
- Un evaluador; composite como adaptador.
- Contrato aditivo versionado con alias.
- Hash del snapshot en la persistencia.
- Web solo refleja.
- ADR-0007.
- Lista explícita de persistencias.
- Backfill.

### 4.3 Conflictos resueltos

| # | Conflicto | Resolución |
|---|---|---|
| C1 | Composite: color propio que degrada vs adaptador | **Adaptador** del veredicto (J2). |
| C2 | Ubicación del contador de costo: shared-types vs business-rules | **business-rules** (`countCostDrivers`); es regla de costo y la web ya lo importa. |
| C3 | Versión del cálculo: columna con migración vs JSON | **`shortTermContext.semaphoreSync`** (J14). |
| C4 | Fase: estado del job de cascada vs derivados | **`derivativesState`**, con sync suspendido mientras hay job activo. |
| C5 | Alcance del flag: backend y web vs solo backend | **Solo puerta backend**; la web refleja `deliverablesGate`. |

## 5. Borrador ADR-0007 — Núcleo único del semáforo del MDD

> El ADR publicado vivirá en `docs/adr/0007-nucleo-unico-semaforo-mdd.md` (P15). `docs/adr/` ya contiene 0001–0006 (`0001-autorizacion-por-proyecto.md` … `0006-architecture-graph-separado.md`); 0007 es el siguiente número libre.

**Estado:** Propuesto (aprobado en plan, 2026-11-11).

**Contexto.** El color y el % del semáforo del MDD se calculaban en cuatro lugares (capa viva de `EstimationService` con tres ramas, `SemaphoreService` con buckets por complejidad, composite de readiness con topes 78/82/85 y la web con `effectiveStatus`), con umbrales y tolerancias distintas. Tres caminos escribían `Stage.status`, incluido el GET de estimación y el POST con borrador sin guardar, siempre sobre la etapa primaria. La puerta de entregables «exigir verde» vivía solo en la web. El costo se calculaba con tres fórmulas. La auditoría encontró 27 defectos (D1–D27).

**Decisión.**
1. Un **núcleo puro** en `packages/shared-types/src/semaphore/` (`evaluateMddSemaphore`, `evaluateDeliverablesGate`, escala 85/90, completitud por fase, `normalizeMddForHash`, zod del veredicto) es la única fuente del veredicto. Sin dependencias de Node, Prisma ni Nest.
2. La API aporta **extractores** y una **fábrica de entradas** (`buildSemaphoreInputs`); `EstimationService` es fachada sin escrituras.
3. **Único escritor** de `Stage.status`/`precisionScore`: `StageSemaphoreSyncService.syncFromPersisted`, invocado tras cada persistencia relevante sobre la etapa editada, con CAS por `updatedAt` y versión en `shortTermContext.semaphoreSync`.
4. **Invariante:** con las mismas entradas persistidas, panel GET = lista = composite = puerta. El POST con borrador puede diferir y se marca `source==='draft'`.
5. El composite es un **adaptador** del veredicto. `SemaphoreService` queda solo con degradadores Figma/UX y Constitución (J9).
6. La **puerta de entregables** se decide en backend con `evaluateDeliverablesGate` tras el flag `DELIVERABLES_GATE_REQUIRE_GREEN`; la web solo refleja.
7. El **costo** sale de `business-rules` (`computeCostEstimation` + `countCostDrivers`), buffer 1.25 si no verde.
8. Las razones nunca bajan el titular; solo limitan el color. Única excepción: tope Design-First (40).

**Consecuencias.**
- (+) Un color por contenido persistido; lectura sin efectos; MDD perfecto verde antes de la cascada; costo coherente.
- (+) Contrato `MddSemaphoreVerdict` versionado y validado con zod.
- (−) Cambios visibles de color y costo en proyectos existentes: requiere backfill y nota en CHANGELOG.
- (−) Se pierden las señales HIGH `edge_cases`/`field_types`, el alivio `sddDomainGraphOk` y los buckets 70/82/92/95 (documentadas en INDEX §4.2).
- (−) Cada nueva ruta de persistencia debe llamar al sync; lo vigila un spec de inventario en CI y `persistedStale`.
- Alias `@deprecated` en `LiveMetricsResult` durante una versión.
- `/projects/:id/analyze` (`sdd-integration.service.ts`) sigue siendo un tercer indicador fuera de este ADR.

**Alternativas consideradas.**
- Composite como color independiente que solo degrada: permite dos colores.
- Columna `semaphoreVersion` con migración: innecesaria (J14).
- Seguir sincronizando desde el GET: lectura con efectos (J7).
- Fase según estado del job de cascada: no existe en `Stage`.
- Contador de costo en shared-types: es regla de costo; va en business-rules.

## 6. Preguntas abiertas

| # | Pregunta | Estado / pista | Quién resuelve |
|---|---|---|---|
| Q1 | Ubicación exacta del archivo de config tipada para el flag `DELIVERABLES_GATE_REQUIRE_GREEN` | `apps/api/src/config/` contiene `env.schema.ts` (ya define defaults como `DEFAULT_DESIGN_FIRST_ENABLED`), `compiler-first.config.ts`, `plugins.config.ts`. Candidato: `env.schema.ts`. | Implementador de P10 |
| Q2 | Ruta de la documentación del MCP `get_estimation` | El plan la dejó sin verificar. Aparece en `docs/notebooklm/THEFORGE-MCP-SERVER.md`, `packages/mcp-server/src/mcp-tools.doc.ts` y `packages/mcp-server/src/tools/analysis.tools.ts`. | Implementador de P15 |
| Q3 | ¿`cleanDocForWorkshop` puede compartirse con `normalizeMddForHash`? | Vive en `apps/web/src/utils/workshop-document-content.util.ts` (usado también en `slice-session-chat.ts` y `helpers/persist-field.ts`). Si no puede moverse a shared-types sin arrastrar dependencias web, el borrador cae a regex (R6). | Implementador de P1/P9; si exige mover código web, decide Jorge |
| Q4 | Ejecución del backfill en producción y momento de encender el flag | Fuera de alcance; requiere informe `--dry-run` revisado. | Jorge |

## 7. Discrepancias plan ↔ código detectadas al redactar

| # | Discrepancia | Tratamiento |
|---|---|---|
| X1 | La regla global de Jorge nombra la sección del CHANGELOG `## [Sin publicar]`, pero `CHANGELOG.md` de este repo usa `## [Unreleased]` (línea 5). | Manda el repo: usar `## [Unreleased]`, como dice el plan. |
| X2 | El plan dejó «sin verificar» la doc de `get_estimation`; existe en las rutas de Q2. | Actualizar en P15 las que describan los campos del semáforo. |
| X3 | El plan no asigna paso explícito a `live-semaphore-status.util.ts` ni a la fixture `design-first-fase3-pendiente.json`. | Asignados por inferencia a P5 y P12 respectivamente (ver [02](./02-estructura-de-archivos.md)). |
| X4 | Ariadne estaba `stale` (indexado 2026-11-04) y no se usó; las líneas `archivo:línea` vienen de `06a0d161` y pueden haberse movido. | Resincronizar antes de ejecutar; el código manda. |
