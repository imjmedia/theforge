# ADR 0005: MDD compilado desde pantallas (Design-First pinned)

- **Estado:** Aceptado (2026-11-04), paquete Design-First, rama `feat/design-first-pasos-18-25`.
- **Ámbito:** `apps/api/src/modules/ai-analysis/graph/mdd-graph.ts`, compiladores `@theforge/shared-types/design-first`, job MDD y puertas en `projects` / `design-first`.
- **Referencias:** ADR corto ADR-DF-05 en `arquitectura/modo-design-first/06-riesgos-y-decisiones.md`; guía [docs/notebooklm/DESIGN-FIRST.md](../notebooklm/DESIGN-FIRST.md).

## Contexto

En proyectos **NEW**, el MDD de 7 secciones se genera con nodos LLM para §3 (modelo de datos) y §4 (API). En **Design-First**, §3 y §4 deben ser **idénticos byte a byte** al PAG compilado desde `designSpec`, porque el contrato ya fue validado en fase 3 (OpenAPI 3.1 + `validateProjectArchitectureGraph`).

Alternativas evaluadas: grafo LangGraph nuevo solo para Design-First (duplica topología, lease y specs de prueba) o seguir generando §3/§4 con LLM y “reparar” después (no determinista, rompe I4–I6 e invariantes de sellado).

## Decisión

1. **Mismo grafo MDD** con estado `designFirstPinned`: se omiten nodos que reescribirían §3/§4 (`data_model`, `data_model_patch`, `architect_critic`, generación LLM de `api_contracts`).
2. **Inserción determinista:** `compilePagToMddSection3` y `compilePagToMddSection4` producen el markdown canónico esperado por el harness (CREATE TABLE, erDiagram vía util del injector, tablas §4 alineadas al PAG).
3. **Barreras de deriva:** `prepare_output` reimpone hashes de §3/§4; `cross_consistency` filtra cambios en secciones selladas; métrica `pinned_section_drift` si el LLM altera contenido fijado.
4. **Auditor:** puntuación determinista en §3/§4; LLM solo en §1, §2, §5–§7. Clarifier usa `design-first-clarifier.md`.
5. **Lease y fence:** sin cambios respecto a ADR 0003/0004; la zona `[A]` del grafo pinned está acotada en el plan de pruebas (paso 15).

## Consecuencias

- Un solo pipeline MDD que mantener; menos ramas pero mayor sensibilidad en `prepare_output` y en tests de sellado con LLM simulado.
- Los endpoints de §4 del MDD coinciden exactamente con el PAG; no hay self-healing LLM del PAG en Design-First (ADR-DF-04).
- Regenerar MDD sin PAG actualizado falla con puertas `ERR_DESIGN_PHASE_GATE` / `ERR_DESIGN_STALE`.

## Alternativas descartadas

- **Grafo `mdd-design-first-graph` separado** — duplica lease, fence, eval y documentación operativa.
- **§3/§4 con pase LLM de prosa (Q9)** — rechazado en v1; solo compiladas.
