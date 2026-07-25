# AI Analysis / Checkpoint

Persistencia de estado de grafos LangGraph con checkpointer. Permite retomar ejecuciones interrumpidas y cachear resultados de nodos.

## Capa

- **`checkpointer.service.ts`** — servicio de checkpoint con PostgresSaver.
- **`langgraph-checkpoint-setup.util.ts`** — configuración del checkpointer para grafos MDD/DBGA.
- **`node-cache.service.ts`** — caché de nodos: evita re-ejecutar nodos con mismos inputs (hash-based).
- **`node-input-hash.ts`** — hashing determinista de inputs de nodo.