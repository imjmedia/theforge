# ADR 0006: Columna `Stage.architectureGraph` separada de `documentAst`

- **Estado:** Aceptado (2026-11-04), paquete Design-First, rama `feat/design-first-pasos-18-25`.
- **Ámbito:** `packages/database/schema.prisma`, migración `20261104090000`, lectores OpenAPI y generadores en `apps/api/src/modules/projects/`, eliminación de `AiService.lastGeneratedPag`.
- **Referencias:** ADR corto ADR-DF-03 en `arquitectura/modo-design-first/06-riesgos-y-decisiones.md`; guía [docs/notebooklm/DESIGN-FIRST.md](../notebooklm/DESIGN-FIRST.md).

## Contexto

`Stage.documentAst` acumulaba roles distintos: AST del pipeline MDD y, en la práctica, el **Project Architecture Graph (PAG)** cuando la cascada compiler-first persistía `endpoints`. El export OpenAPI discriminaba por `"endpoints" in ast`, frágil y propenso a colisiones semánticas.

Además existía **`AiService.lastGeneratedPag`**, un singleton en memoria que filtraba el PAG entre proyectos concurrentes (defecto multi-tenant).

## Decisión

1. **Columnas nuevas:** `Stage.architectureGraph` (JSON del PAG) y `architectureGraphSourceHash` (trazabilidad del origen).
2. **Backfill idempotente:** copiar filas donde `documentAst ? 'endpoints'` (migración `20261104090000`).
3. **Doble escritura una release:** al generar contratos API, persistir PAG en `architectureGraph` y, temporalmente, también donde los lectores legacy esperaban el AST.
4. **Lectura:** `architectureGraph ?? documentAst` solo si el fallback contiene `endpoints`; OpenAPI y logic flows / infra reciben el PAG por argumento desde la etapa, no desde estado global del servicio AI.
5. **Eliminar `lastGeneratedPag`:** el PAG viaja en el retorno de `generateApiContracts` y se persiste en la etapa.

## Consecuencias

- Corrige fuga cross-tenant y clarifica contratos downstream.
- El fallback a `documentAst` es **deuda temporal**; retirarlo en la release siguiente cuando todos los lectores usen `architectureGraph`.
- Clone, Notion y handoff deben copiar `architectureGraph` junto con `designSpec` (implementado en pasos 3 y 20).

## Alternativas descartadas

- **Seguir usando solo `documentAst`** con heurística de forma JSON — frágil y mezcla responsabilidades MDD vs arquitectura.
- **PAG solo en memoria del job** — reproduce la carrera multi-tenant.
