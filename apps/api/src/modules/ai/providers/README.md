# AI / Providers

Catálogo de proveedores LLM soportados y tipos de runtime.

## Archivos

- **`provider-catalog.ts`** — `PROVIDER_IDS` (6 proveedores: openrouter, openai, anthropic, gemini, cloudflare, groq), catálogo con defaults, modelos, capacidades (embeddings, visión, STT, imágenes).
- **`llm-runtime.types.ts`** — `UserLLMRuntime`: tipo resuelto en runtime con providerId, apiKey, baseURL, chatModel, fallbacks, embeddingModel, etc.
- **`chat-model-pricing.ts`** — precios por millón de tokens para cálculo de costos en telemetría.