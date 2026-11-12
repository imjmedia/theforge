# 01 — PRD: Semáforo del MDD alineado

[← README](./README.md) · Siguiente: [03-arquitectura-y-diseno.md](./03-arquitectura-y-diseno.md)

Rutas relativas a la raíz del repo. Líneas tomadas de `master` @ `06a0d161`; pueden moverse durante la ejecución (el código manda).

## 1. Problema y contexto

El semáforo del MDD es la señal con la que el usuario del Workshop decide si su MDD está listo para generar entregables, y con la que la lista de proyectos, el composite de readiness, la estimación de costo y la puerta de entregables toman decisiones. Hoy esa señal **no es una**: se calcula en varias capas con umbrales, tolerancias y fuentes distintas, y hasta tres caminos escriben `Stage.status`. El resultado:

- Un MDD perfecto **no puede** ser verde antes de la cascada (D1).
- El mismo contenido se ve con colores distintos en panel, composite, stream y lista (D3, D4, D9, D27).
- Abrir el panel (GET o POST con borrador sin guardar) **escribe** `Stage.status` de la etapa primaria, aunque se edite otra (D23, D25).
- Detectores heurísticos con falsos positivos («PostgreSQL» cuenta como `POST`, «fallo de red» como caso de seguridad) mueven el color (D18–D22).
- El costo se calcula con tres fórmulas que no coinciden (D11, D12).

### 1.1 Mapa actual del semáforo

| Capa | Dónde | Qué hace hoy |
|---|---|---|
| Capa viva | `apps/api/src/modules/ai-analysis/estimation/estimation.service.ts` — `getLiveMetricsForProject` (:1034-1237) → `calculateLiveMetrics` (:1421-1666) | Tres ramas: **A** `hasDocs` integral `0.30·completitud + 0.25·consistencia + 0.45·calidadMDD − conformancePenalty`; **B** solo Auditor; **C** solo regex. |
| Umbrales | `estimation.types.ts:242-259`, `packages/shared-types/src/readiness-audit.util.ts:40-45` | `PRECISION_RED_MAX=85`, `PRECISION_GREEN_MIN=90`, `meetsIntegralLiveGreenCriteria` (consistencia ≥90 y ≤5 gaps). |
| Entrada HTTP | `ai-analysis.controller.ts:209-258` (`GET/POST /ai-analysis/estimation`) | La web siempre usa POST con override del editor (`apps/web/src/store/workshop/slice-deliverables.ts:1150-1163`). |
| Streams y otros | `ai-analysis.service.ts:379-393`, `:1432-1433`, `:1829`, `:2307`, `:2520`, `:2614`, `:3022`; `nodes/mdd-manager/manager-state-handlers.ts:197-205`, `:468-476` | `done`/`interrupt`, Manager, regeneración de sección y sync upstream llaman `calculateLiveMetrics` **sin `documents`**. |
| Persistida / compuesta | `engine/semaphore.service.ts` (LOW :98-116, MEDIUM :118-140, HIGH :180-237, Constitución :146-178, `applySddPrecisionGates` :82-96 cap 82) | Buckets propios por complejidad. |
| Composite | `projects/project-semaphore-composite.util.ts:146-238` + `applyCompositeReadinessGates` (`readiness-audit.util.ts:159-206`) | Humanos >3 → AMARILLO 78; conformance no ok o >5 gaps → 82; consistencia <90 → 85. Único llamador `project-conformance.service.ts:121`; la web solo muestra `compositeReadiness.reasons` (`WorkshopMetricsColumnInner.tsx:664-670`). |
| Pipeline | `engine/mdd-update-pipeline.service.ts:162-185` | Calcula `SemaphoreService` y lo sobrescribe con el vivo. |
| Tercer indicador | `projects/sdd-integration.service.ts:731-746` | Fuera de alcance (solo se documenta). |
| Escritores de `Stage.status`/`precisionScore` | `estimation.service.ts:977-980` (`syncStageSemaphoreFromLiveMetrics`, llamado en :1233, :1292, :1366; desde GET/POST y `refreshStageSemaphoreFromProject` en `project-deliverable-gate.service.ts:39-65`, 5 callers); `project-merge.service.ts:358,:388` (reset); `project-stage.service.ts:116-143` (copia al crear etapa); `project-clone.util.ts:26`; `project-notion-import.util.ts:153,:190`; `project-notion-portability.service.ts:261,:316` | Varios escritores, ninguno con CAS. |
| UI | `WorkshopMetricsColumnInner.tsx:383-391` (`effectiveStatus`); `apps/web/src/utils/workshopSemaphoreStatus.ts:43-53` (`resolveWorkshopHeadlineScore`); `slice-deliverables.ts:1182-1206` (`fetchEstimation` reescribe `project.status` local); lista = `Stage.status` de la etapa primaria (`project-list-item.util.ts:62-106`, `ProjectFolderTile.tsx:155,:308-310`) | La web recalcula color. |
| Gates por color | Web HIGH exige `liveMetrics.status==='green' && hasSpec` (`WorkshopMetricsColumnInner.tsx:149,:191-202`); backend `assertDeliverablesAllowed` solo aplica delivery gate (`project-deliverable-gate.service.ts:68-128`) | La regla vive en la web. |
| Costo | Panel `liveMetrics.totalMXN` con riskFactor si integral <85 (`estimation.service.ts:1620-1621`); fallback web `calculateCostFromMdd` buffer si no VERDE (`packages/business-rules/src/cost-estimation.ts:17,:121-123`); `Estimation` persistida (`project-estimation-recalc.service.ts:23-68`) | Tres fórmulas. |
| Design-First | `designFirstPhaseSemaphore` (`estimation-design-first.util.ts:63-72`) | Rama paralela. |

### 1.2 Defectos D1–D27

| ID | Confianza | Archivo:línea | Síntoma |
|---|---|---|---|
| D1 | alta | `completeness.util.ts:3-30`; `estimation.service.ts:1491-1495`, `:1531-1536` | Integral no puede ser verde antes de la cascada: completitud incluye 10 entregables post-cascada. MDD+BRD+Spec → máx. 86.6; solo MDD → 66.5. |
| D2 | alta | `estimation.service.ts:1521`; `consistency.util.ts:361-363` | Consistencia 50 «sin datos» se trata distinto por rama (neutra con Auditor; regex y composite la cuentan como <90); devuelve 70 con solo Spec. |
| D3 | alta | `project-semaphore-composite.util.ts:212-215`, `:174-178`, `:214`; `semaphore.service.ts:86-94`; `conformance-gaps.util.ts:55-68` | Puerta SDD doble con tolerancias 0 vs 5: LOW/MEDIUM → AMARILLO 82 con 1 gap; en HIGH los gaps de precisión SDD se cuentan dos veces. |
| D4 | alta | `readiness-audit.util.ts:43-44`; `semaphore.service.ts:88`; `WorkshopMetricsColumnInner.tsx:59`, `:565` | Topes 82/78 reportados AMARILLO cuando en la escala viva <85 es rojo. |
| D5 | alta | `project-semaphore-composite.util.ts:189-193`; `project-conformance.service.ts:96-117` | Composite ignora «derivados pendientes» (usa `collectConformanceGaps` en vez de `collectFullCrossArtifactGaps`), mientras `buildUnifiedAudit` sí. |
| D6 | alta | `WorkshopMetricsColumnInner.tsx:389-390`, `:149`, `:202` | `effectiveStatus` fuerza amarillo con derivados pendientes mientras `canGenerate` exige verde: no se puede generar. |
| D7 | media | `ai-analysis.service.ts:1431-1439`; `estimation.service.ts:881-894`, `:826-830` | `auditedDraftHash` desincronizado: `clearLiveDraft` antes de `persistMddAuditSnapshot`; hash del draft y no del markdown tras `prepareMddForOutput`; rebind solo en memoria. |
| D8 | media-baja | `workshop-document-content.util.ts:130-147`; `project-mdd-persist.service.ts:440-446`; `mdd-draft-hash.util.ts:7-9` | Override del editor no coincide con el hash del persistido (normalizador solo colapsa espacios). |
| D9 | alta | streams (`ai-analysis.service.ts`, ver 1.1) | Stream emite color distinto del panel (ramas B/C sin docs; gaps del Auditor sin verificar hash). |
| D10 | alta | `ai-analysis.service.ts:2510`, `:2519`, `:3022`; `estimation.service.ts:761-778`, `:1377-1383` | Regeneración de sección fuerza complejidad HIGH y contamina la caché. |
| D11 | alta | `estimation.service.ts:1620-1621`; `cost-estimation.ts:17`, `:121-123`; `project-estimation-recalc.service.ts:23-68` | riskFactor (integral <85) vs buffer (no VERDE) contradictorios; 3 fórmulas; INDEX §5 falso. |
| D12 | media | `estimation.service.ts:605-660`; `apps/web/src/utils/costCalculator.ts:~80-121`; `project-estimation-recalc.service.ts:35-46` | Tres contadores de entidades/pantallas/endpoints (la web cuenta cualquier línea con GET/POST). |
| D13 | alta | `estimation.service.ts:1346-1350`, `:1352-1359`, `:1369`, `:1338-1344` vs `:1154-1206`, `:1342` | Design-First: tope 40 saltado por `auditorScore`; sin delivery gate ni conformidad; `!hasMdd ||` muerto. |
| D14 | alta | `mdd-delivery-gate.util.ts:472`, `:477-483`; web :385-388; `estimation.types.ts:146` | Delivery gate no ok siempre rojo; rama amarilla inalcanzable; el tipo dice «no puede ser verde». |
| D15 | alta | `estimation.service.ts:1191-1195`, `:1499-1512`; `CHANGELOG.md:725` | Degradación por conformance (>5/>3) no coincide con el CHANGELOG; doble penalización. |
| D16 | media-alta | `estimation.service.ts:1154-1161`, `:266-273`; `mdd-update-pipeline.service.ts:93`; `project-mdd-persist.service.ts:324-327`, `:451-454`; `project-deliverable-gate.service.ts:115-120` | Perfiles del delivery gate difieren por llamador. |
| D17 | alta | `consistency.util.ts:369-398`; `brd-mdd-traceability.util.ts:26-29` | Trazabilidad del panel inflada con Spec como destino vs gate solo BRD→MDD. |
| D18 | alta | `estimation.service.ts:579` | `endpointsWithPayloads` con regex `/(?:post|put|patch)[\s\S]*?\{[\s\S]*\}/i` sobre todo el doc: «PostgreSQL» + cualquier `{}` cuenta. |
| D19 | media-alta | `estimation.service.ts:567-596`, `:628` | `detectReferenceSections` por palabra suelta sin heading; `|endpoints` sin ancla en `parseCountsFromMarkdown`. |
| D20 | alta | `mdd-internal-audit.util.ts:306-308` | `securityEdgeCaseGap` falso positivo con «fallo». |
| D21 | alta | `mdd-internal-audit.util.ts:69-71` vs `:277` | Paridad Mermaid/SQL solo mira el primer bloque mermaid. |
| D22 | media | `mdd-internal-audit.util.ts:193`; `estimation.service.ts:1402-1404` | MFA: cualquier `/verify` cuenta; `getGapsReport` etiqueta todo como «Trazabilidad MFA». |
| D23 | alta | `project-update.service.ts:182-184` vs `project-deliverable-gate.service.ts:45-54`; `project-mdd-persist.service.ts:456-465` | Se sincroniza la etapa primaria en vez de la editada. |
| D24 | media | `ai-analysis.service.ts:1461`, `:1911`, `:2338`; `estimation.service.ts:935-936`, `:1227-1230` | El live draft persiste tras cancelar el stream. |
| D25 | alta | `estimation.service.ts:1225-1234` | Contenido sin guardar escribe `Stage.status`; el GET también escribe. |
| D26 | media | `readiness-audit.util.ts:93-96`; `conformance-gaps.util.ts:86-88`; `low-medium-readiness.util.ts:242-243` | `isHumanGap` decide por subcadena. |
| D27 | alta | `estimation.service.ts:292-411` (`computePrecisionBreakdown`), `:1469` | Desglose y titular usan detectores distintos (el titular regex ignora §1/§2/§5). |
| Docs | — | `docs_mcp/arquitectura/mdd-semaforo.md:29-30`, `:45-46`; `docs/notebooklm/THEFORGE-INDEX.md` §4–§5 | Contradicen el código («verde exige gapCount===0»; «persistida = SemaphoreService»). |

### 1.3 Cobertura de pruebas actual

Existen: `live-semaphore-green.util.spec.ts`, `live-semaphore-status.util.spec.ts`, `__tests__/estimation-auditor-hash.spec.ts` (9 casos), `__tests__/completeness.util.spec.ts`, `__tests__/consistency.util.spec.ts`, `__tests__/brd-mdd-traceability.util.spec.ts`, `estimation-section5-breakdown.spec.ts`, `estimation-security-credential.spec.ts`, `engine/mdd-internal-audit.util.spec.ts`, `engine/semaphore.service.spec.ts` (8), `packages/shared-types/src/readiness-audit.util.spec.ts`, `mdd-delivery-gate.util.spec.ts`, `low-medium-readiness.util.spec.ts`, `estimation.design-first.spec.ts`, `project-list-item.util.spec.ts`, `packages/business-rules/src/smoke.spec.ts`.

**Sin spec:** `detectReferenceSections`, `computeConsistencyGaps`, `evaluateCompositeSemaphore`, sincronización de etapa, web (`workshopSemaphoreStatus.ts`, `effectiveStatus`, `canGenerate`, `fetchEstimation`), paridad de costo, streams/regeneración.

## 2. Objetivos

1. **Un veredicto.** Para el mismo contenido persistido, panel, lista, composite, streams y puerta de entregables muestran un solo veredicto (color, % titular, razones, permiso de generar) que sale de un núcleo puro común (`evaluateMddSemaphore`).
2. **Verde alcanzable antes de la cascada** cuando el MDD (y BRD/Spec) son buenos.
3. **Lectura sin efectos.** Ver el panel nunca escribe en BD; solo la persistencia de contenido actualiza `Stage`.
4. **Detecciones heurísticas corregidas** (D17–D22, D26).
5. **Costo con una sola fórmula** y un solo contador.
6. **Puerta de entregables en backend**, con la web solo reflejando.

## 3. No-objetivos

- Rediseñar el Auditor LLM o sus prompts.
- Cambiar tarifas de costo.
- Unificar `/projects/:id/analyze` (`sdd-integration.service.ts:731-746`).
- Cambiar el esquema Prisma (J14).
- Modificar flujos LEGACY más allá de respetar su regla de puerta.

## 4. Usuarios y roles

| Rol | Necesidad |
|---|---|
| Usuario del Workshop (rol con `CONTRIBUTE_BODY`) | Ver un color y % coherentes mientras edita; saber si lo que ve es borrador sin guardar; saber por qué no es verde; poder generar entregables cuando el MDD está listo. |
| Rol de lectura (`READ_QUERY`) | Consultar el semáforo sin provocar escrituras. |
| Operador que corre el backfill | Recalcular `Stage.status`/`precisionScore` de proyectos existentes con `--dry-run`, revisar el informe de cambios de color y luego aplicar; habilitar el flag `DELIVERABLES_GATE_REQUIRE_GREEN`. |
| Consumidor MCP `get_estimation` | Seguir recibiendo `status`/`precision`/`auditorScore`/`mddQualitySource`/`deliveryGate` (alias `@deprecated`) y, además, el bloque `semaphore`. |

## 5. Historias de usuario

- **HU-1.** Como usuario del Workshop, quiero que un MDD completo y bien auditado se vea verde antes de generar entregables, con la nota «MDD listo; genera entregables», para saber que puedo lanzar la cascada.
- **HU-2.** Como usuario del Workshop, quiero que el panel, la lista de proyectos y el composite muestren el mismo color para el mismo contenido guardado, para confiar en la señal.
- **HU-3.** Como usuario del Workshop, quiero que mis cambios sin guardar se marquen como «borrador sin guardar» y no cambien la lista, para no confundir borrador con estado real.
- **HU-4.** Como usuario del Workshop, quiero que el botón Generar dependa de la misma regla que aplica el backend, para no recibir un 409 inesperado ni un botón deshabilitado sin razón.
- **HU-5.** Como usuario de un proyecto con varias etapas, quiero que editar la etapa 2 actualice solo la etapa 2.
- **HU-6.** Como usuario con rol de lectura, quiero consultar la estimación sin provocar escrituras.
- **HU-7.** Como usuario, quiero que el costo mostrado en el panel, el fallback web y la `Estimation` guardada coincidan.
- **HU-8.** Como usuario de Design-First, quiero que el semáforo respete el tope de fases aunque el Auditor dé 95.
- **HU-9.** Como operador, quiero un backfill idempotente con `--dry-run` que informe los cambios de color antes de aplicar.
- **HU-10.** Como consumidor MCP, quiero que `get_estimation` no se rompa durante una versión.

## 6. Requisitos funcionales

| RF | Requisito | Criterio de aceptación | D |
|---|---|---|---|
| RF-01 | Escala única: rojo <85, amarillo 85–89, verde ≥90. Ningún tope amarillo <85. | grep de 78/82 como topes = 0; tablas spec 84→rojo, 85→amarillo, 89→amarillo, 90→verde. | D4 |
| RF-02 | Completitud por fase. `pre_cascade`: MDD 0.50, BRD 0.30, Spec 0.20 (en LOW/MEDIUM renormaliza sobre presentes, J10). `post_cascade`: 11 documentos con `DOC_WEIGHTS` actuales. | Pre-cascada, MDD perfecto + BRD + Spec, trazabilidad 100, calidad 100 → integral 100 verde. MDD+BRD sin Spec (HIGH) → 94 verde. | D1, D27 |
| RF-03 | Sin BRD la consistencia no se mide y su peso se redistribuye: `integral = (0.30·C + 0.45·Q)/0.75`. Igual en todas las ramas. | Sin BRD, 50/70 nunca aparece ni bloquea verde. | D2 |
| RF-04 | Un solo evaluador `evaluateMddSemaphore` para panel, lista, composite y streams. | Spec de equivalencia: mismas entradas persistidas → mismo `status` y `headline` en live, composite y sync. | D3, D9, D27 |
| RF-05 | Composite alineado: devuelve `status`/`precisionScore` iguales al veredicto; tolerancia única ≤5 gaps deduplicados; sin `applySddPrecisionGates` ni doble conteo. | 3 gaps → verde (si resto permite); 6 → amarillo; mismo gap en precisión y conformidad cuenta 1. | D3, D4, D5 |
| RF-06 | Derivados `none`: verde permitido con nota «MDD listo; genera entregables»; composite sin «conformidad incompleta». | Fixture `good-ecommerce` sin derivados: `status=green`, `notes` incluye la nota, `reasons` sin «Conformidad». | D5, D6 |
| RF-07 | Conformidad: `ok:false` o >3 endpoints faltantes impide verde. Se eliminan `conformancePenalty` y reglas «>5» y «>8». | 4 faltantes → amarillo; `ok:false` con 1 faltante → amarillo; titular no cambia por conformidad. | D15 |
| RF-08 | Un blocker del delivery gate → rojo. Rama amarilla muerta eliminada; tipo y doc dicen «rojo». | `applyDeliveryGateToSemaphoreStatus` con 2 ramas o eliminado. | D14 |
| RF-09 | Un solo perfil de delivery gate (`resolveDeliveryGateContext`) para panel, pipeline (ambas ramas), snapshot y gate de entregables. | Mismo MDD → mismo `ok`, `blockers`, `score` por los 4 caminos. | D16 |
| RF-10 | Trazabilidad del panel = la del gate (BRD→MDD). Spec solo es fuente cuando no hay BRD, nunca destino. | Ítem BRD presente solo en Spec cuenta como gap. | D17 |
| RF-11 | Detectores anclados a headings `^##\s+\d\.`; `endpointsWithPayloads` solo en §4 con `\b(POST|PUT|PATCH)\s+/`; Mermaid todos los bloques `erDiagram`; «fallo» solo con `(intentos|reintento|bloqueo|lock)` en la misma oración; `/verify` solo con `(mfa|otp|totp|2fa)`. | CL-09 a CL-13 en verde. | D18–D22 |
| RF-12 | Solo lo persistido escribe `Stage.status`/`precisionScore`. GET y POST de estimación no escriben. | Spec: GET y POST nunca llaman `stage.update`/`updateMany`. | D25, D8 |
| RF-13 | Sync sobre la etapa editada en cada persistencia relevante (MDD, BRD, Spec, entregables, fin de cascada, auditoría manual, merge/clear), con CAS por `Stage.updatedAt`. | PATCH sobre etapa no primaria actualiza solo esa; CAS con `updatedAt` viejo no escribe. | D23 |
| RF-14 | Puerta compartida en backend: HIGH gate ok + verde + Spec; LOW/MEDIUM bootstrap (DBGA o MDD) o verde con Spec; DF `assertDesignFirstDeliverableGate`; LEGACY MDD o `codebaseDoc`. Expuesta como `semaphore.deliverablesGate`. `acknowledgeGaps` no salta Spec (J13). | HIGH amarillo → 409 con `gate.reasons` (flag activo); web usa `deliverablesGate.allowed`. | §1.5 de la auditoría (puerta HIGH) |
| RF-15 | Web solo refleja: color = `semaphore.status`; `canGenerate` = `deliverablesGate.allowed`. Desaparecen `effectiveStatus` y la regex de derivados pendientes. | `grep effectiveStatus` = 0; specs del helper web en verde. | D6 |
| RF-16 | Streams (`done`, `interrupt`) y regeneración usan el mismo evaluador con documentos cargados una vez y complejidad real; gaps del Auditor solo si hash coincide. | `done` y POST posterior con mismo contenido → mismo `status`/`headline`; LOW no cachea HIGH. | D9, D10 |
| RF-17 | Hash del snapshot del Auditor sobre contenido persistido canónico, en la misma escritura del MDD. Override del editor hasheado con el mismo normalizador. | Tras reinicio simulado, snapshot coincide y `headlineSource=auditor`. | D7, D8 |
| RF-18 | Al cancelar un stream se ejecuta `clearLiveDraft`. | Tras cancelar, `getMddContentForProject` devuelve BD. | D24 |
| RF-19 | `isHumanGap` decide por prefijo, no subcadena. | «… por validar …» a mitad → `llm`. | D26 |
| RF-20 | Design-First pasa por el mismo evaluador (gate + conformidad). Fases 2/3 no ok → tope 40 en titular (incl. `auditorScore`) y persistido. Borrar `!hasMdd ||`. | DF fase 3 no ok y Auditor 95 → titular 40 y persistido 40. | D13 |
| RF-21 | Costo única fuente: `computeCostEstimation` + `countCostDrivers` de business-rules en panel, fallback web y `Estimation`. Buffer 1.25 si no verde. | Paridad: 3 consumidores → mismas horas y MXN para mismo MDD y color. | D11, D12 |
| RF-22 | GET indica `persistedStale` cuando el hash de entradas persistido no coincide con el actual, sin escribir. | BRD cambiado fuera del sync → `persistedStale=true`. | D25 |

Defectos sin RF propio que se corrigen dentro de otros: D24 → RF-18; D26 → RF-19; D27 → RF-02/RF-04; documentación → P15.

## 7. Requisitos no funcionales

| RNF | Requisito |
|---|---|
| RNF-01 | p95 del POST de estimación ≤ 1.5× el actual (fixture `apps/api/eval/mdd/fixtures/good-ecommerce-tienda-basica.md` y el MDD más grande de `eval/mdd/cases`); gaps cruzados solo en `post_cascade`. |
| RNF-02 | `packages/shared-types/src/semaphore/*` no importa `node:*`, Prisma ni Nest. |
| RNF-03 | Dependencias solo `apps → business-rules → shared-types`; `projects` no importa internos de `estimation` salvo su API pública (`index.ts` del módulo y el servicio). |
| RNF-04 | Alias `status`, `precision`, `auditorScore`, `mddQualitySource`, `deliveryGate` conservados `@deprecated` una versión (J15); MCP `get_estimation` no se rompe. |
| RNF-05 | Una línea estructurada `[Semaphore]` por evaluación persistida y por bloqueo de puerta. |
| RNF-06 | GET con rol de lectura sin efectos secundarios. |
| RNF-07 | `pnpm --filter <pkg> test`, `test:types`, `lint` sin errores nuevos en cada paso. |

## 8. Métricas de éxito

- Spec de equivalencia (RF-04): 100 % de fixtures con mismo `status` y `headline` en live GET, composite, sync y puerta.
- 0 escrituras en `Stage` desde GET/POST de estimación (spec RF-12, CL-28).
- `grep effectiveStatus apps/web/src` = 0; `grep` de 78/82 como topes de color = 0.
- Paridad de costo: diferencia 0 en horas y MXN entre las 3 vías para todos los MDD de `apps/api/eval/mdd`.
- Fixture `good-ecommerce-tienda-basica.md` pre-cascada (con BRD y Spec perfectos) → verde con nota.
- Backfill `--dry-run`: segunda corrida reporta 0 cambios (idempotente).
- p95 del POST ≤ 1.5× la línea base medida en P5.
- Tras activar el flag, ningún 409 inesperado reportado (informe `--dry-run` revisado por Jorge antes de encenderlo).

## 9. Supuestos

**Decisiones de Jorge** (detalle en [06-riesgos-y-decisiones.md](./06-riesgos-y-decisiones.md#3-decisiones-de-jorge-j1j15)):

| # | Resumen |
|---|---|
| J1 | Completitud por fase; MDD perfecto puede ser verde pre-cascada. |
| J2 | Composite alineado: `status`/`precisionScore` = veredicto del núcleo; escala viva; tolerancia única; sin doble puerta. |
| J3 | Derivados pendientes → verde + nota; `canGenerate` y color con la misma señal. |
| J4 | Costo en `business-rules` (`computeCostEstimation` + `countCostDrivers`); buffer 1.25 si no verde. |
| J5 | Conformidad: `ok:false` o >3 endpoints faltantes impide verde; se elimina `conformancePenalty`. |
| J6 | Design-First igual que NEW; tope 40 al titular y persistido; borrar `!hasMdd ||`. |
| J7 | Solo lo persistido escribe `Stage`; sync sobre la etapa editada. |
| J8 | Puerta compartida en backend expuesta como `semaphore.deliverablesGate`. |
| J9 | Señales HIGH de `SemaphoreService` retiradas del color salvo Figma/UX y Constitución. |
| J10 | Pesos pre-cascada 0.5/0.3/0.2; LOW/MEDIUM renormalizan. |
| J11 | Flag `DELIVERABLES_GATE_REQUIRE_GREEN` apagado al desplegar. |
| J12 | Se retiran «>8 → rojo» y la tolerancia separada de humanos; una sola tolerancia de 5. |
| J13 | `acknowledgeGaps` no salta la falta de Spec en HIGH. |
| J14 | Versión del cálculo en `shortTermContext.semaphoreSync`; sin migración. |
| J15 | Alias `@deprecated` una versión. |

**Supuestos aceptados en GATE 1:**
- D2: «sin BRD» (consistencia 50/70 = no medida) es neutro en todas las ramas.
- D14: un blocker del delivery gate = rojo (borrar rama amarilla muerta, corregir tipo y doc).
- D7, D9, D10, D16–D22, D24, D26 se corrigen sin decisión de producto.
- Las razones nunca bajan el titular (solo limitan el color); excepción: tope DF (J6).
- La tolerancia única de 5 absorbe la de humanos.
- `acknowledgeGaps` no salta Spec (J13).

## 10. Dependencias

- `packages/shared-types` (núcleo puro; zod ya disponible).
- `packages/business-rules` (costo; la web ya lo importa en `apps/web/src/utils/costCalculator.ts:5-13`).
- `EstimationModule` de la API, que solo depende de Prisma (lo inyecta `StageSemaphoreSyncService`).
- Config tipada existente de la API (`apps/api/src/config/`, ver pregunta abierta en 06).
- MCP `get_estimation` (`packages/mcp-server/src/tools/analysis.tools.ts`) como consumidor de alias.
- Orden de pasos: ver [README](./README.md#reglas-transversales) y [tasks/TASKS.md](./tasks/TASKS.md).

## 11. Fuera de alcance

- `/projects/:id/analyze` (`sdd-integration.service.ts:731-746`): solo se documenta como tercer indicador.
- Heurísticas internas de `ConformanceService` (solo se reubican a `engine/conformance-gaps.util.ts`).
- Prompts del Auditor LLM.
- Flujos LEGACY (solo se respeta su regla de puerta).
- Migraciones Prisma (J14).
- Tarifas de costo.
- Ejecución del backfill en producción (requiere aprobación de Jorge).
