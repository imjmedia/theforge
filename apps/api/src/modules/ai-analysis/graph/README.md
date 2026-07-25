# AI Analysis / Graph

Definiciones de grafos LangGraph para los pipelines principales: DBGA (Fase 0) y MDD (Master Design Document).

## Grafos

- **`dbga-graph.ts`** — grafo DBGA: Scout → Auditor → Critic → (Scout | Synthesis) → END. Usa Tavily + scrape_url. 1 solo LLM (`createDbgaLLM`) para todos los nodos.
- **`mdd-graph.ts`** — grafo MDD: pipeline multi-agente con 3 LLMs (estructural `chatModel`, alta complejidad `highComplexityChatModel`, auditor `auditorChatModel`). Nodos: clarificador, arquitecto, formateador, auditor, redactor, etc.
- **`dbga-critic-routing.ts`** — lógica de ruteo condicional del nodo critic en DBGA.