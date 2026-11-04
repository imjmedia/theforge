# Modo Design-First para theforge

| Campo | Valor |
|---|---|
| Fecha | 2026-11-03 |
| Modo | Modificación (sobre código existente) |
| Repo | theforge (monorepo pnpm 9.15.9 + Turborepo) |
| Rama base | `master` |
| Estado | **Aprobado, sin ejecutar** |
| Autor del plan | `planificador`, con dictámenes de `experto-arquitectura` y `experto-ia-agentica` |
| Pasos | 28 fichas: 1, 2, 3, 4, 4b, 4c, 5…26 (ver [TASKS](./tasks/TASKS.md)) |

## Resumen

1. Se agrega `ProjectType.DESIGN_FIRST`: el proyecto arranca por pantallas y flujos (fase 1), sigue con necesidades de datos (fase 2) y termina con PAG determinista, OpenAPI 3.1 y MDD compilado (fase 3).
2. Las pantallas llegan por imágenes (visión con propuesta HITL), por Figma (token personal) o por edición manual; todas producen el mismo `designSpec`, guardado en un solo documento `Stage.designSpec` con CAS por revisión.
3. El MDD sigue siendo la Constitución de 7 secciones, pero §3 y §4 se fijan byte a byte desde el PAG; el grafo LangGraph actual corre en modo pinned.
4. Antes de todo se corrige un defecto multi-tenant actual: `AiService.lastGeneratedPag` (singleton) y la sobrecarga de `Stage.documentAst`, con una columna nueva `Stage.architectureGraph`.
5. Salida: repo-handoff con `openapi.yaml`, handlers MSW v2 y fixtures; semáforo por fases, cascada propia y Workshop con pestañas Pantallas, Datos y Contrato. El flujo SDD NEW/LEGACY queda intacto.

## Índice

| Documento | Contenido |
|---|---|
| [tasks/HANDOFF.md](./tasks/HANDOFF.md) | Entrega al ejecutor: precondiciones, Ariadne, reglas de ejecución |
| [01-PRD.md](./01-PRD.md) | Problema, objetivos, usuarios, historias, RF-01…RF-19, RNF-01…RNF-10 |
| [02-estructura-de-archivos.md](./02-estructura-de-archivos.md) | Árbol `[nuevo]`/`[modifica]`, archivo → paso, zonas que no se tocan |
| [03-arquitectura-y-diseno.md](./03-arquitectura-y-diseno.md) | Módulos, flujo, contratos, datos, MDD pinned, semáforo, seguridad, invariantes I1-I9 |
| [04-plan-de-pruebas.md](./04-plan-de-pruebas.md) | Pirámide, matriz requisito → prueba, fixtures, criterios de salida |
| [05-casos-limite.md](./05-casos-limite.md) | CL-01…CL-31 con prueba y paso |
| [06-riesgos-y-decisiones.md](./06-riesgos-y-decisiones.md) | Riesgos, ADR cortos, preguntas resueltas, discrepancias doc↔código, Ariadne |
| [tasks/TASKS.md](./tasks/TASKS.md) | Las 28 fichas de ejecución en orden estricto |

## Orden de lectura recomendado

1. [HANDOFF](./tasks/HANDOFF.md)
2. [PRD](./01-PRD.md)
3. [Arquitectura y diseño](./03-arquitectura-y-diseno.md)
4. [Estructura de archivos](./02-estructura-de-archivos.md)
5. [Plan de pruebas](./04-plan-de-pruebas.md)
6. [Casos límite](./05-casos-limite.md)
7. [Riesgos y decisiones](./06-riesgos-y-decisiones.md)
8. [TASKS](./tasks/TASKS.md)

## Decisiones de Jorge

Estas decisiones mandan sobre cualquier duda del plan.

### Previas al plan (rondas 1-3)

| # | Decisión |
|---|---|
| D1 | Nuevo `ProjectType.DESIGN_FIRST`; no se reconvierte `ProjectApproach.UX_FIRST`. |
| D2 | Fuente de pantallas en v1: chat guiado con imágenes **y** Figma (URL + token personal). Ambas producen el mismo ScreenSpec. MCP gráfico (Kreo) opcional. |
| D3 | El MDD sigue siendo la Constitución de 7 secciones, compilado desde pantallas + datos (§3/§4 fijadas). El gate "MDD primero" pasa a después de la fase 2. |
| D4 | Necesidades de datos como JSON estructurado en Stage (cumplido con el documento único `Stage.designSpec` que incluye `dataNeeds`). |
| D5 | Alcance v1: fases 1-3 + export OpenAPI + mocks estáticos; la fase 4 solo como handoff. |
| D6 | Mocks: OpenAPI + handlers MSW + fixtures JSON en el repo-handoff. |
| D7 | Semáforo por fases en `EstimationService`; fórmula MXN intacta. |
| D8 | Solo proyectos nuevos; UX_FIRST se oculta del wizard y se marca `@deprecated`. |
| D9 | El modo se fija al crear el proyecto. |

### GATE 1 (plan aprobado tal cual) y respuestas a las preguntas abiertas

| # | Pregunta | Respuesta de Jorge |
|---|---|---|
| Q1 | Ariadne Gate 2 en BLOCKED (falso negativo del índice) | El HANDOFF exige resincronizar Ariadne y repetir `validate_change_plan` antes del paso 1; si sigue BLOCKED, detenerse y preguntar. |
| Q2 | Despliegue en dos releases + down-script | Aceptado (N: enum + flag apagado; N+1: flag encendido). |
| Q3 | Dependencia para validar OpenAPI 3.1 | `ajv` + `ajv-formats` (JSON Schema 2020-12) en `apps/api`; la estructura OpenAPI 3.1 se valida con un esquema propio del repo. Aprobada. |
| Q4 | Documento único `Stage.designSpec` con `dataNeeds` | Aceptado. |
| Q5 | Pantallas agregadas (dashboards) | Endpoints por recurso por defecto; `GET /views/{screenId}` solo con `endpointHint`. Aceptado. |
| Q6 | `precisionScore` en fases 1-2 | Porcentaje de completitud con tope 40. |
| Q7 | Estimación antes del MDD | No disponible hasta la fase 3. |
| Q8 | Complejidad en DESIGN_FIRST | Se mantiene la inferencia actual, con oleadas DESIGN_FIRST propias por LOW/MEDIUM/HIGH. |
| Q9 | §3/§4 con pase LLM de prosa | No: solo compiladas en v1. |
| Q10 | Merge e integración con LEGACY | Merge de DESIGN_FIRST: 409 en v1. Integración con LEGACY: DESIGN_FIRST se trata como greenfield. |
| Q11 | Corrección de `lastGeneratedPag`/`documentAst` | Dentro del mismo paquete, pasos 2-3, primeros en el orden. |
| Q12 | Almacén de propuestas de diff | Redis con TTL (no tabla persistente). |
