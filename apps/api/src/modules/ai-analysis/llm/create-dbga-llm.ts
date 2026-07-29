import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import {
  resolveLlmMaxTokensForPurpose,
  type LlmOutputTokenPurpose,
  resolveLangChainChatTemperature,
} from "../../ai/config/llm-config.js";
import type { AIFactory } from "../../ai/ai.factory.js";
import type { UserLLMRuntime } from "../../ai/providers/llm-runtime.types.js";
import type { ProviderId } from "../../ai/providers/provider-catalog.js";
import { ChainedFallbackChatModel } from "./chained-fallback-chat-model.js";
import { OpenRouterFallbackChatModel } from "./openrouter-fallback-chat-model.js";

/**
 * Factory de LLMs para el grafo MDD (DBGA, MDD high-complexity, Auditor, etc.).
 *
 * Cada `BaseChatModel` retornado se pasa al wrapper `invokeLlmWithRetry`
 * (mdd-llm-retry.util.ts). A su vez, ese wrapper extrae `usage_metadata`
 * del `AIMessage` retornado por LangChain y lo registra como `TokenUsage`
 * usando `deriveLlmIdentity(llm)` para reconstruir el `providerId`/`modelId`.
 *
 * IMPORTANTE — atribución de provider:
 *   Los adapters del módulo `ai/` (OpenAI-compat, Anthropic, Gemini) ya
 *   tienen `runtime.providerId` directo. El grafo MDD, en cambio, sólo
 *   recibe el `BaseChatModel`, así que la atribución depende de:
 *     1. Nombre de clase (`ChatAnthropic`, `ChatGoogleGenerativeAI`, `ChatBedrock`).
 *     2. `baseURL` en `configuration.baseURL` / `client.baseURL` / `lc_kwargs.baseURL`
 *        o `anthropicApiUrl` (OpenRouter, Groq, Cloudflare, OpenAI nativo).
 *     3. Heurística del slug del modelo (`anthropic/…` → OpenRouter, etc.).
 *   Si añades un nuevo proveedor o cambias la estructura de la config aquí,
 *   actualiza `deriveLlmIdentity` y `detectProviderFromBaseURL` en
 *   `mdd-llm-retry.util.ts`. El bug original: OpenRouter entraba vía
 *   `ChatOpenAI` con `baseURL = openrouter.ai/api/v1`; la heurística por
 *   clase devolvía `providerId: "openai"` y el coste caía a 0 USD.
 */

/** @internal */ const LLM_TIMEOUT_MS = parseInt(
  process.env.LANGGRAPH_LLM_TIMEOUT_MS?.trim() || "300000",
  10,
);

function chatModelChain(runtime: UserLLMRuntime): string[] {
  const chain = [runtime.chatModel, ...(runtime.chatModelFallbacks ?? [])];
  const seen = new Set<string>();
  return chain.filter((m) => {
    if (!m || seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

/** Opciones de creación del LLM (p. ej. temperature baja para nodos estructurales del MDD). */
export type CreateDbgaLLMOptions = {
  temperature?: number;
  /** Perfil de salida; default `langgraph` (16K por nodo). */
  outputTokenPurpose?: LlmOutputTokenPurpose;
  /** Tope explícito de salida (F6 per-scope); acotado por `llmMaxTokens()`. */
  maxTokensOverride?: number;
};

/** Alcance Arquitecto MDD para tope de tokens de salida (F6). */
export type MddArchitectScopeToken =
  | "stack"
  | "data_model"
  | "api_contracts"
  | "section5"
  | "security"
  | "integration"
  | "full";

/** Topes F6 por pasada scoped (chars ≈ tokens en modelos modernos). */
export const MDD_ARCHITECT_SCOPE_MAX_TOKENS: Record<MddArchitectScopeToken, number> = {
  stack: 4_096,
  data_model: 8_192,
  api_contracts: 12_288,
  section5: 3_072,
  security: 12_288,
  integration: 4_096,
  full: 65_536,
};

export function resolveMddArchitectScopeMaxTokens(scope: MddArchitectScopeToken): number {
  const cap = MDD_ARCHITECT_SCOPE_MAX_TOKENS[scope] ?? MDD_ARCHITECT_SCOPE_MAX_TOKENS.full;
  return Math.min(cap, resolveLlmMaxTokensForPurpose("langgraph"));
}

function buildChatOpenAI(
  runtime: UserLLMRuntime,
  model: string,
  temperatureOverride?: number,
  maxTokens?: number,
): ChatOpenAI {
  // ⚠️ `configuration.baseURL` es la señal canónica que `deriveLlmIdentity`
  // (utils/mdd-llm-retry.util.ts) usa para distinguir OpenRouter / Groq /
  // Cloudflare / OpenAI nativo en la cascada de detección. Si cambias la
  // estructura de configuración aquí, actualiza `readBaseURL()` en ese util
  // y la lista de heurísticas en `detectProviderFromBaseURL`.
  return new ChatOpenAI({
    model,
    temperature: resolveLangChainChatTemperature(temperatureOverride),
    maxTokens: maxTokens ?? resolveLlmMaxTokensForPurpose("langgraph"),
    timeout: LLM_TIMEOUT_MS,
    openAIApiKey: runtime.apiKey,
    configuration: { baseURL: runtime.baseURL },
  });
}

function buildLangChainChat(
  runtime: UserLLMRuntime,
  model: string,
  temperatureOverride?: number,
  maxTokens?: number,
): BaseChatModel {
  const temperature = resolveLangChainChatTemperature(temperatureOverride);
  const outputCap = maxTokens ?? resolveLlmMaxTokensForPurpose("langgraph");
  switch (runtime.providerId as ProviderId) {
    case "anthropic":
      return new ChatAnthropic({
        model,
        apiKey: runtime.apiKey,
        temperature,
        maxTokens: outputCap,
        clientOptions: { timeout: LLM_TIMEOUT_MS },
      });
    case "gemini":
      return new ChatGoogleGenerativeAI({
        model,
        apiKey: runtime.apiKey,
        temperature,
      });
    case "openrouter":
    case "openai":
    case "cloudflare":
    case "groq":
    default:
      return buildChatOpenAI(runtime, model, temperatureOverride, outputCap);
  }
}

function buildWithFallbacks(
  runtime: UserLLMRuntime,
  models: string[],
  build: (model: string) => BaseChatModel,
  temperatureOverride?: number,
  maxTokens?: number,
): BaseChatModel {
  if (models.length <= 1) {
    return build(models[0]!);
  }
  if (
    runtime.providerId === "openrouter" ||
    runtime.providerId === "openai" ||
    runtime.providerId === "cloudflare" ||
    runtime.providerId === "groq"
  ) {
    return new OpenRouterFallbackChatModel(
      (model) => buildChatOpenAI(runtime, model, temperatureOverride, maxTokens),
      models,
      undefined,
      // Telemetría: el wrapper no expone configuration.baseURL, así que
      // pasamos el providerId explícitamente para que deriveLlmIdentity
      // (mdd-llm-retry.util.ts) lo lea y no devuelva "modelId=unknown".
      runtime.providerId,
      // Modelo primario de la cadena (`runtime.chatModel`). Sin esto el
      // catálogo de pricing no encuentra la entrada y el costeSale a 0 USD.
      models[0],
    );
  }
  return new ChainedFallbackChatModel(build, models, undefined, undefined, runtime.providerId, models[0]);
}

export function createDbgaLLMFromRuntime(runtime: UserLLMRuntime, opts?: CreateDbgaLLMOptions): BaseChatModel {
  const models = chatModelChain(runtime);
  const purpose = opts?.outputTokenPurpose ?? "langgraph";
  const maxTokens =
    opts?.maxTokensOverride != null
      ? resolveLlmMaxTokensForPurpose(purpose, opts.maxTokensOverride)
      : resolveLlmMaxTokensForPurpose(purpose);
  return buildWithFallbacks(
    runtime,
    models,
    (model) => buildLangChainChat(runtime, model, opts?.temperature, maxTokens),
    opts?.temperature,
    maxTokens,
  );
}

/**
 * Factory for DBGA / MDD graphs: runtime BYOK del usuario (todos los proveedores del catálogo).
 * `opts.temperature` baja la temperatura (p. ej. 0.2 para nodos estructurales del MDD → reproducibilidad).
 */
export async function createDbgaLLM(aiFactory: AIFactory, userId: string, opts?: CreateDbgaLLMOptions): Promise<BaseChatModel> {
  const runtime = await aiFactory.resolveRuntime(userId);
  return createDbgaLLMFromRuntime(runtime, opts);
}

/**
 * LLM de Auditor (grafo MDD), Tasks Planner y Tasks Auditor LLM: `resolveAuditorRuntime` —
 * misma instancia activa con `auditorChatModel` opcional; si no hay override, `chatModel` del proveedor.
 */
export async function createMddAuditorLLM(
  aiFactory: AIFactory,
  userId: string,
): Promise<BaseChatModel> {
  const runtime = await aiFactory.resolveAuditorRuntime(userId);
  return createDbgaLLMFromRuntime(runtime, { outputTokenPurpose: "auditor" });
}

/**
 * LLM para §3 (modelo de datos) en pipeline HIGH: `highComplexityChatModel` opcional en la instancia;
 * si no hay override, mismo runtime que chat estructural.
 */
export async function createMddHighComplexityLLM(
  aiFactory: AIFactory,
  userId: string,
  opts?: CreateDbgaLLMOptions,
): Promise<BaseChatModel> {
  const runtime = await aiFactory.resolveHighComplexityRuntime(userId);
  const maxTokensOverride = opts?.maxTokensOverride ?? resolveMddArchitectScopeMaxTokens("data_model");
  return createDbgaLLMFromRuntime(runtime, { ...opts, maxTokensOverride });
}

/**
 * LLM rápido para chunks §4 (F6): primer fallback del runtime estructural, si existe.
 */
export function createMddApiContractsChunkLlmFromRuntime(
  runtime: UserLLMRuntime,
  opts?: Omit<CreateDbgaLLMOptions, "maxTokensOverride">,
): BaseChatModel | null {
  const fast = runtime.chatModelFallbacks?.[0]?.trim();
  if (!fast) return null;
  return createDbgaLLMFromRuntime(
    { ...runtime, chatModel: fast, chatModelFallbacks: [] },
    {
      temperature: opts?.temperature,
      outputTokenPurpose: opts?.outputTokenPurpose,
      maxTokensOverride: resolveMddArchitectScopeMaxTokens("api_contracts"),
    },
  );
}
