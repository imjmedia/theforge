# AI Analysis / Graph

Definiciones de grafos LangGraph para los pipelines principales: DBGA (Fase 0) y MDD (Master Design Document).

## Grafos

- **`dbga-graph.ts`** — grafo DBGA: Scout → Auditor → Critic → (Scout | Synthesis) → END. Usa Tavily + scrape_url. 1 solo LLM (`createDbgaLLM`) para todos los nodos.
- **`mdd-graph.ts`** — grafo MDD: pipeline multi-agente con 3 LLMs (estructural `chatModel`, alta complejidad `highComplexityChatModel`, auditor `auditorChatModel`). Nodos: clarificador, arquitecto, formateador, auditor, redactor, etc.
  - **Grafo one-shot (Regenerar MDD y eval):** `format_after_redactor → cross_consistency_checker → diagram_injector` corre en serie. Antes el checker y el inyector iban en paralelo sobre el mismo borrador y `reduceMddDraft` perdía uno de los dos cambios (H3). Lo cubre `mdd-graph.topology.spec.ts`.
  - **Telemetría por nodo:** `wrapNodeTelemetry` (O14) envuelve cada nodo de ambos grafos con `node` y `capability` en el contexto de `TokenUsage`.
  - **Auditor sin nota:** con `auditorOutcome: "unavailable"` la decisión es `done`, así que `routeAuditor` va a `prepare_output` y nunca a `clarifier`. `shouldSkipAuditor` evita re-ejecutarlo en el mismo turno (`auditorRan: true`). Ver `ai-analysis/README.md`, «Calidad del MDD».
- **`dbga-critic-routing.ts`** — lógica de ruteo condicional del nodo critic en DBGA.