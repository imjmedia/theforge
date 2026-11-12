# HANDOFF — Semáforo del MDD alineado

> Documento de arranque para quien ejecute este paquete **sin contexto previo**. Léelo completo antes de abrir [TASKS.md](./TASKS.md).

## 1. Objetivo en 10 líneas

1. Hoy el semáforo del MDD (rojo / amarillo / verde) se calcula en varios sitios con reglas distintas: panel vivo, composite, `SemaphoreService`, streams, lista de proyectos y puerta de entregables.
2. Eso produce colores contradictorios para el mismo contenido (p. ej. panel verde y lista amarilla, o botón «Generar» bloqueado con semáforo verde).
3. La meta es **un solo veredicto** (color, % titular, razones, notas y permiso de generar) que sale de un **núcleo puro** en `packages/shared-types/src/semaphore/`.
4. Todos los consumidores (panel GET/POST, streams, composite, lista, puerta backend y web) pasan por `evaluateMddSemaphore`.
5. Escala única: rojo <85, amarillo 85–89, verde ≥90; las razones solo limitan el color, nunca bajan el titular (excepción: tope Design-First 40).
6. La completitud depende de la fase (`pre_cascade` / `post_cascade`), así que un MDD perfecto puede ser verde antes de la cascada.
7. Solo lo persistido escribe `Stage.status` / `precisionScore`, a través de un único escritor con CAS sobre la etapa **editada**.
8. Se corrigen detecciones heurísticas defectuosas (secciones sin ancla, «PostgreSQL» como POST, Mermaid solo primer bloque, «fallo», `/verify`, `isHumanGap`).
9. El costo tiene **una sola fuente**: `computeCostEstimation` + `countCostDrivers` en `packages/business-rules` (panel, fallback web y `Estimation` persistida).
10. Contrato aditivo y versionado (`semaphore: MddSemaphoreVerdict`), con alias `@deprecated` durante una versión; la decisión queda en ADR-0007.

## 2. Repositorio y entorno

| Dato | Valor |
|---|---|
| Repo | `imjmedia/theforge` |
| Rama base | `master` (commit `06a0d161`) |
| Rama sugerida | `fix/semaforo-alineacion` |
| Gestor | **pnpm 9.15.9** + turbo. **Nunca** npm ni yarn. Lockfile: `pnpm-lock.yaml` |
| Paquetes | `@theforge/api`, `@theforge/web`, `@theforge/shared-types`, `@theforge/business-rules` |

### Comandos

```bash
# Instalación
pnpm install

# Build completo (orden topológico de turbo)
pnpm turbo run build

# Tests por paquete
pnpm --filter @theforge/shared-types test
pnpm --filter @theforge/business-rules test          # node --import tsx --test 'src/**/*.spec.ts'
pnpm --filter @theforge/api test                      # node scripts/run-tests.mjs
pnpm --filter @theforge/api test -- --test-path-pattern=<patrón>   # filtrar (apps/api/scripts/run-tests.mjs:28)
pnpm --filter @theforge/web test

# Tipos (solo api y web tienen test:types)
pnpm --filter @theforge/api test:types
pnpm --filter @theforge/web test:types

# Lint por paquete
pnpm --filter <paquete> lint

# Suite completa
pnpm turbo run build test lint

# Desarrollo local (infra + migraciones + dev)
pnpm dev:local
```

**No existe `docs:check`** en este repo: la documentación se revisa a mano.

## 3. Convenciones obligatorias

- **Idioma:** español en documentación, comentarios, strings de UI y mensajes de commit. Identificadores de código en inglés.
- **Commits** convencionales en español: `fix:`, `feat:`, `refactor:`, `test:`, `docs:`. Asunto corto.
- **CHANGELOG.md:** cada paso añade su entrada en `## [Unreleased]`, en el **mismo cambio** que el código, bajo la subsección que usa el repo: `### Added`, `### Changed`, `### Fixed`, `### Architecture` (también existe `### Removed`).
- **Specs** `*.spec.ts` colocados junto al código (o en el `__tests__/` vecino que ya exista), con mocks por constructor. Patrón de referencia para mocks de Prisma: `apps/api/src/modules/ai-analysis/estimation/__tests__/estimation-auditor-hash.spec.ts`.
- **Ariadne MCP:** el `AGENTS.md` / `CLAUDE.md` del repo pide `list_known_projects`, `get_sync_status`, `validate_before_edit` antes de editar un símbolo y `detect_changes` antes de proponer commit. Úsalo si responde, pero **el índice estaba `stale` (2026-11-04) al planear**: resincroniza antes de confiar en él y, si contradice el código, manda el código.
- **Configuración tipada:** el flag nuevo `DELIVERABLES_GATE_REQUIRE_GREEN` va en la config validada de la API (candidato: `apps/api/src/config/env.schema.ts`; confírmalo), nunca como `process.env` disperso.

### Zonas protegidas (no se tocan)

- `packages/database/schema.prisma` y todas las migraciones Prisma.
- `legacy-flow/*` (salvo lo que el spec de inventario obligue a listar, con TODO).
- Prompts del Auditor LLM.
- `apps/api/src/modules/projects/sdd-integration.service.ts` (tercer indicador; solo se documenta).
- Tarifas de `packages/business-rules/src/cost-estimation.ts`.
- `assertDesignFirstDeliverableGate`.

## 4. Decisiones de producto (inamovibles; no re-discutir)

| # | Tema | Decisión |
|---|---|---|
| J1 | Color sin Auditor | Completitud por fase: `pre_cascade` pondera solo MDD, BRD y Spec; `post_cascade` pondera todo. Un MDD perfecto puede ser verde antes de la cascada. |
| J2 | Fuente única | Composite alineado: devuelve `status` y `precisionScore` iguales al veredicto del núcleo; escala viva; tolerancia única de gaps; sin doble puerta ni doble conteo. |
| J3 | Derivados pendientes | Verde + nota «MDD listo; genera entregables». El composite no lista «conformidad incompleta». `canGenerate` y color usan la misma señal. |
| J4 | Costo | `business-rules` es fuente única (`computeCostEstimation` + `countCostDrivers`). Buffer 1.25 si no es verde. |
| J5 | Conformidad | `ok:false` o >3 endpoints faltantes impide verde. Se elimina `conformancePenalty`. |
| J6 | Design-First | Igual que NEW (delivery gate + conformidad). Tope 40 al titular (incl. `auditorScore`) y a lo persistido mientras fases 2–3 no estén ok. Borrar `!hasMdd ||` muerto. |
| J7 | Sync de Stage | Solo lo persistido escribe `Stage.status`/`precisionScore`. GET y POST no escriben. El sync corre sobre la etapa editada. |
| J8 | Puerta HIGH | Regla compartida en backend (HIGH: gate ok + verde + Spec; LOW/MEDIUM: bootstrap o verde con Spec; DF: `assertDesignFirstDeliverableGate`; LEGACY: MDD o `codebaseDoc`), expuesta como `semaphore.deliverablesGate`; la web solo refleja. |
| J9 | Señales HIGH de `SemaphoreService` | Solo quedan degradadores Figma/UX y bloqueantes de Constitución. Se retiran `edge_cases`/`field_types`, alivio de grafo y buckets 70/82/92/95. |
| J10 | Pesos pre-cascada | MDD 0.5 / BRD 0.3 / Spec 0.2. Ausencia de BRD/Spec penaliza solo en HIGH; LOW y MEDIUM renormalizan. |
| J11 | Flag de puerta | `DELIVERABLES_GATE_REQUIRE_GREEN` apagada al desplegar; se enciende tras backfill y revisión del `--dry-run`. |
| J12 | Reglas residuales | Se retiran «>8 endpoints faltantes → rojo» y la tolerancia separada de gaps humanos. Una regla de conformidad y una tolerancia de 5 gaps deduplicados. |
| J13 | `acknowledgeGaps` | Puede saltar blockers del MDD y la falta de verde (con log). **No** puede saltar la falta de Spec en HIGH. |
| J14 | Versionado del cálculo | `shortTermContext.semaphoreSync = { version: 1, inputsHash, computedAt }` en `Stage`; sin migración Prisma. |
| J15 | Alias | `status`/`precision`/`auditorScore`/`mddQualitySource`/`deliveryGate` en `LiveMetricsResult` quedan `@deprecated` y se retiran en la siguiente versión. |

Supuestos aceptados: sin BRD la consistencia es neutra en todas las ramas; un blocker del delivery gate = rojo; las razones nunca bajan el titular (salvo tope DF); la tolerancia única de 5 absorbe la de humanos.

## 5. Orden de lectura

1. Este `HANDOFF.md`.
2. [../README.md](../README.md) — mapa del paquete.
3. [../01-PRD.md](../01-PRD.md) — RF-01…RF-22 y RNF-01…RNF-07.
4. [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md) — secciones Contratos, Escala única, Completitud por fase, Sincronización y Puerta compartida.
5. [../02-estructura-de-archivos.md](../02-estructura-de-archivos.md) — árbol de archivos y zonas protegidas.
6. [../05-casos-limite.md](../05-casos-limite.md) — CL-01…CL-33.
7. [../04-plan-de-pruebas.md](../04-plan-de-pruebas.md) — comandos, caracterización y criterios de salida.
8. [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md) — riesgos y alternativas descartadas.
9. [TASKS.md](./TASKS.md) — ejecución paso a paso.

No hace falta releerlo todo en cada paso: cada paso de TASKS.md indica en «Lee antes» qué secciones necesita.

## 6. Protocolo de ejecución

1. Lee este HANDOFF (una vez por sesión).
2. Abre [TASKS.md](./TASKS.md) y toma el **primer paso sin marcar** en «Progreso».
3. Lee **solo** lo que el paso cita en «Lee antes» y los archivos de «Archivos».
4. Si Ariadne responde: `validate_before_edit` por cada símbolo que vayas a tocar.
5. Implementa las subtareas en orden, incluida la entrada de `CHANGELOG.md`.
6. Corre el bloque «Verificación» del paso y confirma el «Resultado esperado».
7. Marca las subtareas, los criterios de aceptación y la línea del paso en «Progreso».
8. Rellena «Notas de ejecución»: decisiones, desvíos, mediciones (p. ej. RNF-01 en el Paso 5b), bloqueos.
9. Detente y reporta, o pasa al siguiente paso si no hay motivo de parada.

## 7. Reglas de parada

Detente, anota el motivo en las «Notas de ejecución» del paso y pregunta a Jorge cuando ocurra cualquiera de estas situaciones:

- **Bloqueo:** falta una dependencia, un archivo no existe donde el plan dice o no puedes cumplir un criterio de aceptación sin salir del alcance.
- **Test rojo que no es del paso:** un spec ajeno al paso falla (antes o después de tu cambio). No lo "arregles de pasada".
- **Discrepancia documento ↔ código:** **el código manda.** Anota la discrepancia en TASKS.md (línea, archivo, qué dice el plan, qué dice el código) y pregunta antes de improvisar.
- **Escritor de `Stage.status` / `precisionScore` no listado:** si aparece una escritura que no está en el inventario del plan (ver [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md), sección Sincronización).
- **Cambio de color en la caracterización no marcado como esperado:** si un caso del spec de caracterización cambia de color/precisión/costo y no tiene marca `// CAMBIA EN Pn` para el paso actual.

## 8. Qué NO hacer

- No hacer commit, push, merge ni deploy sin que Jorge lo pida explícitamente.
- No ampliar el alcance ni "mejorar" código fuera de los archivos del paso.
- No saltar pasos ni cambiar su orden.
- No ejecutar el backfill (`apps/api/scripts/recalc-stage-semaphores.ts`) contra producción.
- No encender `DELIVERABLES_GATE_REQUIRE_GREEN` (queda en `false` por defecto).
- No tocar `schema.prisma` ni migraciones Prisma.
- No borrar los alias `@deprecated` (`status`, `precision`, `auditorScore`, `mddQualitySource`, `deliveryGate`, topes `READINESS_*_AMARILLO_CAP`, `refreshStageSemaphoreFromProject`, re-export de `projects/conformance-gaps.util.ts`).
- No imprimir secretos ni contenido del MDD en logs (`[Semaphore]` solo lleva metadatos).
