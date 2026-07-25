# AI Analysis / State

Schemas Zod y anotaciones LangGraph para el estado de los grafos DBGA y MDD.

## Schemas

- **`dbga-state.schema.ts`** — `DBGAState`: idea, research, audit, synthesis, iteration.
- **`mdd-state.schema.ts`** — `MDDState`: draft, sections, auditorFeedback, iteration, complexity, etc.
- **`mdd-structured.schema.ts`** — schema intermedio estructurado del MDD (JSON antes de renderizar a markdown).
- **`langgraph-state.annotation.ts`** — anotaciones LangGraph (reducers, defaults) para ambos grafos.
- **`state-to-markdown.ts`** — conversión de estado estructurado a markdown.