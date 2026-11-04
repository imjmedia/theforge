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
 *
 * El veredicto pasa por `invokeLlmStructured` (zod + 1 reparación con el error re-inyectado). Sin veredicto
 * válido el resultado es `auditorOutcome: "unavailable"`: sin nota, sin bloqueo y sin `clarifier`.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import type { LivePrecisionCalculator } from "../estimation/estimation.types.js";
import { AUDITOR_MDD_PROMPT } from "../prompts/load-prompts.js";
import { auditorGapsSchema, mddAuditorDecisionSchema, type MDDStateType } from "../state/index.js";
import { repairTruncatedJsonObject } from "../utils/parse-json.js";
import { applyPreDeliveryGateFixes, validateMddStructure } from "../utils/mdd-sanitize.js";
import { getInternalDirectivesContext } from "../utils/mdd-mesh-topology.js";
import { auditorConstitutionRigorAppendix } from "../utils/mdd-complexity-rigor.js";
import { domainInventoryPromptBlock } from "../utils/mdd-domain-prompt.util.js";
import type { InvokeWithRetryOptions } from "../utils/mdd-llm-retry.util.js";
import { createLlmAbortError } from "../utils/mdd-llm-stream-invoke.util.js";
import { defaultExtractJson, invokeLlmStructured, type InvokeLlmStructuredArgs } from "../utils/mdd-llm-structured.util.js";
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
import {
  evaluateDesignFirstPinnedSectionAuditorGaps,
  isDesignFirstPinnedActive,
} from "../utils/design-first-pinned.util.js";

const AUDIT_PASS_THRESHOLD = MDD_AUDIT_PASS_THRESHOLD;

/** Intentos de transporte de cada invocación LLM del Auditor (la 2ª solo si la 1ª vuelve vacía o falla). */
const AUDITOR_LLM_MAX_ATTEMPTS = 2;

/** Reparaciones del veredicto tras una salida inválida (re-inyecta el error de validación al modelo). */
const AUDITOR_REPAIR_ATTEMPTS = 1;

type AuditorUnavailableReason = "invalid" | "transport" | "error" | "deadline";

const AUDITOR_UNAVAILABLE_REASON_TEXT: Record<AuditorUnavailableReason, string> = {
  invalid: "respuesta sin JSON válido tras 1 reparación",
  transport: "fallo de transporte con el modelo",
  error: "error interno del nodo",
  deadline: "presupuesto de tiempo del Auditor agotado",
};

/**
 * Extractor del veredicto: el de `invokeLlmStructured` + rescate de JSON truncado por tope de
 * tokens (lo que antes hacía `parseJsonOrThrow`), para no convertir una respuesta casi completa
 * en "Auditor no disponible".
 */
function extractAuditorJson(text: string): string | null {
  const direct = defaultExtractJson(text);
  if (direct) return direct;
  const stripped = text.replace(/^```json?\s*|\s*```$/g, "").trim();
  return repairTruncatedJsonObject(stripped);
}

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

/**
 * Veredicto del Auditor (LLM). `passthrough()`: campos extra del modelo no invalidan la salida.
 * `auditorDecision` es opcional: el nodo recalcula la decisión desde el score y los gaps, nunca la lee del LLM.
 */
export const auditorOutputSchema = z.object({
  auditorScore: z.number().min(0).max(100),
  auditorFeedback: z.string().optional().nullable(),
  auditorDecision: mddAuditorDecisionSchema.optional(),
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
}).passthrough();

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

/**
 * Auditor sin veredicto válido (JSON inválido tras la reparación, fallo de transporte o error interno):
 * "sin nota". NO puntúa (antes: 0/RECHAZADO con las 7 secciones, 50-65 con faltantes), NO bloquea la
 * entrega (la decide el gate determinista de `prepare_output`) y NO manda a `clarifier`.
 *
 * `auditorRan: true` se conserva a propósito: es lo que impide re-ejecutar el Auditor en bucle
 * (`shouldSkipAuditor`); "hay nota" lo dice `auditorOutcome === "scored"`, no `auditorRan`.
 * `auditorScore: undefined` limpia además una nota de un turno anterior que viviera en el checkpoint.
 */
function buildStructuralAuditorResult(
  state: MDDStateType,
  validation: ReturnType<typeof validateMddStructure>,
  reason: AuditorUnavailableReason,
): Partial<MDDStateType> {
  const auditorGaps = synthesizeStructuralAuditorGaps(validation);
  const structuralNote =
    buildAuditorFeedbackFromGaps(auditorGaps) || (validation.issues.length > 0 ? validation.issues.join(" ") : "");
  const feedback =
    `Auditoría LLM no disponible (${AUDITOR_UNAVAILABLE_REASON_TEXT[reason]}); ` +
    "la entrega la decide el gate determinista." +
    (structuralNote ? ` ${structuralNote}` : "");
  return {
    auditorOutcome: "unavailable",
    auditorUnavailableReason: reason,
    auditorScore: undefined,
    auditorFeedback: feedback,
    auditorGaps,
    auditorDecision: "done",
    mddIteration: state.mddIteration ?? 0,
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
  /** Solo pruebas: sobreescribe opciones de transporte (`backoffMs`, `disableStreaming`, …) y del presupuesto (`deadlineMs`, `setTimer`, `clearTimer`). */
  invokeOverrides?: Partial<InvokeWithRetryOptions & Pick<InvokeLlmStructuredArgs<unknown>, "deadlineMs" | "setTimer" | "clearTimer">>,
) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    LOG("entry mddDraftLen=%s (lint determinista previo, sin tools)", (state.mddDraft ?? "").length);
    const draft = applyPreDeliveryGateFixes((state.mddDraft ?? "").trim());
    const pinnedMode = isDesignFirstPinnedActive(state);
    const validation = validateMddStructure(draft);
    const lint = runDeterministicMddLint(draft, validation);
    const deterministicBase = synthesizeDeterministicAuditorGaps(
      draft,
      validation,
      computeDeterministicAuditorScore(draft, validation, { designFirstPinned: pinnedMode }),
      state.brdContent,
      { designFirstPinned: pinnedMode },
    );
    const pinnedSectionGaps = evaluateDesignFirstPinnedSectionAuditorGaps(draft, state);
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
      if (pinnedMode) {
        prompt +=
          "\n**Modo Design-First pinned:** §3 y §4 ya están selladas desde el PAG; puntúa solo §1, §2 y §5–§7 con el LLM. No penalices §3 por prosa mínima compilada.";
      }
      prompt += "\n**Responde únicamente con el JSON de salida.**";

      const llmVerdict = await invokeLlmStructured({
        llm,
        messages: [new HumanMessage(prompt)],
        schema: auditorOutputSchema,
        tag: "Auditor",
        repairAttempts: AUDITOR_REPAIR_ATTEMPTS,
        extractJson: extractAuditorJson,
        maxAttempts: AUDITOR_LLM_MAX_ATTEMPTS,
        hardTimeoutMs: Math.min(auditorPerInvokeMs, auditorNodeBudgetMs),
        deadlineMs: auditorNodeBudgetMs,
        ...invokeOverrides,
      });

      const structuralBase = deterministicBase;

      if (!llmVerdict.ok) {
        if (llmVerdict.reason === "aborted") throw createLlmAbortError("Auditor");
        LOG(
          "sin veredicto validado (reason=%s attempts=%s%s) → Auditor no disponible (sin nota)",
          llmVerdict.reason,
          llmVerdict.attempts,
          llmVerdict.lastError ? ` error=${llmVerdict.lastError.slice(0, 160)}` : "",
        );
        return buildStructuralAuditorResult(state, validation, llmVerdict.reason);
      }
      const parsed = llmVerdict.value;

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
      if (pinnedSectionGaps.length > 0) {
        auditorGaps.critical_gaps.unshift(...pinnedSectionGaps);
        auditorGaps.status = "RECHAZADO";
        score = Math.min(score, 70);
      }
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
        : pinnedSectionGaps.length > 0
          ? ("clarifier" as const)
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
        auditorOutcome: "scored",
        auditorUnavailableReason: undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      LOG("error: %s — Auditor no disponible (sin nota)", err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300));
      return buildStructuralAuditorResult(state, validation, "error");
    }
  };
}
