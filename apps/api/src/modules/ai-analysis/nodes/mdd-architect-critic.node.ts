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
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { z } from "zod";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import { buildArchitectCriticOutline } from "../utils/mdd-architect-critic-outline.util.js";

const criticOutputSchema = z.object({
  verdict: z.enum(["ok", "gap"]),
  gaps: z.array(z.string()).optional(),
});

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:ArchitectCritic] ${msg}`, ...args);

type CriticVerdict = z.infer<typeof criticOutputSchema>;

/** Parsea salida del crítico: JSON estricto + fallback regex cuando el LLM mezcla prosa. */
export function parseArchitectCriticOutput(text: string): CriticVerdict | null {
  const raw = extractFirstJsonObject(text);
  if (raw) {
    try {
      const parsed = criticOutputSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // fallback below
    }
  }
  if (/verdict\s*[:=]\s*["']?ok["']?/i.test(text)) {
    return { verdict: "ok" };
  }
  if (/verdict\s*[:=]\s*["']?gap["']?/i.test(text)) {
    const gapLines = [...text.matchAll(/"([^"]{8,200})"/g)]
      .map((m) => m[1]!.trim())
      .filter((line) => !/verdict|gaps/i.test(line));
    return { verdict: "gap", gaps: gapLines.length > 0 ? gapLines.slice(0, 5) : undefined };
  }
  return null;
}

/**
 * Nodo Architect Critic (Reflection): verifica si §3 y §4 del MDD cumplen la directiva del usuario
 * y (cuando hay BRD) la fidelidad de dominio / anti auth-skew.
 *
 * El LLM recibe un OUTLINE compacto (todas las tablas con columnas y todos los endpoints), no un
 * recorte crudo. Fail-open: error del proveedor, respuesta vacía o salida no parseable => "ok"
 * (sin feedback ni reintento); solo un `gap` explícito con ≥1 gap concreto dispara feedback.
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

    try {
      const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
        tag: "ArchitectCritic",
        isResponseValid: (t) => t.trim().length > 0,
      });
      const text = response ? extractLlmText(response) : "";
      logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, prompt.length, text.length), {
        phase: afterSection3Only ? "after_section3" : "after_full",
      });
      const parsedData = parseArchitectCriticOutput(text);
      if (!parsedData) {
        LOG("critic sin salida parseable (len=%s) → ok, sin reintento", text.length);
        return { architectCriticFeedback: undefined, architectCriticAttempts: attempts };
      }
      const { verdict, gaps } = parsedData;
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
    } catch (err) {
      LOG("critic error: %s → ok (fail-open)", err instanceof Error ? err.message : String(err));
      return { architectCriticFeedback: undefined, architectCriticAttempts: attempts };
    }
  };
}
