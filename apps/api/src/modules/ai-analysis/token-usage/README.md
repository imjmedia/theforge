# Token Usage Telemetry

Módulo que registra cada llamada LLM del Workshop (chat, cascada de documentos, pipeline MDD) en la tabla `TokenUsage` para mostrar coste real por documento generado en la columna de métricas.

## Arquitectura

```
Controller (chat / cascade / MDD queue)
  └── runWithTokenUsageContext(ctx, fn)        ← AsyncLocalStorage
        └── AiService.generateResponse/Stream
              └── LLMProvider (OpenAI / Anthropic / Gemini)
                    └── response.usage / stream chunk usage
                          └── recordTokenUsageFromContext()
                                └── TokenUsageService.record()     ← BD
```

- **`token-usage.context.ts`** — `AsyncLocalStorage<TokenUsageContextValue>`. Helpers: `runWithTokenUsageContext(payload, fn)`, `runWithTokenUsageContext` para propagación transparente a través de awaits.
- **`token-usage.service.ts`** — `TokenUsageService` (NestJS provider): `record(event)` persite un evento. `getSummary(projectId)` agrega por documento/modelo vía `aggregateTokenUsageRows` (función pura, testeable). `recordAsync()` fire-and-forget para adapters de streaming.
- **`token-usage-recorder.ts`** — Helper DI-agnóstico en `apps/api/src/modules/ai/utils/`. `recordTokenUsageFromContext(provider, model, promptTok, completionTok, totalTok, telemetría?)` consume el contexto activo vía `getActiveTokenUsageContext()` y delega al `TokenUsageService` registrado en `globalThis` por `onModuleInit`.
- **`chat-model-pricing.ts`** — Catálogo USD/MXN por `(providerId, modelId)`. `calculateChatCostUsd(...)` calcula el coste; `usdToMxn(usd)` (en `FxRateService`) lo convierte.
- **`fx-rate.service.ts`** — Lee `AppConfig.mxn_per_usd` con cache 60s. `FxRateService.usdToMxn(usd)` async. `invalidate()` se llama desde `SystemConfigService.patchSettings` cuando cambia el TC.

## Cost snapshots

El `costMxn` se **snapshotea** en cada evento con el TC vigente al momento del call. Cambios futuros en el TC (Ajustes → Sistema) **no afectan** a totales históricos. La columna `mxnPerUsd` en `getSummary` devuelve el TC actual de la plataforma para que la UI lo muestre como info.

## Cómo agregar un modelo nuevo al catálogo

Cuando el equipo agregue un modelo (ej. `anthropic/claude-4.5-sonnet` en OpenRouter, o `gpt-4.1` directo), basta con editar `apps/api/src/modules/ai/providers/chat-model-pricing.ts` y añadir entrada al objeto `CHAT_MODEL_PRICING`:

```ts
// OpenRouter (slug con prefijo upstream)
"openrouter:anthropic/claude-4.5-sonnet": {
  input: 3,        // USD por 1M input tokens
  output: 15,      // USD por 1M output tokens
  source: "openrouter",
  capturedAt: "2026-07-24",
},

// Directo (OpenAI / Anthropic / Gemini / Groq / Cloudflare)
"openai:gpt-4.1": { input: 2, output: 8, source: "openai" },
"anthropic:claude-4-5-sonnet-20251001": { input: 3, output: 15, source: "anthropic" },
```

Convenciones:
- **Key**: `${providerId}:${modelId}` — sin prefijo upstream para proveedores directos; con prefijo upstream (e.g. `openai/`, `anthropic/`) para OpenRouter.
- **`input` / `output`**: USD por millón de tokens. Snapshot del precio público; actualizar cuando el proveedor cambie tarifas.
- **`source`**: nombre del proveedor (auditoría).
- **`capturedAt`**: ISO 8601. Opcional pero útil para stale-checks manuales.

Para proveedores custom o precios negociados por tenant, usar `registerChatModelPricingOverride(providerId, modelId, pricing)` en runtime (expuesto en `chat-model-pricing.ts`).

Si el modelo no está catalogado, `calculateChatCostUsd` devuelve 0 — el evento se persiste con `costUsd=0 / costMxn=0` la fila queda con `costKnown: false` y la UI muestra «coste desconocido» en lugar de $0.00: el 0 no significa gratis. La agregación por documento sigue mostrando tokens reales.

## Cómo agregar un nuevo `documentField`

La lista de `documentField` es abierta (string libre). Para que la UI muestre una etiqueta legible:

1. Editar `apps/web/src/components/TokenUsageCard.tsx` (`DOCUMENT_LABELS`).
2. Si el nuevo campo NO está en `apps/api/src/modules/ai/ai.service.ts:finishDocumentGeneration`, añadir `telemetryContext.documentField: "<type>Content"` al `generateOptions` del caller.
3. Si el campo se genera vía `mdd-queue.service.executeJob`, ya queda como `mddContent` por default.

## Wiring por origen

| Origen | Cómo se inyecta `telemetryContext` |
|---|---|
| Workshop chat (`sessions.service.ts`) | `buildSessionChatLlmOptions` → `documentField: "chat"`, `context: "chat"`. |
| Cascada de documentos (`ai.service.ts:finishDocumentGeneration`) | `documentField: "<type>Content"` (e.g. `specContent`, `blueprintContent`). |
| MDD pipeline (`mdd-queue.service.executeJob`) | `runWithTokenUsageContext` envuelve el job entero → `documentField: "mddContent"`, `context: "initial" \| "regenerate"`, `jobId`. |
| Legacy MDD (`legacyCoordinator.generateMdd`) | Mismo wrapper, `context: "regenerate"` si hay `dbgaContent` o `initialMessage` previo. |

## Tests

```
node --import tsx --test \
  src/modules/ai/providers/chat-model-pricing.spec.ts \
  src/modules/ai-analysis/token-usage/token-usage.context.spec.ts \
  src/modules/ai-analysis/token-usage/token-usage.service.spec.ts \
  src/modules/fx-rate/fx-rate.service.spec.ts \
  src/modules/ai-analysis/utils/mdd-llm-retry.util.derive.spec.ts \
  src/modules/ai/utils/token-usage-recorder.spec.ts \
  src/modules/ai-analysis/utils/mdd-llm-retry.util.telemetry.spec.ts \
  src/modules/ai-analysis/utils/mdd-scoped-stream.util.telemetry.spec.ts
```

El conteo de specs en verde no se mantiene en este documento: se obtiene al ejecutar el comando.

## Contadores del resumen (lote 2b)

- `GET /ai-analysis/token-usage` añade por documento y por modelo: `failedCalls` (error, timeout o abort; entran en `calls` con coste 0 y no se facturan), `estimatedCalls` (tokens chars/4) y `costUnknown` (hay filas sin tarifa: el coste mostrado no es completo).
- `classifyTokenUsageOutcome` (`token-usage.context.ts`) es la regla única para contar una fila: `measured` (`ok` o `invalid`; sin `outcome` si `costKnown !== false`), `failed` (`error`, `timeout`, `abort`) o `unknown` (sin `outcome` y con `costKnown === false`, que no cuenta como medida ni como fallida). La usan el resumen y el eval.
- El contrato de respuesta está en `packages/shared-types/src/token-usage-api.ts`. `TokenUsageCard` muestra «(+N fallidas)» y los rótulos «coste estimado» y «coste desconocido».


## Endpoints

- `GET /api/ai-analysis/token-usage?projectId&stageId&includeChat` — resumen agregado por documento y modelo.
- `GET /api/ai-analysis/token-usage/events?projectId&stageId&documentField&limit` — eventos crudos (debug).

Ambos requieren `super_admin` ? no — sólo sesión autenticada. Renderizados en UI por `TokenUsageCard` (`apps/web/src/components/TokenUsageCard.tsx`) integrado en `WorkshopMetricsColumnInner.tsx`.

## Telemetría por llamada (O14)

`TokenUsage` guarda, además de tokens y coste, columnas nullable por llamada: `latencyMs`, `attempts`,
`outcome` (`ok | timeout | abort | error | invalid`), `costKnown` (false si el modelo no tiene tarifa:
el coste 0 no significa gratis), `estimated` (true si los tokens son chars/4) y `modelActual`
(`response_metadata.chained_model`).

- El contexto (`withTokenUsageContextPatch`) acepta `node`, `capability`, `latencyMs`, `attempts`, `outcome`,
  `costKnown`, `estimated` y `modelActual`; `capability` no tiene columna y hace de `node` si este falta.
- `TokenUsageService.recordEstimated(...)` / `recordUsageEstimateOnAbort(...)` (recorder) registran pases
  abortados o cortados antes de `usage_metadata` como estimación marcada.
- `modelId` es el modelo configurado; `modelActual` el que respondió (fallback de la cadena). El coste se
  tarifa con `modelActual` si existe (`resolvePricingModelId`).
- `skipCost` (recorder/servicio): un `error` sin salida parcial (p. ej. 400, 401/403, contexto excedido, cuota o 5xx) no fue facturado por el proveedor: la fila se registra con tokens 0, `costUsd` 0 y `costKnown` false.
  `abort`/`timeout`, o un error con salida parcial, sí conservan la estimación con coste (`mdd-llm-retry.util.ts`,
  `estimateFailedAttempt`).
- Los adaptadores HTTP (`anthropic`, `gemini`, `openai-compatible` en `apps/api/src/modules/ai/adapters/`) llaman a
  `recordTokenUsageFromContext` tanto en la respuesta completa como en el stream. Los pases MDD registran por su
  propio camino (`mdd-llm-retry.util.ts`, `mdd-scoped-stream.util.ts`).
- En cada llamada MDD se escribe además una línea `[MDD:LlmCall]` (JSON de una línea con `node`, modelo, tokens,
  latencia y resultado; `estimated: true` solo cuando la fila es estimación).
- Un fallo de escritura se loggea como `error` y suma a `failedWrites` (`getTelemetryHealth()`); nunca lanza.
