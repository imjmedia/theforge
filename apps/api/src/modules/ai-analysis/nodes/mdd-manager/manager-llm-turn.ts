import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { MANAGER_MDD_PROMPT } from "../../prompts/load-prompts.js";
import type { MDDStateType } from "../../state/index.js";
import { getUserBrief } from "../../utils/mdd-user-brief.js";
import { parseJsonOrThrow } from "../../utils/parse-json.js";
import { getAgenticRagToolset } from "../../tools/tool-registry.js";
import { runAgentToolsRound } from "../../utils/mdd-agent-tools-invoke.js";
import type { MddManagerToolDeps } from "./manager-types.js";
import { LOG } from "./manager-context.util.js";
import {
  inferSectionsFromMessage,
  looksLikeExplicitMddModificationRequest,
  replyClaimsDocumentWasModified,
} from "./manager-heuristics.js";
import { expandSectionsToRun } from "./manager-plan.js";

/** Schema para parse manual (discriminated union). */
const managerOutputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), reply: z.string() }),
  z.object({
    action: z.literal("delegate"),
    target: z.enum(["clarifier_only", "full_pipeline", "sections"]).optional(),
    sections: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("search_memory"),
    memorySearchQuery: z.string(),
  }),
]);

/**
 * Schema plano para structured output. OpenAI exige que 'required' incluya todas las propiedades;
 * no usar .optional() ni .default() o el JSON schema tendrá campos fuera de required y fallará.
 */
const managerStructuredOutputSchema = z.object({
  action: z.enum(["reply", "delegate", "search_memory"]).describe("reply = solo aclaración; delegate = ejecutar agentes; search_memory = buscar en grafo"),
  reply: z.string().describe("Si action es reply: respuesta breve al usuario; si delegate/search enviar cadena vacía"),
  target: z
    .enum(["clarifier_only", "full_pipeline", "sections"])
    .describe("clarifier_only = solo sección 1; full_pipeline = todo; sections = solo los listados en sections"),
  sections: z
    .array(z.string())
    .describe("Si target es sections: software_architect, security, integration; si no, array vacío"),
  memorySearchQuery: z
    .string()
    .describe("Si action es search_memory: la intención a buscar en el grafo (ej: 'auth con MFA'); si no, cadena vacía"),
});

export type ManagerLlmTurnResult = {
  action: "reply" | "delegate" | "search_memory";
  replyContent: string;
  delegateTarget?: "clarifier_only" | "full_pipeline" | "sections";
  sectionsToRun?: string[];
};

export type RunManagerLlmTurnOptions = {
  llm: BaseChatModel;
  toolDeps?: MddManagerToolDeps | null;
  state: MDDStateType;
  userMessage: string;
  hasBench: boolean;
  hasDraft: boolean;
};

function buildManagerPromptContext(
  state: MDDStateType,
  userMessage: string,
  hasBench: boolean,
  round: number,
): string {
  const userBrief = getUserBrief(state);
  const context = [
    "**Contexto:**",
    userBrief ? `**Objetivo del usuario (resumen):** ${userBrief}\n` : "",
    hasBench ? `**Benchmark (DBGA):**\n${(state.dbgaContent ?? "").trim().slice(0, 4000)}${(state.dbgaContent ?? "").length > 4000 ? "…" : ""}` : "**Benchmark:** No hay. El usuario indicó tema; los agentes generan/refinan el MDD.",
    state.userInputAccumulated?.trim() ? `\n**Respuestas del usuario:**\n${state.userInputAccumulated.trim()}` : "",
    state.mddDraft?.trim() ? `\n**Borrador MDD (completo):**\n${state.mddDraft.slice(0, 12_000)}${state.mddDraft.length > 12_000 ? "\n\n...(truncado, las últimas secciones pueden estar omitidas)" : ""}` : "",
    state.auditorFeedback?.trim() ? `\n**Feedback del Auditor:**\n${state.auditorFeedback.trim()}` : "",
    state.episodicMemoryContext?.trim()
      ? `\n**Memoria episódica (evaluador / reflexión — no ignores si pide corregir contratos o código):**\n${state.episodicMemoryContext.trim().slice(0, 4000)}${(state.episodicMemoryContext?.length ?? 0) > 4000 ? "…" : ""}`
      : "",
    state.lastStepFailed
      ? `\n**Falló un paso anterior:** nodo "${state.lastStepFailed.node}": ${state.lastStepFailed.error}. El usuario reanudó para re-planificar. Decide si reintentar (delegate a ese nodo o pipeline), omitir o pedir aclaración (reply).`
      : "",
    userMessage
      ? `\n**Mensaje actual:**\n${userMessage}\n\n**Instrucción:** Clasifica en una de las intenciones del prompt.\n\n**REGLAS PARA PREGUNTAS:** Si el usuario pregunta "para qué", "por qué", "qué es", "cómo funciona", "dónde se usa" o cualquier pregunta factual sobre el contenido del MDD (tecnologías, tablas, endpoints, infraestructura), responde con "reply" — es una consulta informativa, NO un cambio. No trates preguntas como solicitudes de modificación.\n\n**REGLAS PARA CAMBIOS Y CORRECCIONES:**\n- Si el mensaje describe una **necesidad** (pantalla, tabla, endpoint, flujo, MFA, etc.) que afecta a uno o más agentes → target: "sections"\n- Si el mensaje hace una **corrección** sobre contenido que YA EXISTE en el Borrador MDD (ej. "cambia X por Y", "te faltó Z", "en la sección N.N usa W") → DELEGA a clarifier o sections. No respondas con reply. El usuario está corrigiendo el documento, no preguntando.\n- Si el usuario menciona una sección específica (ej. "sección 2.1" o "§2.1") → DELEGA inmediatamente. El usuario está señalando contenido existente que debe modificarse.\n- Si es solo aclaración → "reply"\n- Si es confirmar o información amplia → "delegate" (pipeline completo)\n- Si el usuario **acaba de responder** a preguntas que hiciste (mensaje con contenido concreto, no solo "sí"/"no") → **delega** para incorporar su respuesta al documento; no hagas otra pregunta de seguimiento.\n- Si el mensaje es corto y usa "lo", "eso", "elimínenlo" y en Respuestas del usuario o en el Borrador se mencionó algo concreto (ej. Kubernetes, una tecnología) → **delega** con esa directiva; no respondas pidiendo "qué especificar" o "qué eliminar".\n- Ante la duda, "reply".`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${MANAGER_MDD_PROMPT}\n\n---\nRonda ${round}.\n\n${context}`;
}

async function parseManagerLlmResponse(
  llm: BaseChatModel,
  messages: HumanMessage[],
  complexity?: MDDStateType["mddComplexity"],
): Promise<Pick<ManagerLlmTurnResult, "action" | "replyContent" | "delegateTarget" | "sectionsToRun"> & { memoryQuery?: string }> {
  let action: "reply" | "delegate" | "search_memory" = "reply";
  let replyContent = "¿En qué más puedo ayudarte con el MDD? Puedes pedir refinamientos o revisar el documento.";
  let delegateTarget: "clarifier_only" | "full_pipeline" | "sections" | undefined;
  let sectionsToRun: string[] | undefined;
  let memoryQuery: string | undefined;

  const useStructuredOutput =
    "withStructuredOutput" in llm && typeof (llm as { withStructuredOutput?: (schema: unknown, config?: unknown) => unknown }).withStructuredOutput === "function";

  if (useStructuredOutput) {
    try {
      const runnable = (llm as { withStructuredOutput(schema: unknown, config?: unknown): { invoke(input: unknown): Promise<unknown> } }).withStructuredOutput(
        managerStructuredOutputSchema,
        { method: "function_calling", strict: true },
      );
      const parsed = (await runnable.invoke(messages)) as z.infer<typeof managerStructuredOutputSchema>;
      action = parsed.action;
      if (parsed.action === "reply" && parsed.reply?.trim()) replyContent = parsed.reply.trim();
      if (parsed.action === "delegate") {
        delegateTarget = parsed.target;
        if (parsed.target === "sections" && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
          sectionsToRun = expandSectionsToRun(parsed.sections, { complexity });
        }
      }
      if (parsed.action === "search_memory") {
        memoryQuery = parsed.memorySearchQuery;
      }
    } catch (err) {
      LOG("structured output falló, fallback a invoke+parse: %s", err instanceof Error ? err.message : String(err));
      const response = await llm.invoke(messages);
      const text = typeof response.content === "string" ? response.content : "";
      if (text.trim()) {
        try {
          const parsed = parseJsonOrThrow(text, managerOutputSchema);
          action = parsed.action;
          if (parsed.action === "reply" && parsed.reply?.trim()) replyContent = parsed.reply.trim();
          if (parsed.action === "delegate" && "target" in parsed) {
            delegateTarget = parsed.target;
            if (parsed.target === "sections" && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
              sectionsToRun = expandSectionsToRun(parsed.sections, { complexity });
            }
          }
          if (parsed.action === "search_memory") {
            memoryQuery = parsed.memorySearchQuery;
          }
        } catch { /* keep defaults */ }
      }
    }
  } else {
    const response = await llm.invoke(messages);
    const text = typeof response.content === "string" ? response.content : "";
    if (text.trim()) {
      try {
        const parsed = parseJsonOrThrow(text, managerOutputSchema);
        action = parsed.action;
        if (parsed.action === "reply" && parsed.reply?.trim()) replyContent = parsed.reply.trim();
        if (parsed.action === "delegate" && "target" in parsed) {
          delegateTarget = parsed.target;
          if (parsed.target === "sections" && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
            sectionsToRun = expandSectionsToRun(parsed.sections, { complexity });
          }
        }
        if (parsed.action === "search_memory") {
          memoryQuery = parsed.memorySearchQuery;
        }
      } catch { /* keep defaults */ }
    }
  }

  return { action, replyContent, delegateTarget, sectionsToRun, memoryQuery };
}

/** Invoca el LLM del Manager (structured output + opcional búsqueda en memoria) y aplica guardrails de reply. */
export async function runManagerLlmTurn(options: RunManagerLlmTurnOptions): Promise<ManagerLlmTurnResult> {
  const { llm, toolDeps, state, userMessage, hasBench, hasDraft } = options;
  const round = (state.managerRound ?? 0) + 1;
  const prompt = buildManagerPromptContext(state, userMessage, hasBench, round);
  let messages: HumanMessage[] = [new HumanMessage(prompt)];

  let action: "reply" | "delegate" | "search_memory" = "reply";
  let replyContent = "¿En qué más puedo ayudarte con el MDD? Puedes pedir refinamientos o revisar el documento.";
  let delegateTarget: "clarifier_only" | "full_pipeline" | "sections" | undefined;
  let sectionsToRun: string[] | undefined;

  for (let i = 0; i < 2; i++) {
    const parsed = await parseManagerLlmResponse(llm, messages, state.mddComplexity);
    action = parsed.action;
    replyContent = parsed.replyContent;
    delegateTarget = parsed.delegateTarget;
    sectionsToRun = parsed.sectionsToRun;

    if (parsed.action === "search_memory" && parsed.memoryQuery && i < 2) {
      LOG("ejecutando herramientas agénticas MDD/TheForge: %s", parsed.memoryQuery);
      let memoryContext = "La búsqueda semántica en grafo FalkorDB fue retirada; usa el borrador MDD y las herramientas disponibles.";

      if (toolDeps && state.projectId?.trim() && parsed.memoryQuery) {
        try {
          const tools = getAgenticRagToolset(
            toolDeps.projects,
            toolDeps.theforge,
            toolDeps.ai,
            state.projectId.trim(),
            {
              legacy: state.isLegacyProject === true,
              theforgeProjectId: state.theforgeProjectId?.trim() ?? null,
              activeStageId: state.activeStageId?.trim() ?? undefined,
            },
          );
          if (tools.length > 0) {
            const toolSummary = await runAgentToolsRound(llm, tools, parsed.memoryQuery);
            memoryContext = "### Herramientas MDD / TheForge (patch, enmienda, MCP):\n" + toolSummary;
          }
        } catch (err) {
          memoryContext += `\n\n(Error ejecutando herramientas agénticas: ${err instanceof Error ? err.message : String(err)})`;
        }
      }

      messages.push(new HumanMessage(`[Resultados para "${parsed.memoryQuery}"]:\n${memoryContext}\n\nInstrucción: Usa esta información para decidir la mejor arquitectura o delegación.`));
      continue;
    }
    break;
  }

  LOG("action=%s delegateTarget=%s sectionsToRun=%s", action, delegateTarget, sectionsToRun?.length);

  if (action === "reply" && userMessage && hasDraft && looksLikeExplicitMddModificationRequest(userMessage)) {
    LOG("reply anulado: cambio explícito MDD → forzar delegate/sections");
    action = "delegate";
    delegateTarget = "sections";
    sectionsToRun = expandSectionsToRun(inferSectionsFromMessage(userMessage), { complexity: state.mddComplexity });
    if (sectionsToRun.length === 0) {
      sectionsToRun = expandSectionsToRun(["software_architect", "security", "integration"], {
        complexity: state.mddComplexity,
      });
    }
  }

  if (action === "reply" && replyContent && replyClaimsDocumentWasModified(replyContent)) {
    LOG("reply anulado: afirma cambios en el MDD sin ejecutar agentes → forzar delegate/sections");
    action = "delegate";
    delegateTarget = "sections";
    const hint = [userMessage ?? "", replyContent].filter(Boolean).join(" ");
    sectionsToRun = expandSectionsToRun(inferSectionsFromMessage(hint), { complexity: state.mddComplexity });
    if (sectionsToRun.length === 0) {
      sectionsToRun = expandSectionsToRun(["software_architect", "security", "integration"], {
        complexity: state.mddComplexity,
      });
    }
    replyContent = "";
  }

  return { action, replyContent, delegateTarget, sectionsToRun };
}
