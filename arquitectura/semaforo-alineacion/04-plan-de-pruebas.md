# 04 — Plan de pruebas

[← README](./README.md) · Anterior: [05-casos-limite.md](./05-casos-limite.md) · Siguiente: [06-riesgos-y-decisiones.md](./06-riesgos-y-decisiones.md)

## 1. Comandos verificados

| Paquete | Comando | Nota |
|---|---|---|
| shared-types | `pnpm --filter @theforge/shared-types test` | `node scripts/run-tests.mjs` |
| business-rules | `pnpm --filter @theforge/business-rules test` | `node --import tsx --test 'src/**/*.spec.ts'` |
| api | `pnpm --filter @theforge/api test` | `node scripts/run-tests.mjs` |
| api (filtrado) | `pnpm --filter @theforge/api test -- --test-path-pattern=<patrón>` | Verificado en `apps/api/scripts/run-tests.mjs:28` |
| api tipos | `pnpm --filter @theforge/api test:types` | |
| web | `pnpm --filter @theforge/web test` | |
| web tipos | `pnpm --filter @theforge/web test:types` | |
| lint | `pnpm --filter <pkg> lint` | |
| eval MDD | `pnpm --filter @theforge/api eval:mdd -- --dry-run` | Smoke |
| final | `pnpm turbo run build test lint` | P16 |

**No existe `docs:check`** en el repo; la documentación se verifica a mano (P15).

## 2. Pirámide

| Nivel | Qué cubre | Paso principal |
|---|---|---|
| **Caracterización (P0)** | Fija la salida actual de `calculateLiveMetrics`, `evaluateCompositeSemaphore`, costo de las 3 vías y desglose sobre fixtures de `apps/api/eval/mdd/`. Los casos con cambio esperado se marcan `// CAMBIA EN Pn` y se actualizan en ese paso. Deben pasar sobre `master` sin cambios de código. | P0 (actualizados en P1–P13) |
| **Unitarias** | Tablas del núcleo (escala, fases, integral con/sin BRD); propiedad «ninguna regla sube el color» (combinaciones de entradas; rango resultado ≤ rango del puntaje); detectores CL-09–CL-13; contador de costo; contexto del gate; `isHumanGap`; helper web. | P1–P4, P11 |
| **Integración con mocks Prisma** | Equivalencia live = composite = sync; GET/POST sin escrituras; CAS; puerta 409; stream `done` = POST; reinicio con snapshot del Auditor. | P5–P10, P12 |
| **Paridad** | Stream vs POST (`estimation-stream-parity.spec.ts`); costo en 3 vías (`cost-parity.characterization.spec.ts` + spec de paridad). | P6, P13 |
| **Smoke / e2e** | `recalc-stage-semaphores.ts --dry-run` contra BD local; golden de costo para MDD de `eval/mdd` con diff en CHANGELOG; `eval:mdd -- --dry-run`; revisión visual del Workshop. | P14, P16 |

## 3. Matriz requisito → prueba → nivel → comando

| RF | Prueba (archivo) | Nivel | Comando |
|---|---|---|---|
| RF-01 | `packages/shared-types/src/semaphore/semaphore.spec.ts` (tabla 84/85/89/90); grep de 78/82 como topes = 0 | Unitaria | `pnpm --filter @theforge/shared-types test` |
| RF-02 | `semaphore.spec.ts` (fases, pesos); `estimation/__tests__/estimation-semaphore.spec.ts` (CL-03) | Unitaria + integración | `pnpm --filter @theforge/shared-types test`; `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-semaphore` |
| RF-03 | `semaphore.spec.ts` (integral sin BRD, CL-02) | Unitaria | `pnpm --filter @theforge/shared-types test` |
| RF-04 | `estimation-semaphore.spec.ts` (equivalencia live = composite = sync); `project-semaphore-composite.util.spec.ts` | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-semaphore`; `… --test-path-pattern=project-semaphore-composite` |
| RF-05 | `projects/project-semaphore-composite.util.spec.ts` (CL-16, CL-17) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=project-semaphore-composite` |
| RF-06 | `estimation-semaphore.spec.ts` (fixture `good-ecommerce` sin derivados); `project-semaphore-composite.util.spec.ts` (`reasons` sin «Conformidad») | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-semaphore` |
| RF-07 | `estimation-semaphore.spec.ts` (CL-18) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-semaphore` |
| RF-08 | `mdd-delivery-gate.util.spec.ts` (2 ramas o eliminado); `estimation-semaphore.spec.ts` (CL-19) | Unitaria | `pnpm --filter @theforge/api test -- --test-path-pattern=mdd-delivery-gate` |
| RF-09 | `ai-analysis/utils/mdd-delivery-gate-context.util.spec.ts` (4 caminos → mismo `ok`/`blockers`/`score`) | Unitaria | `pnpm --filter @theforge/api test -- --test-path-pattern=mdd-delivery-gate-context` |
| RF-10 | `estimation/__tests__/consistency.util.spec.ts`; `__tests__/brd-mdd-traceability.util.spec.ts` | Unitaria | `pnpm --filter @theforge/api test -- --test-path-pattern=consistency.util` |
| RF-11 | `__tests__/mdd-section-detectors.util.spec.ts` (CL-09, CL-10); `engine/mdd-internal-audit.util.spec.ts` (CL-11–CL-13); `business-rules/src/cost-drivers.spec.ts` (CL-09 en costo) | Unitaria | `pnpm --filter @theforge/api test -- --test-path-pattern=mdd-section-detectors`; `… --test-path-pattern=mdd-internal-audit`; `pnpm --filter @theforge/business-rules test` |
| RF-12 | `estimation-semaphore.spec.ts` (GET y POST nunca llaman `stage.update`/`updateMany`; CL-28) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-semaphore` |
| RF-13 | `projects/stage-semaphore-sync.service.spec.ts` (CL-08, CL-15, CL-30) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=stage-semaphore-sync` |
| RF-14 | `semaphore.spec.ts` (regla pura, CL-20, CL-26); `projects/project-deliverable-gate.service.spec.ts` (CL-22, 409 con `gate.reasons`) | Unitaria + integración | `pnpm --filter @theforge/shared-types test`; `pnpm --filter @theforge/api test -- --test-path-pattern=project-deliverable-gate` |
| RF-15 | `apps/web/src/utils/workshopSemaphoreStatus.spec.ts`; `grep -rn effectiveStatus apps/web/src` = 0 | Unitaria | `pnpm --filter @theforge/web test` |
| RF-16 | `estimation/__tests__/estimation-stream-parity.spec.ts`; spec de `ai-analysis` (CL-27) | Paridad | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-stream-parity` |
| RF-17 | `estimation/__tests__/estimation-auditor-hash.spec.ts` ampliado (CL-05); spec de `normalizeMddForHash` en `semaphore.spec.ts` (CL-06) | Integración + unitaria | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation-auditor-hash` |
| RF-18 | Spec de `ai-analysis` (CL-07: tras cancelar, `getMddContentForProject` devuelve BD) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=ai-analysis` |
| RF-19 | `packages/shared-types/src/readiness-audit.util.spec.ts` (CL-32) | Unitaria | `pnpm --filter @theforge/shared-types test` |
| RF-20 | `estimation/estimation.design-first.spec.ts` (CL-23, CL-24, CL-25) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=estimation.design-first` |
| RF-21 | `business-rules/src/cost-drivers.spec.ts`; `cost-parity.characterization.spec.ts` actualizado; spec de paridad nuevo (CL-31) | Paridad | `pnpm --filter @theforge/business-rules test && pnpm --filter @theforge/api test && pnpm --filter @theforge/web test` |
| RF-22 | `estimation-semaphore.spec.ts` (BRD cambiado fuera del sync → `persistedStale=true`); `stage-semaphore-writers.inventory.spec.ts` (CL-29) | Integración | `pnpm --filter @theforge/api test -- --test-path-pattern=stage-semaphore-writers` |

RNF:

| RNF | Verificación |
|---|---|
| RNF-01 | Medición p95 del POST en P5 con `good-ecommerce-tienda-basica.md` y el MDD más grande de `eval/mdd/cases`; ≤ 1.5× línea base. |
| RNF-02 | Revisión de imports de `packages/shared-types/src/semaphore/*` (sin `node:*`, Prisma, Nest); lint. |
| RNF-03 | Revisión de imports de `projects/` hacia `estimation/` (solo API pública). |
| RNF-04 | `test:types` api/web; prueba de que `get_estimation` sigue recibiendo los alias. |
| RNF-05 | Spec del sync y de la puerta verifican una línea `[Semaphore]`/`[Semaphore] gate-block`. |
| RNF-06 | CL-28. |
| RNF-07 | `pnpm --filter <pkg> test`, `test:types`, `lint` en cada paso. |

## 4. Datos de prueba y fixtures

### 4.1 Existentes (`apps/api/eval/mdd/`)

- `fixtures/good-ecommerce-tienda-basica.md`
- `fixtures/bad-ecommerce-tienda-basica.md`
- `fixtures/good-ecommerce-tienda-basica-subsecciones.md`
- `fixtures/ecommerce-tienda-basica.json`
- `cases/*.json` cuando contengan MDD

Uso: caracterización P0, equivalencia, golden de costo y medición RNF-01.

### 4.2 Nuevas (`apps/api/src/modules/ai-analysis/estimation/__fixtures__/semaphore/`)

| Fixture | Caso | Paso |
|---|---|---|
| `mermaid-flowchart-then-er.md` | Flowchart en §2 y `erDiagram` en §3 que no coincide con SQL (CL-11) | P3 |
| `postgres-sin-post.md` | «PostgreSQL» sin `POST` en §4 (CL-09) | P3 |
| `fallo-red-sin-bloqueo.md` | «fallo de red» en §5 sin bloqueo (CL-12) | P3 |
| `email-verify-sin-mfa.md` | MFA en §1 y solo `/email/verify` (CL-13) | P3 |
| `endpoints-en-contexto-sin-s4.md` | «endpoints» en §1 sin §4 (CL-10) | P3 |
| `design-first-fase3-pendiente.json` | DF con fase 3 no ok y Auditor 95 (CL-24) | P12 |

## 5. Mocks

Patrón de referencia: `apps/api/src/modules/ai-analysis/estimation/__tests__/estimation-auditor-hash.spec.ts`.

- Prisma mockeado por constructor con objetos que registran llamadas (`stage.findUnique`, `stage.update`, `stage.updateMany`, `project.findUnique`).
- Las pruebas de «sin escrituras» afirman que `stage.update` y `stage.updateMany` tienen 0 llamadas tras GET/POST.
- CAS: `updateMany` devuelve `{ count: 0 }` para simular `updatedAt` viejo y se verifica un solo reintento y el log `cas-miss`.
- Auditor: snapshot con `auditedDraftHash` calculado con `normalizeMddForHash` + hash de la API.
- Streams: se simula `done`/`interrupt` y luego POST con el mismo contenido.
- Web: specs del helper puro (`workshopSemaphoreStatus.spec.ts`) sin red.

## 6. Criterios de salida

- Suite completa verde: shared-types, business-rules, api, web.
- `test:types` api y web sin errores.
- `lint` sin errores nuevos.
- `pnpm turbo run build test lint` verde.
- Caracterización actualizada, sin casos `// CAMBIA EN Pn` pendientes.
- Backfill `--dry-run` idempotente (segunda corrida 0 cambios).
- `CHANGELOG.md` consolidado bajo `## [Unreleased]`, con la diferencia del golden de costo.
- p95 del POST ≤ 1.5× la línea base (RNF-01).

## 7. Verificación manual y visual del Workshop (P16)

Con API y web locales:

| # | Escenario | Qué se espera ver |
|---|---|---|
| 1 | MDD nuevo bueno (con BRD y Spec), sin derivados | Verde con la nota «MDD listo; genera entregables»; botón Generar habilitado. |
| 2 | Edición manual sin guardar | Insignia «borrador sin guardar» (`source==='draft'`); la lista de proyectos **no** cambia hasta guardar; al guardar, la lista refleja el veredicto persistido. |
| 3 | Lanzar cascada | Durante el job el sync no escribe; al terminar pasa a `post_cascade` y el color se recalcula una vez. |
| 4 | Proyecto con etapa 2 | Editar la etapa 2 cambia solo la etapa 2 en la lista. |
| 5 | Design-First | Con fase 2/3 pendiente, titular ≤40 y amarillo; con fase 1 no ok, rojo. |

Anotar en el reporte qué se vio en cada escenario (captura o descripción).

## 8. Backfill `--dry-run`

```
pnpm --filter @theforge/api exec tsx scripts/recalc-stage-semaphores.ts --dry-run [--limit N] [--project <id>]
```

(La forma exacta de invocación la fija el implementador de P14 según cómo se ejecutan los demás scripts de `apps/api/scripts/`.)

- Contra BD local.
- Salta etapas con job o lease activo.
- Informa por etapa: color anterior → nuevo, titular anterior → nuevo.
- Sin `--dry-run`, escribe solo si hay diferencia y con el mismo CAS del sync.
- Segunda corrida: 0 cambios (idempotente).
- Ejecución en producción: fuera de alcance; requiere aprobación de Jorge. El informe `--dry-run` es la entrada para decidir encender `DELIVERABLES_GATE_REQUIRE_GREEN` (J11).
