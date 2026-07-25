import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { LivePrecisionCalculator } from "../estimation/estimation.types.js";
import { AUDITOR_MDD_PROMPT } from "../prompts/load-prompts.js";
import { auditorGapsSchema, mddAuditorDecisionSchema, type MDDStateType } from "../state/index.js";
import { parseJsonOrThrow } from "../utils/parse-json.js";
import { applyPreDeliveryGateFixes, validateMddStructure } from "../utils/mdd-sanitize.js";
import { getInternalDirectivesContext } from "../utils/mdd-mesh-topology.js";
import { auditorConstitutionRigorAppendix } from "../utils/mdd-complexity-rigor.js";
import { domainInventoryPromptBlock } from "../utils/mdd-domain-prompt.util.js";
import { extractLlmText, extractLlmToolCalls, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import {
  buildAuditorFeedbackFromGaps,
  MDD_AUDIT_PASS_THRESHOLD,
  synthesizeStructuralAuditorGaps,
  truncateDraftForAuditorLlm,
} from "../utils/mdd-auditor-gaps.util.js";
import { buildMddAuditorDeepContext } from "../utils/mdd-auditor-context.util.js";
import type { AuditorGapsState } from "../state/mdd-state.schema.js";
import { z } from "zod";
import { draftIsSubstantialForScopedRepair } from "../utils/mdd-section-preserve.util.js";

const AUDIT_PASS_THRESHOLD = MDD_AUDIT_PASS_THRESHOLD;

const auditorCriticalGapItemSchema = z.union([
  z.object({
    sections: z.array(z.string()).optional().default([]),
    issue: z.string().optional().default(""),
    fix: z.string().optional().default(""),
  }),
  z.string().transform((str) => ({
    sections: [] as string[],
    issue: str,
    fix: "Revisión manual requerida",
  })),
]).pipe(z.object({
  sections: z.array(z.string()),
  issue: z.string(),
  fix: z.string(),
}));

const auditorOutputSchema = z.object({
  auditorScore: z.number().min(0).max(100),
  auditorFeedback: z.string().optional().nullable(),
  auditorDecision: mddAuditorDecisionSchema,
  status: z.string().optional(),
  critical_gaps: z.array(auditorCriticalGapItemSchema).optional().default([]),
  syntax_errors: z.union([
    z.array(z.string()),
    z.array(z.any()).transform((arr) => arr.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))),
    z.string().transform((s) => [s]),
    z.record(z.any()).transform((obj) => [JSON.stringify(obj)]),
  ]).optional().default([]),
  infrastructure_ready: z.union([
    z.boolean(),
    z.any().transform((v) => Boolean(v)),
  ]).optional(),
});

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Auditor] ${msg}`, ...args);
const MAX_TOOL_LOOPS = 3;

/** Auditor califica (score/gaps); el auto-loop lo decide prepare_output vía gate blockers. */
function resolveAuditorDecisionForSubstantialDraft(
  draft: string,
  baseDecision: "done" | "clarifier" | "blackboard",
): "done" | "clarifier" | "blackboard" {
  if (baseDecision === "blackboard") return "blackboard";
  if (draftIsSubstantialForScopedRepair(draft)) {
    LOG(
      "draft sustancial (%s chars) → score-only (gaps informativos; gate en prepare_output)",
      draft.length,
    );
    return "done";
  }
  return baseDecision;
}

function buildToolsByName(tools: StructuredToolInterface[]): Record<string, StructuredToolInterface> {
  const byName: Record<string, StructuredToolInterface> = {};
  for (const t of tools) byName[t.name] = t;
  return byName;
}

function resolveAuditorGapsFromLlm(
  structural: AuditorGapsState,
  llmGaps: AuditorGapsState | undefined,
  score: number,
): AuditorGapsState {
  if (!llmGaps) return { ...structural, score: Math.min(score, structural.score || score) };

  const seen = new Set<string>();
  const critical_gaps = [...llmGaps.critical_gaps];
  for (const g of critical_gaps) {
    seen.add(`${g.issue.slice(0, 80)}::${g.fix.slice(0, 80)}`);
  }
  for (const g of structural.critical_gaps) {
    const key = `${g.issue.slice(0, 80)}::${g.fix.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    critical_gaps.push(g);
  }

  const syntax_errors = [...new Set([...llmGaps.syntax_errors, ...structural.syntax_errors])];
  const status =
    score >= AUDIT_PASS_THRESHOLD && critical_gaps.length === 0 && syntax_errors.length === 0
      ? "APROBADO"
      : "RECHAZADO";

  return {
    score,
    status,
    critical_gaps,
    syntax_errors,
    infrastructure_ready: llmGaps.infrastructure_ready,
  };
}

function buildStructuralAuditorResult(
  state: MDDStateType,
  validation: ReturnType<typeof validateMddStructure>,
): Partial<MDDStateType> {
  const auditorGaps = synthesizeStructuralAuditorGaps(validation);
  const score = auditorGaps.score;
  const decision: "done" | "clarifier" = "clarifier";
  const iteration = (state.mddIteration ?? 0) + 1;
  const feedback =
    buildAuditorFeedbackFromGaps(auditorGaps) ||
    (validation.issues.length > 0
      ? validation.issues.join(" ")
      : "Auditoría LLM no disponible; revisa secciones canónicas del MDD.");
  return {
    auditorScore: score,
    auditorFeedback: feedback,
    auditorGaps,
    auditorDecision: decision,
    mddIteration: decision === "clarifier" ? iteration : (state.mddIteration ?? 0),
    delegateTarget: undefined,
    sectionsToRun: undefined,
    acceptedProposalDirective: undefined,
  };
}

/** Creates the MDD Auditor (quality) node. Optionally with tools and precisionCalculator (semáforo). */
export function createMddAuditorNode(
  llm: BaseChatModel,
  tools: StructuredToolInterface[] = [],
  _precisionCalculator?: LivePrecisionCalculator | null,
) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const allowed = state.currentStepAllowedTools;
    const toolsToUse = allowed?.length ? tools.filter((t) => allowed.includes(t.name)) : tools;
    const toolsByName = buildToolsByName(toolsToUse);
    const llmWithTools = llm.bindTools && toolsToUse.length > 0 ? llm.bindTools(toolsToUse) : llm;

    LOG("entry mddDraftLen=%s tools=%s (allowed=%s)", (state.mddDraft ?? "").length, toolsToUse.length, allowed?.length ?? "all");
    const draft = applyPreDeliveryGateFixes((state.mddDraft ?? "").trim());
    const validation = validateMddStructure(draft);
    const structuralGaps = synthesizeStructuralAuditorGaps(validation);

    try {
      const draftForLlm = truncateDraftForAuditorLlm(draft);
      let prompt =
        `${AUDITOR_MDD_PROMPT}\n\n---\n**Borrador completo del MDD:**\n${draftForLlm || "(vacío)"}\n\n` +
        `${getInternalDirectivesContext(state, "auditor")}${auditorConstitutionRigorAppendix(state.mddComplexity)}` +
        buildMddAuditorDeepContext(state);
      const inventoryBlock = domainInventoryPromptBlock(state);
      if (inventoryBlock) {
        prompt +=
          inventoryBlock +
          "\n\n**Criterio domain-auth-only-skew:** Si el inventario tiene ≥3 capacidades de negocio y §3 solo lista tablas auth (users/roles/sessions/…), baja el score y registra critical_gap con fix: ampliar §3/§4 al dominio.";
      }
      if (toolsToUse.length > 0) {
        prompt +=
          "\n\n**Obligatorio:** Usa validate_mdd_structure, validate_sql_syntax y validate_json_payloads con el borrador. " +
          "Usa esos resultados para auditorScore, critical_gaps, syntax_errors e infrastructure_ready. " +
          "Responde al final solo con el JSON de salida.";
      }
      const messages = [new HumanMessage(prompt)];

      let lastContent = "";
      let loopCount = 0;
      let emptyFinalAttempts = 0;
      const MAX_EMPTY_FINAL_ATTEMPTS = 2;

      while (loopCount < MAX_TOOL_LOOPS) {
        const isFinalIteration = loopCount === MAX_TOOL_LOOPS - 1;
        const useRetry =
          isFinalIteration ||
          (loopCount > 0 && emptyFinalAttempts > 0 && loopCount < MAX_TOOL_LOOPS - 1);
        const response = useRetry
          ? await invokeLlmWithRetry(llmWithTools, messages, {
              tag: "Auditor:tools",
              maxAttempts: isFinalIteration ? 3 : 2,
              acceptToolCallsWithoutContent: true,
              isResponseValid: (text) => text.trim().length > 0,
            })
          : await llmWithTools.invoke(messages);
        if (!response) {
          LOG("tool-loop LLM sin respuesta tras reintentos (iter=%s); saliendo del loop", loopCount);
          lastContent = "";
          break;
        }
        const aiMsg = response as AIMessage;
        lastContent = extractLlmText(aiMsg);
        const toolCalls = extractLlmToolCalls(aiMsg);
        if (toolCalls.length === 0) {
          if (!lastContent.trim()) {
            emptyFinalAttempts += 1;
            if (emptyFinalAttempts >= MAX_EMPTY_FINAL_ATTEMPTS) {
              LOG(
                "tool-loop: contenido vacío sin tool_calls tras %s intentos (iter=%s); abortando loop",
                emptyFinalAttempts,
                loopCount,
              );
              break;
            }
            LOG(
              "tool-loop: contenido vacío sin tool_calls (iter=%s); reintentando iteración",
              loopCount,
            );
            continue;
          }
          break;
        }

        const toolMessages: ToolMessage[] = [];
        for (const tc of toolCalls) {
          const tool = toolsByName[tc.name];
          const toolCallId = tc.id ?? `tc-${loopCount}-${tc.name}`;
          if (!tool) {
            toolMessages.push(new ToolMessage({ content: `Unknown tool: ${tc.name}`, tool_call_id: toolCallId, status: "error" }));
            continue;
          }
          const args = typeof tc.args === "object" && tc.args !== null ? tc.args as Record<string, unknown> : {};
          let result: unknown;
          try {
            result = await tool.invoke(args);
          } catch (toolErr) {
            console.log("[MDD:Auditor] tool.invoke error: %s args=%s", toolErr instanceof Error ? toolErr.message : String(toolErr), JSON.stringify(args).slice(0, 200));
            result = `Error: ${toolErr instanceof Error ? toolErr.message : "Tool call failed"}`;
          }
          const content = typeof result === "string" ? result : JSON.stringify(result);
          toolMessages.push(new ToolMessage({ content, tool_call_id: toolCallId }));
        }
        messages.push(aiMsg, ...toolMessages);
        loopCount++;
      }

      const structuralBase = structuralGaps;

      if (!lastContent.trim()) {
        LOG("sin respuesta LLM → fallback estructural (secciones canónicas)");
        return buildStructuralAuditorResult(state, validation);
      }

      let parsed: z.infer<typeof auditorOutputSchema>;
      try {
        parsed = parseJsonOrThrow(lastContent, auditorOutputSchema) as unknown as z.infer<typeof auditorOutputSchema>;
      } catch (parseErr) {
        LOG("fallback estructural: parse error — %s", parseErr instanceof Error ? parseErr.message.slice(0, 300) : String(parseErr).slice(0, 300));
        return buildStructuralAuditorResult(state, validation);
      }

      let score = Math.min(100, Math.max(0, parsed.auditorScore));

      if (validation.missingSections.length > 0) {
        score = Math.min(score, 94);
        const sectionsNote =
          "Secciones obligatorias faltantes: " + validation.missingSections.join(", ") + ". El MDD debe tener exactamente las 7 secciones canónicas.";
        const existing = (parsed.auditorFeedback ?? "").trim();
        parsed.auditorFeedback = existing ? existing + " " + sectionsNote : sectionsNote;
        LOG("missingSections=%s → score capped at 94", validation.missingSections.join(";"));
      }

      if (tools.length > 0 && !validation.section3HasPayloads && score > 20) {
        score = Math.min(score, 79);
        if (!parsed.auditorFeedback?.includes("Contratos de API")) {
          parsed.auditorFeedback =
            (parsed.auditorFeedback ?? "").trim() +
            " Sección 4. Contratos de API: debe incluir endpoints con request/response en ```json.";
        }
      }

      let llmGaps: AuditorGapsState | undefined;
      let feedback = (parsed.auditorFeedback ?? "").trim();

      const normalizedStatus =
        parsed.status === "APROBADO" || parsed.status === "RECHAZADO"
          ? parsed.status
          : score >= AUDIT_PASS_THRESHOLD
            ? "APROBADO"
            : "RECHAZADO";

      const criticalGaps = parsed.critical_gaps ?? [];
      const syntaxErrors = parsed.syntax_errors ?? [];
      const result = auditorGapsSchema.safeParse({
        score,
        status: normalizedStatus,
        critical_gaps: criticalGaps,
        syntax_errors: syntaxErrors,
        infrastructure_ready: parsed.infrastructure_ready ?? true,
      });
      if (result.success) {
        llmGaps = result.data;
      }

      const auditorGaps = resolveAuditorGapsFromLlm(structuralBase, llmGaps, score);
      if (!feedback && (auditorGaps.critical_gaps.length > 0 || auditorGaps.syntax_errors.length > 0)) {
        feedback = buildAuditorFeedbackFromGaps(auditorGaps);
      }

      const hasConflict = auditorGaps.critical_gaps.some((g) => g.issue.includes("[CONFLICTO]"));

      const rawDecision = hasConflict
        ? ("blackboard" as const)
        : score >= AUDIT_PASS_THRESHOLD &&
            validation.missingSections.length === 0 &&
            auditorGaps.critical_gaps.length === 0
          ? ("done" as const)
          : ("clarifier" as const);
      const decision = resolveAuditorDecisionForSubstantialDraft(draft, rawDecision);
      const currentIteration = state.mddIteration ?? 0;
      const iteration = currentIteration + (decision === "clarifier" ? 1 : 0);
      const finalFeedback =
        feedback ||
        (score < AUDIT_PASS_THRESHOLD
          ? "Faltan: modelo de datos/entidades con tipos y relaciones, contratos u operaciones con entrada/salida, decisiones de seguridad, estrategia de infraestructura/despliegue. Genera preguntas para cubrir estos huecos."
          : undefined);

      LOG(
        "ok score=%s decision=%s iteration=%s gaps=%s scoreOnly=%s",
        score,
        decision,
        decision === "clarifier" ? iteration : currentIteration,
        auditorGaps.critical_gaps.length,
        draftIsSubstantialForScopedRepair(draft),
      );
      return {
        auditorScore: score,
        auditorFeedback: finalFeedback,
        auditorGaps,
        auditorDecision: decision,
mddIteration: decision === "clarifier" ? iteration : (state.mddIteration ?? 0),
        delegateTarget: undefined,
        sectionsToRun: undefined,
        acceptedProposalDirective: undefined,
      };
    } catch (err) {
      LOG("error: %s — fallback estructural", err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300));
      return buildStructuralAuditorResult(state, validation);
    }
  };
}
