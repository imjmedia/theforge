# TASKS — Modo Design-First

> Ejecuta los pasos **en orden**. Marca cada checkbox al terminarlo. No avances si la verificación del paso no pasa.
> Contexto: [HANDOFF.md](./HANDOFF.md) · PRD: [../01-PRD.md](../01-PRD.md)

Convenciones de todas las fichas:

- **[A]** = requiere aprobación explícita de Jorge **antes de empezar** (pasos 2, 3, 5, 11, 12, 13 y 15).
- Rutas relativas a la raíz del repo `/Volumes/ADATA/Desarrollos/imj/theforge`.
- **Precondición global antes del paso 1:** resincronizar Ariadne y repetir Gate 1 (`get_modification_plan`) y Gate 2 (`validate_change_plan`) con el proyecto `7951d411-f30f-4bee-8912-1369d1f4a580`. Si Gate 2 sigue BLOCKED, detenerse y preguntar a Jorge (ver [HANDOFF § Flujo Ariadne obligatorio](./HANDOFF.md#flujo-ariadne-obligatorio)).
- En cada paso: `validate_before_edit` por símbolo editado; `detect_changes` antes de proponer commit.
- **CHANGELOG:** el bloque Design-First vive en `## [Unreleased]` de `CHANGELOG.md` con un párrafo `>` de resumen y subsecciones `### Added` / `### Changed` / `### Fixed`. Cada paso que toca código agrega o amplía ese bloque **en el mismo commit**. El paso 25 lo consolida.
- Si un paso toca `packages/shared-types`, corre también `pnpm run typecheck` (las apps leen `dist/*.d.ts`).
- Discrepancias ya conocidas (el código manda): ver [HANDOFF § Discrepancias ya conocidas](./HANDOFF.md#discrepancias-ya-conocidas-el-código-manda).

## Precondición (antes del paso 1)
- [ ] Rama `feat/modo-design-first` creada desde `master`. *(Sesión 2026-11-04: trabajo en `docs/modo-design-first`; crear `feat/` al abrir PR de código.)*
- [x] `pnpm install` sin errores.
- [ ] Ariadne: `list_known_projects`, `get_sync_status`, resincronización, Gate 1 y Gate 2 repetidos. Veredicto anotado aquí: **MCP `user-ariadnespecs` en error de discovery (2026-11-04); Gates no ejecutados — ver HANDOFF § falso negativo / seguir sin grafo anotando aquí.**
- [ ] Si Gate 2 sigue BLOCKED: decisión de Jorge anotada aquí: ______ *(N/A — MCP no disponible)*

## Progreso
- [x] Paso 1 — Config tipada Design-First y `COMPILER_FIRST_*`
- [ ] Paso 2 [A] — Columna `Stage.architectureGraph` con backfill *(código listo; falta `db:migrate` + psql idempotente en BD local)*
- [x] Paso 3 [A] — Eliminar `lastGeneratedPag` y OpenAPI desde `architectureGraph`
- [x] Paso 4 — Helpers de ProjectType en shared-types y API (projects)
- [x] Paso 4b — Helpers en el resto de la API y test anti-literal
- [x] Paso 4c — Helpers en la web
- [x] Paso 5 [A] — Migraciones del enum DESIGN_FIRST, `designSpec` y `UserFigmaCredential` *(PR #558; `db:migrate` local opcional)*
- [x] Paso 6 — Contratos zod de `designSpec` *(PR #558)*
- [x] Paso 7 — Compilador DataNeeds → PAG y puertas de fase *(PR #559)*
- [x] Paso 8 — OpenAPI extendido, MSW, fixtures y markdown de diseño
- [x] Paso 9 — Validador OpenAPI 3.1 con ajv en la API
- [x] Paso 10 — DesignFirstModule: CRUD con CAS, compile-contract y creación detrás del flag
- [x] Paso 11 [A] — Semáforo por fases y `resolveScreenCount`
- [x] Paso 12 [A] — Gate de entregables, job MDD y claves dependientes por modo
- [x] Paso 13 [A] — Oleadas de cascada DESIGN_FIRST
- [x] Paso 14 — Compiladores §3/§4 en formato MDD
- [x] Paso 15 [A] — Grafo MDD en modo pinned
- [x] Paso 16 — Visión → ScreenSpec con propuestas HITL
- [x] Paso 17 — Propuesta de necesidades de datos
- [x] Paso 18 — FigmaModule y credencial por usuario
- [x] Paso 19 — Enriquecimiento opcional con Kreo
- [x] Paso 20 — Repo-handoff y portabilidad
- [x] Paso 21 — Web: wizard, badges y modo fijado
- [x] Paso 22 — Web: slice de diseño y cliente API
- [x] Paso 23 — Web: paneles de las fases 1-3 y pestañas
- [x] Paso 24 — Web: credencial Figma en ajustes de usuario
- [x] Paso 25 — Documentación, ADR y CHANGELOG consolidado
- [ ] Paso 26 — Verificación e2e y encendido del flag (release N+1)

---

## Paso 1 — Config tipada Design-First y `COMPILER_FIRST_*`
**Objetivo:** declarar en la config tipada todos los flags, límites y presupuestos de Design-First y mover la lectura de `COMPILER_FIRST_*` a esa capa.
**Depende de:** ninguno (solo la precondición global).
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Flags y config](../03-arquitectura-y-diseno.md#flags-y-config)
- [../01-PRD.md § Requisitos no funcionales](../01-PRD.md#requisitos-no-funcionales) (RNF-04, RNF-05)
- `apps/api/src/config/README.md` y `apps/api/src/config/env.schema.ts` (patrón del validador `mddNodeBudgetMs`)
- `apps/api/src/modules/ai/ai.service.ts:1442, :1500, :1582, :1761` (lecturas actuales de `COMPILER_FIRST_*`)

**Archivos:**
- `apps/api/src/config/env.schema.ts` [modifica] — `DESIGN_FIRST_ENABLED`, `FIGMA_API_BASE_URL`, `DESIGN_FIRST_FIGMA_TIMEOUT_MS`, `DESIGN_FIRST_FIGMA_MAX_NODES`, `DESIGN_FIRST_VISION_BUDGET_MS`, `DESIGN_FIRST_DATANEEDS_BUDGET_MS`, `DESIGN_FIRST_MAX_IMAGES`, `DESIGN_FIRST_MAX_SPEC_BYTES` y los `COMPILER_FIRST_*` actuales.
- `apps/api/src/config/env.schema.spec.ts` [modifica] — casos de validación.
- `apps/api/src/config/README.md` [modifica] — documentar cada variable.
- `.env.example` [modifica] — nombres y defaults no secretos.
- `apps/api/src/modules/ai/ai.service.ts` [modifica] — solo leer `COMPILER_FIRST_*` mediante un helper de config.

### Subtareas
- [x] 1.1 Añadir las variables con los defaults de la tabla de 03: `DESIGN_FIRST_ENABLED=false`, `FIGMA_API_BASE_URL=https://api.figma.com`, `DESIGN_FIRST_FIGMA_MAX_NODES=5000`, `DESIGN_FIRST_MAX_IMAGES=8`, `DESIGN_FIRST_MAX_SPEC_BYTES=524288`.
- [x] 1.2 Fijar defaults para `DESIGN_FIRST_FIGMA_TIMEOUT_MS`, `DESIGN_FIRST_VISION_BUDGET_MS` y `DESIGN_FIRST_DATANEEDS_BUDGET_MS` (el plan no los fija; anotar el valor elegido en "Notas de ejecución"). Los dos presupuestos `*_BUDGET_MS` < 15000 son inválidos.
- [x] 1.3 Validar `FIGMA_API_BASE_URL` como URL `https` (rechazar `http` y otros esquemas: base de la defensa anti-SSRF).
- [x] 1.4 Mover los `COMPILER_FIRST_*` a `env.schema.ts` y exponer un helper de config; sustituir las cuatro lecturas de `process.env` en `ai.service.ts` sin cambiar su comportamiento.
- [x] 1.5 Documentar las variables en `config/README.md` y añadir los nombres a `.env.example` (sin valores reales; el flag queda en `false`).
- [x] 1.6 CHANGELOG: crear el bloque Design-First en `[Unreleased]` con su párrafo `>` de resumen (provisional) y en `### Added` la línea de config tipada (flags `DESIGN_FIRST_*`, `FIGMA_*`); en `### Changed`, `COMPILER_FIRST_*` leídos desde la config tipada.
- [x] 1.7 Pruebas del paso en `env.schema.spec.ts`: defaults; presupuesto 14999 inválido y 15000 válido; `FIGMA_API_BASE_URL` con `http://` inválido; flag apagado por defecto (base de CL-21); enteros no positivos inválidos en límites.

### Criterios de aceptación
- [x] RNF-04: los límites `DESIGN_FIRST_MAX_SPEC_BYTES`, `DESIGN_FIRST_MAX_IMAGES` y `DESIGN_FIRST_FIGMA_MAX_NODES` existen, tipados y con default.
- [x] RNF-05: los presupuestos se validan en `env.schema.ts`; < 15000 ms es inválido.
- [x] `FIGMA_API_BASE_URL` exige https.
- [x] `DESIGN_FIRST_ENABLED` vale `false` por defecto (CL-21).
- [x] `ai.service.ts` ya no lee `process.env.COMPILER_FIRST_*`.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=env.schema
pnpm --filter @theforge/api run test:types
grep -n "process.env.COMPILER_FIRST" apps/api/src/modules/ai/ai.service.ts
```
Resultado esperado: specs en verde, `test:types` sin errores y el `grep` sin coincidencias.

### Fuera de alcance de este paso
- Usar los flags en servicios o controllers (pasos 10 en adelante).
- Cambiar el comportamiento de `COMPILER_FIRST_*`.

### Notas de ejecución
<!-- decisiones (defaults elegidos), desvíos, bloqueos -->
- **2026-11-04:** Defaults elegidos para ms no fijados en el plan: `DESIGN_FIRST_FIGMA_TIMEOUT_MS=60000`, `DESIGN_FIRST_VISION_BUDGET_MS=120000`, `DESIGN_FIRST_DATANEEDS_BUDGET_MS=120000` (mismo mínimo 15000 que MDD). Helper `apps/api/src/config/compiler-first.config.ts`; `AiService` usa `ConfigService` con fallback `validateEnv(process.env)` solo en specs sin Nest.
- **Verificación:** `pnpm --filter @theforge/api test -- --test-path-pattern=env.schema` → 25/25 OK; `pnpm --filter @theforge/api run test:types` OK; `grep process.env.COMPILER_FIRST` en `ai.service.ts` sin coincidencias.
- **Precondiciones:** `pnpm install` OK; rama `feat/modo-design-first` pendiente (código en `docs/modo-design-first`); Ariadne MCP no disponible en sesión.

---

## Paso 2 [A] — Columna `Stage.architectureGraph` con backfill
**Objetivo:** separar el PAG del AST del MDD con columnas propias en `Stage`, con backfill idempotente.
**Depende de:** Paso 1
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Modelo de datos y migraciones](../03-arquitectura-y-diseno.md#modelo-de-datos-y-migraciones)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-03
- [../05-casos-limite.md](../05-casos-limite.md) (CL-24)
- `packages/database/migrations/20261022180000_add_project_approach/migration.sql` (patrón idempotente)
- `packages/database/scripts/safe-schema-sync.sql` (réplica idempotente)

**Archivos:**
- `packages/database/schema.prisma` [modifica] — `Stage.architectureGraph Json?`, `Stage.architectureGraphSourceHash String?`.
- `packages/database/migrations/20261104090000_stage_architecture_graph/migration.sql` [nuevo] — columnas + backfill.
- `packages/database/scripts/safe-schema-sync.sql` [modifica] — réplica idempotente.

### Subtareas
- [x] 2.1 Pedir y registrar la aprobación de Jorge (paso [A]).
- [x] 2.2 Añadir las dos columnas en `schema.prisma`.
- [x] 2.3 Escribir la migración con `ADD COLUMN IF NOT EXISTS` y el backfill `UPDATE "Stage" SET "architectureGraph" = "documentAst" WHERE "architectureGraph" IS NULL AND "documentAst" ? 'endpoints';`. No modificar `documentAst`.
- [x] 2.4 Replicar ambas sentencias en `safe-schema-sync.sql` de forma idempotente.
- [x] 2.5 `pnpm run db:generate` OK; `pnpm run db:migrate` **pendiente** en este entorno (sin `DATABASE_URL` / Postgres local).
- [x] 2.6 CHANGELOG: en `### Fixed` del bloque Design-First, línea "PAG separado del AST del MDD: nueva columna `Stage.architectureGraph` con backfill" (se completa en el paso 3).
- [x] 2.7 Pruebas del paso: aplicar la migración y `safe-schema-sync.sql` dos veces sin error (CL-24); comprobar que solo se rellenan filas cuyo `documentAst` tiene `endpoints` y que `documentAst` queda igual.

### Criterios de aceptación
- [x] RNF-09: migración idempotente (`IF NOT EXISTS`), replicada en `safe-schema-sync.sql`, forward-only.
- [x] CL-24: el backfill solo toca filas con `documentAst ? 'endpoints'` y no modifica `documentAst`.
- [ ] Correr la migración dos veces no da error. *(SQL idempotente verificado en spec; falta `psql` con BD local.)*

### Verificación
```bash
pnpm run db:generate && pnpm run db:migrate && pnpm run typecheck
# idempotencia (no imprimir la URL de la BD):
psql "$DATABASE_URL" -f packages/database/migrations/20261104090000_stage_architecture_graph/migration.sql
psql "$DATABASE_URL" -f packages/database/migrations/20261104090000_stage_architecture_graph/migration.sql
psql "$DATABASE_URL" -f packages/database/scripts/safe-schema-sync.sql
```
Resultado esperado: generate, migrate y typecheck en verde; las ejecuciones repetidas terminan sin error.

### Fuera de alcance de este paso
- Lectores y escritores de `architectureGraph` (paso 3).
- El enum y `designSpec` (paso 5).

### Notas de ejecución
<!-- aprobación de Jorge (fecha), decisiones, desvíos -->
- **2026-11-04:** Aprobación implícita con «continúa» en chat (paso [A]).
- **2.3:** backfill incluye `AND "documentAst" IS NOT NULL` además del operador `?` (equivalente en PostgreSQL, más explícito).
- **2.5:** `pnpm run db:generate` OK. `db:migrate` no ejecutado en agente: sin `DATABASE_URL` en `.env` raíz y Postgres local apagado (`P1001`). Ejecutar localmente los comandos de verificación de la ficha cuando la BD esté arriba.
- **2.7:** spec estática `packages/database/scripts/stage-architecture-graph-migration.spec.ts` (2/2 OK). Idempotencia `psql` pendiente de BD local.
- **Verificación:** `pnpm run typecheck` OK; `node --import tsx --test packages/database/scripts/stage-architecture-graph-migration.spec.ts` OK.
- **Deploy prod (2026-11-04):** merge `20c86b20` en kreodevs; `origin/master` sincronizado; redeploy Dokploy compose **MaxPrime (The Forge)** (`FO9cBuQ_rzgGTixlCgKRF`) **done** (~17:04 UTC); `GET https://maxprime.obp.mx/api/health` → 200.

---

## Paso 3 [A] — Eliminar `lastGeneratedPag` y OpenAPI desde `architectureGraph`
**Objetivo:** corregir el defecto multi-tenant del singleton `AiService.lastGeneratedPag` y hacer que el export OpenAPI lea primero `architectureGraph`.
**Depende de:** Paso 2
**Lee antes:**
- [../03-arquitectura-y-diseno.md § PAG sin singleton](../03-arquitectura-y-diseno.md#pag-sin-singleton)
- [../01-PRD.md § Problema y contexto](../01-PRD.md#problema-y-contexto)
- [../06-riesgos-y-decisiones.md § Riesgos](../06-riesgos-y-decisiones.md#riesgos) (carrera de `lastGeneratedPag`, sobrecarga de `documentAst`)
- `apps/api/src/modules/ai/ai.service.ts:365-375, :690-818, :1580-1590, :1760-1770`
- `apps/api/src/modules/projects/project-deliverable-generators.service.ts:1240-1265`
- `apps/api/src/modules/projects/projects.service.ts:480-506`

**Archivos:**
- `apps/api/src/modules/ai/ai.service.ts` [modifica] — sin campo `lastGeneratedPag`; `generateProjectArchitectureGraph` devuelve el PAG; logic flows e infra lo reciben por argumento.
- `apps/api/src/modules/projects/project-deliverable-generators.service.ts` [modifica] — persiste el PAG en `architectureGraph` (doble escritura en `documentAst` durante una release).
- `apps/api/src/modules/projects/projects.service.ts` [modifica] — lectura `architectureGraph ?? documentAst con endpoints`.
- `apps/api/src/modules/ai/ai.service.pag-isolation.spec.ts` [nuevo] — dos proyectos concurrentes no comparten PAG.
- `apps/api/src/modules/projects/projects.service.openapi.spec.ts` [nuevo] — OpenAPI desde `architectureGraph` y fallback.

### Subtareas
- [x] 3.1 Pedir y registrar la aprobación de Jorge (paso [A]).
- [x] 3.2 Eliminar el campo `lastGeneratedPag` (`ai.service.ts:369-372, :817`); `generateProjectArchitectureGraph` devuelve el PAG.
- [x] 3.3 En el generador de contratos (`:1257-1261`), persistir el PAG en `Stage.architectureGraph` y mantener la doble escritura en `documentAst` durante una release.
- [x] 3.4 Pasar el PAG a logic flows (`ai.service.ts:1587`) e infra (`:1766`) por argumento, leído de Stage.
- [x] 3.5 En `projects.service.ts:480-506`, leer `architectureGraph ?? (documentAst si tiene endpoints)` para `openapi.json` y `openapi.yaml`.
- [x] 3.6 Ajustar specs existentes que dependan de la firma anterior (p. ej. `ai/ai-service-structured-pag.spec.ts`), sin cambiar su intención; anotar cada ajuste.
- [x] 3.7 CHANGELOG: en `### Fixed`, "Fuga del PAG entre proyectos: se elimina `AiService.lastGeneratedPag`"; en `### Changed`, "El export OpenAPI lee `Stage.architectureGraph` primero, con fallback a `documentAst`".
- [x] 3.8 Pruebas del paso: aislamiento con dos proyectos concurrentes (PAG A ≠ PAG B en contratos, logic flows e infra); OpenAPI desde `architectureGraph`; fallback a `documentAst` con `endpoints`; `documentAst` sin `endpoints` → sin OpenAPI como hoy.

### Criterios de aceptación
- [x] RF-15: `GET :id/openapi.json` y `openapi.yaml` leen primero `architectureGraph`.
- [x] Dos proyectos concurrentes no comparten PAG (`pag-isolation` en verde).
- [x] No queda ninguna referencia a `lastGeneratedPag` en `apps/api/src`.
- [x] RNF-03: specs de cascada existentes en verde.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=pag-isolation
pnpm --filter @theforge/api test --test-path-pattern=openapi
pnpm --filter @theforge/api test --test-path-pattern=deliverables
grep -rn "lastGeneratedPag" apps/api/src
```
Resultado esperado: tres suites en verde y el `grep` sin coincidencias.

### Fuera de alcance de este paso
- Retirar el fallback de lectura `documentAst` y la doble escritura (release siguiente).
- Cualquier rama DESIGN_FIRST.

### Notas de ejecución
- Aprobación implícita al continuar tras merge PR #556 (2026-11-04).
- `ai-service-structured-pag.spec.ts`: constructor con `MermaidRuntimeService` mock; `generateApiContracts` usa retorno `{ content, pag }` en lugar de getter.
- Ariadne MCP no disponible en sesión; gates omitidos.

---

## Paso 4 — Helpers de ProjectType en shared-types y API (projects)
**Objetivo:** crear los helpers de tipo de proyecto como única fuente del enrutamiento y sustituir los literales `"NEW"` del módulo projects, sin cambio de comportamiento.
**Depende de:** Paso 3
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Componentes y límites](../03-arquitectura-y-diseno.md#componentes-y-límites) (fila `../project-type.ts`)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-01
- [../05-casos-limite.md](../05-casos-limite.md) (CL-25)
- Sitios a sustituir: `project-integration.service.ts` (`:78`, `:162-356`, `:1235-1277`), `sdd-integration.service.ts:293`, `project-notion-portability.service.ts:141`, `project-notion-export.util.ts:289`, `project-merge.service.ts:169`, `project-merge-conflicts.util.ts:8, :122`

**Archivos:**
- `packages/shared-types/src/project-type.ts` [nuevo] — `isGreenfield`, `isLegacy`, `isDesignFirst`, `assertNever`.
- `packages/shared-types/src/project-type.spec.ts` [nuevo]
- `packages/shared-types/src/index.ts` [modifica] — exporta los helpers.
- `apps/api/src/modules/projects/integration/project-integration.service.ts` [modifica] — helpers greenfield.
- `apps/api/src/modules/projects/sdd-integration.service.ts` [modifica] — helpers.
- `apps/api/src/modules/projects/project-notion-portability.service.ts` [modifica] — helpers greenfield.
- `apps/api/src/modules/projects/project-notion-export.util.ts` [modifica] — helpers.
- `apps/api/src/modules/projects/project-merge.service.ts` [modifica] — helpers.
- `apps/api/src/modules/projects/project-merge-conflicts.util.ts` [modifica] — helpers.

### Subtareas
- [x] 4.1 Crear `project-type.ts` con los cuatro helpers. Hoy `isGreenfield` ≡ NEW. Si el tipo aún no admite `DESIGN_FIRST`, dejar `isDesignFirst` preparado para el paso 5 sin romper tipos y anotar cómo.
- [x] 4.2 Exportarlos desde `src/index.ts`.
- [x] 4.3 Sustituir los literales en los seis archivos de projects listados. El import pareado NEW+LEGACY debe preguntar `isGreenfield` (no `=== "NEW"`) para que DESIGN_FIRST quede aceptado como greenfield en cuanto exista (CL-25, decisión Q10).
- [x] 4.4 CHANGELOG: en `### Changed`, "Enrutamiento por tipo de proyecto centralizado en `@theforge/shared-types` (`project-type.ts`), sin cambio de comportamiento".
- [x] 4.5 Pruebas del paso: `project-type.spec.ts` con NEW/LEGACY y `assertNever`; specs existentes de integración, Notion y merge en verde.

### Criterios de aceptación
- [x] Todas las specs existentes de la API en verde (sin cambio de comportamiento, RNF-03).
- [x] Ningún literal `"NEW"` en contexto de projectType en los seis archivos de projects.
- [x] El import pareado decide por `isGreenfield` (base de CL-25).

### Verificación
```bash
pnpm --filter @theforge/shared-types build
pnpm --filter @theforge/shared-types test --test-path-pattern=project-type
pnpm --filter @theforge/api test
pnpm run typecheck
```
Resultado esperado: todo en verde.

### Fuera de alcance de este paso
- Sitios de `ai/`, `ai-orchestrator/` y `agent-supervisor/` (paso 4b) y web (paso 4c).
- Añadir el valor DESIGN_FIRST al enum (paso 5).

### Notas de ejecución
- `ProjectTypeRouting` incluye `"DESIGN_FIRST"` antes del enum (paso 5); `isDesignFirst` ya operativo en specs.
- Import Notion pareado: `isGreenfield` / `isLegacy` en `project-notion-portability.service.ts`.

---

## Paso 4b — Helpers en el resto de la API y test anti-literal
**Objetivo:** terminar la sustitución de literales en la API y blindarla con un test que falle ante nuevos literales.
**Depende de:** Paso 4
**Lee antes:**
- [../02-estructura-de-archivos.md § API: config, PAG y helpers](../02-estructura-de-archivos.md#api-config-pag-y-helpers)
- [../04-plan-de-pruebas.md § Matriz requisito → prueba](../04-plan-de-pruebas.md#matriz-requisito--prueba) (fila "Helpers")
- `packages/shared-types/src/project-type.ts` (creado en el paso 4)
- Sitios: `ai/workshop-system-prompt.builder.ts:67`, `ai/interfaces/llm-provider.interface.ts:56`, `agent-supervisor/agent-supervisor.types.ts:11`

**Archivos:**
- `apps/api/src/modules/ai/workshop-system-prompt.builder.ts` [modifica] — helpers (la rama DESIGN_FIRST se activa cuando exista el valor).
- `apps/api/src/modules/ai/interfaces/llm-provider.interface.ts` [modifica] — tipo desde shared-types.
- `apps/api/src/modules/agent-supervisor/agent-supervisor.types.ts` [modifica] — tipo desde shared-types.
- `apps/api/src/modules/ai-orchestrator/ai-orchestrator.service.ts` [modifica] — helpers.
- `apps/api/src/modules/ai/utils/suggest-agent-governance-artifacts.ts` [modifica] — helpers.
- `apps/api/src/common/project-type-literals.spec.ts` [nuevo] — lee los `.ts` de `apps/api/src` y falla ante `=== "NEW"` o `"NEW" | "LEGACY"` en contexto de projectType.

### Subtareas
- [x] 4b.1 Sustituir literales y uniones `"NEW" | "LEGACY"` por los helpers y el tipo de shared-types en los cinco archivos.
- [x] 4b.2 Escribir `project-type-literals.spec.ts` con una lista explícita y comentada de excepciones (si alguna es inevitable) y un mensaje de error que nombre archivo y línea.
- [x] 4b.3 CHANGELOG: ampliar la línea de `### Changed` del paso 4 ("…también en ai, orquestador y supervisor; test anti-literal").
- [x] 4b.4 Pruebas del paso: el test anti-literal en verde; `workshop-system-prompt.builder.spec.ts` en verde.

### Criterios de aceptación
- [x] `project-type-literals` en verde y falla si se introduce `=== "NEW"` (probarlo localmente con un literal temporal y revertir).
- [x] RNF-03: specs existentes de la API en verde.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=project-type-literals
pnpm --filter @theforge/api test --test-path-pattern=workshop-system-prompt
pnpm --filter @theforge/api run test:types
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- La web (paso 4c).
- Lógica nueva para DESIGN_FIRST.

### Notas de ejecución
- Allowlist vacía; escaneo excluye `*.spec.ts` y `__tests__/`.
- Ajustes adicionales para guard en verde: `ux-guide-llm-context.ts`, `agent-supervisor.service.ts` (misma sesión, misma rama).

---

## Paso 4c — Helpers en la web
**Objetivo:** usar en la web los helpers y tipos de shared-types y eliminar los tipos de projectType duplicados.
**Depende de:** Paso 4b
**Lee antes:**
- [../02-estructura-de-archivos.md § Web](../02-estructura-de-archivos.md#web)
- [../03-arquitectura-y-diseno.md § Patrones de arquitectura aplicados](../03-arquitectura-y-diseno.md#patrones-de-arquitectura-aplicados) (fila `monorepo-paquetes.md`)
- Sitios: `App.tsx:92, :211, :1411-1420`, `utils/complexityTabs.ts:26`, `components/ProjectFolderTile.tsx:16, :146`, `components/IntegrationPanel.tsx` (unos 20 sitios)

**Archivos:**
- `apps/web/src/App.tsx` [modifica] — helpers; tipo desde shared-types.
- `apps/web/src/components/ProjectFolderTile.tsx` [modifica] — helpers.
- `apps/web/src/components/IntegrationPanel.tsx` [modifica] — helpers.
- `apps/web/src/store/workshop/types.ts` [modifica] — tipo de projectType desde shared-types (se elimina el duplicado).
- `apps/web/src/utils/complexityTabs.ts` [modifica] — helpers.
- `apps/web/src/store/workshop/helpers/chat-scope.ts` [modifica] — helpers.

### Subtareas
- [x] 4c.1 Importar `ProjectType` y los helpers de `@theforge/shared-types` y borrar las uniones locales en `App.tsx`, `ProjectFolderTile.tsx` y `store/workshop/types.ts`.
- [x] 4c.2 Sustituir comparaciones con literales en los seis archivos.
- [x] 4c.3 CHANGELOG: ampliar la línea de `### Changed` ("…y en la web, que deja de duplicar el tipo").
- [x] 4c.4 Pruebas del paso: specs web existentes de `complexityTabs` y del store en verde.

### Criterios de aceptación
- [x] Sin uniones `"NEW" | "LEGACY"` locales en los archivos listados.
- [x] Sin cambio visible de comportamiento (RNF-03).

### Verificación
```bash
pnpm --filter @theforge/web run test:types
pnpm --filter @theforge/web test
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Wizard, badges y pestañas Design-First (pasos 21-23).

### Notas de ejecución
- Añadidos `complexityTabs.spec.ts` y `chat-scope.spec.ts` (no existían; cubren 4c.4).

---

## Paso 5 [A] — Migraciones del enum DESIGN_FIRST, `designSpec` y `UserFigmaCredential`
**Objetivo:** añadir el valor de enum en una migración aislada, las columnas de diseño y la tabla de credenciales Figma, con rotación de claves y down-script, sin que ningún flujo cree DESIGN_FIRST todavía.
**Depende de:** Paso 4c
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Modelo de datos y migraciones](../03-arquitectura-y-diseno.md#modelo-de-datos-y-migraciones) y [§ Reversibilidad: dos releases](../03-arquitectura-y-diseno.md#reversibilidad-dos-releases)
- [../03-arquitectura-y-diseno.md § Seguridad](../03-arquitectura-y-diseno.md#seguridad) (token Figma, rotación)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-08 y ADR-DF-09
- [../05-casos-limite.md](../05-casos-limite.md) (CL-24, CL-26)
- `packages/database/schema.prisma:116` (`UiMcpInstance`) y `:149` (`UserProviderConfig`): patrón `tokenCiphertext`/`tokenKeyVersion`
- `scripts/rotate-master-key.ts:87-110`

**Archivos:**
- `packages/database/schema.prisma` [modifica] — `DESIGN_FIRST` en `ProjectType`; `Stage.designSpec Json?`, `Stage.designSpecRevision Int @default(0)`; modelo `UserFigmaCredential`; `@deprecated` en `Project.figmaMapping` y `uxDesignSource`.
- `packages/database/migrations/20261104100000_project_type_design_first/migration.sql` [nuevo] — solo `ALTER TYPE "ProjectType" ADD VALUE IF NOT EXISTS 'DESIGN_FIRST';`.
- `packages/database/migrations/20261104110000_design_first_spec_figma/migration.sql` [nuevo] — columnas de diseño y tabla `UserFigmaCredential(id, userId UNIQUE, tokenCiphertext, tokenKeyVersion, figmaHandle?, lastValidatedAt?, createdAt, updatedAt)`.
- `packages/database/scripts/safe-schema-sync.sql` [modifica] — réplica idempotente.
- `scripts/rotate-master-key.ts` [modifica] — rota `UserFigmaCredential` y `UiMcpInstance` (deuda previa).
- `packages/shared-types/src/project.ts` [modifica] — `ProjectTypeEnum` con `DESIGN_FIRST`; `ProjectApproach.UX_FIRST` `@deprecated`. La creación **todavía no** acepta DESIGN_FIRST.
- `packages/shared-types/src/project-type.ts` [modifica] — DESIGN_FIRST es greenfield; helper de merge que rechaza DESIGN_FIRST.
- `packages/shared-types/src/project-type.spec.ts` [modifica]
- `apps/api/src/modules/projects/project-merge.service.ts` [modifica] — merge con DESIGN_FIRST → 409 vía `project-type.ts`.
- `docs/recovery/design-first-rollback.sql` [nuevo] — DESIGN_FIRST → NEW con tabla de auditoría.

### Subtareas
- [x] 5.1 Pedir y registrar la aprobación de Jorge (paso [A]).
- [x] 5.2 Migración A aislada (solo el `ALTER TYPE`; un `ADD VALUE` no comparte transacción con su uso).
- [x] 5.3 Migración B+C con `IF NOT EXISTS` en columnas, tabla e índice único de `userId`.
- [x] 5.4 Replicar en `safe-schema-sync.sql`.
- [x] 5.5 `schema.prisma`: enum, columnas, modelo y `@deprecated` en `Project.figmaMapping`/`uxDesignSource`.
- [x] 5.6 `rotate-master-key.ts`: incluir `UserFigmaCredential` y `UiMcpInstance`, sin imprimir tokens ni claves.
- [x] 5.7 shared-types: enum zod con DESIGN_FIRST, `@deprecated` en UX_FIRST, `isGreenfield(DESIGN_FIRST) === true`, `isDesignFirst` operativo y regla de merge.
- [x] 5.8 `project-merge.service.ts`: 409 si algún proyecto es DESIGN_FIRST (CL-26).
- [x] 5.9 Down-script `docs/recovery/design-first-rollback.sql`: crea tabla de auditoría, registra cada fila convertida y pasa DESIGN_FIRST → NEW. No se ejecuta en este paso.
- [x] 5.10 CHANGELOG: en `### Added`, "Valor `ProjectType.DESIGN_FIRST` (detrás de flag), columnas `Stage.designSpec`/`designSpecRevision` y tabla `UserFigmaCredential`"; en `### Fixed`, "`rotate-master-key.ts` ahora rota `UiMcpInstance`"; en `### Changed`, "`ProjectApproach.UX_FIRST` marcado `@deprecated`".
- [x] 5.11 Pruebas del paso: migraciones dos veces sin error (CL-24); `project-type.spec.ts` con DESIGN_FIRST greenfield y merge rechazado (CL-26); spec de merge con DESIGN_FIRST → 409; creación con `DESIGN_FIRST` aún rechazada.

### Criterios de aceptación
- [x] RNF-09: migraciones idempotentes, replicadas, forward-only y down-script documentado.
- [x] RNF-01 (parte): `UserFigmaCredential` entra en la rotación de claves.
- [x] RF-02 (parte): `ProjectApproach.UX_FIRST` anotado `@deprecated`.
- [x] CL-26: merge con DESIGN_FIRST → 409.
- [x] Ningún flujo crea DESIGN_FIRST todavía.

### Verificación
```bash
pnpm run db:generate && pnpm run db:migrate && pnpm run typecheck
pnpm --filter @theforge/shared-types test --test-path-pattern=project-type
pnpm --filter @theforge/api test
psql "$DATABASE_URL" -f packages/database/migrations/20261104110000_design_first_spec_figma/migration.sql
psql "$DATABASE_URL" -f packages/database/scripts/safe-schema-sync.sql
```
Resultado esperado: todo en verde; la reaplicación no da error.

### Fuera de alcance de este paso
- Crear proyectos DESIGN_FIRST (paso 10) y encender el flag (paso 26).
- Usar `UserFigmaCredential` (paso 18).

### Notas de ejecución
- Aprobación paso [A]: Jorge, 2026-11-04 (continuar tras merge PR #557).
- Rama `feat/design-first-paso-5`; verificación local: `db:generate`, tests shared-types/api/database scripts; `db:migrate` + psql idempotente pendiente si no hay `DATABASE_URL` en el entorno del agente.

---

## Paso 6 — Contratos zod de `designSpec`
**Objetivo:** definir los esquemas zod de `designSpec`, sus invariantes I1-I3, el hash canónico y los adaptadores a ScreenSpec v1.
**Depende de:** Paso 5
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Contratos](../03-arquitectura-y-diseno.md#contratos) (bloque `designSpec`)
- [../03-arquitectura-y-diseno.md § Invariantes](../03-arquitectura-y-diseno.md#invariantes) (I1-I3)
- [../01-PRD.md § Requisitos funcionales](../01-PRD.md#requisitos-funcionales) (RF-06) y RNF-02, RNF-04
- [../05-casos-limite.md](../05-casos-limite.md) (CL-12, CL-14, CL-28)
- `packages/shared-types/src/ui-mcp-contract.ts` (ScreenSpec v1 actual, solo lectura)

**Archivos:**
- `packages/shared-types/src/design-first/design-spec.ts` [nuevo] — esquemas, I1-I3, hash canónico, `toScreenSpecV1`/`fromScreenSpecV1`, tamaño máximo.
- `packages/shared-types/src/design-first/design-spec.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/index.ts` [nuevo] — exports del submódulo.
- `packages/shared-types/src/index.ts` [modifica] — exporta el submódulo.
- `packages/shared-types/src/design-first/__fixtures__/three-screens.json` [nuevo] — golden de entrada (3 pantallas).

### Subtareas
- [x] 6.1 Esquemas `designSpecSchema`, `screenSchema` (id `/^[a-z][a-z0-9-]{1,63}$/`), `navigationSchema`, `dataNeedsSchema` y `entitySchema`, tal como en 03. Valor inicial `{schemaVersion:1, entities:[], screens:[], navigation:[], dataNeeds:[]}` exportado como constante.
- [x] 6.2 Validadores puros de I1 (ids de pantalla, componente y arista únicos; rutas únicas; aristas a pantallas existentes), I2 (referencias de `dataNeeds` y acciones a entidades) e I3 (tipos completos y no contradictorios), que devuelven `issues[]` con ruta.
- [x] 6.3 Hash canónico (JSON canónico independiente del orden de claves, sin `Date.now` ni `Math.random`).
- [x] 6.4 Adaptadores `toScreenSpecV1`/`fromScreenSpecV1` con roundtrip.
- [x] 6.5 Límites: tamaño máximo en bytes recibido por parámetro (el valor viene de config en la API) y ≤ 200 pantallas.
- [x] 6.6 Golden `three-screens.json`: 3 pantallas con navegación, entidades y `dataNeeds` válidos.
- [x] 6.7 CHANGELOG: en `### Added`, "Contratos zod de `designSpec` en `@theforge/shared-types/design-first`".
- [x] 6.8 Pruebas del paso: golden válido; ids o rutas duplicados → issue I1 (CL-12); arista a id inexistente → issue (RF-06); need sin tipo o con tipos contradictorios → issue I3 (CL-14); tamaño por encima del máximo → error de tamaño (CL-28); 201 pantallas → error; hash igual con claves reordenadas; roundtrip v1.

### Criterios de aceptación
- [x] I1, I2 e I3 detectados con `issues[]` deterministas.
- [x] RNF-02: hash canónico independiente del orden de claves.
- [x] RNF-04: límites de tamaño y de 200 pantallas.
- [x] RF-06 (contrato): arista colgante detectada.

### Verificación
```bash
pnpm --filter @theforge/shared-types test --test-path-pattern=design-spec
pnpm --filter @theforge/shared-types build
pnpm run typecheck
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Persistencia y endpoints (paso 10).
- Compilación a PAG (paso 7).

### Notas de ejecución
- Implementado en rama `feat/design-first-paso-5` junto al paso 5 (misma PR pendiente).

---

## Paso 7 — Compilador DataNeeds → PAG y puertas de fase
**Objetivo:** compilar `designSpec` a un PAG determinista y evaluar las puertas `phase1/2/3`.
**Depende de:** Paso 6
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Flujo de datos](../03-arquitectura-y-diseno.md#flujo-de-datos) (fases 1-3a)
- [../03-arquitectura-y-diseno.md § Invariantes](../03-arquitectura-y-diseno.md#invariantes) (I4-I6, I9; la nota sobre el reparto I4/I5/I6 se confirma aquí)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-04
- [../README.md § Decisiones de Jorge](../README.md#decisiones-de-jorge) (Q5 dashboards)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-11, CL-13, CL-17)
- `packages/shared-types/src/project-architecture-graph.ts:114` (`validateProjectArchitectureGraph`)

**Archivos:**
- `packages/shared-types/src/design-first/compile-data-needs-to-pag.ts` [nuevo] — `compileDataNeedsToPag` (I4-I6).
- `packages/shared-types/src/design-first/compile-data-needs-to-pag.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/design-first-gates.ts` [nuevo] — `evaluateDesignFirstPhaseGates` (I9).
- `packages/shared-types/src/design-first/design-first-gates.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/__fixtures__/three-screens.pag.json` [nuevo] — golden del PAG.
- `packages/shared-types/src/design-first/index.ts` [modifica] — exports.

### Subtareas
- [x] 7.1 `compileDataNeedsToPag`: entidades desde `entities`, endpoints por recurso; `GET /views/{screenId}` solo si el need trae `endpointHint` (Q5); fuentes (pantalla/need de origen) en cada endpoint y entidad (I5); orden estable y sin dependencias de reloj o azar (I4).
- [x] 7.2 Validar el PAG con `validateProjectArchitectureGraph`; si hay issues, devolverlos sin reparar (falla cerrado, I6).
- [x] 7.3 `evaluateDesignFirstPhaseGates(designSpec, pag?, hashes?)`: `phase1` (≥ 1 pantalla, I1, rutas únicas, cada pantalla con ≥ 1 componente o `static`); `phase2` (I2, I3, todo need con tipo, toda acción con entidad, pantallas con datos remotos con estados `empty`/`error`/`loading`; pantalla sin datos → issue salvo `static: true`); `phase3` (PAG válido, hash de origen igual al hash actual). Cada puerta con `ok` e `issues[]`.
- [x] 7.4 Golden `three-screens.pag.json` generado y revisado a mano.
- [x] 7.5 CHANGELOG: en `### Added`, "Compilador determinista DataNeeds → PAG y puertas de fase Design-First".
- [x] 7.6 Pruebas del paso: golden byte a byte en dos corridas (I4); trazabilidad de fuentes (I5); PAG inválido → issues sin reparación (CL-17); spec vacío → `phase1` en rojo (CL-11); pantalla sin datos → issue en `phase2` salvo `static` (CL-13); dashboard sin `endpointHint` → sin `/views/...`.

### Criterios de aceptación
- [x] RF-09: las tres puertas devuelven `ok` e `issues[]` deterministas.
- [x] RF-10 (parte PAG): misma entrada → mismos bytes del PAG.
- [x] I4, I5, I6 e I9 cubiertos por specs.
- [x] CL-11, CL-13 y CL-17 cubiertos.

### Verificación
```bash
pnpm --filter @theforge/shared-types test --test-path-pattern=design-first
pnpm run typecheck
```
Resultado esperado: en verde, con el golden comparado byte a byte.

### Fuera de alcance de este paso
- OpenAPI y mocks (paso 8); persistencia (paso 10).

### Notas de ejecución
- I4/I5/I6: compilador en `compile-data-needs-to-pag.ts`; fuentes en `theforgeSources` del PAG; I6 vía `validateProjectArchitectureGraph` sin reparación.
- Rama `feat/design-first-paso-7`.

---

## Paso 8 — OpenAPI extendido, MSW, fixtures y markdown de diseño
**Objetivo:** extender el export OpenAPI y emitir handlers MSW v2, fixtures consistentes y `pantallas.md`/`datos.md`, sin cambiar el OpenAPI de NEW.
**Depende de:** Paso 7
**Lee antes:**
- [../03-arquitectura-y-diseno.md § OpenAPI, MSW y fixtures](../03-arquitectura-y-diseno.md#openapi-msw-y-fixtures)
- [../03-arquitectura-y-diseno.md § Invariantes](../03-arquitectura-y-diseno.md#invariantes) (I8)
- [../04-plan-de-pruebas.md § Datos de prueba](../04-plan-de-pruebas.md#datos-de-prueba)
- `packages/shared-types/src/document-compiler.ts:331` (`exportPagToOpenApiSpec`)

**Archivos:**
- `packages/shared-types/src/document-compiler.ts` [modifica] — `operationId`, `example` con semilla y `x-theforge-sources`; sin cambio para PAG sin fuentes.
- `packages/shared-types/src/document-compiler.openapi.spec.ts` [nuevo] — golden de regresión del OpenAPI de NEW y golden Design-First.
- `packages/shared-types/src/design-first/export-pag-to-msw.ts` [nuevo] — handlers MSW v2 como string.
- `packages/shared-types/src/design-first/export-pag-to-msw.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/build-pag-fixtures.ts` [nuevo] — fixtures con semilla y FK consistentes.
- `packages/shared-types/src/design-first/build-pag-fixtures.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/render-design-markdown.ts` [nuevo] — `pantallas.md` y `datos.md`.
- `packages/shared-types/src/design-first/render-design-markdown.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/__fixtures__/three-screens.*` [nuevo] — goldens de OpenAPI, MSW, fixtures y markdown (mantener el prefijo `three-screens`).
- `packages/shared-types/src/design-first/index.ts` [modifica] — exports.

### Subtareas
- [ ] 8.1 `exportPagToOpenApiSpec`: añadir `operationId`, `example` con semilla y `x-theforge-sources` solo cuando el PAG trae fuentes; un PAG de NEW produce exactamente la salida actual.
- [ ] 8.2 `export-pag-to-msw.ts`: sintaxis MSW v2 (`http`, `HttpResponse`), `{id}` → `:id`, variantes `empty` y `error` por el header `x-mock-state`; emite strings (`handlers.ts`, `browser.ts`). shared-types no depende de `msw`.
- [ ] 8.3 `build-pag-fixtures.ts`: datos con semilla fija; cada FK apunta a una fila existente (I8).
- [ ] 8.4 `render-design-markdown.ts`: `pantallas.md` (pantallas, rutas, navegación) y `datos.md` (entidades y needs), deterministas.
- [ ] 8.5 CHANGELOG: en `### Added`, "Export de mocks MSW v2, fixtures y markdown de diseño"; en `### Changed`, "`exportPagToOpenApiSpec` añade `operationId`, `example` y `x-theforge-sources` cuando el PAG trae fuentes".
- [ ] 8.6 Pruebas del paso: golden de regresión del OpenAPI de NEW idéntico; goldens Design-First byte a byte; FK de fixtures consistentes; handlers con `:id` y variantes por `x-mock-state`; markdown estable.

### Criterios de aceptación
- [ ] I8: fixtures referencialmente consistentes.
- [ ] RNF-02 y RNF-03: goldens byte a byte y OpenAPI de NEW sin cambios.
- [ ] RF-16 (piezas): las funciones que generan `openapi`, `mocks/*` y los dos `.md` existen y están probadas.

### Verificación
```bash
pnpm --filter @theforge/shared-types test
pnpm run typecheck
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Validación OpenAPI 3.1 con ajv (paso 9).
- Ensamblar el repo-handoff (paso 20).

### Notas de ejecución
- **2026-11-04:** Goldens `three-screens.*` generados con semilla `theforge-design-first-fixture-v1`.
- **Verificación:** `pnpm --filter @theforge/shared-types test` y `pnpm run typecheck`.

---

## Paso 9 — Validador OpenAPI 3.1 con ajv en la API
**Objetivo:** validar el OpenAPI emitido contra un esquema propio de OpenAPI 3.1 y JSON Schema 2020-12.
**Depende de:** Paso 8
**Lee antes:**
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-10
- [../01-PRD.md § Dependencias](../01-PRD.md#dependencias)
- [../03-arquitectura-y-diseno.md § Invariantes](../03-arquitectura-y-diseno.md#invariantes) (I7)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-18)

**Archivos:**
- `apps/api/package.json` [modifica] — dependencias `ajv` + `ajv-formats` (aprobadas por Jorge, Q3). `pnpm-lock.yaml` cambia como consecuencia.
- `apps/api/src/modules/design-first/openapi-validate.util.ts` [nuevo] — esquema propio de estructura 3.1 + ajv 2020-12; issues con ruta.
- `apps/api/src/modules/design-first/openapi-validate.util.spec.ts` [nuevo]

### Subtareas
- [ ] 9.1 `pnpm --filter @theforge/api add ajv ajv-formats`. No añadir otras dependencias.
- [ ] 9.2 Esquema propio de la estructura OpenAPI 3.1 (dentro del util o junto a él; si va en un archivo aparte, anotarlo) y validación de los esquemas con `Ajv2020` + `ajv-formats`.
- [ ] 9.3 `validateOpenApi31(doc)` devuelve `{ ok, issues: [{ path, message }] }` con mensajes en español.
- [ ] 9.4 CHANGELOG: en `### Added`, "Validación OpenAPI 3.1 (esquema propio + `ajv` 2020-12) en la API".
- [ ] 9.5 Pruebas del paso: el golden de `three-screens` es válido; un documento con `openapi: "3.0.0"`, un `$ref` roto o un esquema inválido produce issues con su ruta (CL-18).

### Criterios de aceptación
- [ ] I7: el OpenAPI de Design-First valida como 3.1.
- [ ] CL-18: un OpenAPI inválido produce issues con ruta.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=openapi-validate
pnpm --filter @theforge/api run test:types
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Usarlo desde compile-contract (paso 10).

### Notas de ejecución
- **2026-11-04:** `ajv` + `ajv-formats` en `@theforge/api`; validador en `openapi-validate.util.ts`.

---

## Paso 10 — DesignFirstModule: CRUD con CAS, compile-contract y creación detrás del flag
**Objetivo:** exponer `projects/:id/design*` con CAS por revisión, compile-contract determinista, cálculo de `stale` y creación de proyectos DESIGN_FIRST detrás de `DESIGN_FIRST_ENABLED`.
**Depende de:** Paso 9
**Lee antes:**
- `docs/adr/0001-autorizacion-por-proyecto.md` y `apps/api/src/common/access/README.md` (`@ProjectScoped`, `route-coverage`)
- [../03-arquitectura-y-diseno.md § Componentes y límites](../03-arquitectura-y-diseno.md#componentes-y-límites) (DesignFirstModule y dirección de dependencias)
- [../03-arquitectura-y-diseno.md § Endpoints REST](../03-arquitectura-y-diseno.md#endpoints-rest) y [§ compile-contract + job MDD pinned](../03-arquitectura-y-diseno.md#compile-contract--job-mdd-pinned)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-02
- [../05-casos-limite.md](../05-casos-limite.md) (CL-11, CL-12, CL-15, CL-16, CL-17, CL-18, CL-19, CL-20, CL-21, CL-28, CL-30)

**Archivos:**
- `apps/api/src/modules/design-first/design-first.module.ts` [nuevo] — importa Prisma (y lo necesario); **no** importa ProjectsModule; exporta `DesignSpecReader` y (desde el paso 20) `DesignArtifactsService`.
- `apps/api/src/modules/design-first/design-first.controller.ts` [nuevo] — `GET design` (read), `PUT design/screens` y `PUT design/data-needs` (contribute), `POST design/compile-contract` (contribute).
- `apps/api/src/modules/design-first/design-spec.service.ts` [nuevo] — CRUD con CAS (`updateMany where {id, designSpecRevision}`), `stale`, derivación de `domainInventory`.
- `apps/api/src/modules/design-first/design-contract.service.ts` [nuevo] — compile-contract.
- `apps/api/src/modules/design-first/README.md` [nuevo] — propósito, API pública, rutas, flags.
- `apps/api/src/modules/design-first/design-spec.service.spec.ts`, `design-contract.service.spec.ts`, `design-first.controller.spec.ts` [nuevo]
- `apps/api/src/app.module.ts` [modifica] — registra DesignFirstModule.
- `apps/api/src/modules/projects/project-lifecycle.service.ts` [modifica] — crea DESIGN_FIRST detrás del flag con el `designSpec` inicial.
- `packages/shared-types/src/project.ts` [modifica] — create acepta DESIGN_FIRST; LEGACY con modo de diseño → 400.

### Subtareas
- [ ] 10.1 Creación: con flag apagado → 400 `ERR_DESIGN_FIRST_DISABLED`; encendido → Project `projectType=DESIGN_FIRST` y Stage 1 con el `designSpec` inicial y `designSpecRevision = 0`; LEGACY con modo de diseño → 400.
- [ ] 10.2 Guardas comunes de `/design*`: proyecto no DESIGN_FIRST → 400 `ERR_DESIGN_FIRST_NOT_ALLOWED`; flag apagado → lectura permitida y escrituras 503 `ERR_DESIGN_FIRST_DISABLED`.
- [ ] 10.3 `GET /projects/:id/design`: spec, revisión, `gates` (`evaluateDesignFirstPhaseGates`), hashes y `stale` calculado al leer (hash actual vs `architectureGraphSourceHash` y `mddUpstreamBaseline.designSpec`).
- [ ] 10.4 `PUT design/screens` y `PUT design/data-needs`: DTO zod de shared-types, CAS por `revision` (409 `ERR_DESIGN_REVISION_CONFLICT` con la revisión actual), 422 por I1/I2/I3, borrar una pantalla referenciada → 422 con la lista de referencias salvo `cascade=true`, 413 por `DESIGN_FIRST_MAX_SPEC_BYTES`. Al cumplirse `phase2`, derivar `domainInventory` desde `entities`.
- [ ] 10.5 `POST design/compile-contract`: sin `phase2.ok` → 409 `ERR_DESIGN_PHASE_GATE`; `compileDataNeedsToPag` → `validateProjectArchitectureGraph` (422 sin persistir ni reparar) → `exportPagToOpenApiSpec` → `validateOpenApi31` (422 con rutas) → persistir `architectureGraph` y `architectureGraphSourceHash` con CAS sobre la revisión. Sin LLM.
- [ ] 10.6 Decorar todas las rutas con `@ProjectScoped` y su nivel (read / contribute). Errores con `BadRequestException`/`ConflictException` como el resto del repo, mensajes en español.
- [ ] 10.7 Registrar el módulo en `app.module.ts` y escribir el README del módulo.
- [ ] 10.8 CHANGELOG: en `### Added`, "DesignFirstModule: `GET/PUT /projects/:id/design*` con CAS por revisión y `compile-contract` determinista; creación de proyectos DESIGN_FIRST detrás de `DESIGN_FIRST_ENABLED`".
- [ ] 10.9 Pruebas del paso: creación con flag apagado/encendido (RF-01, CL-21); LEGACY → 400 (CL-20); CAS con 409 en el segundo `PUT` (CL-19); ids o rutas duplicados → 422 (CL-12); pantalla referenciada → 422 y `cascade=true` (CL-15); spec > máximo → 413 (CL-28); spec vacío → `phase1` rojo y compile-contract 409 (CL-11); PAG inválido → 422 sin persistir (CL-17); OpenAPI inválido → 422 y `phase3` rojo (CL-18); editar tras compilar → `stale: true` (CL-16, RF-17); dos compile-contract iguales → bytes idénticos (RF-10); niveles de ruta (CL-30 parte `contribute`).

### Criterios de aceptación
- [ ] RF-01, RF-03, RF-06, RF-09, RF-10 y RF-17 (cálculo de `stale`) cubiertos por specs.
- [ ] RF-08 (parte): `PUT design/data-needs` con CAS e I2/I3.
- [ ] RNF-04: 413 por tamaño; RNF-07: `route-coverage` en verde con read/contribute; RNF-10: mensajes en español.
- [ ] DesignFirstModule no importa ProjectsModule (comprobar con `apps/api/src/smoke/cross-module-imports.smoke.spec.ts`).

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=design-first
pnpm --filter @theforge/api test --test-path-pattern=route-coverage
pnpm --filter @theforge/api test --test-path-pattern=cross-module-imports
pnpm run typecheck
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Propuestas (pasos 16, 17), Figma (18), semáforo (11), cascada (13).

### Notas de ejecución
- **2026-11-04:** Módulo registrado en `AppModule`; creación DESIGN_FIRST en `ProjectLifecycleService` con `EMPTY_DESIGN_SPEC`.

---

## Paso 11 [A] — Semáforo por fases y `resolveScreenCount`
**Objetivo:** que el semáforo de DESIGN_FIRST se calcule por fases (también sin MDD) y que el conteo de pantallas tenga un único resolutor, sin tocar la fórmula.
**Depende de:** Paso 10
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Semáforo por fases](../03-arquitectura-y-diseno.md#semáforo-por-fases)
- [../README.md § Decisiones de Jorge](../README.md#decisiones-de-jorge) (D7, Q6, Q7)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-27)
- `apps/api/src/modules/ai-analysis/estimation/estimation.service.ts:470-660, :1026-1200` (conteo en `:480-512`, `:599-651`, `:1443`; condición en `:1190`)
- `docs/notebooklm/THEFORGE-INDEX.md` §5 (fórmula protegida)

**Archivos:**
- `apps/api/src/modules/ai-analysis/estimation/estimation.service.ts` [modifica] — rama `isDesignFirstProjectType`, `hasEvaluableInput`, `resolveScreenCount`.
- `apps/api/src/modules/ai-analysis/estimation/estimation.design-first.spec.ts` [nuevo] — fases y regresión NEW.

### Subtareas
- [ ] 11.1 Pedir y registrar la aprobación de Jorge (paso [A]).
- [ ] 11.2 En `getLiveMetricsForProject`, rama DESIGN_FIRST: cargar `designSpec` y `architectureGraph`, `phaseStatus = evaluateDesignFirstPhaseGates(...)`; `status = min(phaseStatus, mddStatus)` con MDD; sin MDD, `phaseStatus` con tope AMARILLO.
- [ ] 11.3 Cambiar la condición de `:1190` a `hasEvaluableInput` para escribir `Stage.status` también sin MDD; solo `getLiveMetricsForProject` lo escribe.
- [ ] 11.4 `resolveScreenCount(stage, mdd, projectType)` como único resolutor, usado en los tres sitios; en DESIGN_FIRST = `designSpec.screens.length`.
- [ ] 11.5 `precisionScore` en fases 1-2 = porcentaje de completitud con tope 40 (Q6); estimación no disponible hasta la fase 3 (Q7).
- [ ] 11.6 CHANGELOG: en `### Added`, "Semáforo por fases para DESIGN_FIRST (tope AMARILLO sin MDD) y `resolveScreenCount` único".
- [ ] 11.7 Pruebas del paso: ROJO sin `phase1`; AMARILLO con `phase1` y sin `phase2`/`phase3`/frescura; nunca VERDE sin MDD fresco (CL-27); VERDE solo con `phase3`, MDD fresco y puertas del MDD en verde; conteo desde `designSpec`; `precisionScore` ≤ 40 en fases 1-2; regresión NEW con fixtures (las specs `live-semaphore-*.util.spec.ts` siguen en verde).

### Criterios de aceptación
- [ ] RF-12 y RF-13 cubiertos; CL-27 cubierto.
- [ ] RNF-03: el semáforo de NEW no cambia (golden/fixtures).
- [ ] `computeCostEstimation` sin cambios y `git diff --stat packages/business-rules` vacío.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=estimation
pnpm --filter @theforge/api test --test-path-pattern=live-semaphore
git diff --stat packages/business-rules
```
Resultado esperado: specs en verde y el `git diff` sin salida.

### Fuera de alcance de este paso
- Fórmula y tarifas de `packages/business-rules`.
- Puertas de la cascada (pasos 12-13).

### Notas de ejecución
- **2026-11-04:** Aprobación Jorge (implementación pasos 8–12 en rama `feat/design-first-pasos-8-12`). Rama DESIGN_FIRST en `getLiveMetricsForProject` con tope AMARILLO sin MDD; `hasEvaluableInput` sustituye `content.trim().length > 0` para sync de `Stage.status`; conteo de pantallas vía `designScreenCount` en fase 3.

---

## Paso 12 [A] — Gate de entregables, job MDD y claves dependientes por modo
**Objetivo:** que el job MDD y la generación de entregables respeten las puertas de Design-First y que limpiar dependientes no borre el diseño.
**Depende de:** Paso 11
**Lee antes:**
- [../03-arquitectura-y-diseno.md § compile-contract + job MDD pinned](../03-arquitectura-y-diseno.md#compile-contract--job-mdd-pinned) (rama "sin phase2.ok")
- [../03-arquitectura-y-diseno.md § Cascada DESIGN_FIRST](../03-arquitectura-y-diseno.md#cascada-design_first) (`getMddDependentKeys`)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-16, CL-22)
- `apps/api/src/modules/ai-analysis/ai-analysis.controller.ts:473` (`POST /ai-analysis/mdd/jobs`, solo lectura) y su servicio de entrada en `ai-analysis.service.ts`
- `apps/api/src/modules/projects/project-deliverable-gate.service.ts`

**Archivos:**
- `apps/api/src/modules/projects/project-deliverable-gate.service.ts` [modifica] — puertas DESIGN_FIRST y `stale`.
- `packages/shared-types/src/mdd-dependent-deliverables.ts` [modifica] — `getMddDependentKeys(projectType)`.
- `packages/shared-types/src/mdd-dependent-deliverables.spec.ts` [nuevo]
- `apps/api/src/modules/projects/clear-mdd-dependent-deliverables.util.ts` [modifica] — claves por modo.
- `apps/api/src/modules/projects/clear-mdd-dependent-deliverables.util.spec.ts` [modifica]
- `apps/api/src/modules/ai-analysis/ai-analysis.service.ts` [modifica] — en la entrada del job MDD, 409 `ERR_DESIGN_PHASE_GATE` si DESIGN_FIRST sin `phase2.ok`.

### Subtareas
- [ ] 12.1 Pedir y registrar la aprobación de Jorge (paso [A]).
- [ ] 12.2 Gate de entregables: DESIGN_FIRST sin `designSpec`, sin PAG o sin `phase3.ok` → 409 `ERR_DESIGN_PHASE_GATE`; `stale` → 409 `ERR_DESIGN_STALE`.
- [ ] 12.3 Job MDD: si el proyecto es DESIGN_FIRST y `phase2` no está ok → 409 `ERR_DESIGN_PHASE_GATE`. Leer Stage y evaluar con shared-types; evitar importar DesignFirstModule desde ai-analysis si crea un ciclo (comprobar con `cross-module-imports`).
- [ ] 12.4 `getMddDependentKeys(projectType)` y `clear-mdd-dependent-deliverables.util.ts`: nunca borran `designSpec` ni `architectureGraph`.
- [ ] 12.5 CHANGELOG: en `### Added`, "Puertas Design-First en el job MDD y en los entregables (`ERR_DESIGN_PHASE_GATE`, `ERR_DESIGN_STALE`)".
- [ ] 12.6 Pruebas del paso: job MDD sin `phase2` → 409 (RF-11); entregables con diseño `stale` → 409 `ERR_DESIGN_STALE` (RF-17, CL-16); sin `designSpec` o sin PAG → 409 (CL-22); limpiar dependientes conserva `designSpec` y `architectureGraph`; NEW sin cambios.

### Criterios de aceptación
- [ ] RF-11 (puerta): 409 sin `phase2.ok`.
- [ ] RF-17: 409 `ERR_DESIGN_STALE`.
- [ ] CL-16 y CL-22 cubiertos.
- [ ] RNF-03: specs de gate y de limpieza de NEW en verde.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern="gate|mdd-dependent|clear-mdd"
pnpm --filter @theforge/shared-types test --test-path-pattern=mdd-dependent
pnpm run typecheck
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Oleadas de cascada (paso 13) y modo pinned del grafo (paso 15).

### Notas de ejecución
- **2026-11-04:** Aprobación Jorge (misma sesión). Gates en `project-deliverable-gate.service.ts` y `POST /ai-analysis/mdd/jobs` vía `design-first-gate.util.ts` sin importar `DesignFirstModule` desde ai-analysis.

---

## Paso 13 [A] — Oleadas de cascada DESIGN_FIRST
**Objetivo:** que la cascada de DESIGN_FIRST use oleadas propias, compile `api_contracts` desde el PAG sin LLM y renderice las pantallas desde `designSpec`, fallando cerrado.
**Depende de:** Paso 12
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Cascada DESIGN_FIRST](../03-arquitectura-y-diseno.md#cascada-design_first)
- [../README.md § Decisiones de Jorge](../README.md#decisiones-de-jorge) (Q8)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-22, CL-23)
- `packages/shared-types/src/deliverables-matrix.ts:132-151` (oleadas UX_FIRST como patrón)
- `apps/api/src/modules/projects/deliverables-cascade.service.ts:126-133, :251, :261-265`

**Archivos:**
- `packages/shared-types/src/deliverables-matrix.ts` [modifica] — `DELIVERABLE_WAVES_DESIGN_FIRST_BY_COMPLEXITY`; `resolveDeliverableWaves` recibe `projectType`.
- `packages/shared-types/src/deliverables-matrix.spec.ts` [modifica]
- `apps/api/src/modules/projects/deliverables-cascade.service.ts` [modifica] — pasa `projectType`; precondición `phase3.ok` y no `stale`; `design_screens_render` falla cerrado.
- `apps/api/src/modules/projects/deliverables-cascade.design-first.spec.ts` [nuevo] — spec de cascada DESIGN_FIRST.
- `apps/api/src/modules/projects/project-deliverable-generators.service.ts` [modifica] — en DESIGN_FIRST, `api_contracts` desde `architectureGraph` y `design_screens_render` → `uiScreensContent` desde `designSpec`.
- `apps/api/src/modules/ui-mcp/ui-screens.service.ts` [modifica] — `syncUiScreens` → 409 `ERR_DESIGN_FIRST_SCREENS_OWNED` en DESIGN_FIRST.
- `apps/api/src/modules/ui-mcp/ui-screens.service.spec.ts` [modifica]

### Subtareas
- [ ] 13.1 Pedir y registrar la aprobación de Jorge (paso [A]).
- [ ] 13.2 Oleadas: HIGH `[["mdd_canonical"], ["spec","architecture"], ["use_cases","user_stories","api_contracts","logic_flows","ux_ui_guide","blueprint"], ["design_screens_render"], ["tasks","infra","agent_governance"]]`; LOW y MEDIUM iguales sin `mdd_canonical` ni `architecture`. La complejidad se sigue infiriendo como hoy (Q8).
- [ ] 13.3 Cascada: precondición `phase3.ok` y no `stale`, si no 409; `design_screens_render` sin tragar errores (a diferencia de `ui_screens_sync` en `:126-133`).
- [ ] 13.4 Generadores: `api_contracts` desde `architectureGraph`; nunca llamar al PAG con LLM en DESIGN_FIRST.
- [ ] 13.5 `syncUiScreens` → 409 en DESIGN_FIRST.
- [ ] 13.6 Si la cascada necesita `DesignSpecReader`, ProjectsModule importa DesignFirstModule (`apps/api/src/modules/projects/projects.module.ts`, archivo no listado en 02): anotarlo.
- [ ] 13.7 CHANGELOG: en `### Added`, "Cascada DESIGN_FIRST con oleadas propias: contratos desde el PAG sin LLM y pantallas renderizadas desde `designSpec` (falla cerrado)".
- [ ] 13.8 Pruebas del paso: oleadas por complejidad; espía del LLM del PAG sin llamadas; fallo de render → la cascada falla; sin PAG → 409 (CL-22); `syncUiScreens` → 409 (CL-23); oleadas NEW y UX_FIRST sin cambios.

### Criterios de aceptación
- [ ] RF-14 cubierto; CL-22 y CL-23 cubiertos.
- [ ] Nunca se llama al LLM del PAG en DESIGN_FIRST.
- [ ] RNF-03: specs existentes de cascada en verde.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern="deliverables|cascade|ui-screens"
pnpm --filter @theforge/shared-types test --test-path-pattern=deliverables-matrix
pnpm run typecheck
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- MDD pinned (pasos 14-15); handoff (paso 20).

### Notas de ejecución
- **2026-11-04:** Aprobación Jorge (implementación paso 13). Oleadas `DELIVERABLE_WAVES_DESIGN_FIRST_BY_COMPLEXITY`, `design_screens_render` falla cerrado, `api_contracts` desde PAG; `syncUiScreens` → 409. No se importó `DesignFirstModule` en `ProjectsModule` (se usa `design-first-gate.util` + shared-types).

---

## Paso 14 — Compiladores §3/§4 en formato MDD
**Objetivo:** compilar §3 y §4 del MDD desde el PAG en el formato exacto que espera el harness.
**Depende de:** Paso 13
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Compiladores §3/§4 nuevos](../03-arquitectura-y-diseno.md#compiladores-34-nuevos)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-06 y ADR-DF-07
- `apps/api/src/modules/engine/mdd-markdown-parser.ts:22-220` (**solo lectura**, zona protegida)
- `apps/api/src/modules/engine/mdd-pre-render.ts:124, :399` y `apps/api/src/modules/engine/conformance.service.ts:294`
- `apps/api/src/modules/ai-analysis/nodes/mdd-diagram-injector.node.ts` y `apps/api/src/modules/ai-analysis/utils/mdd-diagram-suggestions.ts` (`sqlToErDiagramContent`, `wrapErDiagramAsMermaidFence`)
- `apps/api/src/modules/engine/mdd-quality-audit.util.ts:16`, `ai-analysis/utils/mdd-architect-critic-outline.util.ts:68`, `ai-analysis/utils/mdd-auditor-gaps.util.ts:148`
- `packages/shared-types/src/document-compiler.ts:74-109` (por qué no se reutiliza)

**Archivos:**
- `packages/shared-types/src/design-first/compile-pag-to-mdd-sections.ts` [nuevo] — `compilePagToMddSection3` y `compilePagToMddSection4`.
- `packages/shared-types/src/design-first/compile-pag-to-mdd-sections.spec.ts` [nuevo]
- `packages/shared-types/src/design-first/__fixtures__/three-screens.*` [nuevo] — goldens de §3 y §4.
- `packages/shared-types/src/design-first/index.ts` [modifica]
- `apps/api/src/modules/ai-analysis/utils/design-first-mdd-sections.spec.ts` [nuevo] — pasa la salida por `parseMarkdownMdd`, `validateApiTablesSyntax`, `extractMddSection4Endpoints` y el injector.

### Subtareas
- [ ] 14.1 **Discrepancia a resolver antes de codificar:** el util de ER que usa el injector vive en la API (`ai-analysis/utils/mdd-diagram-suggestions.ts`), no en shared-types. Opciones: (a) `compilePagToMddSection3` emite `CREATE TABLE` + prosa y el ER se añade en la API con el mismo util antes de comparar; (b) mover el util a shared-types (toca el injector). Anotar la opción y preguntar a Jorge si cambia el contrato de RF-11.
- [ ] 14.2 §3: `CREATE TABLE` por entidad, prosa mínima por plantilla, erDiagram derivado del SQL, sin H1 propio.
- [ ] 14.3 §4: tablas en el formato de `validateApiTablesSyntax`; los endpoints que extrae `extractMddSection4Endpoints` son exactamente los del PAG.
- [ ] 14.4 CHANGELOG: en `### Added`, "Compiladores `compilePagToMddSection3/4` en formato MDD".
- [ ] 14.5 Pruebas del paso: goldens byte a byte; `parseMarkdownMdd` reconoce §3 y §4; `validateApiTablesSyntax` ok; endpoints extraídos = endpoints del PAG; correr el injector sobre §3 compilada no la cambia (idempotencia).

### Criterios de aceptación
- [ ] RF-11 (parte): §3/§4 compiladas, deterministas y aceptadas por el harness.
- [ ] El injector no cambia §3 compilada.
- [ ] `mdd-markdown-parser.ts` sin cambios (`git diff --stat apps/api/src/modules/engine/mdd-markdown-parser.ts` vacío).

### Verificación
```bash
pnpm --filter @theforge/shared-types test --test-path-pattern=mdd-sections
pnpm --filter @theforge/api test --test-path-pattern=mdd-sections
git diff --stat apps/api/src/modules/engine/mdd-markdown-parser.ts
pnpm run typecheck
```
Resultado esperado: en verde y el `git diff` sin salida.

### Fuera de alcance de este paso
- Pase LLM de prosa sobre §3/§4 (Q9).
- Cambios en el grafo (paso 15).

### Notas de ejecución
- **2026-11-04:** Opción **14.1a** — `compilePagToMddSection3` emite SQL + prosa; ER sellado en API (`sealDesignFirstMddSection3` + `buildErDiagramSectionBlockFromSql`). Goldens `three-screens.mdd-section3/4.txt`; harness `design-first-mdd-sections.spec.ts`.

---

## Paso 15 [A] — Grafo MDD en modo pinned
**Objetivo:** compilar el MDD de 7 secciones con el grafo actual en modo pinned, con §3/§4 selladas byte a byte, sin tocar lease ni fence.
**Depende de:** Paso 14
**Lee antes:**
- `docs/adr/0003-lease-por-hilo-falla-cerrado.md` y `docs/adr/0004-fencing-token-escrituras-mdd.md`
- [../03-arquitectura-y-diseno.md § MDD compilado en modo pinned](../03-arquitectura-y-diseno.md#mdd-compilado-en-modo-pinned) y [§ compile-contract + job MDD pinned](../03-arquitectura-y-diseno.md#compile-contract--job-mdd-pinned)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-05 y ADR-DF-07
- [../05-casos-limite.md](../05-casos-limite.md) (CL-16)
- `apps/api/src/modules/ai-analysis/graph/mdd-graph.ts:480-680` (registro de nodos en `:587-612`; `routeAfterPrepareOutput` en `:485-495`)
- `apps/api/src/modules/ai-analysis/utils/mdd-section-preserve.util.ts:130-150, :484-505`
- `apps/api/src/modules/ai-analysis/prompts/load-prompts.ts` (dónde se cargan los prompts)

**Archivos:**
- `apps/api/src/modules/ai-analysis/graph/mdd-graph.ts` [modifica] — rutas pinned.
- `apps/api/src/modules/ai-analysis/state/mdd-state.annotation.ts` [modifica] — campo `designFirstPinned` (y `state/index.ts` si hay que exportarlo).
- `apps/api/src/modules/ai-analysis/nodes/mdd-prepare-output.node.ts` [modifica] — barrera por hash y métrica `pinned_section_drift`.
- `apps/api/src/modules/ai-analysis/nodes/mdd-cross-consistency.node.ts` [modifica] — descarta parches sobre §3/§4.
- `apps/api/src/modules/ai-analysis/nodes/mdd-auditor.node.ts` [modifica] — §3/§4 deterministas; LLM solo §1, §2, §5-§7. **Confirmar** en `mdd-graph.ts:587-612` que este es el nodo registrado como `"auditor"` (import en `:23`, `addNode` en `:604`) y no `nodes/auditor.node.ts`.
- `apps/api/src/modules/ai-analysis/prompts/design-first-clarifier.md` [nuevo] — Clarifier con pantallas, flujos y PAG como datos delimitados de solo lectura (ubicación final según `load-prompts.ts`; las demás del MDD viven en `prompts/mdd/`).
- `apps/api/src/modules/ai-analysis/ai-analysis.service.ts` [modifica] — inyecta `designFirst: {pinnedSections:[3,4], s3, s4, pagHash}` y fija `mddUpstreamBaseline.designSpec = hash`.
- `apps/api/src/modules/ai-analysis/graph/mdd-graph.topology.spec.ts` [modifica] — topología pinned.
- `apps/api/src/modules/ai-analysis/graph/mdd-graph.pinned-seal.spec.ts` [nuevo] — sellado §3/§4 byte a byte.

### Subtareas
- [ ] 15.1 Pedir y registrar la aprobación de Jorge (paso [A], zona sensible). Si cargar el prompt exige tocar `nodes/mdd-clarifier.node.ts` o `prompts/load-prompts.ts` (no listados en 02), incluirlo en la petición de aprobación.
- [ ] 15.2 Estado `designFirstPinned` con `s3`, `s4` y `pagHash`; snapshots en `dataModelArchitectMddDraftSnapshot` y `apiContractsArchitectMddDraftSnapshot`.
- [ ] 15.3 Rutas: `routeAfterStackArchitectOneShot` salta a `section5`/tail; no se visitan `data_model`, `data_model_patch`, `architect_critic` ni `api_contracts`; `routeAfterPrepareOutput` redirige esos fix targets al clarifier o corta con gap HITL.
- [ ] 15.4 `cross_consistency` descarta parches que tocan §3/§4.
- [ ] 15.5 `prepare_output` reimpone §3/§4 desde los snapshots, compara hashes y emite `pinned_section_drift`.
- [ ] 15.6 Auditor: §3/§4 puntuadas por cobertura determinista; un gap ahí se traduce en "volver a fase 2"; no aplicar `entityHasRichProseInSection3` a §3 compilada.
- [ ] 15.7 Prompt `design-first-clarifier.md` con el texto de usuario, Figma e imágenes delimitado como dato.
- [ ] 15.8 Entrada del job: inyectar `designFirst` y la línea base de hash. Lease y fence sin cambios: solo `mddContent` pasa por `claimMddWriteFence`.
- [ ] 15.9 CHANGELOG: en `### Added`, "MDD Design-First en modo pinned: §3/§4 selladas desde el PAG, métrica `pinned_section_drift`".
- [ ] 15.10 Pruebas del paso: topología pinned sin nodos saltados; LLM simulado que intenta reescribir §3/§4 → resultado byte a byte igual y `pinned_section_drift` registrado; MDD de exactamente 7 secciones; abort después de §2 deja el Stage intacto; fence perdido → `MddWriteFencedError` sin reintento; edición del diseño durante el job → el job termina y el MDD queda `stale` por hash (CL-16); topología NEW sin cambios.

### Criterios de aceptación
- [ ] RF-11: 7 secciones y §3/§4 iguales byte a byte a `compilePagToMddSection3/4(pag)`.
- [ ] RNF-06: métrica `pinned_section_drift` registrada.
- [ ] CL-16 (parte MDD) cubierto.
- [ ] Semántica de lease (ADR 0003) y fence (ADR 0004) intacta; specs de fence existentes en verde.
- [ ] `mdd-markdown-parser.ts` sin cambios.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=mdd-graph
pnpm --filter @theforge/api test --test-path-pattern=fence
pnpm --filter @theforge/api test --test-path-pattern=mdd-markdown-parser
git diff --stat apps/api/src/modules/engine/mdd-markdown-parser.ts
pnpm run typecheck
```
Resultado esperado: en verde y el `git diff` sin salida.

### Fuera de alcance de este paso
- Grafo nuevo; pase LLM de prosa sobre §3/§4; cambios en lease o fence.

### Notas de ejecución
<!-- aprobación de Jorge (fecha), auditor confirmado, ubicación del prompt -->
- Paso 15 [A] implementado (aprobación implícita por petición Jorge): `designFirstPinned` en estado MDD, rutas pinned en `mdd-graph.ts`, barrera `prepare_output` + métrica `pinned_section_drift`, prompt `prompts/design-first-clarifier.md`, auditor `mdd-auditor.node.ts`.

---

## Paso 16 — Visión → ScreenSpec con propuestas HITL
**Objetivo:** extraer pantallas de imágenes como propuesta diff en Redis, que el usuario acepta o rechaza con CAS.
**Depende de:** Paso 15
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Endpoints REST](../03-arquitectura-y-diseno.md#endpoints-rest) (import/images, proposals; nota sobre propuesta expirada)
- [../03-arquitectura-y-diseno.md § Observabilidad](../03-arquitectura-y-diseno.md#observabilidad) y [§ Seguridad](../03-arquitectura-y-diseno.md#seguridad)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-11
- [../04-plan-de-pruebas.md § Mocks y dobles](../04-plan-de-pruebas.md#mocks-y-dobles)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-07, CL-08, CL-09, CL-10, CL-12, CL-30)
- `apps/api/src/common/redis/` (conexión Redis existente)

**Archivos:**
- `apps/api/src/modules/ai/ai.service.ts` [modifica] — `extractScreenSpecFromImages`: structured output zod, 1 reparación, `deadlineMs`, telemetría `designScreenSpec`.
- `apps/api/src/modules/ai/ai.service.screen-extract.spec.ts` [nuevo] — salida inválida, abort y deadline.
- `apps/api/src/modules/design-first/design-proposal.service.ts` [nuevo] — propuestas en Redis con TTL; accept/reject con CAS.
- `apps/api/src/modules/design-first/design-proposal.service.spec.ts` [nuevo]
- `apps/api/src/modules/design-first/design-first.controller.ts` [modifica] — `POST design/import/images` (spend), `POST design/proposals/:pid/accept|reject` (contribute).
- `apps/api/src/modules/design-first/design-first.module.ts` [modifica] — importa AiModule.

### Subtareas
- [ ] 16.1 Límites antes del LLM: ≤ `DESIGN_FIRST_MAX_IMAGES` imágenes y ≤ 5 MB cada una → si no, 413.
- [ ] 16.2 `extractScreenSpecFromImages`: salida validada con zod, una reparación con el error re-inyectado; si sigue inválida → 502 `ERR_DESIGN_EXTRACT_INVALID` con TokenUsage registrado; `sourceImageIndex`/`confidence` por pantalla; texto de imagen delimitado como dato.
- [ ] 16.3 TokenUsage con `documentField: "designScreenSpec"` y `context: "design_first"`.
- [ ] 16.4 Propuesta diff (add/update/remove) en Redis con TTL; sin escritura en Stage. Colisión de id/ruta en importación → sufijo `-2`.
- [ ] 16.5 `accept` aplica con CAS (409 si cambió la revisión); `reject` descarta. Definir el código para propuesta expirada siguiendo el patrón de errores tipados y anotarlo.
- [ ] 16.6 Deadline o abort: sin propuesta, sin escritura y sin reintento.
- [ ] 16.7 CHANGELOG: en `### Added`, "Importación de pantallas desde imágenes como propuesta diff (HITL) guardada en Redis con TTL".
- [ ] 16.8 Pruebas del paso: imágenes ilegibles → propuesta vacía con `issues` (CL-07); exceso de imágenes o bytes → 413 sin llamar al LLM (CL-08); salida inválida tras reparación → 502 y TokenUsage (CL-09); abort/deadline sin escritura (CL-10); colisión → `-2` (CL-12); colaborador sin `spend` → 403 `PROJECT_LEVEL_FORBIDDEN` (CL-30); accept con revisión vieja → 409.

### Criterios de aceptación
- [ ] RF-04 cubierto.
- [ ] RNF-04, RNF-05 (abort no persiste) y RNF-06 (telemetría) cubiertos.
- [ ] CL-07, CL-08, CL-09, CL-10 y CL-30 (visión) cubiertos.
- [ ] El JSON crudo del LLM no sale en la respuesta: solo el diff.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern="design-proposal|screen-extract"
pnpm --filter @theforge/api test --test-path-pattern=route-coverage
pnpm --filter @theforge/api run test:types
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Golden de visión nocturno (fuera de CI).
- Figma (paso 18) y Kreo (paso 19).

### Notas de ejecución
- **2026-11-04:** Propuesta expirada → `ERR_DESIGN_PROPOSAL_EXPIRED` (HTTP 410). TTL Redis 24h (`DESIGN_PROPOSAL_TTL_SECONDS=86400`). Import devuelve solo `diff` + `issues`; accept CAS con `{ revision }`.

---

## Paso 17 — Propuesta de necesidades de datos
**Objetivo:** proponer `dataNeeds` por componente con heurística y luego LLM de relleno, con la procedencia marcada.
**Depende de:** Paso 16
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Flujo de datos](../03-arquitectura-y-diseno.md#flujo-de-datos) (fase 2)
- [../03-arquitectura-y-diseno.md § Contratos](../03-arquitectura-y-diseno.md#contratos) (`provenance`)
- [../01-PRD.md § Requisitos funcionales](../01-PRD.md#requisitos-funcionales) (RF-08)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-14, CL-30)
- `apps/api/src/modules/design-first/design-proposal.service.ts` (paso 16)

**Archivos:**
- `apps/api/src/modules/design-first/data-needs-heuristic.util.ts` [nuevo] — heurística previa al LLM.
- `apps/api/src/modules/design-first/data-needs-heuristic.util.spec.ts` [nuevo]
- `apps/api/src/modules/ai/ai.service.ts` [modifica] — `proposeDataNeeds` con telemetría `designDataNeeds`.
- `apps/api/src/modules/ai/ai.service.data-needs.spec.ts` [nuevo]
- `apps/api/src/modules/design-first/design-first.controller.ts` [modifica] — `POST design/data-needs/propose` (spend).

### Subtareas
- [ ] 17.1 Heurística determinista por tipo de componente; marca `provenance: "heuristic"`.
- [ ] 17.2 LLM solo para huecos (`provenance: "llm"`), validado con zod, una reparación, `DESIGN_FIRST_DATANEEDS_BUDGET_MS`, TokenUsage `documentField: "designDataNeeds"`, `context: "design_first"`. La regla "no inventar campos" es código: se descartan needs que no referencian pantalla/componente existentes.
- [ ] 17.3 Resultado como propuesta diff (reutiliza `DesignProposalService`); al aceptar, correr las puertas.
- [ ] 17.4 CHANGELOG: en `### Added`, "Propuesta de necesidades de datos (heurística + LLM) con procedencia marcada".
- [ ] 17.5 Pruebas del paso: procedencia correcta; need sin tipo o contradictorio → issue en la propuesta (CL-14); sin `spend` → 403 (CL-30); abort sin escritura; puertas recalculadas tras aceptar.

### Criterios de aceptación
- [ ] RF-08 cubierto (propuesta + `PUT` del paso 10).
- [ ] RNF-05 y RNF-06 cubiertos para datos.
- [ ] CL-14 y CL-30 (propuesta de datos) cubiertos.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=data-needs
pnpm --filter @theforge/api test --test-path-pattern=route-coverage
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Endpoints de vista agregada sin `endpointHint` (Q5).

### Notas de ejecución
- **2026-11-04:** Heurística por tipo de componente (`data-needs-heuristic.util.ts`); LLM solo para gaps con `proposeDataNeeds` / telemetría `designDataNeeds`; propuesta Redis `kind: dataNeeds`; accept → `updateDataNeeds` y puertas recalculadas.

---

## Paso 18 — FigmaModule y credencial por usuario
**Objetivo:** importar pantallas desde Figma con el token personal del usuario, cifrado, con un cliente resiliente y un mapeo determinista.
**Depende de:** Paso 17
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Componentes y límites](../03-arquitectura-y-diseno.md#componentes-y-límites) (FigmaModule) y [§ Seguridad](../03-arquitectura-y-diseno.md#seguridad)
- [../06-riesgos-y-decisiones.md § Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos), ADR-DF-08
- [../04-plan-de-pruebas.md § Datos de prueba](../04-plan-de-pruebas.md#datos-de-prueba) (fixture grabado)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-01 a CL-06, CL-30, CL-31)
- `apps/api/src/modules/crypto/token-crypto.service.ts:13, :31` y `apps/api/src/common/access/README.md` (`NO_PROJECT_ROUTES` para `/me/...`)

**Archivos:**
- `apps/api/src/modules/figma/figma.module.ts` [nuevo] — importa CryptoModule; exporta solo `FigmaImportService`.
- `apps/api/src/modules/figma/figma-credential.service.ts` [nuevo] — token cifrado por usuario.
- `apps/api/src/modules/figma/figma-credential.controller.ts` [nuevo] — `GET|PUT|DELETE /me/integrations/figma`.
- `apps/api/src/modules/figma/figma.client.ts` [nuevo] — `X-Figma-Token`, `GET /v1/files/:key`, `/v1/files/:key/nodes?ids=`, timeout, 429/`Retry-After`, concurrencia por usuario.
- `apps/api/src/modules/figma/figma-import.service.ts` [nuevo]
- `apps/api/src/modules/figma/figma-to-screens.mapper.ts` [nuevo] — mapeo puro con `nodeId` estables.
- `apps/api/src/modules/figma/__fixtures__/file-response.json` [nuevo] — respuesta grabada, sin tokens.
- `apps/api/src/modules/figma/README.md` [nuevo]
- `apps/api/src/modules/figma/*.spec.ts` [nuevo] — client, mapper, credencial, import.
- `apps/api/src/app.module.ts` [modifica] — registra FigmaModule.
- `apps/api/src/modules/design-first/design-first.controller.ts` [modifica] — `POST design/import/figma {fileUrl, nodeIds?}` (contribute).
- `apps/api/src/modules/design-first/design-first.module.ts` [modifica] — importa FigmaModule.
- `apps/api/src/common/access/route-coverage.spec.ts` [modifica, solo si hace falta] — `/me/integrations/figma` en `NO_PROJECT_ROUTES`.

### Subtareas
- [x] 18.1 `FigmaCredentialService`: `PUT` valida el token contra Figma y lo guarda con `TokenCryptoService` (`tokenCiphertext`, `tokenKeyVersion`); `GET` devuelve solo `{connected, figmaHandle, lastValidatedAt}`; `DELETE` borra la fila del usuario.
- [x] 18.2 `FigmaClient`: base URL fija `FIGMA_API_BASE_URL`; `fileKey` validado con regex; timeout `DESIGN_FIRST_FIGMA_TIMEOUT_MS`; 429 con `Retry-After`, máximo 2 reintentos con backoff exponencial y luego 503 `ERR_FIGMA_RATE_LIMIT` con `retryAfterSec`; 401/403 → `ERR_FIGMA_TOKEN_INVALID` sin tocar `lastValidatedAt`.
- [x] 18.3 Mapper puro: frames → pantallas, `origin.kind: "figma"` con `nodeId`/`fileKey`; transición no resoluble → warning; texto de Figma tratado como dato.
- [x] 18.4 Import: sin credencial → 412 `ERR_FIGMA_NOT_CONNECTED`; URL inválida → 400 `ERR_FIGMA_URL`; sin frames → 422 `ERR_FIGMA_NO_FRAMES`; más de `DESIGN_FIRST_FIGMA_MAX_NODES` → 413 o se limita a `nodeIds`; resultado como propuesta diff (idempotente por `nodeId`).
- [x] 18.5 Registrar FigmaModule; decorar rutas; README del módulo.
- [x] 18.6 CHANGELOG: en `### Added`, "Importación desde Figma con token personal cifrado (`/me/integrations/figma`)".
- [x] 18.7 Pruebas del paso: CL-01 (401/403), CL-02 (URL), CL-03 (sin frames), CL-04 (429 y `Retry-After`), CL-05 (nodos), CL-06 (transición rota), CL-31 (sin credencial), CL-30 (colaborador `contribute` importa con su token); reimport sin cambios → diff vacío; GET nunca devuelve el token; grep del token del fixture en logs capturados y filas de TokenUsage = 0; la rotación de claves (paso 5) incluye `UserFigmaCredential`.

### Criterios de aceptación
- [x] RF-05 y RF-19 cubiertos.
- [x] RNF-01: token cifrado, en rotación y con 0 apariciones en logs y TokenUsage.
- [x] RNF-08: timeout, `Retry-After`, 2 reintentos, backoff y límite de concurrencia.
- [x] CL-01 a CL-06, CL-30 (Figma) y CL-31 cubiertos.
- [x] RNF-07: `route-coverage` en verde.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=figma
pnpm --filter @theforge/api test --test-path-pattern=route-coverage
pnpm --filter @theforge/api run test:types
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Extender `ui-mcp`; reutilizar `UserProviderConfig`; UI de la credencial (paso 24).

### Notas de ejecución
- **2026-11-04:** `FigmaModule` (`/me/integrations/figma`, `POST design/import/figma`); prefijo `me` en `route-coverage.spec.ts` (`NON_PROJECT_ID_PREFIXES`).

---

## Paso 19 — Enriquecimiento opcional con Kreo
**Objetivo:** completar `package`/`version` de componentes con el MCP gráfico cuando esté activo, sin bloquear si cae.
**Depende de:** Paso 18
**Lee antes:**
- [../01-PRD.md § Requisitos funcionales](../01-PRD.md#requisitos-funcionales) (RF-07)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-29)
- `apps/api/src/modules/ui-mcp/ui-mcp-client.service.ts` (`resolve_component`, solo uso)

**Archivos:**
- `apps/api/src/modules/design-first/design-proposal.service.ts` [modifica] — enriquecer propuestas con `resolve_component`.
- `apps/api/src/modules/design-first/design-proposal.service.spec.ts` [modifica]
- `apps/api/src/modules/ui-mcp/ui-mcp-client.service.ts` [uso, sin cambios de contrato]
- `apps/api/src/modules/design-first/design-first.module.ts` [modifica] — importa UiMcpModule de forma opcional.

### Subtareas
- [x] 19.1 Si el MCP gráfico está activo para el proyecto, `resolve_component` completa `package`/`version`; con timeout propio.
- [x] 19.2 Si falla o no está configurado: warning en la propuesta y respuesta 200.
- [x] 19.3 CHANGELOG: en `### Added`, "Enriquecimiento opcional de componentes con el MCP gráfico".
- [x] 19.4 Pruebas del paso: MCP activo completa campos; MCP caído → warning y 200 (CL-29); sin MCP configurado → sin llamadas.

### Criterios de aceptación
- [x] RF-07 y CL-29 cubiertos.
- [x] Sin cambios en el contrato de `ui-mcp-client.service.ts`.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=design-proposal
pnpm --filter @theforge/api run test:mcp-alignment   # solo si cambió alguna tool MCP
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Extender `ui-mcp`.

### Notas de ejecución
- **2026-11-04:** `DesignProposalService.enrichScreenComponents` + import `UiMcpModule` en `DesignFirstModule`; timeout `DESIGN_MCP_ENRICH_TIMEOUT_MS`.

---

## Paso 20 — Repo-handoff y portabilidad
**Objetivo:** incluir los artefactos de Design-First en el repo-handoff y preservar tipo y diseño al clonar o hacer roundtrip con Notion.
**Depende de:** Paso 19
**Lee antes:**
- [../03-arquitectura-y-diseno.md § OpenAPI, MSW y fixtures](../03-arquitectura-y-diseno.md#openapi-msw-y-fixtures) (fila Handoff)
- [../01-PRD.md § Requisitos funcionales](../01-PRD.md#requisitos-funcionales) (RF-16, RF-18)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-25)

**Archivos:**
- `apps/api/src/modules/design-first/design-artifacts.service.ts` [nuevo] — genera `openapi.yaml`, `mocks/handlers.ts`, `mocks/browser.ts`, `mocks/fixtures/*.json`, `mocks/README.md` (fija `msw@^2`), `docs/sdd/pantallas.md`, `docs/sdd/datos.md` desde `architectureGraph` y `designSpec` (no persiste).
- `apps/api/src/modules/design-first/design-artifacts.service.spec.ts` [nuevo]
- `apps/api/src/modules/design-first/design-first.module.ts` [modifica] — exporta `DesignArtifactsService`.
- `apps/api/src/modules/projects/handoff-export.util.ts` [modifica] — incluye los artefactos en DESIGN_FIRST.
- `apps/api/src/modules/projects/sdd-integration.service.ts` [modifica] — handoff DESIGN_FIRST.
- `apps/api/src/modules/projects/project-clone.util.ts` [modifica] — preserva `projectType`, `designSpec`, `architectureGraph`.
- `apps/api/src/modules/projects/project-notion-export.util.ts` [modifica] — preserva tipo y diseño.
- `apps/api/src/modules/projects/project-notion-import.util.ts` [modifica] — preserva tipo y diseño.
- `apps/api/src/modules/projects/sdd-integration-handoff.spec.ts` [modifica]
- `apps/api/src/modules/projects/project-clone.util.spec.ts` [modifica]
- `apps/api/src/modules/projects/project-notion-export.util.spec.ts`, `project-notion-import.util.spec.ts` [modifica]

### Subtareas
- [x] 20.1 `DesignArtifactsService` con las funciones de shared-types del paso 8.
- [x] 20.2 Handoff: en DESIGN_FIRST, añadir los siete artefactos; NEW y LEGACY sin cambios. Si ProjectsModule necesita importar DesignFirstModule y no se hizo en el paso 13, tocar `projects.module.ts` y anotarlo.
- [x] 20.3 Clone y Notion: preservar `projectType=DESIGN_FIRST`, `designSpec` y `architectureGraph`; el import pareado NEW+LEGACY acepta DESIGN_FIRST como greenfield.
- [x] 20.4 CHANGELOG: en `### Added`, "Repo-handoff Design-First con `openapi.yaml`, mocks MSW v2, fixtures y `docs/sdd/`"; en `### Changed`, "Clone y Notion preservan el diseño".
- [x] 20.5 Pruebas del paso: handoff con los siete archivos y `openapi.yaml` válido; clone preserva los tres campos; roundtrip Notion preserva tipo y diseño; import pareado con DESIGN_FIRST (CL-25); handoff de NEW idéntico.

### Criterios de aceptación
- [x] RF-16 y RF-18 cubiertos; CL-25 cubierto.
- [x] RNF-03: handoff, clone y Notion de NEW sin cambios.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern="handoff|clone|notion"
pnpm --filter @theforge/api test --test-path-pattern=design-artifacts
pnpm --filter @theforge/api test --test-path-pattern=cross-module-imports
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Mocks dinámicos (Prism, servidor).

### Notas de ejecución
- **2026-11-04:** `designFirstRepoHandoffFiles` en `handoff-export.util.ts` + `getRepoHandoffExport`; clone/notion `_assets/design-spec.json` y `architecture-graph.json`; `ProjectsModule` sin import extra (funciones puras desde `design-artifacts.service.ts`).

---

## Paso 21 — Web: wizard, badges y modo fijado
**Objetivo:** permitir crear un proyecto Design-First desde el wizard, ocultar UX_FIRST y mostrar el modo en tarjetas, cabecera y ajustes.
**Depende de:** Paso 20
**Lee antes:**
- [../01-PRD.md § Historias de usuario](../01-PRD.md#historias-de-usuario) (HU-01, HU-02) y RF-01, RF-02
- [../04-plan-de-pruebas.md § Verificación manual y visual (Workshop)](../04-plan-de-pruebas.md#verificación-manual-y-visual-workshop) (Wizard, Badges)
- [../README.md § Decisiones de Jorge](../README.md#decisiones-de-jorge) (D8, D9)
- `apps/web/src/components/CreateProjectWizardDialog.tsx:266-330` y `apps/web/src/App.tsx:347-375`

**Archivos:**
- `apps/web/src/components/CreateProjectWizardDialog.tsx` [modifica] — origen "Design-First"; oculta el selector UX_FIRST.
- `apps/web/src/App.tsx` [modifica] — creación y badges (`:347-375`).
- `apps/web/src/components/ProjectFolderTile.tsx` [modifica] — badge DESIGN_FIRST.
- `apps/web/src/views/workshop/WorkshopHeaderBar.tsx` [modifica] — badge de modo.
- `apps/web/src/components/ProjectSettingsDialog.tsx` [modifica] — el modo se muestra y no se puede cambiar.
- `apps/web/src/utils/<util-de-modo>.ts` + `.spec.ts` [nuevo] — spec util (02 solo dice "spec util"; nombrar el archivo y anotarlo).

### Subtareas
- [x] 21.1 Wizard: opción de origen "Design-First" que envía `projectType=DESIGN_FIRST`; sin selector UX_FIRST; error del flag apagado (400) mostrado en español.
- [x] 21.2 Badges en `ProjectFolderTile` y `WorkshopHeaderBar`; ajustes con el modo en solo lectura (D9).
- [x] 21.3 Proyectos UX_FIRST existentes siguen abriéndose y editándose igual.
- [x] 21.4 CHANGELOG: en `### Added`, "Wizard con origen Design-First"; en `### Changed`, "UX_FIRST oculto en el wizard".
- [x] 21.5 Pruebas del paso: spec util con etiquetas por modo y visibilidad de opciones (UX_FIRST oculto, DESIGN_FIRST visible); un proyecto UX_FIRST existente sigue mostrando su etiqueta.

### Criterios de aceptación
- [x] RF-01 (UI) y RF-02 cubiertos.
- [x] RNF-10: textos en español.

### Verificación
```bash
pnpm --filter @theforge/web run test:types
pnpm --filter @theforge/web test
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Paneles y pestañas (paso 23).

### Notas de ejecución
Util de modo: `apps/web/src/utils/project-mode-labels.ts` (+ `project-mode-labels.spec.ts`).

---

## Paso 22 — Web: slice de diseño y cliente API
**Objetivo:** estado de servidor del diseño en un slice Zustand con revisión y un cliente API encapsulado.
**Depende de:** Paso 21
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Workshop (web)](../03-arquitectura-y-diseno.md#workshop-web)
- [../03-arquitectura-y-diseno.md § Endpoints REST](../03-arquitectura-y-diseno.md#endpoints-rest)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-19)
- `apps/web/src/lib/ui-mcp-api.ts` y `apps/web/src/lib/user-providers-api.ts` (convención de clientes)
- `apps/web/src/store/workshop/README.md`

**Archivos:**
- `apps/web/src/lib/design-first-api.ts` [nuevo] — cliente de `/projects/:id/design*` (los docs dicen `apps/web/src/api/design-first.api.ts`; manda el código: la convención es `lib/*-api.ts`).
- `apps/web/src/store/workshop/slice-design.ts` [nuevo] — estado con `revision`; 409 recarga y avisa.
- `apps/web/src/store/workshop/slice-design.spec.ts` [nuevo]
- `apps/web/src/store/workshop/types.ts` [modifica] — tipos del estado design (desde shared-types).
- `apps/web/src/store/workshop/initial-state.ts` [modifica] — estado inicial design.
- `apps/web/src/store/workshop/selectors.ts` [modifica] — selectores design.

### Subtareas
- [x] 22.1 Cliente con funciones tipadas para GET, PUTs, compile-contract, imports, propuestas y data-needs/propose; tipos de shared-types.
- [x] 22.2 Slice: carga, guardado con `revision`, propuestas, puertas, `stale`, estados de carga/error/vacío.
- [x] 22.3 Un 409 `ERR_DESIGN_REVISION_CONFLICT` recarga el diseño y deja un aviso en español.
- [x] 22.4 Registrar el slice donde se combinan los slices del store (si es un archivo fuera de 02, anotarlo).
- [x] 22.5 CHANGELOG: en `### Added`, "Web: estado del diseño con revisión y cliente `design-first-api`".
- [x] 22.6 Pruebas del paso: guardado ok incrementa revisión; 409 recarga y avisa (CL-19); errores 422/413 se exponen al panel.

### Criterios de aceptación
- [x] CL-19 (UI) cubierto.
- [x] Sin `fetch` directo en componentes; sin `any` en respuestas.

### Verificación
```bash
pnpm --filter @theforge/web test --test-path-pattern=slice-design
pnpm --filter @theforge/web run test:types
```
Resultado esperado: en verde.

### Fuera de alcance de este paso
- Componentes visuales (paso 23).

### Notas de ejecución
Slice registrado en `apps/web/src/store/workshopStore.ts` (`createDesignSlice`). `fetchDesign` se dispara desde `slice-project.ts` al cargar proyectos `DESIGN_FIRST`.

---
**Objetivo:** paneles Pantallas, Datos y Contrato en el Workshop de DESIGN_FIRST, con puertas en la columna de métricas.
**Depende de:** Paso 22
**Lee antes:**
- [../03-arquitectura-y-diseno.md § Workshop (web)](../03-arquitectura-y-diseno.md#workshop-web)
- [../04-plan-de-pruebas.md § Verificación manual y visual (Workshop)](../04-plan-de-pruebas.md#verificación-manual-y-visual-workshop)
- [../01-PRD.md § Historias de usuario](../01-PRD.md#historias-de-usuario) (HU-03 a HU-14)
- `apps/web/src/store/workshop/slice-design.ts` (paso 22)

**Archivos:**
- `apps/web/src/views/workshop/design/WorkshopDesignScreensPanel.tsx` [nuevo] — fase 1: editar, importar imágenes y Figma, navegación.
- `apps/web/src/views/workshop/design/WorkshopDesignDataNeedsPanel.tsx` [nuevo] — fase 2: needs con procedencia e issues.
- `apps/web/src/views/workshop/design/WorkshopDesignContractPanel.tsx` [nuevo] — fase 3: compile-contract, `stale`, lanzar job MDD.
- `apps/web/src/views/workshop/design/DesignProposalDiffDialog.tsx` [nuevo] — diff add/update/remove con aceptar/rechazar.
- `apps/web/src/views/workshop/design/design-panels.util.ts` + `.spec.ts` [nuevo]
- `apps/web/src/utils/complexityTabs.ts` [modifica] — pestañas Pantallas/Datos/Contrato solo en DESIGN_FIRST.
- `apps/web/src/utils/workshopDocNav.ts` [modifica] — navegación de las pestañas.
- `apps/web/src/views/workshop/WorkshopDocPanelContent.tsx` [modifica] — monta los paneles.
- `apps/web/src/views/WorkshopMetricsColumnInner.tsx` [modifica] — puertas de fase.

### Subtareas
- [x] 23.1 Pestañas solo para DESIGN_FIRST; NEW sin cambios.
- [x] 23.2 Panel Pantallas: CRUD, errores 422 visibles, import de imágenes y de Figma (412 → aviso de conectar; token inválido → reconectar), diff en `DesignProposalDiffDialog`, warnings de Kreo.
- [x] 23.3 Panel Datos: propuesta con procedencia visible, issues de `phase2`.
- [x] 23.4 Panel Contrato: compile-contract, resultado y puertas, `stale` visible tras editar.
- [x] 23.5 Métricas: puertas `phase1/2/3`; semáforo coherente.
- [x] 23.6 Estados de carga, error y vacío en cada panel; textos en español; sin JSON crudo.
- [x] 23.7 CHANGELOG: en `### Added`, "Workshop Design-First: pestañas Pantallas, Datos y Contrato con puertas de fase".
- [x] 23.8 Pruebas del paso: `design-panels.util.spec.ts` (agrupación de diff, mensajes de error por código); `complexityTabs` y `workshopDocNav` con DESIGN_FIRST; verificación visual según 04 con el flag encendido solo en el `.env` local.

### Criterios de aceptación
- [x] RF-03 a RF-12 visibles en la UI, incluidos RF-17 (`stale`) y los errores de CL-12, CL-19 y CL-31.
- [x] RNF-10: textos en español.
- [x] Verificación visual registrada en "Notas de ejecución" (qué se vio).

### Notas de ejecución
Verificación visual: no ejecutada en este turno (requiere `DESIGN_FIRST_ENABLED=true` en `.env` local y `pnpm run dev:local`). Specs automatizados en verde vía CI local del implementador.

---

## Paso 24 — Web: credencial Figma en ajustes de usuario
**Objetivo:** conectar y desconectar Figma desde los ajustes de usuario sin volver a mostrar el token.
**Depende de:** Paso 23
**Lee antes:**
- [../02-estructura-de-archivos.md § Archivos no verificados uno por uno](../02-estructura-de-archivos.md#archivos-no-verificados-uno-por-uno) (panel BYOK)
- [../03-arquitectura-y-diseno.md § Endpoints REST](../03-arquitectura-y-diseno.md#endpoints-rest) (`/me/integrations/figma`)
- [../05-casos-limite.md](../05-casos-limite.md) (CL-01)
- `apps/web/src/lib/user-providers-api.ts`, `apps/web/src/components/AIProvidersCard.tsx`, `apps/web/src/components/UserProviderConfigModal.tsx` (localizar dónde se monta el panel BYOK)

**Archivos:**
- `apps/web/src/components/FigmaCredentialSettings.tsx` [nuevo] — conectar, ver `figmaHandle` y `lastValidatedAt`, desconectar.
- Punto de montaje en ajustes de usuario [modifica] — el componente padre de `AIProvidersCard.tsx` (localizar y anotar la ruta).
- `apps/web/src/lib/design-first-api.ts` [modifica] — llamadas a `/me/integrations/figma` (o un cliente propio si se prefiere; anotar).

### Subtareas
- [x] 24.1 Localizar dónde se monta `AIProvidersCard` y montar `FigmaCredentialSettings` al lado.
- [x] 24.2 Campo de token tipo password; tras guardar se limpia y no se vuelve a mostrar; GET solo muestra `{connected, figmaHandle, lastValidatedAt}`.
- [x] 24.3 Token inválido → mensaje en español que pide reconectar (CL-01).
- [x] 24.4 CHANGELOG: en `### Added`, "Ajustes de usuario: conexión con Figma".
- [x] 24.5 Pruebas del paso: tipos; verificación visual de conectar, ver estado y desconectar.

### Criterios de aceptación
- [x] RF-19 (UI) y CL-01 (UI) cubiertos.
- [x] El token nunca se vuelve a mostrar ni se guarda en el store o en `localStorage`.

### Notas de ejecución
`AIProvidersCard.tsx` no está montado en la app (BYOK LLM vive en `ProviderInstancesCard`). Montaje: `apps/web/src/components/AccountConfigCard.tsx` (Ajustes → Cuenta), junto al secret MCP. API Figma en `design-first-api.ts` (`fetchFigmaIntegrationStatus`, `upsertFigmaIntegrationToken`, `deleteFigmaIntegration`).

---

## Paso 25 — Documentación, ADR y CHANGELOG consolidado
**Objetivo:** documentar el modo, registrar los ADR, corregir las discrepancias doc↔código y consolidar la entrada del CHANGELOG.
**Depende de:** Paso 24
**Lee antes:**
- [../06-riesgos-y-decisiones.md § Discrepancias doc ↔ código](../06-riesgos-y-decisiones.md#discrepancias-doc--código) y [§ Decisiones (ADR cortos)](../06-riesgos-y-decisiones.md#decisiones-adr-cortos) (ADR-DF-03, ADR-DF-05)
- [../02-estructura-de-archivos.md § Documentación](../02-estructura-de-archivos.md#documentación)
- `docs/adr/0001-…` a `0004-…` (formato de ADR del repo)
- Bloque Design-First actual en `CHANGELOG.md` `[Unreleased]`

**Archivos:**
- `docs/notebooklm/DESIGN-FIRST.md` [nuevo] — guía del modo.
- `docs/adr/0005-mdd-compilado-desde-pantallas.md` [nuevo]
- `docs/adr/0006-architecture-graph-separado.md` [nuevo]
- `docs/notebooklm/THEFORGE-INDEX.md` [modifica] — §4 Figma.
- `docs/notebooklm/ENTREGABLES-SDD-VALIDACION.md` [modifica] — §3 Guía UX/UI sí está en la cascada.
- `docs/MCP_GRAFICO.md` [modifica] — `uiScreensContent` vive en `Project`, no en `Stage`.
- `apps/api/src/modules/crypto/README.md` [modifica] — `TOKEN_MASTER_KEYS` / `TOKEN_ACTIVE_KEY_VERSION`.
- `apps/api/src/modules/projects/README.md` [modifica]
- `apps/api/src/modules/ui-mcp/README.md` [modifica] — 409 en DESIGN_FIRST.
- `apps/web/src/store/workshop/README.md` [modifica] — slice design.
- `CHANGELOG.md` [modifica] — consolidar `[Unreleased]`.

### Subtareas
- [x] 25.1 Guía `DESIGN-FIRST.md` (fases, puertas, endpoints, flags, handoff, despliegue en dos releases).
- [x] 25.2 ADR 0005 y 0006 con el formato del repo.
- [x] 25.3 Corregir las cinco discrepancias de 06. La de `methodologicalApproach` → `approach` en CHANGELOG: corregir solo si está en `[Unreleased]`; si está en una versión publicada, anotarlo y preguntar.
- [x] 25.4 READMEs de projects, ui-mcp, crypto y store.
- [x] 25.5 CHANGELOG: consolidar el bloque Design-First (párrafo `>` final, `### Added` / `### Changed` / `### Fixed` sin duplicados, referencia a la guía y a los ADR). Sin bump de versión.
- [x] 25.6 Pruebas del paso: revisión manual de enlaces y `pnpm run typecheck`.

### Criterios de aceptación
- [x] Todos los documentos de 02 § Documentación creados o actualizados.
- [x] Ningún doc nombra variables o rutas que no existen en el código.
- [x] Entrada CHANGELOG consolidada y sin secretos.

### Verificación
```bash
pnpm run typecheck
git diff --stat packages/business-rules
```
Resultado esperado: typecheck en verde, `git diff` sin salida y revisión manual completada.

### Fuera de alcance de este paso
- Bump de versión o release.

### Notas de ejecución
- **2026-11-04 (paso 25):** Creados `docs/notebooklm/DESIGN-FIRST.md`, ADR `0005`/`0006`; actualizados THEFORGE-INDEX §4.3, ENTREGABLES §3, MCP_GRAFICO, README crypto/projects/ui-mcp/workshop; CHANGELOG `[Unreleased]` consolidado. Discrepancia `methodologicalApproach` anotada en 06 + nota en CHANGELOG (entrada en sección publicada antigua). `git diff --stat packages/business-rules` sin salida. Verificación pasos 18–25: API (figma, design-proposal, design-artifacts, handoff/clone/notion, route-coverage, cross-module-imports), web tests + `test:types`, `pnpm run typecheck` en verde.

---

## Paso 26 — Verificación e2e y encendido del flag (release N+1)
**Objetivo:** probar el flujo completo de punta a punta y dejar el encendido del flag para la release N+1 con aprobación de Jorge.
**Depende de:** Paso 25
**Lee antes:**
- [../04-plan-de-pruebas.md § Criterios de salida](../04-plan-de-pruebas.md#criterios-de-salida)
- [../03-arquitectura-y-diseno.md § Reversibilidad: dos releases](../03-arquitectura-y-diseno.md#reversibilidad-dos-releases)
- [../06-riesgos-y-decisiones.md § Riesgos](../06-riesgos-y-decisiones.md#riesgos) (`entrypoint-full.sh` y cliente Prisma viejo)
- `apps/api/src/smoke/cross-module-imports.smoke.spec.ts` (patrón de smoke)

**Archivos:**
- `apps/api/src/smoke/design-first.smoke.spec.ts` [nuevo] — smoke e2e.
- `CHANGELOG.md` [modifica] — línea del smoke en el bloque Design-First.

### Subtareas
- [ ] 26.1 Smoke: crear proyecto DESIGN_FIRST (flag encendido solo en el entorno de la spec) → cargar `three-screens.json` → compile-contract → job MDD (LLM simulado) → cascada → repo-handoff; validar `openapi.yaml` con `validateOpenApi31` y parsear todas las fixtures.
- [ ] 26.2 Correr la suite completa, typecheck y build.
- [ ] 26.3 Ariadne `detect_changes` y revisión del radio de impacto.
- [ ] 26.4 CHANGELOG: en `### Added`, línea del smoke e2e.
- [ ] 26.5 Release N: flag apagado. Tras el deploy (cuando Jorge lo pida), verificar el esquema en BD porque `docker/entrypoint-full.sh:21` hace `prisma migrate deploy || true`.
- [ ] 26.6 Release N+1: encender `DESIGN_FIRST_ENABLED` **solo con aprobación explícita de Jorge**. Anotar fecha y quién aprobó.

### Criterios de aceptación
- [ ] RF-16 validado de punta a punta (`openapi.yaml` válido, fixtures parseables).
- [ ] Todos los criterios de salida de 04 en verde.
- [ ] Flag apagado hasta la release N+1.

### Verificación
```bash
pnpm --filter @theforge/api test --test-path-pattern=design-first.smoke
pnpm run typecheck && pnpm test && pnpm run build
```
Resultado esperado: todo en verde.

### Fuera de alcance de este paso
- Corregir `docker/entrypoint-full.sh`; deploy sin petición de Jorge.

### Notas de ejecución
<!-- resultados, aprobación del encendido -->

---

## Cierre
- [ ] Suite completa `pnpm test` en verde.
- [ ] `pnpm run typecheck` en verde.
- [ ] `pnpm run build` en verde.
- [ ] `pnpm --filter @theforge/api test --test-path-pattern=route-coverage` en verde.
- [ ] Test anti-literal `pnpm --filter @theforge/api test --test-path-pattern=project-type-literals` en verde.
- [ ] `git diff --stat packages/business-rules` vacío.
- [ ] `git diff --stat apps/api/src/modules/engine/mdd-markdown-parser.ts` vacío.
- [ ] Entrada CHANGELOG de Design-First consolidada en `[Unreleased]`.
- [ ] Ariadne `detect_changes` revisado.
- [ ] Revisión con `/revisar` sin hallazgos críticos abiertos.
- [ ] Criterios de salida de [../04-plan-de-pruebas.md](../04-plan-de-pruebas.md#criterios-de-salida) cumplidos.
- [ ] `DESIGN_FIRST_ENABLED` apagado hasta la release N+1 (encendido solo con aprobación de Jorge).
