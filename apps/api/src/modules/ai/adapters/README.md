# AI / Adapters

Implementaciones del contrato `LLMProvider` para cada proveedor del catálogo. Cada adapter traduce la interfaz unificada a la API nativa del proveedor.

## Adapters

| Adapter | Proveedor | Protocolo |
|---|---|---|
| `OpenAICompatibleAdapter` | OpenAI, OpenRouter, Groq, Cloudflare | REST OpenAI-compatible |
| `AnthropicAdapter` | Anthropic Claude | REST Anthropic Messages API |
| `GeminiAdapter` | Google Gemini | REST Gemini generateContent |

## Contrato (`LLMProvider`)

- `generateResponse(prompt, history)` → texto
- `generateResponseStream(prompt, history)` → stream async
- `parseChecklist(text)` → `ChecklistResult`
- `generateEmbedding(text)` → `number[]`

Resuelto por `AIFactory.createForUser()` según el `providerId` del runtime del usuario.