/**
 * @fileoverview Nodo auditor — evalúa calidad de documentación y gaps en el pipeline.
 *
 * Lint-first: la validación determinista (estructura, SQL, JSON) se ejecuta en código
 * sobre el borrador real y se inyecta al prompt. El Auditor hace UNA llamada LLM sin
 * tools: antes, las tools recibían `mdd_draft` como argumento y el modelo tenía que
 * re-emitir el documento completo (40-60 KB), que el proveedor truncaba → falsos
 * "secciones faltantes" / "sin payloads" → score hundido.
 *
 * El lint informa, no puntúa ni veredicta: el único cap determinista que se conserva es el de
 * secciones canónicas faltantes (94 + bloqueo de `done`), por decisión de producto. Los gaps
 * deterministas (contrato/trazabilidad/BRD) solo viajan como texto `[lint] …` en el feedback;
 * `critical_gaps` son los del LLM y `syntax_errors` suma solo errores SQL/JSON objetivos.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import type { LivePrecisionCalculator } from "../estimation/estimation.types.js";
import { AUDITOR_MDD_PROMPT } from "../prompts/load-prompts.js";
import { auditorGapsSchema, mddAuditorDecisionSchema, type MDDStateType } from "../state/index.js";
import { parseJsonOrThrow } from "../utils/parse-json.js";
import { applyPreDeliveryGateFixes, validateMddStructure } from "../utils/mdd-sanitize.js";
import { getInternalDirectivesContext } from "../utils/mdd-mesh-topology.js";
import { auditorConstitutionRigorAppendix } from "../utils/mdd-complexity-rigor.js";
import { domainInventoryPromptBlock } from "../utils/mdd-domain-prompt.util.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { resolveMddAuditorNodeBudgetMs, resolveMddAuditorPerInvokeHardTimeoutMs } from "../utils/mdd-llm-timeout.util.js";
import {
  buildAuditorFeedbackFromGaps,
  computeDeterministicAuditorScore,
  MDD_AUDIT_PASS_THRESHOLD,
  synthesizeDeterministicAuditorGaps,
  synthesizeStructuralAuditorGaps,
  truncateDraftForAuditorLlm,
} from "../utils/mdd-auditor-gaps.util.js";
import {
  deterministicLintSyntaxErrors,
  formatDeterministicLintForPrompt,
  runDeterministicMddLint,
} from "../utils/mdd-auditor-lint.util.js";
import { hasBrdToMddTraceabilityBlockers } from "../estimation/brd-mdd-traceability.util.js";
import { buildMddAuditorDeepContext } from "../utils/mdd-auditor-context.util.js";
import type { AuditorGapsState } from "../state/mdd-state.schema.js";
import { z } from "zod";
import { draftIsSubstantialForScopedRepair } from "../utils/mdd-section-preserve.util.js";

const AUDIT_PASS_THRESHOLD = MDD_AUDIT_PASS_THRESHOLD;

/** Intentos de la única llamada LLM del Auditor (la segunda solo si la primera vuelve vacía). */
const AUDITOR_LLM_MAX_ATTEMPTS = 2;

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

/** Auditor califica (score/gaps); el auto-loop lo decide prepare_output vía gate blockers. */
function resolveAuditorDecisionForSubstantialDraft(
  draft: string,
  baseDecision: "done" | "clarifier" | "blackboard",
  _options?: { hasBrdTraceGaps?: boolean },
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

/**
 * Gaps finales del Auditor: `critical_gaps` = SOLO los del LLM. Los gaps deterministas
 * (estructura/contrato/trazabilidad) son heurísticos y van únicamente al texto de feedback
 * (`[lint] …`); a `syntax_errors` solo entran errores SQL/JSON objetivos del lint.
 * El veredicto lo decide el score del LLM (+ el bloqueo estructural de secciones faltantes).
 */
export function resolveAuditorGapsFromLlm(
  llmGaps: AuditorGapsState | undefined,
  lintSyntaxErrors: string[],
  score: number,
  missingSections: string[] = [],
): AuditorGapsState {
  const syntax_errors = [...new Set([...(llmGaps?.syntax_errors ?? []), ...lintSyntaxErrors])];
  const status = score >= AUDIT_PASS_THRESHOLD && missingSections.length === 0 ? "APROBADO" : "RECHAZADO";
  return {
    score,
    status,
    critical_gaps: [...(llmGaps?.critical_gaps ?? [])],
    syntax_errors,
    infrastructure_ready: llmGaps?.infrastructure_ready ?? true,
  };
}

/** Texto `[lint] …` con los gaps deterministas (informativos) para anexar al feedback. */
export function formatDeterministicGapsAsLintFeedback(
  deterministic: AuditorGapsState,
  options?: { maxItems?: number },
): string {
  const maxItems = options?.maxItems ?? 8;
  const lines: string[] = [];
  for (const g of deterministic.critical_gaps) {
    if (/^Falta la sección obligatoria:/i.test(g.issue)) continue; // ya cubierto por el bloqueo estructural
    lines.push(`[lint] [${(g.sections ?? []).join(", ")}] ${g.issue} Corrección: ${g.fix}`);
  }
  for (const e of deterministic.syntax_errors) lines.push(`[lint] ${e}`);
  if (lines.length === 0) return "";
  const shown = lines.slice(0, maxItems);
  if (lines.length > maxItems) shown.push(`[lint] … y ${lines.length - maxItems} observación(es) más`);
  return shown.join(" ");
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
    auditorRan: true,
  };
}

/**
 * Creates the MDD Auditor (quality) node. Sin tools: el lint determinista va en el prompt.
 * `_precisionCalculator` se conserva por compatibilidad de firma (el semáforo regex ya no sobrescribe el score).
 */
export function createMddAuditorNode(
  llm: BaseChatModel,
  _precisionCalculator?: LivePrecisionCalculator | null,
) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    LOG("entry mddDraftLen=%s (lint determinista previo, sin tools)", (state.mddDraft ?? "").length);
    const draft = applyPreDeliveryGateFixes((state.mddDraft ?? "").trim());
    const validation = validateMddStructure(draft);
    const lint = runDeterministicMddLint(draft, validation);
    const deterministicBase = synthesizeDeterministicAuditorGaps(
      draft,
      validation,
      computeDeterministicAuditorScore(draft, validation),
      state.brdContent,
    );
    LOG(
      "lint: missingSections=%s payloads=%s sqlBlocks=%s sqlErrors=%s jsonBlocks=%s jsonErrors=%s",
      validation.missingSections.length,
      validation.section3HasPayloads,
      lint.sqlBlocks,
      lint.sqlErrors.length,
      lint.jsonBlocks,
      lint.jsonErrors.length,
    );

    try {
      const auditorPerInvokeMs = resolveMddAuditorPerInvokeHardTimeoutMs();
      const auditorNodeBudgetMs = resolveMddAuditorNodeBudgetMs();

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
      prompt += formatDeterministicLintForPrompt(lint);
      prompt += "\n**Responde únicamente con el JSON de salida.**";

      const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], {
        tag: "Auditor",
        maxAttempts: AUDITOR_LLM_MAX_ATTEMPTS,
        isResponseValid: (text) => text.trim().length > 0,
        hardTimeoutMs: Math.min(auditorPerInvokeMs, auditorNodeBudgetMs),
      });
      const lastContent = response ? extractLlmText(response) : "";

      const structuralBase = deterministicBase;

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

      // Único cap determinista conservado: las 7 secciones canónicas son contrato estructural del MDD.
      if (validation.missingSections.length > 0) {
        score = Math.min(score, 94);
        const sectionsNote =
          "Secciones obligatorias faltantes: " + validation.missingSections.join(", ") + ". El MDD debe tener exactamente las 7 secciones canónicas.";
        const existing = (parsed.auditorFeedback ?? "").trim();
        parsed.auditorFeedback = existing ? existing + " " + sectionsNote : sectionsNote;
        LOG("missingSections=%s → score capped at 94", validation.missingSections.join(";"));
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

      const auditorGaps = resolveAuditorGapsFromLlm(
        llmGaps,
        deterministicLintSyntaxErrors(lint),
        score,
        validation.missingSections,
      );
      if (!feedback && (auditorGaps.critical_gaps.length > 0 || auditorGaps.syntax_errors.length > 0)) {
        feedback = buildAuditorFeedbackFromGaps(auditorGaps);
      }
      if (!feedback && score < AUDIT_PASS_THRESHOLD) {
        feedback =
          "Faltan: modelo de datos/entidades con tipos y relaciones, contratos u operaciones con entrada/salida, decisiones de seguridad, estrategia de infraestructura/despliegue. Genera preguntas para cubrir estos huecos.";
      }
      // Gaps deterministas: informativos, nunca deciden el veredicto.
      const lintFeedback = formatDeterministicGapsAsLintFeedback(structuralBase);
      if (lintFeedback) feedback = feedback ? `${feedback} ${lintFeedback}` : lintFeedback;

      const hasConflict = auditorGaps.critical_gaps.some((g) => g.issue.includes("[CONFLICTO]"));

      const rawDecision = hasConflict
        ? ("blackboard" as const)
        : score >= AUDIT_PASS_THRESHOLD && validation.missingSections.length === 0
          ? ("done" as const)
          : ("clarifier" as const);
      const decision = resolveAuditorDecisionForSubstantialDraft(draft, rawDecision, {
        hasBrdTraceGaps: hasBrdToMddTraceabilityBlockers(state.brdContent, draft),
      });
      const currentIteration = state.mddIteration ?? 0;
      const iteration = currentIteration + (decision === "clarifier" ? 1 : 0);
      const finalFeedback = feedback || undefined;

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
        auditorRan: true,
      };
    } catch (err) {
      LOG("error: %s — fallback estructural", err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300));
      return buildStructuralAuditorResult(state, validation);
    }
  };
}
