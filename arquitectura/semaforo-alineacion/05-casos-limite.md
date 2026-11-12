# 05 — Casos límite

[← README](./README.md) · Anterior: [02-estructura-de-archivos.md](./02-estructura-de-archivos.md) · Siguiente: [04-plan-de-pruebas.md](./04-plan-de-pruebas.md)

IDs exactos del plan aprobado. Las rutas de las pruebas están en [04-plan-de-pruebas.md](./04-plan-de-pruebas.md#3-matriz-requisito--prueba--nivel--comando) y en [02-estructura-de-archivos.md](./02-estructura-de-archivos.md).

| ID | Escenario | Comportamiento esperado | Prueba que lo cubre | Paso |
|---|---|---|---|---|
| CL-01 | MDD vacío | Rojo, titular 0, `deliverablesGate.allowed=false` en HIGH | `semaphore.spec`, `estimation-semaphore.spec` | P1, P5 |
| CL-02 | Sin BRD, MDD perfecto y Spec (HIGH) | Consistencia `null`; integral `(0.30·70 + 45)/0.75 = 88` → amarillo | `semaphore.spec` | P1 |
| CL-03 | MDD perfecto, BRD y Spec, sin Auditor, pre-cascada | Integral 100 → verde + nota de derivados («MDD listo; genera entregables») | `estimation-semaphore.spec` | P5 |
| CL-04 | Auditor vigente 95, `critical_gaps=0` | Titular 95 (`headlineSource=auditor`), verde | `estimation-semaphore.spec` | P5 |
| CL-05 | Hash del Auditor desincronizado tras reinicio | El snapshot persistido coincide con el contenido canónico → `headlineSource=auditor` | `estimation-auditor-hash.spec` ampliado | P9 |
| CL-06 | Override del editor formateado por la web | `normalizeMddForHash` iguala los hashes → auditor | spec de `hash-normalize` (en `semaphore.spec`) | P1, P9 |
| CL-07 | Stream cancelado | Se ejecuta `clearLiveDraft`; el GET evalúa lo de BD | spec de `ai-analysis` | P6 |
| CL-08 | Etapas múltiples, PATCH sobre etapa 2 | Solo la etapa 2 cambia `status` | `stage-semaphore-sync.spec` | P8 |
| CL-09 | «PostgreSQL» sin `POST` en §4 | `endpointsWithPayloads=false` | `mdd-section-detectors.spec` (fixture `postgres-sin-post.md`); también en `cost-drivers.spec` | P3 |
| CL-10 | «endpoints» en §1 sin §4 | `endpoints=0` | `mdd-section-detectors.spec` (fixture `endpoints-en-contexto-sin-s4.md`) | P3 |
| CL-11 | Flowchart en §2 y `erDiagram` en §3 que no coincide con SQL | `mermaidParityGap=1` | `mdd-internal-audit.spec` (fixture `mermaid-flowchart-then-er.md`) | P3 |
| CL-12 | «fallo de red» en §5 sin bloqueo | `securityEdgeCaseGap=0` | `mdd-internal-audit.spec` (fixture `fallo-red-sin-bloqueo.md`) | P3 |
| CL-13 | MFA en §1 y solo `/email/verify` | Inconsistente (MFA no trazado) | `mdd-internal-audit.spec` (fixture `email-verify-sin-mfa.md`) | P3 |
| CL-14 | Derivados `partial` | `pre_cascade`; conformidad solo de presentes; nota «cascada incompleta» | `semaphore-inputs.factory.spec` | P5 |
| CL-15 | Cascada en curso | El sync no escribe; al terminar escribe una vez | `stage-semaphore-sync.spec` | P9 |
| CL-16 | Mismo gap en precisión SDD y conformidad | Cuenta 1 | `project-semaphore-composite.spec` | P7 |
| CL-17 | 6 gaps cruzados deduplicados | Amarillo, titular intacto | composite spec | P7 |
| CL-18 | Conformidad con 4 faltantes | Amarillo; titular sin resta | `estimation-semaphore.spec` | P5 |
| CL-19 | Gate con 1 blocker y Auditor 95 | Rojo, `reasons` con el blocker | `estimation-semaphore.spec` | P5 |
| CL-20 | LOW sin HU/tasks y con DBGA | `allowed=true` (bootstrap) | spec de `deliverables-gate` (en `semaphore.spec`) | P1 |
| CL-21 | MEDIUM con 3 de 5 derivados | `partial` | factory spec | P5 |
| CL-22 | HIGH verde sin Spec | `allowed=false` «falta Spec»; 409 con flag; `acknowledgeGaps` no lo salta | `project-deliverable-gate.spec` | P10 |
| CL-23 | DESIGN_FIRST fase 1 no ok | Rojo | `estimation.design-first.spec` | P12 |
| CL-24 | DESIGN_FIRST fase 3 no ok y Auditor 95 | Titular 40, amarillo, persistido 40 | `estimation.design-first.spec` (fixture `design-first-fase3-pendiente.json`) | P12 |
| CL-25 | DESIGN_FIRST fases ok y un blocker | Rojo | `estimation.design-first.spec` | P12 |
| CL-26 | LEGACY sin MDD con `codebaseDoc` | `allowed=true` | spec de `deliverables-gate` (en `semaphore.spec`) | P1 |
| CL-27 | Regeneración de sección en LOW | Complejidad LOW; la caché no pasa a HIGH | spec de `ai-analysis` | P6 |
| CL-28 | GET con rol de lectura | 0 escrituras | `estimation-semaphore.spec` | P8 |
| CL-29 | BRD cambiado por ruta no instrumentada | `persistedStale=true`; el inventario falla en CI si la ruta es nueva | inventory spec (`stage-semaphore-writers.inventory.spec`) | P9 |
| CL-30 | CAS con `updatedAt` viejo | No escribe; log `cas-miss` | `stage-semaphore-sync.spec` | P8 |
| CL-31 | Costo amarillo vs verde con el mismo MDD | ×1.25 si no verde, igual en las 3 vías | `cost-drivers` + paridad | P13 |
| CL-32 | «Por validar» a mitad de mensaje | Gap `llm` | `readiness-audit` spec | P4 |
| CL-33 | LOW/MEDIUM sin BRD ni Spec pre-cascada | La completitud renormaliza sobre presentes (J10); no penaliza | `semaphore.spec` | P1 |

## Cobertura por paso

| Paso | Casos |
|---|---|
| P1 | CL-01, CL-02, CL-06, CL-20, CL-26, CL-33 |
| P3 | CL-09, CL-10, CL-11, CL-12, CL-13 |
| P4 | CL-32 |
| P5 | CL-01, CL-03, CL-04, CL-14, CL-18, CL-19, CL-21 |
| P6 | CL-07, CL-27 |
| P7 | CL-16, CL-17 |
| P8 | CL-08, CL-28, CL-30 |
| P9 | CL-05, CL-06, CL-15, CL-29 |
| P10 | CL-22 |
| P11 | CL-03 y CL-22 reflejados en UI |
| P12 | CL-23, CL-24, CL-25 |
| P13 | CL-31 |
