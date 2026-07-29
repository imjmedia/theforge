import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AIFactory } from "../../ai/ai.factory.js";
import {
  formatModelsUnavailableMessage,
  ModelsUnavailableError,
  type ModelsUnavailableDetails,
} from "../../ai/config/llm-model-fallback.js";
import type { UserLLMRuntime } from "../../ai/providers/llm-runtime.types.js";
import { extractLlmText, extractLlmToolCalls, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { createDbgaLLMFromRuntime } from "./create-dbga-llm.js";

const probeSchema = z.object({
  ok: z.literal(true),
  probe: z.string().min(1),
});

export type MddLlmPreflightProbeResult = {
  ok: boolean;
  mode: "content" | "tool_calls" | "none";
  model: string;
  reason?: string;
};

function chatModelChain(runtime: UserLLMRuntime): string[] {
  const chain = [runtime.chatModel, ...(runtime.chatModelFallbacks ?? [])];
  const seen = new Set<string>();
  return chain.filter((m) => {
    if (!m || seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

function reorderRuntimeForModel(runtime: UserLLMRuntime, workingModel: string): UserLLMRuntime {
  const chain = chatModelChain(runtime);
  const rest = chain.filter((m) => m !== workingModel);
  return {
    ...runtime,
    chatModel: workingModel,
    chatModelFallbacks: rest,
  };
}

/**
 * Sonda ligera: el modelo debe devolver JSON mínimo parseable O tool_calls parseables.
 * Evita quemar el pipeline MDD completo con modelos que devuelven vacío (p. ej. deepseek tool-only).
 */
export async function probeMddLlmModel(
  llm: BaseChatModel,
  model: string,
  tag = "MddPreflight",
): Promise<MddLlmPreflightProbeResult> {
  const prompt =
    'Responde SOLO con JSON válido (sin markdown): {"ok":true,"probe":"mdd"}. ' +
    "No uses herramientas; una sola línea JSON.";
  try {
    const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
      tag,
      maxAttempts: 2,
      acceptToolCallsWithoutContent: true,
      isResponseValid: (text) => {
        if (!text.trim()) return false;
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return false;
          return probeSchema.safeParse(JSON.parse(jsonMatch[0])).success;
        } catch {
          return false;
        }
      },
    });
    if (!response) {
      return { ok: false, mode: "none", model, reason: "sin respuesta tras reintentos" };
    }
    const toolCalls = extractLlmToolCalls(response);
    if (toolCalls.length > 0) {
      return { ok: true, mode: "tool_calls", model };
    }
    const text = extractLlmText(response).trim();
    if (!text) {
      return { ok: false, mode: "none", model, reason: "respuesta vacía sin tool_calls" };
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, mode: "none", model, reason: "sin JSON parseable" };
    }
    const parsed = probeSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) {
      return { ok: false, mode: "none", model, reason: "JSON no cumple esquema de sonda" };
    }
    return { ok: true, mode: "content", model };
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    console.warn(`[${tag}] modelo «${model}» falló sonda: ${reason}`);
    return { ok: false, mode: "none", model, reason };
  }
}

/**
 * Resuelve runtime BYOK y reordena la cadena al primer modelo que pasa la sonda MDD.
 * Lanza ModelsUnavailableError con mensaje en español si ninguno responde.
 */
export async function resolveMddRuntimeWithPreflight(
  aiFactory: AIFactory,
  userId: string,
): Promise<UserLLMRuntime> {
  const runtime = await aiFactory.resolveRuntime(userId);
  const models = chatModelChain(runtime);
  if (models.length === 0) {
    throw new ModelsUnavailableError({
      modelsChain: [],
      failedModel: runtime.chatModel || "(vacío)",
      cause: "No hay modelos configurados para el pipeline MDD.",
      label: "MddPreflight",
    });
  }

  const failures: string[] = [];
  for (const model of models) {
    const singleModelRuntime: UserLLMRuntime = {
      ...runtime,
      chatModel: model,
      chatModelFallbacks: [],
    };
    const llm = createDbgaLLMFromRuntime(singleModelRuntime, { outputTokenPurpose: "auditor" });
    const probe = await probeMddLlmModel(llm, model);
    if (probe.ok) {
      if (model !== runtime.chatModel) {
        console.warn(
          `[MddPreflight] modelo principal «${runtime.chatModel}» no pasó sonda; usando «${model}» (${probe.mode})`,
        );
      } else {
        console.log(`[MddPreflight] modelo «${model}» OK (${probe.mode})`);
      }
      return reorderRuntimeForModel(runtime, model);
    }
    failures.push(`«${model}»: ${probe.reason ?? "falló"}`);
  }

  const details: ModelsUnavailableDetails = {
    modelsChain: models,
    failedModel: models[models.length - 1] ?? runtime.chatModel,
    cause: failures.join("; "),
    label: "MddPreflight",
  };
  throw new ModelsUnavailableError(
    details,
    formatModelsUnavailableMessage(details) +
      " La sonda MDD exige JSON mínimo o tool_calls parseables antes de iniciar el pipeline.",
  );
}
