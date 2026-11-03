/**
 * @fileoverview Nodo critic — toma decisiones de ruteo (loop vs avanzar) en el grafo.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { ARCHITECT_CRITIC_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import { extractSection3Body, extractSection4Body } from "../utils/mdd-sanitize.js";
import { detectSection3CompositionBlockers } from "../utils/schema-owner.util.js";
import { getUserExplicitRequirements } from "../utils/mdd-user-brief.js";
import type { ArchitectCriticPhase } from "../utils/mdd-architect-pipeline.util.js";
import {
  domainInventoryPromptBlock,
  mddStateHasDomainAuthSkew,
} from "../utils/mdd-domain-prompt.util.js";
import { extractFirstJsonObject } from "../utils/parse-json.js";
import { invokeLlmStructured } from "../utils/mdd-llm-structured.util.js";
import { resolveMddCriticBudgetMs } from "../utils/mdd-llm-timeout.util.js";
import { createLlmAbortError } from "../utils/mdd-llm-stream-invoke.util.js";
import { z } from "zod";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import { buildArchitectCriticOutline } from "../utils/mdd-architect-critic-outline.util.js";

/** Veredicto del crítico. `passthrough` para no romper campos extra que añada el modelo. */
export const criticOutputSchema = z
  .object({
    verdict: z.enum(["ok", "gap"]),
    gaps: z.array(z.string()).nullish(),
  })
  .passthrough();

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:ArchitectCritic] ${msg}`, ...args);

/** Intentos de transporte de la llamada del Critic; el tope total lo fija `deadlineMs`. */
const CRITIC_LLM_MAX_ATTEMPTS = 2;

type CriticVerdict = z.infer<typeof criticOutputSchema>;

/**
 * Parsea salida del crítico: JSON con el esquema zod. Sin heurísticas por regex: una salida que
 * no cumple el esquema devuelve `null` (el nodo la reintenta una vez con el error re-inyectado).
 */
export function parseArchitectCriticOutput(text: string): CriticVerdict | null {
  const raw = extractFirstJsonObject(text);
  if (!raw) return null;
  try {
    const parsed = criticOutputSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Nodo Architect Critic (Reflection): verifica si §3 y §4 del MDD cumplen la directiva del usuario
 * y (cuando hay BRD) la fidelidad de dominio / anti auth-skew.
 *
 * El LLM recibe un OUTLINE compacto (todas las tablas con columnas y todos los endpoints), no un
 * recorte crudo. Fail-open: error del proveedor, respuesta vacía o salida no parseable => "ok"
 * (sin feedback ni reintento); solo un `gap` explícito con ≥1 gap concreto dispara feedback.
 *
 * La salida se valida con zod vía `invokeLlmStructured` (una reparación con el error re-inyectado).
 * Si sigue inválida o falla el transporte NO se inventa veredicto: se registra un `warn` con
 * intentos y motivo y se continúa sin feedback (el contador avanza para no entrar en bucle).
 * Una cancelación (`aborted`) se propaga como `AbortError`.
 */
export function createMddArchitectCriticNode(llm: BaseChatModel) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const directive = state.acceptedProposalDirective?.trim();
    const explicitReqs = getUserExplicitRequirements(state);
    const draft = (state.mddDraft ?? "").trim();
    const attempts = (state.architectCriticAttempts ?? 0) + 1;
    const sqlBlockers = detectSection3CompositionBlockers(draft);
    if (sqlBlockers.length > 0 && attempts <= 1) {
      const feedback = `Corregir §3 (SQL/DDL): ${sqlBlockers.join("; ")}`;
      LOG("blockers §3 deterministas attempts=%s", attempts);
      return {
        architectCriticFeedback: feedback,
        architectCriticAttempts: attempts,
      };
    }

    const domainSkew = mddStateHasDomainAuthSkew(state);
    const inventoryBlock = domainInventoryPromptBlock(state);
    const hasDomainContext = inventoryBlock.length > 0 || domainSkew;

    if (!directive && !explicitReqs && !hasDomainContext) {
      LOG("sin directiva, requisitos ni inventario de dominio, omitir critic");
      return {
        architectCriticFeedback: undefined,
        architectCriticAttempts: (state.architectCriticAttempts ?? 0) + 1,
      };
    }

    if (domainSkew && attempts <= 1) {
      LOG("domain-auth-only-skew determinista attempts=%s", attempts);
      return {
        architectCriticFeedback:
          "domain-auth-only-skew: §3 solo tiene entidades de auth mientras el BRD/inventario declara capacidades de dominio. Reescribe §3 y §4 con tablas y endpoints de negocio del inventario; auth es complemento.",
        architectCriticAttempts: attempts,
      };
    }

    const section3 = extractSection3Body(draft);
    const section4 = extractSection4Body(draft);
    const phase: ArchitectCriticPhase | undefined = state.architectCriticPhase;
    const afterSection3Only = phase === "after_section3";
    const fragment = afterSection3Only
      ? section3
        ? `## 3. Modelo de Datos\n\n${section3}`
        : ""
      : [section3 ? `## 3. Modelo de Datos\n\n${section3}` : "", section4 ? `## 4. Contratos de API\n\n${section4}` : ""]
          .filter(Boolean)
          .join("\n\n");
    if (!fragment || fragment.length < 50) {
      LOG("fragmento §3%s insuficiente, omitir critic", afterSection3Only ? "" : "+§4");
      return {
        architectCriticFeedback: undefined,
        architectCriticAttempts: (state.architectCriticAttempts ?? 0) + 1,
      };
    }

    const directiveBlock = [directive, explicitReqs].filter(Boolean).join("\n\n") ||
      "(Sin directiva HITL; evalúa fidelidad al inventario de dominio / BRD.)";
    const outline = buildArchitectCriticOutline({
      section3,
      section4: afterSection3Only ? null : section4,
    });
    const context =
      `**Directiva o requisitos del usuario:**\n${directiveBlock}\n\n` +
      (inventoryBlock ? `${inventoryBlock.trim()}\n\n` : "") +
      `**Esquema compacto del MDD recién generado (${afterSection3Only ? "solo §3" : "§3 y §4"}). ` +
      `Lista COMPLETA de tablas y endpoints; si ves "+N más", esos ítems existen y NO deben reportarse como faltantes:**\n${outline}`;
    const prompt = `${ARCHITECT_CRITIC_MDD_PROMPT}\n\n---\n${context}`;
    const startedAt = Date.now();

    const result = await invokeLlmStructured({
      llm,
      messages: [new HumanMessage(prompt)],
      schema: criticOutputSchema,
      tag: "ArchitectCritic",
      maxAttempts: CRITIC_LLM_MAX_ATTEMPTS,
      deadlineMs: resolveMddCriticBudgetMs(),
    });
    logMddLlmMetrics(
      LOG,
      measureMddLlmCall(startedAt, prompt.length, result.rawText?.length ?? 0),
      { phase: afterSection3Only ? "after_section3" : "after_full" },
    );
    if (!result.ok) {
      if (result.reason === "aborted") throw createLlmAbortError("ArchitectCritic");
      console.warn(
        `[MDD:ArchitectCritic] sin veredicto validado (reason=${result.reason} attempts=${result.attempts}` +
          `${result.lastError ? ` error=${result.lastError.slice(0, 160)}` : ""}) → sin feedback, el flujo continúa`,
      );
      return { architectCriticFeedback: undefined, architectCriticAttempts: attempts };
    }
    const { verdict, gaps } = result.value;
    const concreteGaps = (gaps ?? []).map((g) => g.trim()).filter((g) => g.length > 0);
    if (verdict === "gap" && concreteGaps.length > 0 && attempts <= 1) {
      const feedback = concreteGaps.join("\n");
      LOG("verdict=gap attempts=%s feedback=%s", attempts, feedback.slice(0, 80));
      return {
        architectCriticFeedback: feedback,
        architectCriticAttempts: attempts,
      };
    }
    LOG("verdict=%s gaps=%s attempts=%s → seguir", verdict, concreteGaps.length, attempts);
    return {
      architectCriticFeedback: undefined,
      architectCriticAttempts: attempts,
    };
  };
}
