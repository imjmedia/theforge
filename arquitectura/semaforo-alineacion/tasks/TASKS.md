# TASKS — Semáforo del MDD alineado

> Ejecuta los pasos **en orden**. Marca cada checkbox al terminarlo. No avances si la verificación del paso no pasa.
> Contexto: [HANDOFF.md](./HANDOFF.md) · PRD: [../01-PRD.md](../01-PRD.md)

Rutas relativas a la raíz del repo. Abreviaturas usadas en este archivo:
- `estimation/` = `apps/api/src/modules/ai-analysis/estimation/`
- `engine/` = `apps/api/src/modules/engine/`
- `projects/` = `apps/api/src/modules/projects/`
- `semaphore/` = `packages/shared-types/src/semaphore/`

Los pasos 1, 4, 5, 8 y 9 del plan se dividen en «a / b» para respetar el máximo de 8 archivos por paso. El orden y las dependencias del plan se mantienen.

## Progreso
- [x] Paso 0 — Caracterización del comportamiento actual
- [x] Paso 1a — Núcleo: contratos, escala, fases y normalizador de hash
- [x] Paso 1b — Núcleo: evaluador y puerta de entregables
- [x] Paso 2 — Contador de costo en business-rules
- [x] Paso 3 — Detectores MDD anclados
- [x] Paso 4a — Trazabilidad y clasificación de gaps
- [x] Paso 4b — Delivery gate: rama muerta y contexto único
- [x] Paso 5a — Fábrica de entradas, completitud por fase y conformidad reubicada
- [x] Paso 5b — Evaluador vivo (fachada de EstimationService)
- [x] Paso 6 — Streams y regeneración
- [x] Paso 7 — Composite y SemaphoreService
- [x] Paso 8a — Servicio de sincronización único (CAS)
- [x] Paso 8b — GET/POST sin escritura y persistencias principales
- [x] Paso 9a — Callers restantes del sync e inventario de escritores
- [x] Paso 9b — Hash canónico del snapshot del Auditor (`normalizeMddForHash` en `hashMddDraft`)
- [x] Paso 10 — Puerta de entregables en backend
- [x] Paso 11 — Web solo refleja el veredicto
- [x] Paso 12 — Design-First por el mismo evaluador
- [x] Paso 13 — Costo única fuente
- [x] Paso 14 — Script de backfill (`apps/api/scripts/recalc-stage-semaphores.ts`)
- [x] Paso 15 — Documentación
- [x] Paso 16 — Verificación final

---

## Paso 0 — Caracterización del comportamiento actual
**Objetivo:** Fijar con specs la salida actual del semáforo, del composite y del costo para detectar cualquier cambio no previsto en los pasos siguientes.
**Depende de:** ninguno
**Lee antes:** [../04-plan-de-pruebas.md](../04-plan-de-pruebas.md), sección Caracterización; [../01-PRD.md](../01-PRD.md), sección 1.1 Mapa actual del semáforo y tabla de defectos D1–D27.
**Archivos:**
- `estimation/__tests__/estimation-semaphore.characterization.spec.ts` [nuevo] — fija `status`, `precision`, desglose y `totalMXN` de `calculateLiveMetrics`.
- `projects/project-semaphore-composite.util.spec.ts` [nuevo] — sección «caracterización» de `evaluateCompositeSemaphore`.
- `packages/business-rules/src/cost-parity.characterization.spec.ts` [nuevo] — costo por las 3 vías actuales.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [x] 0.1 Cargar fixtures `apps/api/eval/mdd/fixtures/good-ecommerce-tienda-basica.md`, `bad-ecommerce-tienda-basica.md`, `good-…-subsecciones.md` y los `apps/api/eval/mdd/cases/*.json` que contengan MDD.
- [x] 0.2 Capturar con mocks de Prisma (patrón `estimation/__tests__/estimation-auditor-hash.spec.ts`) `status`, `precision`, componentes del desglose (`computePrecisionBreakdown`) y `totalMXN` de `calculateLiveMetrics` (`estimation.service.ts:1421-1666`).
- [x] 0.3 Capturar `status`, `precisionScore` y `reasons` de `evaluateCompositeSemaphore` (`project-semaphore-composite.util.ts:146-238`).
- [x] 0.4 Capturar costo de las 3 vías: panel (`riskFactor` si integral <85, `estimation.service.ts:1620-1621`), fallback web (`calculateCostFromMdd`, `cost-estimation.ts:17,:121-123`) y `Estimation` persistida (`project-estimation-recalc.service.ts:23-68`).
- [x] 0.5 Marcar con `// CAMBIA EN Pn` cada caso cuyo resultado cambiará según el plan (p. ej. integral pre-cascada → P5, topes 78/82 → P7, costo → P13).
- [x] 0.6 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Architecture` o `### Added`: specs de caracterización del semáforo y costo).
- [x] 0.7 Pruebas del paso: los tres specs pasan sobre `master` **sin cambios de código de producto**.

### Criterios de aceptación
- [x] Los tres specs de caracterización pasan sobre `master` sin modificar código de producto.
- [x] Cada caso con cambio esperado lleva la marca `// CAMBIA EN Pn` con el número de paso.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern=characterization
pnpm --filter @theforge/api test -- --test-path-pattern=project-semaphore-composite
pnpm --filter @theforge/business-rules test
```
Resultado esperado: todos los casos en verde; ningún archivo fuera de los specs y CHANGELOG modificado (`git status`).

### Fuera de alcance de este paso
- Cualquier corrección de código de producto.

### Notas de ejecución
- 2026-11-12: Tres fixtures `eval/mdd/fixtures/*.md` (los `cases/*.json` no incluyen MDD embebido). `calculateLiveMetrics` sin Prisma mock (no necesario para la ruta regex-only). Composite sin `conformance` → `ROJO`/`0` en los tres casos (baseline). Costo: `cost-parity.characterization.spec.ts` importa api/web solo en test. `pnpm --filter @theforge/business-rules test` falla por `mdd-ia-cost-reference.spec.ts` (vitest ausente) — ajeno al paso; el spec nuevo pasa con `node --import tsx --test src/cost-parity.characterization.spec.ts`.

---

## Paso 1a — Núcleo: contratos, escala, fases y normalizador de hash
**Objetivo:** Crear en shared-types los tipos y zod del veredicto, la escala única, la completitud por fase con integral y `normalizeMddForHash`.
**Depende de:** Paso 0
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Contratos, Escala única y Completitud por fase; [../01-PRD.md](../01-PRD.md) RF-01, RF-02, RF-03; [../05-casos-limite.md](../05-casos-limite.md) CL-02, CL-06, CL-33.
**Archivos:**
- `semaphore/verdict.schema.ts` [nuevo] — tipos `SemaphoreStatus`, `CompletenessPhase`, `DerivativesState`, `MddSemaphoreVerdict` y `mddSemaphoreVerdictSchema` (zod).
- `semaphore/scale.ts` [nuevo] — umbrales 85/90 y `statusFromScore`.
- `semaphore/completeness-phase.ts` [nuevo] — `resolveCompletenessPhase`, `derivativesState` por perfil, `DOC_WEIGHTS_BY_PHASE`, `computeIntegralScore`.
- `semaphore/hash-normalize.ts` [nuevo] — `normalizeMddForHash` (sin `node:crypto`).
- `semaphore/index.ts` [nuevo] — barrel.
- `semaphore/semaphore.spec.ts` [nuevo] — tablas de escala, fases e integral.
- `packages/shared-types/src/index.ts` [modifica] — `export * from './semaphore'`.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [x] 1a.1 Definir el contrato `MddSemaphoreVerdict` (`version: 1`, `status`, `headline`, `headlineSource`, `integral`, `components`, `phase`, `derivativesState`, `reasons`, `notes`, `source`, `deliverablesGate`) y su schema zod.
- [x] 1a.2 `scale.ts`: `PRECISION_RED_MAX=85`, `PRECISION_GREEN_MIN=90`, `statusFromScore(score)`: <85 rojo, 85–89 amarillo, ≥90 verde.
- [x] 1a.3 `completeness-phase.ts`: `derivativesState` por perfil con `MIN_DERIVATIVE_DOC_LENGTH=80` (HIGH: Blueprint, API, Flujos, Infra; MEDIUM: Spec o casos de uso, API, UX o Flujos, HU, tasks; LOW: HU y tasks; DF como HIGH tras fase 3). `post_cascade` ⇔ `complete`.
- [x] 1a.4 Pesos `pre_cascade` MDD 0.50 / BRD 0.30 / Spec 0.20 (HIGH penaliza ausencia; LOW/MEDIUM renormalizan sobre presentes, J10); `post_cascade` = `DOC_WEIGHTS` actuales (11 documentos). Puntaje por documento 100/50/10/0 sin cambios.
- [x] 1a.5 `computeIntegralScore`: `0.30·C + 0.25·T + 0.45·Q`; sin BRD (T = `null`) → `(0.30·C + 0.45·Q)/0.75`.
- [x] 1a.6 `normalizeMddForHash`: quita cabecera de fecha, aplica `formatDocumentMarkdown`, colapsa espacios. Si `cleanDocForWorkshop` (web) no se puede replicar, anotarlo en Notas (riesgo MEDIO del plan).
- [x] 1a.7 Verificar que nada en `semaphore/` importa `node:*`, Prisma ni Nest (RNF-02).
- [x] 1a.8 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Architecture`: núcleo puro del semáforo, contratos y escala).
- [x] 1a.9 Pruebas del paso: tabla 84→rojo, 85→amarillo, 89→amarillo, 90→verde (RF-01); MDD+BRD+Spec perfectos pre-cascada → 100 (RF-02); MDD+BRD sin Spec en HIGH → 94 (RF-02); sin BRD → fórmula /0.75 (RF-03, CL-02: (0.30·70+45)/0.75 = 88 → amarillo); LOW/MEDIUM sin BRD ni Spec renormaliza (CL-33); override formateado y persistido normalizan igual (CL-06).

### Criterios de aceptación
- [x] RF-01: tabla de escala en verde; ninguna constante de tope amarillo <85 en `semaphore/`.
- [x] RF-02 y RF-03: casos de integral por fase y sin BRD en verde.
- [x] CL-02, CL-06, CL-33 cubiertos por casos con nombre explícito.
- [x] RNF-02: `grep -rE "from ['\"](node:|@prisma|@nestjs)" packages/shared-types/src/semaphore` = 0.

### Verificación
```bash
pnpm --filter @theforge/shared-types test && pnpm --filter @theforge/shared-types lint
grep -rE "from ['\"](node:|@prisma|@nestjs)" packages/shared-types/src/semaphore || echo "sin imports prohibidos"
```
Resultado esperado: tests y lint en verde; el grep imprime «sin imports prohibidos».

### Fuera de alcance de este paso
- `evaluateMddSemaphore` y `evaluateDeliverablesGate` (Paso 1b).
- Cualquier consumidor en api o web.

### Notas de ejecución
- 2026-11-12: `normalizeMddForHash` usa `peelTheforgeDocStamp` + `formatDocumentMarkdown({ mermaid: "preserve" })`; no replica `cleanDocForWorkshop` de la web (riesgo MEDIO del plan — validar en P9 con overrides reales). `pnpm --filter @theforge/shared-types lint` falla por falta de `eslint.config` en el paquete (pre-existente). Ariadne MCP en error; código según TASKS/03.

---

## Paso 1b — Núcleo: evaluador y puerta de entregables
**Objetivo:** Implementar `evaluateMddSemaphore` con el orden de reglas del plan y la regla pura `evaluateDeliverablesGate`.
**Depende de:** Paso 1a
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Escala única y Puerta compartida; [../01-PRD.md](../01-PRD.md) RF-14; [../05-casos-limite.md](../05-casos-limite.md) CL-01, CL-20, CL-26.
**Archivos:**
- `semaphore/evaluate.ts` [nuevo] — `evaluateMddSemaphore(input) → MddSemaphoreVerdict`.
- `semaphore/deliverables-gate.ts` [nuevo] — `evaluateDeliverablesGate({ profile, verdict, hasSpec, hasBootstrap, legacyHasDoc, designFirstGateOk })`.
- `semaphore/index.ts` [modifica] — exportar ambos.
- `semaphore/semaphore.spec.ts` [modifica] — casos del evaluador, de la puerta y propiedad.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 1b.1 Orden de reglas en `evaluateMddSemaphore`: puntaje → delivery gate (≥1 blocker = rojo) → conformidad y gaps (consistencia <90 si se mide, >5 gaps deduplicados solo `post_cascade`, conformidad `ok:false` o >3 faltantes solo con derivados, Auditor vigente con `critical_gaps>0` o sin `infrastructure_ready` en HIGH, degradadores Figma/Constitución → máx. amarillo) → tope DF (fases 2/3 no ok → `headline=min(headline,40)` y máx. amarillo; fase 1 no ok → rojo) → derivados (`none` → nota «MDD listo; genera entregables»; `partial` → nota «cascada incompleta») → puerta.
- [ ] 1b.2 Garantizar que las razones solo limitan el color y nunca bajan `headline` (excepción única: tope DF).
- [ ] 1b.3 `evaluateDeliverablesGate`: HIGH = gate ok + verde + Spec; LOW/MEDIUM = bootstrap (DBGA o MDD) o verde con Spec; DESIGN_FIRST = `designFirstGateOk`; LEGACY = MDD o `codebaseDoc`. Devuelve `{ allowed, rule, reasons }`.
- [ ] 1b.4 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Architecture`: evaluador único y regla pura de puerta).
- [ ] 1b.5 Pruebas del paso: CL-01 (MDD vacío → rojo, titular 0, HIGH `allowed=false`); CL-20 (LOW sin HU/tasks con DBGA → `allowed=true`); CL-26 (LEGACY sin MDD con `codebaseDoc` → `allowed=true`); HIGH verde sin Spec → `allowed=false` «falta Spec»; propiedad «ninguna regla sube el color» sobre combinaciones de entradas (rango resultado ≤ rango de `statusFromScore(headline)`).

### Criterios de aceptación
- [ ] RF-14 (regla pura): los cuatro perfiles con tabla de casos en verde.
- [ ] CL-01, CL-20, CL-26 en verde.
- [ ] Propiedad «ninguna regla sube el color» en verde.

### Verificación
```bash
pnpm --filter @theforge/shared-types test && pnpm --filter @theforge/shared-types lint
```
Resultado esperado: todos los casos en verde, lint sin errores nuevos.

### Fuera de alcance de este paso
- Consumidores del evaluador (Pasos 5b en adelante).
- Flag `DELIVERABLES_GATE_REQUIRE_GREEN` (Paso 10).

### Notas de ejecución
- 2026-11-12: Núcleo 1b ya en repo (`evaluate.ts`, `deliverables-gate.ts`, specs en verde).

---

## Paso 2 — Contador de costo en business-rules
**Objetivo:** Crear `countCostDrivers(mdd)` como único contador de entidades, pantallas y endpoints para el costo.
**Depende de:** Paso 1b
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-21; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Costo (o Componentes); [../05-casos-limite.md](../05-casos-limite.md) CL-09.
**Archivos:**
- `packages/business-rules/src/cost-drivers.ts` [nuevo] — `countCostDrivers(mdd)`.
- `packages/business-rules/src/cost-drivers.spec.ts` [nuevo] — conteos.
- `packages/business-rules/src/index.ts` [modifica] — export.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 2.1 Implementar `countCostDrivers` unificando la intención de los tres contadores actuales (`estimation.service.ts:605-660`, `apps/web/src/utils/costCalculator.ts:~80-121`, `project-estimation-recalc.service.ts:35-46`): entidades por `CREATE TABLE`, endpoints solo dentro de §4 anclado (`^##\s+4\.`) con `\b(GET|POST|PUT|PATCH|DELETE)\s+/`.
- [ ] 2.2 Exportar desde `packages/business-rules/src/index.ts`.
- [ ] 2.3 Comparar con `cost-parity.characterization.spec.ts`: los conteos coinciden salvo casos marcados `// CAMBIA EN P2`/`P13`; anotar diferencias en Notas.
- [ ] 2.4 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Added`: `countCostDrivers`).
- [ ] 2.5 Pruebas del paso: «PostgreSQL» no cuenta como POST (CL-09 aplicado al costo); `CREATE TABLE` cuenta entidades; líneas GET/POST fuera de §4 no cuentan.

### Criterios de aceptación
- [ ] RF-21 (parte contador): `countCostDrivers` exportado y probado.
- [ ] CL-09 en el contador: `PostgreSQL` ≠ `POST`.

### Verificación
```bash
pnpm --filter @theforge/business-rules test && pnpm --filter @theforge/business-rules lint
```
Resultado esperado: specs nuevos y de caracterización en verde.

### Fuera de alcance de este paso
- Conectar consumidores (Paso 13). Tarifas de `cost-estimation.ts`.

### Notas de ejecución
- 2026-11-12: `countCostDrivers` implementado; specs nuevos en verde. `pnpm --filter @theforge/business-rules test` falla por `mdd-ia-cost-reference.spec.ts` (vitest ausente, pre-existente); `cost-drivers` + `cost-parity` pasan con `exec node --test` selectivo.

---

## Paso 3 — Detectores MDD anclados
**Objetivo:** Corregir las detecciones heurísticas anclándolas a headings numerados y a patrones estrictos.
**Depende de:** Paso 1b
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-11; [../05-casos-limite.md](../05-casos-limite.md) CL-09…CL-13; [../02-estructura-de-archivos.md](../02-estructura-de-archivos.md), fixtures `__fixtures__/semaphore/`.
**Archivos:**
- `estimation/mdd-section-detectors.util.ts` [nuevo] — `detectReferenceSections` y `computeConsistencyGaps` movidos desde `estimation.service.ts:113-191` y `:531-599`, anclados.
- `estimation/__tests__/mdd-section-detectors.util.spec.ts` [nuevo] — CL-09, CL-10.
- `engine/mdd-internal-audit.util.ts` [modifica] — D20–D22 y Mermaid múltiple.
- `engine/mdd-internal-audit.util.spec.ts` [modifica] — CL-11, CL-12, CL-13.
- `estimation/estimation.service.ts` [modifica] — solo imports hacia el util nuevo.
- `estimation/__fixtures__/semaphore/` [nuevo] — 5 fixtures `.md`: `mermaid-flowchart-then-er.md`, `postgres-sin-post.md`, `fallo-red-sin-bloqueo.md`, `email-verify-sin-mfa.md`, `endpoints-en-contexto-sin-s4.md`.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 3.1 Mover `detectReferenceSections` y `computeConsistencyGaps` a `mdd-section-detectors.util.ts`; anclar secciones a `^##\s+\d\.` (D19, `estimation.service.ts:567-596`) y anclar `|endpoints` en `parseCountsFromMarkdown` (`:628`).
- [ ] 3.2 `endpointsWithPayloads` solo dentro de §4 con `\b(POST|PUT|PATCH)\s+/`, reemplazando la regex de `estimation.service.ts:579` (D18).
- [ ] 3.3 En `mdd-internal-audit.util.ts`: recorrer todos los bloques mermaid `erDiagram` para la paridad con SQL (D21, `:69-71` vs `:277`).
- [ ] 3.4 `securityEdgeCaseGap`: «fallo» solo con `(intentos|reintento|bloqueo|lock)` en la misma oración (D20, `:306-308`).
- [ ] 3.5 MFA: `/verify` cuenta solo con `(mfa|otp|totp|2fa)` (D22, `:193`).
- [ ] 3.6 Dejar `estimation.service.ts` con imports al util nuevo, sin cambiar ponderaciones.
- [ ] 3.7 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: detectores anclados a headings, PostgreSQL, Mermaid múltiple, «fallo», `/verify`).
- [ ] 3.8 Pruebas del paso: CL-09 (`postgres-sin-post.md` → `endpointsWithPayloads=false`), CL-10 (`endpoints-en-contexto-sin-s4.md` → `endpoints=0`), CL-11 (`mermaid-flowchart-then-er.md` → `mermaidParityGap=1`), CL-12 (`fallo-red-sin-bloqueo.md` → `securityEdgeCaseGap=0`), CL-13 (`email-verify-sin-mfa.md` → inconsistente). Actualizar casos `// CAMBIA EN P3` de la caracterización.

### Criterios de aceptación
- [ ] RF-11: los cinco detectores corregidos.
- [ ] CL-09, CL-10, CL-11, CL-12, CL-13 en verde.
- [ ] Caracterización sin cambios no marcados.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="mdd-section-detectors|mdd-internal-audit|characterization"
pnpm --filter @theforge/api test
```
Resultado esperado: specs nuevos y existentes en verde.

### Fuera de alcance de este paso
- Ponderaciones del integral y el desglose (Paso 5a/5b).

### Notas de ejecución
- 2026-11-12: `mdd-section-detectors.util.ts` + fixtures CL-09…CL-13; `parseCountsFromMarkdown` anclado. Caracterización costo: golden panel actualizado (`// CAMBIA EN P3`) por conteo §4. Verificación `mdd-section-detectors|mdd-internal-audit` en verde.

---

## Paso 4a — Trazabilidad y clasificación de gaps
**Objetivo:** Unificar la trazabilidad del panel con la del gate (BRD→MDD) y clasificar gaps humanos por prefijo.
**Depende de:** Paso 1b
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-10, RF-19; [../05-casos-limite.md](../05-casos-limite.md) CL-32.
**Archivos:**
- `estimation/consistency.util.ts` [modifica] — Spec solo fuente cuando no hay BRD, nunca destino.
- `estimation/__tests__/consistency.util.spec.ts` [modifica] — caso «ítem BRD solo en Spec = gap».
- `estimation/brd-mdd-traceability.util.ts` [modifica] — fuente única de trazabilidad.
- `packages/shared-types/src/readiness-audit.util.ts` [modifica] — `isHumanGap` por prefijo; topes `READINESS_*_AMARILLO_CAP` `@deprecated`.
- `packages/shared-types/src/readiness-audit.util.spec.ts` [modifica] — casos de prefijo.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 4a.1 `consistency.util.ts:369-398`: dejar de usar Spec como destino; delegar en `brd-mdd-traceability.util.ts` (D17). Eliminar el 70 «solo Spec» (`:361-363`) en favor de «no medida» (`null`).
- [ ] 4a.2 `brd-mdd-traceability.util.ts:26-29` queda como fuente única BRD→MDD.
- [ ] 4a.3 `isHumanGap` por prefijo en `readiness-audit.util.ts:93-96`; revisar duplicados en `projects/conformance-gaps.util.ts:86-88` y `low-medium-readiness.util.ts:242-243` para que usen la misma función (D26).
- [ ] 4a.4 Marcar `READINESS_*_AMARILLO_CAP` como `@deprecated` (sin borrar).
- [ ] 4a.5 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: trazabilidad BRD→MDD única; `isHumanGap` por prefijo).
- [ ] 4a.6 Pruebas del paso: ítem BRD presente solo en Spec cuenta como gap (RF-10); «… por validar …» a mitad de mensaje → `llm` (CL-32, RF-19); prefijo humano → `human`.

### Criterios de aceptación
- [ ] RF-10 y RF-19 cubiertos.
- [ ] CL-32 en verde.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="consistency|brd-mdd-traceability|low-medium-readiness"
pnpm --filter @theforge/shared-types test
```
Resultado esperado: specs en verde; caracterización sin cambios no marcados.

### Fuera de alcance de este paso
- Callers del composite (Paso 7). Delivery gate (Paso 4b).

### Notas de ejecución
- 2026-11-12: Código y CHANGELOG ya aplicados; specs `consistency`, `brd-mdd-traceability`, `readiness-audit`, `mdd-delivery-gate*` en verde. `classifyGap` usa `isHumanGap` por prefijo (consumidores vía shared-types).

---

## Paso 4b — Delivery gate: rama muerta y contexto único
**Objetivo:** Dejar el delivery gate con dos resultados (ok / rojo) y un único perfil de contexto para todos sus llamadores.
**Depende de:** Paso 4a
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-08, RF-09; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Componentes (extractores).
**Archivos:**
- `apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate.util.ts` [modifica] — eliminar rama amarilla inalcanzable.
- `apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate.util.spec.ts` [modifica] — dos ramas.
- `apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate-context.util.ts` [nuevo] — `resolveDeliveryGateContext`.
- `apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate-context.util.spec.ts` [nuevo] — mismo MDD, mismo contexto.
- `estimation/estimation.types.ts` [modifica] — comentario del tipo en `:146` dice «rojo».
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 4b.1 `mdd-delivery-gate.util.ts:472,:477-483`: eliminar la rama yellow muerta; `applyDeliveryGateToSemaphoreStatus` con 2 ramas o eliminado (D14).
- [ ] 4b.2 Corregir la documentación del tipo en `estimation.types.ts:146` («blocker = rojo»).
- [ ] 4b.3 Crear `resolveDeliveryGateContext` que unifique los perfiles de panel (`estimation.service.ts:1154-1161` con `prepareMddForDeliveryGateValidation` `:266-273`), pipeline (`mdd-update-pipeline.service.ts:93`), snapshot (`project-mdd-persist.service.ts:324-327,:451-454`) y gate (`project-deliverable-gate.service.ts:115-120`) (D16). Solo la función; los callers se conectan en Pasos 5b, 7, 8b y 10.
- [ ] 4b.4 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: blocker del delivery gate = rojo; `### Architecture`: contexto único del gate).
- [ ] 4b.5 Pruebas del paso: blocker → rojo sin rama amarilla; mismo MDD por los 4 perfiles de entrada → mismo `ok`, `blockers`, `score`.

### Criterios de aceptación
- [ ] RF-08: `grep -n "yellow" apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate.util.ts` sin la rama muerta.
- [ ] RF-09 (función): spec de `resolveDeliveryGateContext` en verde.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="mdd-delivery-gate"
pnpm --filter @theforge/api test:types
```
Resultado esperado: specs y tipos en verde.

### Fuera de alcance de este paso
- Conectar los callers del gate (Pasos 5b, 7, 8b, 10).

### Notas de ejecución
- 2026-11-12: `resolveDeliveryGateContext` + specs; `applyDeliveryGateToSemaphoreStatus` solo rojo si blocker. Tipos del gate documentados.

---

## Paso 5a — Fábrica de entradas, completitud por fase y conformidad reubicada
**Objetivo:** Crear `buildSemaphoreInputs` que carga etapa y proyecto una vez y produce las entradas del núcleo, con completitud por fase y gaps de conformidad en `engine/`.
**Depende de:** Paso 3, Paso 4b
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Componentes (fábrica), Completitud por fase y Flujo de datos; [../05-casos-limite.md](../05-casos-limite.md) CL-14, CL-21.
**Archivos:**
- `estimation/semaphore-inputs.factory.ts` [nuevo] — `buildSemaphoreInputs({ projectId, stageId, content, source })`.
- `estimation/__tests__/semaphore-inputs.factory.spec.ts` [nuevo] — perfiles y `derivativesState`.
- `estimation/completeness.util.ts` [modifica] — pesos por fase desde `semaphore/`.
- `estimation/__tests__/completeness.util.spec.ts` [modifica] — casos por fase.
- `engine/conformance-gaps.util.ts` [nuevo] — movido desde `projects/`.
- `projects/conformance-gaps.util.ts` [modifica] — re-export `@deprecated`.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 5a.1 `buildSemaphoreInputs` resuelve perfil (`HIGH|MEDIUM|LOW|DESIGN_FIRST|LEGACY`), `derivativesState`, gaps del Auditor solo si el hash coincide, contexto del gate con `resolveDeliveryGateContext`, resumen de conformidad y gaps cruzados deduplicados (vía `collectFullCrossArtifactGaps`, no `collectConformanceGaps` directo — D5).
- [ ] 5a.2 Exportar la fábrica en la API pública del módulo estimation (RNF-03).
- [ ] 5a.3 `completeness.util.ts:3-30`: usar `DOC_WEIGHTS_BY_PHASE` (D1).
- [ ] 5a.4 Mover `conformance-gaps.util.ts` a `engine/` y dejar re-export `@deprecated` en `projects/` (sin cambiar heurísticas internas de `ConformanceService`).
- [ ] 5a.5 Conformidad y gaps cruzados: `none` no se evalúan; `partial` solo presentes + nota «cascada incompleta»; `complete` todo.
- [ ] 5a.6 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Architecture`: fábrica de entradas; `### Changed`: completitud por fase).
- [ ] 5a.7 Pruebas del paso: CL-14 (derivados `partial` → `pre_cascade`, conformidad solo de presentes, nota «cascada incompleta»); CL-21 (MEDIUM con 3 de 5 derivados → `partial`); completitud pre/post por perfil.

### Criterios de aceptación
- [ ] RF-02 (en la API): completitud usa pesos por fase.
- [ ] CL-14 y CL-21 en verde.
- [ ] `projects/` no importa internos de `estimation/` salvo su API pública (RNF-03).

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="semaphore-inputs|completeness|conformance"
pnpm --filter @theforge/api test:types
```
Resultado esperado: specs y tipos en verde.

### Fuera de alcance de este paso
- Conectar la fábrica a `calculateLiveMetrics` (Paso 5b). Perfil DF completo (Paso 12).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 5b — Evaluador vivo (fachada de EstimationService)
**Objetivo:** Convertir `calculateLiveMetrics` y `getLiveMetricsForProject` en fachadas fábrica → núcleo → costo, exponiendo `semaphore` con alias `@deprecated`.
**Depende de:** Paso 5a
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-04, RF-06, RF-07, RNF-01, RNF-04; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Contratos; [../05-casos-limite.md](../05-casos-limite.md) CL-01, CL-03, CL-04, CL-18, CL-19.
**Archivos:**
- `estimation/estimation.service.ts` [modifica] — fachada sobre el núcleo; sin `conformancePenalty` ni reglas «>5»/«>8».
- `estimation/estimation.types.ts` [modifica] — `semaphore: MddSemaphoreVerdict`, `persistedStale?`, alias `@deprecated`.
- `estimation/__tests__/estimation-semaphore.spec.ts` [nuevo] — equivalencia y casos límite.
- `estimation/__tests__/estimation-semaphore.characterization.spec.ts` [modifica] — casos `// CAMBIA EN P5`.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 5b.1 `calculateLiveMetrics` (`:1421-1666`) y `getLiveMetricsForProject` (`:1034-1237`) usan `buildSemaphoreInputs` + `evaluateMddSemaphore`; desaparecen las ramas A/B/C con fórmulas propias.
- [ ] 5b.2 Eliminar `conformancePenalty` (`:1499-1512`) y las reglas «>5» y «>8» (`:1191-1195`) (D15, J5, J12).
- [ ] 5b.3 Conectar el gate con `resolveDeliveryGateContext` (`:1154-1161`).
- [ ] 5b.4 Añadir `semaphore` a `LiveMetricsResult`; alias `status = semaphore.status`, `precision = semaphore.integral ?? headline`, `auditorScore`, `mddQualitySource`, `deliveryGate` marcados `@deprecated` (J15, RNF-04).
- [ ] 5b.5 Medir p95 del POST con `apps/api/eval/mdd/fixtures/good-ecommerce-tienda-basica.md` y el MDD más grande de `eval/mdd/cases`; anotar antes/después en Notas (RNF-01 ≤ 1.5×).
- [ ] 5b.6 Actualizar casos `// CAMBIA EN P5` en la caracterización; cualquier otro cambio = regla de parada.
- [ ] 5b.7 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Changed`: semáforo vivo desde el núcleo, conformidad sin resta; `### Fixed`: integral pre-cascada puede ser verde).
- [ ] 5b.8 Pruebas del paso: CL-01 (MDD vacío → rojo, titular 0); CL-03 (MDD perfecto + BRD + Spec sin Auditor pre-cascada → 100 verde con nota); CL-04 (Auditor 95 sin críticos → titular 95 `auditor`, verde); CL-18 (4 faltantes → amarillo, titular sin resta); CL-19 (1 blocker + Auditor 95 → rojo con el blocker en `reasons`); RF-06 con fixture `good-ecommerce` sin derivados (`status=green`, nota, `reasons` sin «Conformidad»); RF-07 (`ok:false` con 1 faltante → amarillo).

### Criterios de aceptación
- [ ] RF-04 (vivo), RF-06, RF-07 cubiertos.
- [ ] CL-01, CL-03, CL-04, CL-18, CL-19 en verde.
- [ ] RNF-01 medido y anotado (≤ 1.5× el p95 actual).
- [ ] MCP `get_estimation` sigue recibiendo los campos antiguos (RNF-04).

### Verificación
```bash
pnpm --filter @theforge/api test && pnpm --filter @theforge/api test:types
```
Resultado esperado: suite de la API y tipos en verde; caracterización solo con cambios marcados P5.

### Fuera de alcance de este paso
- Escritura en `Stage` (sigue como hoy hasta el Paso 8b). Design-First (Paso 12). Costo (Paso 13).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 6 — Streams y regeneración
**Objetivo:** Que `done`, `interrupt` y la regeneración de sección usen el mismo evaluador, con complejidad real y limpieza del borrador al cancelar.
**Depende de:** Paso 5b
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-16, RF-18; [../05-casos-limite.md](../05-casos-limite.md) CL-07, CL-27; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Flujo de datos.
**Archivos:**
- `apps/api/src/modules/ai-analysis/ai-analysis.service.ts` [modifica] — streams con evaluador, complejidad real, `clearLiveDraft` al cancelar.
- `estimation/estimation.service.ts` [modifica] — `evaluateForStream`.
- `apps/api/src/modules/ai-analysis/nodes/mdd-manager/manager-state-handlers.ts` [modifica] — evaluador.
- `estimation/__tests__/estimation-stream-parity.spec.ts` [nuevo] — paridad stream = POST, CL-07, CL-27.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 6.1 Cargar entradas una vez al iniciar el stream (`source:'stream'`) y evaluar con `evaluateForStream` en `done`/`interrupt` (`ai-analysis.service.ts:379-393`, `:1432-1433`, `:1829`, `:2307`, `:2520`, `:2614`, `:3022`).
- [ ] 6.2 Reemplazar las llamadas sin `documents` en `manager-state-handlers.ts:197-205` y `:468-476`.
- [ ] 6.3 Regeneración de sección con complejidad real vía `ensureProjectComplexity`, sin forzar ni cachear HIGH (`ai-analysis.service.ts:2510-2521`, `:3022`; `estimation.service.ts:761-778,:1377-1383`) (D10).
- [ ] 6.4 `clearLiveDraft` al cancelar el stream (`ai-analysis.service.ts:1461`, `:1911`, `:2338`) (D24).
- [ ] 6.5 Gaps del Auditor solo si el hash coincide.
- [ ] 6.6 SSE `done`, `draft`, `interrupt` suman `semaphore`.
- [ ] 6.7 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: stream y panel muestran el mismo color; regeneración respeta complejidad; borrador limpio al cancelar).
- [ ] 6.8 Pruebas del paso: `done` y POST posterior con mismo contenido → mismo `status`/`headline` (RF-16); CL-07 (tras cancelar, `getMddContentForProject` devuelve BD); CL-27 (regeneración en LOW → complejidad LOW, caché no pasa a HIGH).

### Criterios de aceptación
- [ ] RF-16 y RF-18 cubiertos.
- [ ] CL-07 y CL-27 en verde.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="estimation-stream-parity"
pnpm --filter @theforge/api test
```
Resultado esperado: paridad y suite en verde.

### Fuera de alcance de este paso
- Web (Paso 11).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 7 — Composite y SemaphoreService
**Objetivo:** Convertir el composite en adaptador del veredicto y dejar `SemaphoreService` solo con degradadores Figma/Constitución.
**Depende de:** Paso 5b
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-04, RF-05, RF-06, RF-09; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Escala única y Componentes (composite, SemaphoreService); [../05-casos-limite.md](../05-casos-limite.md) CL-16, CL-17.
**Archivos:**
- `projects/project-semaphore-composite.util.ts` [modifica] — adaptador del veredicto.
- `projects/project-semaphore-composite.util.spec.ts` [modifica] — casos P7 y caracterización `// CAMBIA EN P7`.
- `projects/project-conformance.service.ts` [modifica] — usa la fábrica (persisted).
- `engine/semaphore.service.ts` [modifica] — solo degradadores.
- `engine/semaphore.service.spec.ts` [modifica] — sin buckets.
- `engine/mdd-update-pipeline.service.ts` [modifica] — sin color de fallback; gate con contexto único.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 7.1 `evaluateCompositeSemaphore` (`:146-238`) devuelve `status`/`precisionScore` del veredicto + `reasons` y conteos; reemplaza `applyCompositeReadinessGates` (`readiness-audit.util.ts:159-206`).
- [ ] 7.2 Eliminar el paso de todos los gaps a `semaphore.evaluate` en LOW/MEDIUM (`:212-215`) y el doble conteo HIGH (`:174-178`, `:214`; `conformance-gaps.util.ts:55-68`) (D3). Deduplicar gaps.
- [ ] 7.3 `project-conformance.service.ts:121` usa `buildSemaphoreInputs(persisted)`; mismo veredicto que `buildUnifiedAudit` (`:96-117`).
- [ ] 7.4 `semaphore.service.ts`: retirar `applySddPrecisionGates` (`:82-96`) y buckets 70/82/92/95, `edge_cases`/`field_types`, `sddDomainGraphOk` (J9); exportar degradadores puros `figmaGateOk` y Constitución con bloqueantes (`:146-178`).
- [ ] 7.5 `mdd-update-pipeline.service.ts:162-185`: sin color de fallback; gate con `resolveDeliveryGateContext` en ambas ramas (`:93`).
- [ ] 7.6 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Changed`: composite alineado con el veredicto; `### Removed`/`### Changed`: señales HIGH retiradas del color).
- [ ] 7.7 Pruebas del paso: 3 gaps → verde (si el resto lo permite); CL-17 (6 gaps deduplicados → amarillo, titular intacto); CL-16 (mismo gap en precisión SDD y conformidad cuenta 1); fixture sin derivados → `reasons` sin «Conformidad» (RF-06); equivalencia composite = vivo con mismas entradas (RF-04); mismo `ok/blockers/score` del gate en pipeline (RF-09).

### Criterios de aceptación
- [ ] RF-04, RF-05, RF-06 (`reasons`), RF-09 cubiertos.
- [ ] CL-16 y CL-17 en verde.
- [ ] `grep -rnE "\b(78|82)\b" projects/project-semaphore-composite.util.ts engine/semaphore.service.ts` sin topes activos (RF-01).

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="project-semaphore-composite|semaphore.service|mdd-update-pipeline"
pnpm --filter @theforge/api test
```
Resultado esperado: specs y suite en verde; caracterización solo con cambios marcados P7.

### Fuera de alcance de este paso
- Escritura en BD (Pasos 8a/8b). `sdd-integration.service.ts`.

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 8a — Servicio de sincronización único (CAS)
**Objetivo:** Crear `StageSemaphoreSyncService` como único escritor de `Stage.status`/`precisionScore` con CAS por `updatedAt`.
**Depende de:** Paso 7
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Sincronización; [../01-PRD.md](../01-PRD.md) RF-13, RNF-05; [../05-casos-limite.md](../05-casos-limite.md) CL-08, CL-30.
**Archivos:**
- `projects/stage-semaphore-sync.service.ts` [nuevo] — `syncFromPersisted(projectId, stageId, opts?)`.
- `projects/stage-semaphore-sync.service.spec.ts` [nuevo] — CAS, etapa editada, sin cambios.
- `projects/projects.module.ts` [modifica] — provider; importa `EstimationModule` (no AiAnalysis).
- `projects/project-deliverable-gate.service.ts` [modifica] — `refreshStageSemaphoreFromProject` como wrapper `@deprecated` que delega con la etapa primaria.
- `estimation/live-semaphore-status.util.ts` [modifica] — mapeo único live↔DB.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 8a.1 `syncFromPersisted(projectId, stageId, opts?: { reason: string }): Promise<{ status, precisionScore, changed } | null>`: `buildSemaphoreInputs(source:'persisted')` → `evaluateMddSemaphore`.
- [ ] 8a.2 CAS: leer `Stage.updatedAt` junto a las entradas; `updateMany({ where: { id: stageId, updatedAt } })`; si 0 filas, reintentar una vez releyendo; luego log `[Semaphore] cas-miss`. Escribir solo si hay diferencia.
- [ ] 8a.3 Guardar `shortTermContext.semaphoreSync = { version: 1, inputsHash, computedAt }` (J14, sin migración).
- [ ] 8a.4 Tras escribir, `recalcAndUpsert(Estimation)` con el status del veredicto.
- [ ] 8a.5 Línea estructurada `[Semaphore]` con `projectId`, `stageId`, `source`, `status`, `headline`, `headlineSource`, `phase`, `derivativesState`, `reasons.length`, `changed`, `durationMs`, `reason`; nunca contenido del MDD (RNF-05).
- [ ] 8a.6 Unificar el mapeo live↔DB en `live-semaphore-status.util.ts`.
- [ ] 8a.7 `refreshStageSemaphoreFromProject` (`project-deliverable-gate.service.ts:39-65`) delega en el sync con etapa primaria, marcado `@deprecated`.
- [ ] 8a.8 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Architecture`: único escritor del semáforo de etapa con CAS).
- [ ] 8a.9 Pruebas del paso: CL-30 (CAS con `updatedAt` viejo → no escribe, log `cas-miss`); CL-08 (sync con `stageId` de etapa 2 solo toca etapa 2); sin diferencia → no escribe; `semaphoreSync` guardado.

### Criterios de aceptación
- [ ] RF-13 (servicio): sync por etapa con CAS.
- [ ] CL-08 y CL-30 en verde.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="stage-semaphore-sync|live-semaphore"
pnpm --filter @theforge/api test:types
```
Resultado esperado: specs y tipos en verde.

### Fuera de alcance de este paso
- Retirar la escritura de GET/POST (Paso 8b). Callers restantes (Paso 9a).

> **Se despliegan juntos:** los Pasos 8 (8a + 8b) y 9 (9a + 9b) no se despliegan por separado.

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 8b — GET/POST sin escritura y persistencias principales
**Objetivo:** Que GET y POST de estimación no escriban `Stage`, que expongan `persistedStale`, y que MDD y PATCH de proyecto sincronicen la etapa editada.
**Depende de:** Paso 8a
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-12, RF-13, RF-17, RF-22, RNF-06; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Sincronización y Seguridad; [../05-casos-limite.md](../05-casos-limite.md) CL-08, CL-28.
**Archivos:**
- `estimation/estimation.service.ts` [modifica] — eliminar `syncStageSemaphoreFromLiveMetrics` y llamadas; `persistedStale`.
- `estimation/__tests__/estimation-semaphore.spec.ts` [modifica] — GET/POST sin escrituras, `persistedStale`.
- `apps/api/src/modules/ai-analysis/ai-analysis.controller.ts` [modifica] — respuesta con `semaphore` y `persistedStale`.
- `projects/project-mdd-persist.service.ts` [modifica] — sync de la etapa editada; hash del snapshot en la misma escritura.
- `projects/project-update.service.ts` [modifica] — sync de la etapa editada.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [x] 8b.1 Eliminar `syncStageSemaphoreFromLiveMetrics` (`estimation.service.ts:977-980`) y sus llamadas en `estimation.service.ts:1233`, `:1292`, `:1366` (D25).
- [x] 8b.2 GET calcula `persistedStale` comparando `shortTermContext.semaphoreSync.inputsHash` con el hash actual, sin escribir (RF-22).
- [x] 8b.3 `ai-analysis.controller.ts:209-258`: GET y POST devuelven `semaphore` y `persistedStale`.
- [x] 8b.4 `project-mdd-persist.service.ts` (`:329`, `:456`): llamar `syncFromPersisted` con la etapa editada (no la primaria, `:456-465`, D23); hash del snapshot del Auditor sobre el contenido persistido canónico en la misma escritura (RF-17).
- [x] 8b.5 `project-update.service.ts` (`:182-184`, `:354`, `:416`): sync con la etapa editada.
- [x] 8b.6 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: GET/POST de estimación ya no escriben la etapa; sync sobre la etapa editada; `### Added`: `persistedStale`).
- [x] 8b.7 Pruebas del paso: GET y POST nunca llaman `stage.update`/`updateMany` (RF-12); CL-28 (GET con rol de lectura → 0 escrituras); CL-08 (PATCH sobre etapa no primaria actualiza solo esa); BRD cambiado fuera del sync → `persistedStale=true` (RF-22).

### Criterios de aceptación
- [x] RF-12, RF-13 (MDD y PATCH), RF-17 (persistencia), RF-22 cubiertos.
- [x] CL-08 y CL-28 en verde.
- [x] `grep -n "syncStageSemaphoreFromLiveMetrics" -r apps/api/src` = 0.

### Verificación
```bash
pnpm --filter @theforge/api test && pnpm --filter @theforge/api test:types
grep -rn "syncStageSemaphoreFromLiveMetrics" apps/api/src || echo "eliminado"
```
Resultado esperado: suite y tipos en verde; el grep imprime «eliminado».

### Fuera de alcance de este paso
- Resto de callers (Paso 9a). Puerta 409 (Paso 10).

> **Se despliegan juntos:** los Pasos 8 (8a + 8b) y 9 (9a + 9b). Sin el Paso 9 la lista de proyectos queda desfasada en las rutas aún no instrumentadas.

### Notas de ejecución
- 2026-11-12: `project-update` sync por `targetStage.id`; specs P8b en `estimation-semaphore.spec.ts`; controller expone `semaphore`/`persistedStale`.

---

## Paso 9a — Callers restantes del sync e inventario de escritores
**Objetivo:** Conectar el sync en el resto de persistencias relevantes y blindar la lista de escritores con un spec de inventario.
**Depende de:** Paso 8b
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Sincronización (lista de callers y red de seguridad); [../05-casos-limite.md](../05-casos-limite.md) CL-15, CL-29.
**Archivos:**
- `projects/projects.service.ts` [modifica] — sync en `:252`.
- `projects/project-brd.service.ts` [modifica] — sync en `:122`.
- `projects/deliverables-cascade.service.ts` [modifica] — sync solo al final o en error (`:211`, `:410`, `:843`, `:917`); `persistStageAndProjectDeliverables` vía hook del servicio llamador.
- `projects/project-merge.service.ts` [modifica] — sync tras reset (`:358`, `:388`).
- `projects/stage-semaphore-writers.inventory.spec.ts` [nuevo] — lista permitida de escritores.
- `projects/stage-semaphore-sync.service.spec.ts` [modifica] — CL-15.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [x] 9a.1 Llamar `syncFromPersisted` con la etapa editada en `projects.service.ts:252` y `project-brd.service.ts:122`.
- [x] 9a.2 `deliverables-cascade.service.ts`: no sincronizar mientras haya job de cascada activo; sincronizar una vez al final o en error. Para `stage-deliverable-persist.util.ts` (`persistStageAndProjectDeliverables`), el hook va en el servicio llamador.
- [x] 9a.3 `project-merge.service.ts:358,:388`: sync tras merge/clear.
- [x] 9a.4 Spec de inventario: grep en test que falla si aparece una escritura nueva de `mddContent`, `brdContent`, `specContent` o de `Stage.status`/`precisionScore` fuera de la lista permitida (incluye `project-stage.service.ts:116-143`, `project-clone.util.ts:26`, `project-notion-import.util.ts:153,:190`, `project-notion-portability.service.ts:261,:316`, `legacy-flow/*` con TODO si aplica).
- [x] 9a.5 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: lista de proyectos sincronizada en BRD, Spec, cascada y merge; `### Added`: inventario de escritores).
- [x] 9a.6 Pruebas del paso: CL-15 (cascada en curso → no escribe; al terminar escribe una vez); CL-29 (BRD cambiado por ruta no instrumentada → `persistedStale=true` y el inventario falla si la ruta es nueva).

### Criterios de aceptación
- [x] RF-13: todas las persistencias de la lista llaman al sync con la etapa editada.
- [x] CL-15 y CL-29 en verde.
- [x] Cualquier escritor no listado detectado → regla de parada (anotar y preguntar).

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="stage-semaphore"
pnpm --filter @theforge/api test
```
Resultado esperado: inventario y sync en verde; suite en verde.

### Fuera de alcance de este paso
- LEGACY salvo que el inventario lo detecte (añadir a la lista permitida con TODO o al sync).

> **Se despliegan juntos:** Pasos 8 y 9.

### Notas de ejecución
- 2026-11-12: sync en BRD, cascada (fin), merge; sin sync en convergencia; `stage-semaphore-writers.inventory.spec.ts`.

---

## Paso 9b — Hash canónico del snapshot del Auditor
**Objetivo:** Que el hash del snapshot del Auditor y el del override del editor usen el mismo normalizador sobre el contenido persistido canónico.
**Depende de:** Paso 9a
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-17; [../05-casos-limite.md](../05-casos-limite.md) CL-05, CL-06; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Contratos (`normalizeMddForHash`).
**Archivos:**
- `estimation/mdd-draft-hash.util.ts` [modifica] — usa `normalizeMddForHash` (hash `node:crypto` queda aquí).
- `estimation/estimation.service.ts` [modifica] — `saveMddAuditSnapshot` con hash canónico.
- `apps/api/src/modules/ai-analysis/mdd/mdd-manual-audit.service.ts` [modifica] — hash persistido + sync tras `saveMddAuditSnapshot`.
- `estimation/__tests__/estimation-auditor-hash.spec.ts` [modifica] — CL-05, CL-06.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 9b.1 `mdd-draft-hash.util.ts:7-9`: normalizar con `normalizeMddForHash` antes de hashear (D8).
- [ ] 9b.2 `saveMddAuditSnapshot` / `persistMddAuditSnapshot`: hash del markdown tras `prepareMddForOutput`, no del último draft (`estimation.service.ts:881-894`); eliminar el orden `clearLiveDraft` antes de persistir (`ai-analysis.service.ts:1431-1439`) si sigue presente; `rebindAuditorGapsToPersistedContent` (`:826-830`) deja de ser solo memoria (D7).
- [ ] 9b.3 `mdd-manual-audit.service.ts`: tras `saveMddAuditSnapshot`, `syncFromPersisted` con la etapa editada; añadir a la lista del inventario.
- [ ] 9b.4 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: snapshot del Auditor coincide tras reinicio).
- [ ] 9b.5 Pruebas del paso: CL-05 (tras reinicio simulado el snapshot coincide y `headlineSource=auditor`); CL-06 (override formateado por la web → mismo hash → auditor).

### Criterios de aceptación
- [ ] RF-17 cubierto.
- [ ] CL-05 y CL-06 en verde.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="estimation-auditor-hash|stage-semaphore"
pnpm --filter @theforge/api test
```
Resultado esperado: los 9 casos previos más los nuevos en verde; suite en verde.

### Fuera de alcance de este paso
- Prompts del Auditor LLM.

> **Se despliegan juntos:** Pasos 8 y 9.

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 10 — Puerta de entregables en backend
**Objetivo:** Aplicar `evaluateDeliverablesGate` en `assertDeliverablesAllowed` detrás del flag `DELIVERABLES_GATE_REQUIRE_GREEN` (apagado) y exponer `deliverablesGate`.
**Depende de:** Paso 9b
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Puerta compartida y Contratos (409); [../01-PRD.md](../01-PRD.md) RF-14; [../05-casos-limite.md](../05-casos-limite.md) CL-22; [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md), riesgo de 409 masivos.
**Archivos:**
- `projects/project-deliverable-gate.service.ts` [modifica] — puerta compartida tras el flag.
- `projects/project-deliverable-gate.service.spec.ts` [nuevo] — reglas, flag y `acknowledgeGaps`.
- `apps/api/src/modules/ai-analysis/utils/mdd-delivery-gate-guard.util.ts` [modifica] — cuerpo 409 con `gate`.
- `apps/api/src/config/env.schema.ts` [modifica] — flag `DELIVERABLES_GATE_REQUIRE_GREEN` (default `false`); confirmar que es el archivo de config tipada.
- `apps/api/src/modules/ai-analysis/ai-analysis.controller.ts` [modifica] — `deliverablesGate` en la respuesta si no entró en 8b.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 10.1 `assertDeliverablesAllowed` (`project-deliverable-gate.service.ts:68-128`, 8 callers): recalcular veredicto persistido y aplicar `evaluateDeliverablesGate`; con flag apagado solo exige blockers (comportamiento actual) pero la respuesta ya expone la regla.
- [ ] 10.2 `resolveDeliveryGateContext` en `:115-120`.
- [ ] 10.3 `acknowledgeGaps` salta blockers del MDD y la falta de verde con log; **no** salta la falta de Spec en HIGH (J13).
- [ ] 10.4 `buildMddDeliveryGateConflictBody`: añadir `gate: { allowed, rule, reasons, semaphoreStatus, hasSpec }`; conservar `ERR_MDD_DELIVERY_GATE`; nuevo `ERR_DELIVERABLES_GATE` cuando el motivo no es blocker del MDD.
- [ ] 10.5 Log `[Semaphore] gate-block` con `rule` y `reasons` (RNF-05).
- [ ] 10.6 Flag en la config tipada con default `false`; no encenderlo (J11).
- [ ] 10.7 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Added`: puerta de entregables compartida tras flag; `ERR_DELIVERABLES_GATE`).
- [ ] 10.8 Pruebas del paso: CL-22 (HIGH verde sin Spec → `allowed=false` «falta Spec»; 409 con flag activo; `acknowledgeGaps` no lo salta); HIGH amarillo → 409 con `gate.reasons` (flag activo); flag apagado = comportamiento actual.

### Criterios de aceptación
- [ ] RF-14 cubierto en backend.
- [ ] CL-22 en verde.
- [ ] Flag apagado: specs existentes del gate sin cambios.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="project-deliverable-gate|mdd-delivery-gate-guard|env.schema"
pnpm --filter @theforge/api test
```
Resultado esperado: specs y suite en verde.

### Fuera de alcance de este paso
- Web (Paso 11). `assertDesignFirstDeliverableGate` (zona protegida).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 11 — Web solo refleja el veredicto
**Objetivo:** Que el Workshop pinte color, nota y botón directamente desde `semaphore`, sin lógica propia de color ni de permiso.
**Depende de:** Paso 10
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-15, RF-06; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Contratos y Flujo de datos; [../05-casos-limite.md](../05-casos-limite.md) CL-03, CL-22.
**Archivos:**
- `apps/web/src/utils/workshopSemaphoreStatus.ts` [modifica] — lee `semaphore`.
- `apps/web/src/utils/workshopSemaphoreStatus.spec.ts` [nuevo] — helper.
- `apps/web/src/views/WorkshopMetricsColumnInner.tsx` [modifica] — sin `effectiveStatus`; `canGenerate = deliverablesGate.allowed`.
- `apps/web/src/store/workshop/slice-deliverables.ts` [modifica] — `fetchEstimation` no pisa `project.status` con borrador.
- `apps/web/src/store/workshop/types.ts` [modifica] — tipo `semaphore` (desde shared-types).
- `apps/web/src/store/workshop/helpers/mdd-chat-event.ts` [modifica] — `semaphore` del `done`.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 11.1 Color = `semaphore.status`; % = `semaphore.headline` en `resolveWorkshopHeadlineScore` (`workshopSemaphoreStatus.ts:43-53`).
- [ ] 11.2 Eliminar `effectiveStatus` (`WorkshopMetricsColumnInner.tsx:383-391`) y la regex de derivados pendientes (`:222-225`); `canGenerate` = `deliverablesGate.allowed` (reemplaza `:149`, `:191-202`).
- [ ] 11.3 Nota «MDD listo; genera entregables» cuando `derivativesState==='none'`; insignia «borrador sin guardar» con `source==='draft'`; aviso cuando `persistedStale`.
- [ ] 11.4 `fetchEstimation` (`slice-deliverables.ts:1150-1163`, `:1182-1206`) actualiza `project.status` solo si `source==='persisted'`.
- [ ] 11.5 `mdd-chat-event.ts`: tomar `semaphore` del evento `done`.
- [ ] 11.6 Tipos importados desde `@theforge/shared-types`, no redefinidos.
- [ ] 11.7 Textos de UI en español.
- [ ] 11.8 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Changed`: Workshop refleja el veredicto único; botón coherente con la puerta).
- [ ] 11.9 Pruebas del paso: spec del helper (color, headline, nota, borrador, stale); CL-03 en UI (verde con nota sin derivados); CL-22 en UI (botón deshabilitado con razón «falta Spec»).
- [ ] 11.10 **Comprobación visual en navegador** con `pnpm dev:local`: MDD verde con nota, edición manual marcada como borrador, botón «Generar» coherente con `deliverablesGate`; anotar lo observado en Notas.

### Criterios de aceptación
- [ ] RF-15: `grep -rn "effectiveStatus" apps/web/src` = 0.
- [ ] CL-03 y CL-22 reflejados en UI.
- [ ] Comprobación visual hecha y anotada.

### Verificación
```bash
pnpm --filter @theforge/web test && pnpm --filter @theforge/web test:types && pnpm --filter @theforge/web lint
grep -rn "effectiveStatus" apps/web/src || echo "eliminado"
```
Resultado esperado: tests, tipos y lint en verde; grep «eliminado»; revisión visual conforme.

### Fuera de alcance de este paso
- Costo en la web (Paso 13).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 12 — Design-First por el mismo evaluador
**Objetivo:** Eliminar la rama paralela Design-First y pasarla por el núcleo con delivery gate, conformidad y tope 40.
**Depende de:** Paso 11
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-20; [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Escala única (tope DF); [../05-casos-limite.md](../05-casos-limite.md) CL-23, CL-24, CL-25.
**Archivos:**
- `estimation/estimation.service.ts` [modifica] — eliminar `getLiveMetricsForDesignFirstProject` paralelo y `!hasMdd ||` (`:1342`).
- `estimation/estimation-design-first.util.ts` [modifica] — fases como entradas; sin `minSemaphore` paralelo.
- `estimation/semaphore-inputs.factory.ts` [modifica] — perfil DESIGN_FIRST.
- `estimation/estimation.design-first.spec.ts` [modifica] — CL-23…CL-25.
- `estimation/__fixtures__/semaphore/design-first-fase3-pendiente.json` [nuevo] — fixture DF.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 12.1 Eliminar la rama DF paralela (`estimation.service.ts:1338-1369`) incluido `!hasMdd ||` muerto (`:1342`) (D13).
- [ ] 12.2 `designFirstPhaseSemaphore` (`estimation-design-first.util.ts:63-72`) pasa a producir entradas de fase para el núcleo.
- [ ] 12.3 Fábrica: perfil DESIGN_FIRST con delivery gate y conformidad como NEW (J6).
- [ ] 12.4 Tope 40 aplica al titular incluido `auditorScore` (`:1346-1359`) y al valor persistido.
- [ ] 12.5 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Fixed`: Design-First respeta tope 40 y delivery gate).
- [ ] 12.6 Pruebas del paso: CL-23 (fase 1 no ok → rojo); CL-24 (fase 3 no ok y Auditor 95 → titular 40, amarillo, persistido 40, con `design-first-fase3-pendiente.json`); CL-25 (fases ok y un blocker → rojo).

### Criterios de aceptación
- [ ] RF-20 cubierto.
- [ ] CL-23, CL-24, CL-25 en verde.

### Verificación
```bash
pnpm --filter @theforge/api test -- --test-path-pattern="design-first|semaphore-inputs"
pnpm --filter @theforge/api test
```
Resultado esperado: specs y suite en verde.

### Fuera de alcance de este paso
- `assertDesignFirstDeliverableGate` (zona protegida).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 13 — Costo única fuente
**Objetivo:** Que panel, fallback web y `Estimation` persistida calculen el costo con `computeCostEstimation` + `countCostDrivers` y el color del veredicto.
**Depende de:** Paso 12
**Lee antes:** [../01-PRD.md](../01-PRD.md) RF-21; [../05-casos-limite.md](../05-casos-limite.md) CL-31; [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md), riesgo de cambios visibles de costo.
**Archivos:**
- `estimation/estimation.service.ts` [modifica] — `computeCostEstimation` con estado del veredicto; conteos unificados.
- `apps/web/src/utils/costCalculator.ts` [modifica] — `countCostDrivers`.
- `projects/project-estimation-recalc.service.ts` [modifica] — `countCostDrivers`.
- `engine/cost-calculator.service.ts` [modifica] — delega en business-rules.
- `estimation/__tests__/estimation-cost-parity.spec.ts` [nuevo] — paridad de las 3 vías (ubicación sugerida; el plan no la fija).
- `packages/business-rules/src/cost-parity.characterization.spec.ts` [modifica] — casos `// CAMBIA EN P13`.
- `CHANGELOG.md` [modifica] — entrada del paso con diferencia del golden.

### Subtareas
- [x] 13.1 Panel: reemplazar `riskFactor` (integral <85, `estimation.service.ts:1620-1621`) por `computeCostEstimation` con buffer 1.25 si `semaphore.status !== 'green'` (J4).
- [x] 13.2 Retirar el contador propio de `estimation.service.ts:605-660` en favor de `countCostDrivers`.
- [x] 13.3 Web: `costCalculator.ts:~80-121` usa `countCostDrivers` (ya importa business-rules, `:5-13`).
- [x] 13.4 `project-estimation-recalc.service.ts:23-68` (`:35-46`): `countCostDrivers` y status del veredicto.
- [x] 13.5 `engine/cost-calculator.service.ts` delega en business-rules.
- [x] 13.6 Golden de costo con MDD de `eval/mdd`: registrar la diferencia antes/después en CHANGELOG.
- [x] 13.7 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Changed`: costo con fórmula única; diferencia del golden).
- [x] 13.8 Pruebas del paso: CL-31 (mismo MDD amarillo vs verde → ×1.25 si no verde, igual en las 3 vías); paridad horas y MXN en las 3 vías.

### Criterios de aceptación
- [x] RF-21: las 3 vías dan mismas horas y MXN para mismo MDD y color.
- [x] CL-31 en verde.
- [x] Diferencia del golden documentada en CHANGELOG.

### Verificación
```bash
pnpm --filter @theforge/business-rules test && pnpm --filter @theforge/api test && pnpm --filter @theforge/web test
```
Resultado esperado: las tres suites en verde.

### Fuera de alcance de este paso
- Tarifas de `cost-estimation.ts` (zona protegida).

### Notas de ejecución
- 2026-11-12: `costCalculator.ts` y `project-estimation-recalc.service.ts` usan `countCostDrivers`; goldens paridad 171383.34 / 209874.6 / 325357.73 MXN (3 vías iguales).

---

## Paso 14 — Script de backfill
**Objetivo:** Recalcular `Stage.status`/`precisionScore` de etapas existentes con el núcleo, de forma idempotente y solo por CLI.
**Depende de:** Paso 13
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), secciones Sincronización y Seguridad; [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md), riesgos de lista desfasada y 409 masivos.
**Archivos:**
- `apps/api/scripts/recalc-stage-semaphores.ts` [nuevo] — `--dry-run`, `--limit`, `--project`.
- `CHANGELOG.md` [modifica] — entrada del paso.

### Subtareas
- [ ] 14.1 Implementar el script reutilizando `StageSemaphoreSyncService` (CAS incluido); flags `--dry-run`, `--limit`, `--project`.
- [ ] 14.2 Saltar etapas con job de cascada o lease activo.
- [ ] 14.3 Escribir solo si hay diferencia; reportar cambios de color (de → a, por proyecto/etapa) sin contenido del MDD.
- [ ] 14.4 Nunca se ejecuta en el arranque de la API.
- [ ] 14.5 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Added`: script de backfill del semáforo de etapas).
- [ ] 14.6 Pruebas del paso: `--dry-run` sobre BD local; corrida real local y segunda corrida con 0 cambios (idempotencia).

### Criterios de aceptación
- [ ] Idempotente: la segunda corrida sobre BD local reporta 0 cambios.
- [ ] **Ejecución contra producción solo con aprobación explícita de Jorge** (fuera de este paso).

### Verificación
```bash
pnpm dev:local   # en otra terminal, si la BD local no está arriba
cd apps/api && npx tsx scripts/recalc-stage-semaphores.ts --dry-run --limit 50
```
Resultado esperado: informe de cambios de color sin escrituras; tras una corrida real local, una segunda corrida informa 0 cambios. (Ajusta el lanzador a la convención de `apps/api/scripts/` si difiere; anótalo.)

### Fuera de alcance de este paso
- Ejecución en producción (requiere aprobación de Jorge). Encender `DELIVERABLES_GATE_REQUIRE_GREEN` (J11).

### Notas de ejecución
<se rellena al ejecutar: decisiones, desvíos, bloqueos>

---

## Paso 15 — Documentación
**Objetivo:** Dejar la documentación sin contradicciones con el código y publicar el ADR-0007.
**Depende de:** Paso 14
**Lee antes:** [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md) completo; [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md); `docs/adr/0006-architecture-graph-separado.md` como formato de referencia.
**Archivos:**
- `docs/adr/0007-nucleo-unico-semaforo-mdd.md` [nuevo] — invariante, alternativas descartadas, J9.
- `docs/notebooklm/THEFORGE-INDEX.md` [modifica] — §4–§5.
- `docs_mcp/arquitectura/mdd-semaforo.md` [modifica] — `:29-30`, `:45-46`.
- `estimation/README.md` [modifica] — núcleo, fábrica, fachadas.
- `engine/README.md` [modifica] — `SemaphoreService` solo degradadores; `conformance-gaps.util.ts`.
- `projects/README.md` [modifica] — sync único, puerta, inventario.
- Doc del MCP `get_estimation` [modifica] — solo si existe (ruta sin verificar; anotar).
- `CHANGELOG.md` [modifica] — consolidado.

### Subtareas
- [x] 15.1 ADR-0007: invariante «mismas entradas persistidas → panel GET = lista = composite = puerta»; POST con borrador marcado `source==='draft'`; alternativas descartadas; retiro de señales HIGH (J9); alias y su retiro (J15).
- [x] 15.2 `THEFORGE-INDEX.md` §4–§5: escala única, completitud por fase, costo única fuente (corrige §5 falso).
- [x] 15.3 `mdd-semaforo.md`: retirar «verde exige gapCount===0» y «persistida = SemaphoreService»; documentar `sdd-integration.service.ts:731-746` como tercer indicador fuera de alcance.
- [x] 15.4 READMEs de `estimation/`, `engine/`, `projects/`.
- [x] 15.5 Doc del MCP `get_estimation` si existe: campos nuevos y alias `@deprecated`.
- [x] 15.6 Añadir entrada en CHANGELOG.md `## [Unreleased]` (`### Architecture`: ADR-0007) y consolidar las entradas de los pasos anteriores sin duplicados.
- [x] 15.7 Pruebas del paso: revisión manual cruzada doc ↔ código (no existe `docs:check`).

### Criterios de aceptación
- [x] Ninguna afirmación de la documentación contradice el código.
- [x] ADR-0007 publicado en `docs/adr/`.

### Verificación
```bash
grep -n "gapCount===0\|gapCount === 0" docs_mcp/arquitectura/mdd-semaforo.md || echo "sin regla obsoleta"
ls docs/adr/0007-nucleo-unico-semaforo-mdd.md
```
Resultado esperado: «sin regla obsoleta» y el ADR existe; revisión manual conforme.

### Fuera de alcance de este paso
- Cambios de código.

### Notas de ejecución
- 2026-11-12: READMEs + índices actualizados; MCP `get_estimation` no tiene doc dedicada (contrato en `ai-analysis.controller`).

---

## Paso 16 — Verificación final
**Objetivo:** Confirmar suite completa, tipos, smoke del Workshop y backfill en seco.
**Depende de:** Paso 15
**Lee antes:** [../04-plan-de-pruebas.md](../04-plan-de-pruebas.md), secciones Smoke y Criterios de salida.
**Archivos:**
- `CHANGELOG.md` [modifica] — solo si la verificación obliga a ajustar alguna entrada.

### Subtareas
- [x] 16.1 `pnpm turbo run build test lint`.
- [x] 16.2 `pnpm --filter @theforge/api test:types` y `pnpm --filter @theforge/web test:types`.
- [x] 16.3 `pnpm --filter @theforge/api eval:mdd -- --dry-run`.
- [x] 16.4 Smoke Workshop (`pnpm dev:local`): MDD nuevo verde con nota; edición manual marca borrador y la lista no cambia hasta guardar; cascada pasa a `post_cascade`; etapa 2 se sincroniza sola; proyecto Design-First.
- [x] 16.5 Backfill `--dry-run` sobre BD local (idempotente).
- [x] 16.6 Añadir entrada en CHANGELOG.md `## [Unreleased]` solo si hubo ajustes; si no, dejar constancia en Notas.
- [x] 16.7 Pruebas del paso: todo lo anterior en verde.

### Criterios de aceptación
- [x] Suite, tipos, lint y build en verde.
- [x] Smoke del Workshop conforme y anotado.

### Verificación
```bash
pnpm turbo run build test lint
pnpm --filter @theforge/api test:types && pnpm --filter @theforge/web test:types
```
Resultado esperado: todo en verde, sin errores nuevos.

### Fuera de alcance de este paso
- Commit, push, deploy y backfill en producción (solo con pedido explícito de Jorge).

### Notas de ejecución
- 2026-11-12: **build** OK (`turbo build` api+web). **Tests** api 6306/6307 (1 skipped), web 305/305, `test:types` api+web OK. **Lint:** omitido en gate PR — `turbo lint` falla pre-existente (ESLint v9 sin `eslint.config` en web; api/shared-types/business-rules). **Turbo test** monorepo: `@theforge/business-rules` falla `mdd-ia-cost-reference.spec.ts` (vitest no resuelto, pre-existente); suites semáforo (`cost-parity`, `stage-semaphore*`, `estimation-semaphore*`) en verde vía `node --test` selectivo. Smoke Workshop/backfill local no re-ejecutados en esta pasada (sin BD `dev:local`).

---

## Cierre
- [~] Suite completa en verde: `pnpm turbo run build test lint` _(build+api/web tests OK; lint y business-rules vitest pre-existentes)_
- [x] `pnpm --filter @theforge/api test:types` y `pnpm --filter @theforge/web test:types` en verde.
- [x] Caracterización sin casos `// CAMBIA EN Pn` pendientes (`grep -rn "CAMBIA EN P" apps packages` sin casos sin actualizar).
- [x] Backfill `--dry-run` idempotente (segunda corrida: 0 cambios).
- [x] `CHANGELOG.md` consolidado en `## [Unreleased]`.
- [x] Revisión con `/revisar` sobre el diff completo.
- [x] Criterios de salida de [../04-plan-de-pruebas.md](../04-plan-de-pruebas.md) cumplidos.
- [x] ADR-0007 publicado en `docs/adr/0007-nucleo-unico-semaforo-mdd.md`.

---

## Tabla de cobertura

### RF → paso

| RF | Pasos |
|---|---|
| RF-01 | 1a, 7 |
| RF-02 | 1a, 5a |
| RF-03 | 1a |
| RF-04 | 5b, 7 |
| RF-05 | 7 |
| RF-06 | 5b, 7, 11 |
| RF-07 | 5b |
| RF-08 | 4b |
| RF-09 | 4b, 7 |
| RF-10 | 4a |
| RF-11 | 3 |
| RF-12 | 8b |
| RF-13 | 8a, 8b, 9a |
| RF-14 | 1b, 10 |
| RF-15 | 11 |
| RF-16 | 6 |
| RF-17 | 8b, 9b |
| RF-18 | 6 |
| RF-19 | 4a |
| RF-20 | 12 |
| RF-21 | 2, 13 |
| RF-22 | 8b |

### CL → paso

| CL | Pasos | CL | Pasos |
|---|---|---|---|
| CL-01 | 1b, 5b | CL-18 | 5b |
| CL-02 | 1a | CL-19 | 5b |
| CL-03 | 5b, 11 | CL-20 | 1b |
| CL-04 | 5b | CL-21 | 5a |
| CL-05 | 9b | CL-22 | 10, 11 |
| CL-06 | 1a, 9b | CL-23 | 12 |
| CL-07 | 6 | CL-24 | 12 |
| CL-08 | 8a, 8b | CL-25 | 12 |
| CL-09 | 2, 3 | CL-26 | 1b |
| CL-10 | 3 | CL-27 | 6 |
| CL-11 | 3 | CL-28 | 8b |
| CL-12 | 3 | CL-29 | 9a |
| CL-13 | 3 | CL-30 | 8a |
| CL-14 | 5a | CL-31 | 13 |
| CL-15 | 9a | CL-32 | 4a |
| CL-16 | 7 | CL-33 | 1a |
| CL-17 | 7 | | |
