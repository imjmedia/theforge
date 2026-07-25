/**
 * Utilidades LLM globales (sin claves ni modelos desde env — BYOK por usuario).
 */
import {
  resolvePlatformConfigNumber,
} from "../../system-config/platform-config.runtime.js";

export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_CHAT_MODEL = "nousresearch/hermes-3-llama-3.1-405b";
export const OPENROUTER_DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
/** Referencia de catálogo OpenRouter; el runtime usa `ProviderInstance.visionModel` (BYOK). */
export const OPENROUTER_DEFAULT_VISION_MODEL = "openai/gpt-4o";

/**
 * Tope de tokens de **salida** (`max_tokens` en la API), no ventana de contexto.
 * Default 128K: techo global (`LLM_MAX_TOKENS`); los perfiles por tarea nunca lo superan.
 */
export const LLM_MAX_TOKENS_DEFAULT = 131_072;

/** Perfiles de salida por tipo de tarea (siempre acotados por `llmMaxTokens()`). */
export const LLM_OUTPUT_TOKEN_PROFILES = {
  /** Turnos conversacionales (chat sin regenerar documento). */
  chat: 16_384,
  /** Bienvenida / mensajes cortos. */
  welcome: 2_048,
  /** Design System (DESIGN.md). */
  uxGuide: 16_384,
  /** Documento completo vía Workshop (MDD, DBGA, Blueprint, Spec, BRD…). */
  document: 65_536,
  /** Nodos LangGraph MDD/DBGA (una sección por llamada). */
  langgraph: 65_536,
  /** Auditor MDD / cross-consistency. */
  auditor: 131_072,
  /** Tasks Planner JSON (plan grande en proyectos HIGH). */
  tasksPlanner: 131_072,
  /** Tasks documento markdown completo (Workshop tab). */
  tasksDoc: 131_072,
  /** parseChecklist y salidas JSON cortas. */
  checklist: 4_096,
} as const;

export type LlmOutputTokenPurpose = keyof typeof LLM_OUTPUT_TOKEN_PROFILES;

const WORKSHOP_DOCUMENT_TABS = new Set([
  "mdd",
  "benchmark",
  "spec",
  "brd",
  "blueprint",
  "api-contracts",
  "logic-flows",
  "architecture",
  "use-cases",
  "user-stories",
  "tasks",
  "infra",
  "phase0",
]);

/** Tope global desde catálogo de plataforma (BD → env → default). */
export function llmMaxTokens(): number {
  return resolvePlatformConfigNumber("llm_max_tokens");
}

/**
 * Resuelve `max_tokens` para una tarea concreta.
 * `explicitOverride` (p. ej. desde `GenerateResponseOptions.maxTokensOverride`) gana sobre el perfil.
 */
export function resolveLlmMaxTokensForPurpose(
  purpose: LlmOutputTokenPurpose = "chat",
  explicitOverride?: number,
): number {
  const ceiling = llmMaxTokens();
  if (explicitOverride != null && Number.isFinite(explicitOverride) && explicitOverride > 0) {
    return Math.min(explicitOverride, ceiling);
  }
  const profile = LLM_OUTPUT_TOKEN_PROFILES[purpose] ?? LLM_OUTPUT_TOKEN_PROFILES.chat;
  return Math.min(profile, ceiling);
}

/** Perfil según pestaña activa del Workshop (chat orquestador / stream). */
export function resolveLlmMaxTokensForWorkshopTab(
  activeTab?: string,
  opts?: { welcomeBrief?: boolean },
): number {
  if (opts?.welcomeBrief) {
    return resolveLlmMaxTokensForPurpose("welcome");
  }
  const tab = activeTab?.trim();
  if (tab === "ux-ui-guide") {
    return resolveLlmMaxTokensForPurpose("uxGuide");
  }
  if (tab === "tasks") {
    return resolveLlmMaxTokensForPurpose("tasksDoc");
  }
  if (tab && WORKSHOP_DOCUMENT_TABS.has(tab)) {
    return resolveLlmMaxTokensForPurpose("document");
  }
  return resolveLlmMaxTokensForPurpose("chat");
}

/**
 * Dimensión de embeddings: runtime BYOK/instancia tenant (`embeddingDimension` en Ajustes → Proveedores).
 */
export function resolveEmbeddingDimension(runtimeDim?: number | null): number {
  if (runtimeDim != null && runtimeDim > 0) return runtimeDim;
  return 1536;
}

/**
 * LangChain / ChatOpenAI: temperatura fija coherente con el workshop.
 */
export function resolveLangChainChatTemperature(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return override;
  }
  return 0.5;
}

/** @deprecated BYOK: sin snapshot desde env */
export function getLlmProvidersSnapshot(): { id: string; chatConfigured: boolean; active: boolean }[] {
  return [];
}

/** Fallback 429 en cadena cuando el proveedor activo define `chatModelFallbacks` (Ajustes → Proveedores). */
export function isChatFallbackOn429Enabled(hasFallbacks = true): boolean {
  return hasFallbacks;
}
