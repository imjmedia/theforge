import { Injectable, Logger } from "@nestjs/common";
import {
  hasEmbeddedSpecificationBlock,
  isUserExploringDbgaIntent,
  looksLikeApiEndpointCatalog,
  looksLikeDbgaEditRequest,
  looksLikeDbgaSpecIntegrationRequest,
  looksLikeProjectFactStatement,
} from "@theforge/shared-types";
import { AiService } from "./ai.service.js";
import { IntentClassifierService, type ChatIntent } from "./intent-classifier.service.js";
import {
  actionFromChatIntent,
  actionToChatIntent,
  type IntentRouteContext,
  type IntentRouteResult,
  type IntentRouteSource,
  type WorkshopChatAction,
  workshopIntentLlmSchema,
} from "./intent-route.types.js";
import {
  assistantOfferedDocumentEdit,
  documentLabelForTab,
  summarizeMessageForIntentClassification,
} from "./intent-router.util.js";
import { WORKSHOP_INTENT_ROUTER_PROMPT } from "./prompts/workshop-intent-router-prompt.js";
import { parseJsonOrThrow } from "../ai-analysis/utils/parse-json.js";
import { resolveLlmMaxTokensForPurpose } from "./config/llm-config.js";

const HEURISTIC_CONFIDENCE_THRESHOLD = 0.85;
const LLM_ACCEPT_CONFIDENCE = 0.65;

export interface HeuristicIntentResult {
  intent: ChatIntent;
  action: WorkshopChatAction;
  confidence: number;
}

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);
  private readonly routeCache = new Map<string, IntentRouteResult>();

  constructor(
    private readonly intentClassifier: IntentClassifierService,
    private readonly ai: AiService,
  ) {}

  /** Clasifica intención: heurística de alta confianza primero; LLM solo si es ambiguo. */
  async route(message: string, context: IntentRouteContext = {}): Promise<IntentRouteResult> {
    const trimmed = message.trim();
    if (!trimmed) {
      return this.buildResult("explore", "chat_only", 1, "heuristic", "Mensaje vacío");
    }

    const assistantCtx = (context.lastAssistantMessage ?? "").slice(0, 200);
    const cacheKey = `${context.activeTab ?? ""}|${context.hasDocumentContent ? "1" : "0"}|${assistantCtx}|${trimmed}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;

    const heuristic = this.classifyHeuristic(trimmed, context);
    if (heuristic.confidence >= HEURISTIC_CONFIDENCE_THRESHOLD) {
      const result = this.buildResult(
        heuristic.intent,
        heuristic.action,
        heuristic.confidence,
        "heuristic",
      );
      this.rememberRoute(cacheKey, result);
      return result;
    }

    if (!this.isLlmRoutingEnabled()) {
      const result = this.buildResult(
        heuristic.intent,
        heuristic.action,
        heuristic.confidence,
        "heuristic",
        "LLM desactivado (INTENT_ROUTER_LLM=0)",
      );
      this.rememberRoute(cacheKey, result);
      return result;
    }

    try {
      const llm = await this.classifyWithLlm(trimmed, context);
      if (llm.confidence >= LLM_ACCEPT_CONFIDENCE) {
        const result = this.buildResult(
          actionToChatIntent(llm.action),
          llm.action,
          llm.confidence,
          "llm",
          llm.reasoning,
        );
        this.rememberRoute(cacheKey, result);
        return result;
      }
      this.logger.debug(
        `[route] LLM confianza baja (${llm.confidence}); fallback heurístico (${heuristic.action})`,
      );
    } catch (err) {
      this.logger.warn(
        `[route] LLM falló: ${err instanceof Error ? err.message : String(err)}; fallback heurístico`,
      );
    }

    const fallback = this.buildResult(
      heuristic.intent,
      heuristic.action,
      heuristic.confidence,
      "heuristic",
    );
    this.rememberRoute(cacheKey, fallback);
    return fallback;
  }

  /** Heurística determinista con score de confianza (sin LLM). */
  classifyHeuristic(message: string, context: IntentRouteContext = {}): HeuristicIntentResult {
    const trimmed = message.trim();
    if (!trimmed) {
      return { intent: "explore", action: "chat_only", confidence: 1 };
    }

    const lastAssistant = context.lastAssistantMessage?.trim() ?? "";
    if (
      lastAssistant &&
      assistantOfferedDocumentEdit(lastAssistant) &&
      /^(s[íi]|dale|aplica|ok|vale|correcto|de acuerdo|hazlo|adelante|procede|int[eé]gralo)\b/i.test(trimmed)
    ) {
      return { intent: "direct_edit", action: "edit_document", confidence: 0.94 };
    }

    if (isUserExploringDbgaIntent(trimmed)) {
      return { intent: "explore", action: "chat_only", confidence: 0.96 };
    }

    if (looksLikeDbgaSpecIntegrationRequest(trimmed)) {
      return { intent: "direct_edit", action: "edit_document", confidence: 0.98 };
    }

    if (looksLikeApiEndpointCatalog(trimmed)) {
      return { intent: "direct_edit", action: "edit_document", confidence: 0.97 };
    }

    if (looksLikeDbgaEditRequest(trimmed)) {
      // Imperativos cortos → alta confianza. Mensajes largos de dominio → confianza
      // media para que el LLM de intención confirme (ruteo preferente post-refactor).
      const confidence = trimmed.length > 120 ? 0.78 : 0.9;
      return { intent: "direct_edit", action: "edit_document", confidence };
    }

    // Dato concreto del proyecto («el SSO está en sso.obp.mx») con documento en el panel:
    // el usuario espera verlo reflejado sin tener que añadir «haz los cambios al documento».
    // Gate determinístico: no se delega al LLM, que por su regla 4 sesga a chat_only.
    if (context.hasDocumentContent && looksLikeProjectFactStatement(trimmed)) {
      return { intent: "direct_edit", action: "edit_document", confidence: 0.88 };
    }

    const intent = this.intentClassifier.classify(trimmed);
    const action = actionFromChatIntent(intent);

    if (intent === "direct_edit") {
      return { intent, action, confidence: 0.92 };
    }

    if (intent === "mixed") {
      return { intent, action, confidence: 0.48 };
    }

    const hasWeakEditSignals =
      hasEmbeddedSpecificationBlock(trimmed) ||
      /\b(?:integra|incorpora|actualiza|modifica|cumplir|especificaci[oó]n|documento\s+deber[ií]a|alinear)\b/i.test(
        trimmed,
      );

    if (hasWeakEditSignals) {
      // Baja confianza → LLM decide si es edición o solo chat.
      return { intent: "explore", action: "chat_only", confidence: 0.58 };
    }

    if (intent === "explore" && /\?\s*$/.test(trimmed)) {
      return { intent, action, confidence: 0.88 };
    }

    return { intent, action, confidence: 0.72 };
  }

  private async classifyWithLlm(
    message: string,
    context: IntentRouteContext,
  ): Promise<{ action: WorkshopChatAction; confidence: number; reasoning: string }> {
    const docLabel = documentLabelForTab(context.activeTab);
    const summary = summarizeMessageForIntentClassification(message);
    const assistantBlock = context.lastAssistantMessage?.trim()
      ? `\nÚltimo mensaje del asistente en este tab:\n---\n${context.lastAssistantMessage.trim().slice(0, 1200)}\n---\n\n`
      : "";

    const prompt =
      `Pestaña activa: **${docLabel}**.\n` +
      `¿Hay documento en el panel?: ${context.hasDocumentContent ? "sí" : "no"}.\n` +
      assistantBlock +
      `Mensaje del usuario:\n---\n${summary}\n---`;

    const raw = await this.ai.generateResponse(prompt, [], {
      systemPrompt: WORKSHOP_INTENT_ROUTER_PROMPT,
      maxTokensOverride: resolveLlmMaxTokensForPurpose("checklist", 512),
    });

    const parsed = parseJsonOrThrow(raw, workshopIntentLlmSchema);
    return {
      action: parsed.action,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning.trim(),
    };
  }

  private isLlmRoutingEnabled(): boolean {
    const raw = process.env.INTENT_ROUTER_LLM?.trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "off") return false;
    return true;
  }

  private buildResult(
    intent: ChatIntent,
    action: WorkshopChatAction,
    confidence: number,
    source: IntentRouteSource,
    reasoning?: string,
  ): IntentRouteResult {
    return {
      intent,
      action,
      confidence,
      source,
      ...(reasoning?.trim() ? { reasoning: reasoning.trim() } : {}),
    };
  }

  private rememberRoute(key: string, result: IntentRouteResult): void {
    this.routeCache.set(key, result);
    if (this.routeCache.size > 128) this.routeCache.clear();
  }
}
