/**
 * @fileoverview Nodo formateador — aplica reglas de formato y normalización al MDD.
 */

import type { MDDStateType } from "../state/index.js";
import {
  ensureContratosSection,
  extractSection3Body,
  getMddDraftSummary,
  getSection6Or7Range,
  getSectionsToPreserveFromExecutorPlan,
  hydrateStructuredFromDraft,
  logMddNodeOutput,
  finalizeMddDeliverable,
  normalizeMddFormat,
  preserveUntouchedMddSectionsFromBaseline,
  replaceContextWhenOnlyMetadata,
  sanitizeContextKeyValueAndObject,
  sanitizeContextSection,
} from "../utils/mdd-sanitize.js";
import { reconcileUiUxDesignIntent } from "../utils/mdd-enrich-uiux-intent.js";
import { preserveTailSectionsIfSubstantial, preserveSection2FromStackSnapshot, preserveSection3FromDataModelSnapshot, preserveSection4FromApiContractsSnapshot, draftHasPersistableSection4 } from "../utils/mdd-section-preserve.util.js";
import { shouldPreferDraftOverStructured } from "../utils/mdd-prepare-output.js";
import { mddStructuredToMarkdown } from "../render/mdd-structured-to-markdown.js";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Formatter] ${msg}`, ...args);

function hasStructuredContent(mdd: MDDStateType["mddStructured"]): boolean {
  if (!mdd || typeof mdd !== "object") return false;
  const keys = Object.keys(mdd) as (keyof typeof mdd)[];
  return keys.some((k) => {
    const v = mdd[k];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return Object.keys(v as object).length > 0;
  });
}

/**
 * Nodo formateador: si existe mddStructured con contenido, deriva mddDraft con mddStructuredToMarkdown;
 * si no, normaliza mddDraft (unescape, Contexto a viñetas, tablas, TechnicalMetadata, etc.).
 * Sin LLM ni tools.
 */
export function createMddFormatterNode(): (state: MDDStateType) => Promise<Partial<MDDStateType>> {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const startedAt = Date.now();
    const currentDraft = (state.mddDraft ?? "").trim();
    const currentDraftLen = currentDraft.length;
    const section3Body = extractSection3Body(currentDraft);
    const draftHasSubstantialSection3 =
      (section3Body?.length ?? 0) > 200 && /\bCREATE\s+TABLE\b/i.test(section3Body ?? "");
    const range6 = getSection6Or7Range(currentDraft, 6);
    const section6Body =
      range6 != null
        ? currentDraft.slice(range6.start + (range6.heading?.length ?? 0), range6.end).trim()
        : "";
    const draftHasSubstantialSection6 =
      section6Body.length > 200 && !/^\s*\(Pendiente[^)]*\)\s*$/im.test(section6Body);
    const draftHasSubstantialSection4Local = draftHasPersistableSection4(currentDraft);
    // No reemplazar por mddStructured si: directiva aceptada, §3 sustancial, o §6 sustancial (evitar pisar Seguridad generada por Security node).
    const preserveDraftFromArchitect =
      (state.acceptedProposalDirective ?? "").trim().length > 0 && currentDraftLen > 500;
    const executorSectionPreserve =
      state.executorControlled === true &&
      (state.previousMddDraftForMerge?.trim().length ?? 0) > 500 &&
      getSectionsToPreserveFromExecutorPlan(state.sectionsToRun).length > 0;
    const preserveDraft =
      preserveDraftFromArchitect ||
      draftHasSubstantialSection3 ||
      draftHasSubstantialSection4Local ||
      draftHasSubstantialSection6 ||
      executorSectionPreserve ||
      shouldPreferDraftOverStructured(currentDraft, state.mddStructured);

    if (hasStructuredContent(state.mddStructured) && !preserveDraft) {
      try {
        const hydrated = hydrateStructuredFromDraft(state.mddStructured, state.mddDraft ?? "");
        const rendered = mddStructuredToMarkdown(hydrated);
        if (rendered.trim().length > 0) {
          const markdown = await reconcileUiUxDesignIntent(
            finalizeMddDeliverable(normalizeMddFormat(rendered)),
          );
          if (currentDraftLen > markdown.length * 1.35 || draftHasSubstantialSection3) {
            if (draftHasSubstantialSection3) LOG("draft tiene §3 sustancial; no reemplazar por mddStructured, se normaliza draft");
            else LOG("draft entrante (%s) mucho más largo que mddStructured (%s); se preserva draft y solo se normaliza", currentDraftLen, markdown.length);
          } else {
            LOG("derivado desde mddStructured len=%s (normalizado)", markdown.length);
            logMddNodeOutput("Formatter", markdown);
            return { mddDraft: markdown };
          }
        }
      } catch (err) {
        LOG("error render mddStructured: %s", err instanceof Error ? err.message : String(err));
      }
    } else if (preserveDraft) {
      if (preserveDraftFromArchitect) LOG("acceptedProposalDirective presente y draft sustancial; no reemplazar por mddStructured, se normaliza draft");
      else if (draftHasSubstantialSection6) LOG("draft con §6 sustancial; no reemplazar por mddStructured, se normaliza draft");
      else LOG("draft con §3 sustancial; no reemplazar por mddStructured, se normaliza draft");
    }
    const draft = currentDraft;
    if (!draft || draft.length < 50) {
      LOG("draft vacío o muy corto, sin cambios");
      return {};
    }
    try {
      let formatted = await reconcileUiUxDesignIntent(
        finalizeMddDeliverable(
          normalizeMddFormat(
            ensureContratosSection(
              replaceContextWhenOnlyMetadata(sanitizeContextKeyValueAndObject(sanitizeContextSection(draft))),
            ),
          ),
        ),
      );
      if (state.executorControlled === true && state.previousMddDraftForMerge?.trim()) {
        const preserve = getSectionsToPreserveFromExecutorPlan(state.sectionsToRun);
        if (preserve.length > 0) {
          formatted = preserveUntouchedMddSectionsFromBaseline(
            formatted,
            state.previousMddDraftForMerge.trim(),
            preserve,
          );
          LOG("preservadas secciones fuera de plan tras format: %s", preserve.join(","));
        }
      }
      if (formatted === draft) {
        const sum = getMddDraftSummary(draft);
        logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, 0, draft.length), { unchanged: true });
        LOG("sin cambios len=%s section2=%s", sum.length, sum.section2);
        return {};
      }
      formatted = preserveTailSectionsIfSubstantial(draft, formatted);
      formatted = preserveSection2FromStackSnapshot(state.stackArchitectMddDraftSnapshot, formatted);
      formatted = preserveSection3FromDataModelSnapshot(state.dataModelArchitectMddDraftSnapshot, formatted);
      formatted = preserveSection4FromApiContractsSnapshot(
        state.apiContractsArchitectMddDraftSnapshot,
        formatted,
      );
      const sum = getMddDraftSummary(formatted);
      logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, 0, formatted.length));
      LOG("formateado len=%s -> %s section2=%s", draft.length, sum.length, sum.section2);
      logMddNodeOutput("Formatter", formatted);
      return { mddDraft: formatted };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      return {};
    }
  };
}
