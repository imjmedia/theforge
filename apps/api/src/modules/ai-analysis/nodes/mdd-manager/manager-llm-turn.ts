import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { MANAGER_MDD_PROMPT } from "../../prompts/load-prompts.js";
import type { MDDStateType } from "../../state/index.js";
import { getUserBrief } from "../../utils/mdd-user-brief.js";
import { invokeLlmStructured } from "../../utils/mdd-llm-structured.util.js";
import { resolveLlmTimeoutMs, resolveMddManagerTurnBudgetMs } from "../../utils/mdd-llm-timeout.util.js";
import { deriveLlmIdentity, invokeLlmWithRetry, type InvokableLlm } from "../../utils/mdd-llm-retry.util.js";
import { createLlmAbortError } from "../../utils/mdd-llm-stream-invoke.util.js";
import { getAgenticRagToolset } from "../../tools/tool-registry.js";
import { runAgentToolsRound } from "../../utils/mdd-agent-tools-invoke.js";
import type { MddManagerToolDeps } from "./manager-types.js";
import { LOG } from "./manager-context.util.js";
import {
  inferAgentsFromAuditorFeedback,
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
    .describe("Si target es sections: software_architect, section5, security, integration; si no, array vacío"),
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
  /** Sólo pruebas: reloj del presupuesto del turno (default `Date.now`). */
  now?: () => number;
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
      ? `\n**Mensaje actual:**\n${userMessage}\n\n**Instrucción:** Clasifica en una de las intenciones del prompt.\n\n**REGLAS PARA PREGUNTAS:** Si el usuario pregunta "para qué", "por qué", "qué es", "cómo funciona", "dónde se usa" o cualquier pregunta factual sobre el contenido del MDD (tecnologías, tablas, endpoints, infraestructura), responde con "reply" — es una consulta informativa, NO un cambio. No trates preguntas como solicitudes de modificación.\n\n**REGLAS PARA CAMBIOS Y CORRECCIONES:**\n- Si el mensaje describe una **necesidad** (pantalla, tabla, endpoint, flujo, MFA, etc.) que afecta a uno o más agentes → target: "sections"\n- Si el mensaje hace una **corrección** sobre contenido que YA EXISTE en el Borrador MDD (ej. "cambia X por Y", "te faltó Z", "en la sección N.N usa W") → DELEGA a clarifier o sections. No respondas con reply. El usuario está corrigiendo el documento, no preguntando.\n- Si el usuario menciona una sección específica (ej. "sección 2.1" o "§2.1") → DELEGA inmediatamente. El usuario está señalando contenido existente que debe modificarse.\n- Si es solo aclaración → "reply"\n- Si es confirmar o información amplia → "delegate" (pipeline completo)\n- Si el usuario **acaba de responder** a preguntas que hiciste (mensaje con contenido concreto, no solo "sí"/"no") → **delega** para incorporar su respuesta al documento; no hagas otra pregunta de seguimiento.\n- Si el mensaje es corto y usa "lo", "eso", "elimínenlo" y en Respuestas del usuario o en el Borrador se mencionó algo concreto (ej. Kubernetes, una tecnología) → **delega** con esa directiva; no respondas pidiendo "qué especificar" o "qué eliminar".\n- Ante la duda, "delegate" con target "sections" infiriendo los agentes afectados; "reply" solo para preguntas conceptuales o factuales (nunca para cambios).`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${MANAGER_MDD_PROMPT}\n\n---\nRonda ${round}.\n\n${context}`;
}

type ManagerParseFallback = {
  /** Hay borrador MDD con contenido: el fallback delega a sections en vez de full_pipeline. */
  hasDraft: boolean;
  /** Mensaje del usuario, para inferir qué agentes tocar en el fallback. */
  userMessage: string;
};

/**
 * Salida del Manager vacía o no parseable → delegar (no contestar un reply genérico).
 * El reply genérico era el falso negativo clásico: el usuario pedía un cambio y recibía
 * "¿En qué más puedo ayudarte?" sin que corriera ningún agente.
 */
export function managerParseFallbackDecision(
  fallback: ManagerParseFallback,
  complexity?: MDDStateType["mddComplexity"],
): Pick<ManagerLlmTurnResult, "action" | "delegateTarget" | "sectionsToRun"> {
  if (!fallback.hasDraft) return { action: "delegate", delegateTarget: "full_pipeline", sectionsToRun: undefined };
  const inferred = inferSectionsFromMessage(fallback.userMessage);
  const agents = inferred.length > 0 ? inferred : inferAgentsFromAuditorFeedback(fallback.userMessage);
  return {
    action: "delegate",
    delegateTarget: "sections",
    sectionsToRun: expandSectionsToRun(agents, { complexity }),
  };
}

/** Salida del Manager ya validada (union discriminada de `managerOutputSchema`). */
type ManagerParsedOutput = z.infer<typeof managerOutputSchema>;

/** Holgura mínima (ms) para lanzar una etapa del turno; por debajo no se invoca y se aplica el fallback. */
const MIN_MANAGER_STAGE_BUDGET_MS = 15_000;

/** Presupuesto único del turno: lo fija `runManagerLlmTurn` y cada etapa lo consulta; ninguna abre uno nuevo. */
type ManagerTurnBudget = { deadlineAt: number; now: () => number };

/** Milisegundos que quedan del presupuesto del turno (nunca negativos). */
function turnBudgetLeftMs(budget: ManagerTurnBudget): number {
  return Math.max(0, budget.deadlineAt - budget.now());
}

/** Candidato a salida del Manager dentro de la respuesta: `parsed` con `includeRaw`, o el objeto directo. */
function managerStructuredCandidate(response: unknown): unknown {
  if (response == null || typeof response !== "object") return null;
  // Con `includeRaw` el objeto va en `parsed` (null si el parseo falló); sin él, la respuesta es el objeto.
  return "raw" in response ? (response as { parsed?: unknown }).parsed : response;
}

/**
 * Invoca el runnable de structured output (strict, function calling) con timeout, abort por señal
 * (ALS / `config.signal`) y SIN reintento ni streaming (la respuesta ya es un objeto parseado, no
 * texto). Devuelve `null` si falla por transporte/timeout o si la salida no cumple el esquema (el caller
 * cae al camino invoke+parse con reparación). Una cancelación se propaga como `AbortError`.
 *
 * `stageBudgetMs` es el presupuesto restante del turno. Sin streaming, `timeoutMs` es el tope real de la
 * llamada: `hardTimeoutMs` solo actúa en streaming, así que aquí no se pasa.
 *
 * Telemetría: `includeRaw: true` hace que el runnable devuelva `{ raw, parsed }`; el uso real
 * (`raw.usage_metadata`, `raw.response_metadata`) lo registra `invokeLlmWithRetry`, y el runnable derivado
 * no tiene identidad de modelo, así que se le pasa la del `llm` base (`identityOverride`). Un `parsed`
 * nulo o fuera de esquema se marca como respuesta inválida (`isResponseValid`): la traza y el uso quedan como `invalid`.
 */
async function invokeManagerStructuredOutput(
  llm: BaseChatModel,
  messages: HumanMessage[],
  stageBudgetMs: number,
): Promise<z.infer<typeof managerStructuredOutputSchema> | null> {
  const runnable = (llm as unknown as { withStructuredOutput(schema: unknown, config?: unknown): InvokableLlm }).withStructuredOutput(
    managerStructuredOutputSchema,
    { method: "function_calling", strict: true, includeRaw: true },
  );
  const response = await invokeLlmWithRetry(runnable, messages, {
    tag: "Manager",
    maxAttempts: 1,
    disableStreaming: true,
    timeoutMs: Math.min(stageBudgetMs, resolveLlmTimeoutMs()),
    isResponseValid: (_text, raw) => managerStructuredOutputSchema.safeParse(managerStructuredCandidate(raw)).success,
    identityOverride: deriveLlmIdentity(llm),
  });
  if (response == null || typeof response !== "object") return null;
  const parsed = managerStructuredOutputSchema.safeParse(managerStructuredCandidate(response));
  return parsed.success ? parsed.data : null;
}

async function parseManagerLlmResponse(
  llm: BaseChatModel,
  messages: HumanMessage[],
  complexity: MDDStateType["mddComplexity"] | undefined,
  fallback: ManagerParseFallback,
  turnBudget: ManagerTurnBudget,
): Promise<Pick<ManagerLlmTurnResult, "action" | "replyContent" | "delegateTarget" | "sectionsToRun"> & { memoryQuery?: string }> {
  let action: "reply" | "delegate" | "search_memory" = "reply";
  // Sin texto por defecto: un reply vacío del LLM se convierte en delegate (runManagerLlmTurn), nunca en
  // un "¿En qué más puedo ayudarte?" genérico que dejaba la petición sin ejecutar.
  let replyContent = "";
  let delegateTarget: "clarifier_only" | "full_pipeline" | "sections" | undefined;
  let sectionsToRun: string[] | undefined;
  let memoryQuery: string | undefined;
  const applyParseFallback = (reason: string) => {
    const decision = managerParseFallbackDecision(fallback, complexity);
    LOG("salida del Manager %s → delegate por defecto (target=%s sections=%s)", reason, decision.delegateTarget, decision.sectionsToRun?.join(",") ?? "-");
    action = decision.action;
    delegateTarget = decision.delegateTarget;
    sectionsToRun = decision.sectionsToRun;
  };
  const applyParsed = (parsed: ManagerParsedOutput | z.infer<typeof managerStructuredOutputSchema>) => {
    action = parsed.action;
    if (parsed.action === "reply" && parsed.reply?.trim()) replyContent = parsed.reply.trim();
    if (parsed.action === "delegate") {
      delegateTarget = parsed.target;
      if (parsed.target === "sections" && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
        sectionsToRun = expandSectionsToRun(parsed.sections, { complexity });
      }
    }
    if (parsed.action === "search_memory") memoryQuery = parsed.memorySearchQuery;
  };

  const useStructuredOutput =
    "withStructuredOutput" in llm && typeof (llm as { withStructuredOutput?: (schema: unknown, config?: unknown) => unknown }).withStructuredOutput === "function";
  // Cada etapa mide su tope contra el presupuesto del turno; ninguna abre uno nuevo.
  const turnBudgetAvailable = (): boolean => turnBudgetLeftMs(turnBudget) >= MIN_MANAGER_STAGE_BUDGET_MS;

  if (useStructuredOutput && turnBudgetAvailable()) {
    try {
      const structured = await invokeManagerStructuredOutput(llm, messages, turnBudgetLeftMs(turnBudget));
      if (structured) {
        applyParsed(structured);
        return { action, replyContent, delegateTarget, sectionsToRun, memoryQuery };
      }
      LOG("structured output sin resultado válido, fallback a invoke+parse con reparación");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      LOG("structured output falló, fallback a invoke+parse: %s", err instanceof Error ? err.message : String(err));
    }
  }

  // Sin presupuesto para otra llamada (el structured lo consumió o ya estaba agotado): no se invoca.
  if (!turnBudgetAvailable()) {
    applyParseFallback(`presupuesto del turno agotado (restante ${turnBudgetLeftMs(turnBudget)} ms, no se invoca)`);
    return { action, replyContent, delegateTarget, sectionsToRun, memoryQuery };
  }

  // Camino invoke+parse: timeout, abort por ALS, reintento de transporte acotado y UNA reparación
  // del JSON (error de validación re-inyectado) antes del fallback "delegar".
  const result = await invokeLlmStructured({
    llm,
    messages,
    schema: managerOutputSchema,
    tag: "Manager",
    deadlineMs: turnBudgetLeftMs(turnBudget),
    now: turnBudget.now,
  });
  if (result.ok) {
    applyParsed(result.value);
  } else if (result.reason === "aborted") {
    throw createLlmAbortError("Manager");
  } else if (result.reason === "transport") {
    applyParseFallback(`sin respuesta (attempts=${result.attempts})`);
  } else if (result.reason === "deadline") {
    applyParseFallback(`presupuesto agotado (attempts=${result.attempts})`);
  } else {
    applyParseFallback(`no parseable (attempts=${result.attempts}: ${(result.lastError ?? "").slice(0, 120)})`);
  }

  return { action, replyContent, delegateTarget, sectionsToRun, memoryQuery };
}

/** Invoca el LLM del Manager (structured output + opcional búsqueda en memoria) y aplica guardrails de reply. */
export async function runManagerLlmTurn(options: RunManagerLlmTurnOptions): Promise<ManagerLlmTurnResult> {
  const { llm, toolDeps, state, userMessage, hasBench, hasDraft } = options;
  // Presupuesto del turno (LANGGRAPH_MDD_MANAGER_TURN_BUDGET_MS) fijado UNA vez: el structured output, el
  // invoke+parse con reparación y cada vuelta del bucle de search_memory consumen el mismo reloj.
  const now = options.now ?? Date.now;
  const turnBudget: ManagerTurnBudget = { deadlineAt: now() + resolveMddManagerTurnBudgetMs(), now };
  const round = (state.managerRound ?? 0) + 1;
  const prompt = buildManagerPromptContext(state, userMessage, hasBench, round);
  let messages: HumanMessage[] = [new HumanMessage(prompt)];

  let action: "reply" | "delegate" | "search_memory" = "reply";
  let replyContent = "";
  let delegateTarget: "clarifier_only" | "full_pipeline" | "sections" | undefined;
  let sectionsToRun: string[] | undefined;
  let budgetExhaustedInTools = false;

  for (let i = 0; i < 2; i++) {
    const parsed = await parseManagerLlmResponse(llm, messages, state.mddComplexity, { hasDraft, userMessage }, turnBudget);
    action = parsed.action;
    replyContent = parsed.replyContent;
    delegateTarget = parsed.delegateTarget;
    sectionsToRun = parsed.sectionsToRun;

    if (parsed.action === "search_memory" && parsed.memoryQuery && i < 2) {
      LOG("ejecutando herramientas agénticas MDD/TheForge: %s", parsed.memoryQuery);
      let memoryContext = "No hay búsqueda semántica en proyectos históricos; usa el borrador MDD y las herramientas disponibles.";

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
            // La ronda comparte el presupuesto del turno: sin holgura no invoca al LLM y el turno delega.
            const toolRound = await runAgentToolsRound(llm, tools, parsed.memoryQuery, {
              deadlineAt: turnBudget.deadlineAt,
              now: turnBudget.now,
            });
            if (toolRound.budgetExhausted) {
              budgetExhaustedInTools = true;
              break;
            }
            memoryContext = "### Herramientas MDD / TheForge (patch, enmienda, MCP):\n" + toolRound.text;
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

  if (budgetExhaustedInTools) {
    const decision = managerParseFallbackDecision({ hasDraft, userMessage }, state.mddComplexity);
    LOG("presupuesto del turno agotado en la búsqueda de herramientas → delegate (target=%s sections=%s)", decision.delegateTarget, decision.sectionsToRun?.join(",") ?? "-");
    action = decision.action;
    delegateTarget = decision.delegateTarget;
    sectionsToRun = decision.sectionsToRun;
  }

  LOG("action=%s delegateTarget=%s sectionsToRun=%s", action, delegateTarget, sectionsToRun?.length);

  if (action === "reply" && !replyContent.trim()) {
    const decision = managerParseFallbackDecision({ hasDraft, userMessage }, state.mddComplexity);
    LOG("reply vacío del LLM → delegate (target=%s sections=%s)", decision.delegateTarget, decision.sectionsToRun?.join(",") ?? "-");
    action = decision.action;
    delegateTarget = decision.delegateTarget;
    sectionsToRun = decision.sectionsToRun;
  }

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
