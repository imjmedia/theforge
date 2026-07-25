# AI / Config

Configuración runtime de LLM: perfiles de tokens, cadena de fallback, y debug.

## Archivos

- **`llm-config.ts`** — perfiles de salida (`LLM_OUTPUT_TOKEN_PROFILES`: chat, document, langgraph, auditor, tasksPlanner...), resolución de `max_tokens` por propósito y pestaña Workshop, techo global `llmMaxTokens()`.
- **`llm-model-fallback.ts`** — `runWithModelFallback()`: cadena ordenada `chatModel → chatModelFallbacks[]`, 3 reintentos por modelo, detección de agotamiento (402, quota, crédito, modelo no encontrado, 429).
- **`llm-debug.util.ts`** — utilidades de tracing/logging para llamadas LLM.