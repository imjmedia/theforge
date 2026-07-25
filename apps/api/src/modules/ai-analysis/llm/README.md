# AI Analysis / LLM

Factories de LLM para los grafos DBGA y MDD. Maneja cadenas de fallback, OpenRouter, y resolución de runtime.

## Factories

- **`createDbgaLLM(aiFactory, userId)`** — LLM general para DBGA y nodos estructurales MDD. Usa `resolveRuntime()` (chatModel del proveedor).
- **`createMddAuditorLLM(aiFactory, userId)`** — LLM específico para el nodo auditor del MDD. Usa `resolveAuditorRuntime()` (auditorChatModel) + perfil de tokens `auditor`.
- **`createMddHighComplexityLLM(aiFactory, userId)`** — LLM para §3 (modelo de datos) en pipelines HIGH. Usa `resolveHighComplexityRuntime()` (highComplexityChatModel).

## Modelos de fallback

- **`chained-fallback-chat-model.ts`** — `ChainedFallbackChatModel`: itera `[chatModel, ...fallbacks]` con reintentos por modelo.
- **`openrouter-fallback-chat-model.ts`** — `OpenRouterFallbackChatModel`: variante específica para OpenRouter.
- **`mdd-llm-preflight.util.ts`** — validación pre-vuelo de disponibilidad del modelo antes de iniciar pipeline.