# HANDOFF — Modo Design-First

Para quien ejecute este paquete **sin contexto previo**. Lee este archivo completo antes de tocar nada. Las fichas de ejecución están en [TASKS.md](./TASKS.md).

## Resumen del objetivo

1. Agregar `ProjectType.DESIGN_FIRST` a theforge: el proyecto arranca por pantallas y flujos (fase 1), sigue con necesidades de datos (fase 2) y termina con PAG determinista, OpenAPI 3.1 y MDD compilado (fase 3).
2. Las pantallas llegan por imágenes (visión con propuesta diff y aceptación HITL), por Figma (token personal del usuario) o por edición manual. Todas producen el mismo `designSpec`.
3. El diseño vive en un solo documento `Stage.designSpec` (entities, screens, navigation, dataNeeds) con CAS por `designSpecRevision`.
4. El PAG de Design-First es 100 % determinista (`compileDataNeedsToPag`), sin LLM, y falla cerrado.
5. El MDD sigue siendo la Constitución de 7 secciones; §3 y §4 se fijan byte a byte desde el PAG y el grafo LangGraph actual corre en modo pinned.
6. Antes de todo se corrige un defecto multi-tenant actual: el singleton `AiService.lastGeneratedPag` y la sobrecarga de `Stage.documentAst` (nueva columna `Stage.architectureGraph`, pasos 2-3).
7. Semáforo por fases en `EstimationService`, también sin MDD; la fórmula MXN de `packages/business-rules` no cambia.
8. Cascada de entregables con oleadas propias; Workshop con pestañas Pantallas, Datos y Contrato; wizard con origen "Design-First" y UX_FIRST oculto.
9. Salida: repo-handoff con `openapi.yaml`, handlers MSW v2, fixtures y `docs/sdd/pantallas.md` / `datos.md`.
10. Todo detrás del flag `DESIGN_FIRST_ENABLED` (apagado). Se enciende solo en la release N+1 con aprobación de Jorge. El flujo SDD NEW/LEGACY queda intacto.

## Repo, rama y gestor de paquetes

| Campo | Valor |
|---|---|
| Repo | `/Volumes/ADATA/Desarrollos/imj/theforge` (origin: fork `imjmedia`; upstream `kreodevs/theforge`) |
| Rama base | `master` |
| Rama sugerida | `feat/modo-design-first` (créala desde `master` antes del paso 1) |
| Gestor | pnpm 9.15.9 + Turborepo. No mezclar lockfiles ni usar npm/yarn. |
| Runner de pruebas | `node scripts/run-tests.mjs` (node:test) en api, web y shared-types; specs `*.spec.ts` colocados junto al código. |
| Proyecto Ariadne | `7951d411-f30f-4bee-8912-1369d1f4a580` (no hay `.ariadne-project` en la raíz) |

## Comandos

| Para qué | Comando |
|---|---|
| Instalar | `pnpm install` |
| Build + tipos (obligatorio si se toca `packages/shared-types`, porque las apps leen `dist/*.d.ts`) | `pnpm run typecheck` |
| Build solo de shared-types | `pnpm --filter @theforge/shared-types build` |
| Pruebas shared-types | `pnpm --filter @theforge/shared-types test --test-path-pattern=<x>` |
| Pruebas API | `pnpm --filter @theforge/api test --test-path-pattern=<x>` |
| Pruebas web | `pnpm --filter @theforge/web test --test-path-pattern=<x>` |
| Tipos web / API | `pnpm --filter @theforge/web run test:types` · `pnpm --filter @theforge/api run test:types` |
| Prisma | `pnpm run db:generate` · `pnpm run db:migrate` |
| Alineación de tools MCP (solo si cambian tools) | `pnpm --filter @theforge/api run test:mcp-alignment` |
| Build completo | `pnpm run build` |
| Suite completa | `pnpm test` |
| Dev local | `pnpm run dev:local` |
| Lint | `pnpm run lint` — **no arranca en las apps (deuda conocida). No bloquees un paso por eso**; anótalo si lo intentas. |
| Zona protegida | `git diff --stat packages/business-rules` debe salir vacío |

## Convenciones obligatorias

- **Idioma:** documentación, comentarios, textos de UI, mensajes de error y commits en **español**. Los identificadores siguen la convención del repo (inglés).
- **Commits convencionales en español** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), asunto corto, **sin trailers `Co-authored-by`**.
- **No hagas commit, push, merge, PR ni deploy** salvo que Jorge lo pida de forma explícita en el mensaje actual. Si lo pide y hay PR, va cross-fork a `kreodevs/theforge` con `--head imjmedia:<rama>`.
- **CHANGELOG en cada commit.** El repo usa `## [Unreleased]` con `### Added` / `### Changed` / `### Fixed` y un párrafo `>` de resumen por bloque (manda el repo sobre la regla global `[Sin publicar]`). **Cada paso que se vaya a commitear agrega o amplía la entrada de Design-First en `[Unreleased]` en el mismo commit.** Un hook global bloquea `git commit` si `CHANGELOG.md` no está en el stage. El paso 25 consolida y pule esa entrada; no es el único que la toca. Sin bump de versión salvo que Jorge pida un release.
- **Config tipada:** toda variable nueva entra por `apps/api/src/config/env.schema.ts`; nada de `process.env` disperso.
- **Secretos:** nunca imprimas tokens, claves ni valores de `.env` en respuestas, logs, specs ni en TASKS. Nombra la variable, no el valor. `.env.example` lleva solo nombres y defaults no secretos.
- **Pasos `[A]` (2, 3, 5, 11, 12, 13 y 15):** requieren **aprobación humana explícita de Jorge antes de empezar**. Pídela en chat indicando qué vas a tocar; anota en "Notas de ejecución" de la ficha quién aprobó y cuándo.

### Zonas protegidas (no se tocan)

| Zona | Regla |
|---|---|
| `packages/business-rules/**` | Fórmula y tarifas intactas. Solo cambia la fuente del conteo de pantallas. |
| Estructura de 7 secciones del MDD | `apps/api/src/modules/engine/mdd-markdown-parser.ts` es **solo lectura**. El MDD compilado tiene exactamente 7 secciones. |
| Lease y fence del MDD | No se altera la semántica de `docs/adr/0003-lease-por-hilo-falla-cerrado.md` ni de `docs/adr/0004-fencing-token-escrituras-mdd.md`. Solo `mddContent` pasa por fence; el diseño usa CAS. |
| `apps/api/src/modules/ai/adapters/` | Solo OpenRouter; no se agregan adaptadores. |
| `ProjectApproach.UX_FIRST` | No se reconvierte: solo se oculta del wizard y se anota `@deprecated`. |

## Flujo Ariadne obligatorio

Las tools `mcp__ariadne__*` se usan antes de escribir código. Si no responden, sigue sin ellas y anótalo.

1. **Antes del paso 1 (una sola vez):**
   - `list_known_projects()` y `get_sync_status("7951d411-f30f-4bee-8912-1369d1f4a580")`. Si `list_known_projects` muestra un `roots[].id` propio para el repo theforge, el `AGENTS.md` pide usar ese id en las tools por repo; anota en TASKS cuál usaste.
   - **Resincroniza el índice** aunque diga `up_to_date`.
   - Repite **Gate 1** `get_modification_plan(<descripción del paquete>)` y **Gate 2** `validate_change_plan(<ChangePlan JSON>)`.
   - **Falso negativo conocido:** en la planificación, `get_sync_status` dio `up_to_date` (commit `c42078e0`), pero `get_modification_plan` no devolvió archivos y `validate_change_plan` dio **BLOCKED** con "File not in graph" para archivos que sí existen en disco (`schema.prisma`, `ai.service.ts`, `estimation.service.ts`…). Los archivos nuevos pasaban.
   - **Si Gate 2 sigue BLOCKED tras resincronizar: detente y pregunta a Jorge.** No edites con un veredicto BLOCKED sin su decisión.
2. **Por cada símbolo que edites:** `validate_before_edit(nodeName)` (y `get_references` si cambias una firma exportada).
3. **Antes de proponer un commit:** `detect_changes()` y revisa el radio de impacto.
4. Si el grafo contradice el código, **manda el código**.

## Orden de lectura

1. Este HANDOFF.
2. [../README.md](../README.md): resumen y decisiones de Jorge (D1-D9, Q1-Q12).
3. [../01-PRD.md](../01-PRD.md): RF-01…RF-19, RNF-01…RNF-10, HU-01…HU-16.
4. [../03-arquitectura-y-diseno.md](../03-arquitectura-y-diseno.md): módulos, contratos, migraciones, MDD pinned, semáforo, cascada, invariantes I1-I9.
5. [../02-estructura-de-archivos.md](../02-estructura-de-archivos.md): árbol y tabla archivo → paso.
6. [../04-plan-de-pruebas.md](../04-plan-de-pruebas.md): matriz requisito → prueba y criterios de salida.
7. [../05-casos-limite.md](../05-casos-limite.md): CL-01…CL-31 con su paso.
8. [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md): riesgos, ADR cortos, discrepancias doc↔código.
9. [TASKS.md](./TASKS.md): las 28 fichas.

En una sesión nueva no hace falta releerlo todo: basta este HANDOFF, la ficha del paso y lo que esa ficha cita en "Lee antes".

## Protocolo de ejecución

1. Lee este HANDOFF.
2. En [TASKS.md](./TASKS.md), toma **el primer paso sin marcar** en "Progreso". No saltes pasos ni los reordenes.
3. Lee **solo** lo que la ficha cita en "Lee antes", más los archivos que vas a tocar.
4. Si el paso es **[A]**, pide aprobación a Jorge y espera un sí explícito.
5. Ariadne: `validate_before_edit` por símbolo.
6. Implementa las subtareas de la ficha, incluida la subtarea CHANGELOG y las pruebas del paso.
7. Corre la **Verificación** exacta de la ficha. Si toca shared-types, corre también `pnpm run typecheck`.
8. Marca los checkboxes de subtareas y criterios cumplidos, y el del paso en "Progreso".
9. Registra en "Notas de ejecución": decisiones, desvíos, discrepancias, comandos corridos y su resultado.
10. Detente y reporta, o pasa al siguiente paso si Jorge pidió encadenar.

## Reglas de parada

Detente, anota el motivo en "Notas de ejecución" y pregunta a Jorge cuando:

- **Bloqueo:** falta una dependencia, una precondición o un dato que la ficha no resuelve.
- **Test rojo que no es del paso:** una spec ajena falla antes o después de tu cambio. No la "arregles de pasada"; anota cuál y con qué salida.
- **Discrepancia doc ↔ código:** **el código manda.** Sigue el código, anota la discrepancia en la ficha y pregunta si cambia el alcance.
- **Ariadne BLOCKED** en Gate 2 (o un `validate_before_edit` que lo indique).
- **Zona protegida:** el cambio exige tocar `packages/business-rules`, el parser de 7 secciones, la semántica de lease/fence, `ai/adapters/` o reconvertir UX_FIRST.
- La verificación del paso no pasa tras un intento razonable.

### Discrepancias ya conocidas (el código manda)

| Documento | Dice | Código real |
|---|---|---|
| Plan / 02 | `apps/web/src/api/design-first.api.ts` | No existe `apps/web/src/api/`. Los clientes viven en `apps/web/src/lib/*-api.ts`. Se usa **`apps/web/src/lib/design-first-api.ts`** (paso 22). |
| Plan | `migrations/safe-schema-sync.sql` | El archivo está en **`packages/database/scripts/safe-schema-sync.sql`** (02 y 03 ya lo citan así). Las migraciones sí van en `packages/database/migrations/`. |
| Plan | `ai-analysis/engine/mdd-markdown-parser.ts`, `engine/mdd-pre-render.ts`, `engine/conformance.service.ts`, `engine/mdd-quality-audit.util.ts` | Viven en **`apps/api/src/modules/engine/`** (hay además un `ai-analysis/utils/mdd-pre-render.ts` que reexporta `validateApiTablesSyntax`). |
| Plan | Nodos `prepare_output` y `auditor` sin verificar | `mdd-graph.ts` importa `nodes/mdd-prepare-output.node.ts` (`:32`) y `nodes/mdd-auditor.node.ts` (`:23`) y registra `addNode("auditor", auditorNode)` (`:604`). Existe también `nodes/auditor.node.ts`: confirmar en el paso 15 desde `mdd-graph.ts:587-612` antes de editar. |

Las discrepancias de documentación del repo (CHANGELOG `methodologicalApproach`, `MCP_GRAFICO.md`, THEFORGE-INDEX §4, ENTREGABLES §3, README de crypto) están en [../06-riesgos-y-decisiones.md](../06-riesgos-y-decisiones.md) y se corrigen en el paso 25.

## Qué NO hacer

- No hagas commit, push, merge, PR ni deploy sin que Jorge lo pida.
- No amplíes el alcance: nada de fase 4 dentro de theforge, LEGACY en Design-First, mocks dinámicos (Prism), SSE nuevo, tabla persistente de propuestas, pase LLM de prosa sobre §3/§4 ni retirar el fallback `documentAst` (es de la release siguiente).
- No saltes pasos ni ejecutes un `[A]` sin aprobación.
- **No enciendas `DESIGN_FIRST_ENABLED`** en ningún entorno compartido (stage, prod) ni en archivos versionados (`.env.example`, compose): solo en la release N+1 y con aprobación de Jorge (paso 26). Para las pruebas y la verificación visual en local puedes encenderlo en tu `.env` local, sin commitearlo.
- No toques `packages/business-rules` ni la fórmula de `computeCostEstimation`.
- No reconviertas `ProjectApproach.UX_FIRST`.
- No agregues dependencias distintas de `ajv` + `ajv-formats` (paso 9, aprobadas).
- No corrijas el `|| true` de `docker/entrypoint-full.sh:21` (riesgo registrado, fuera de alcance).
- No imprimas secretos.
