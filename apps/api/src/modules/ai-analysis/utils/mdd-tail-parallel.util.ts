/**
 * @fileoverview Nodo tail-parallel — ejecuta procesamiento paralelo final.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import type { MDDStateType } from "../state/index.js";
import {
  extractSection5Body,
  extractSection6Body,
  extractSection7Body,
  getSection6Or7Range,
  isMddSectionPipelinePlaceholderBody,
  replaceMddSection5Body,
  replaceSection6Or7InDraft,
} from "./mdd-sanitize.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";

export type TailParallelNodeResult = Partial<MDDStateType>;

/** §6/§7 aún no materializadas → section5 no debe citarlas como hechos. */
export function isTailParallelFirstPassDraft(draft: string): boolean {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return true;
  const s6 = extractSection6Body(trimmed);
  const s7 = extractSection7Body(trimmed);
  const s6Pending = !s6 || isMddSectionPipelinePlaceholderBody(s6);
  const s7Pending = !s7 || isMddSectionPipelinePlaceholderBody(s7);
  return s6Pending && s7Pending;
}

/** Tras SA (§2–§4): asegura §5 placeholder canónico para el nodo dedicado. */
export function ensureSection5TailParallelPlaceholder(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return trimmed;
  const existing = extractSection5Body(trimmed);
  if (existing && !isMddSectionPipelinePlaceholderBody(existing) && existing.trim().length >= 100) {
    return trimmed;
  }
  return replaceMddSection5Body(trimmed, MDD_SECTION5_TAIL_PLACEHOLDER);
}

/** Borrador truncado para section5 en primera pasada paralela (solo §1–§4). */
export function draftThroughSection4ForTailParallelFirstPass(draft: string): string {
  const trimmed = (draft ?? "").trim();
  const s4Match = trimmed.match(/##\s*4\.\s*Contratos\s+de\s+API/i);
  if (!s4Match?.index) return trimmed;
  const after4Start = s4Match.index + s4Match[0].length;
  const rest = trimmed.slice(after4Start);
  const nextH2 = rest.search(/\n##\s+[567]\./);
  const end = nextH2 >= 0 ? after4Start + nextH2 : trimmed.length;
  return trimmed.slice(0, end).trim();
}

function extractSection5BodyForMerge(s5Result: TailParallelNodeResult, baseDraft: string): string | null {
  const fromDraft = s5Result.mddDraft ? extractSection5Body(s5Result.mddDraft) : null;
  const structuredBody =
    typeof s5Result.mddStructured?.logicaEdgeCases === "string"
      ? s5Result.mddStructured.logicaEdgeCases
      : "";
  const body = (fromDraft ?? structuredBody).trim();
  if (!body || isMddSectionPipelinePlaceholderBody(body) || body.length < 100) return null;
  if (fromDraft && s5Result.mddDraft === baseDraft) return null;
  return body;
}

/**
 * Combina §5 (section5), §6 (security) y §7 (integration) sobre el draft post-SA.
 * Mismo contrato que `security_integration` para §6+§7, más inyección quirúrgica de §5.
 */
export function mergeTailParallelResults(
  state: MDDStateType,
  s5Result: TailParallelNodeResult,
  secResult: TailParallelNodeResult,
  intResult: TailParallelNodeResult,
): Partial<MDDStateType> {
  const baseDraft = (state.mddDraft ?? "").trim();
  const secDraft = (secResult.mddDraft ?? baseDraft).trim();
  const intDraft = (intResult.mddDraft ?? baseDraft).trim();

  let finalDraft = secDraft;
  const range7 = getSection6Or7Range(intDraft, 7);
  if (range7) {
    finalDraft = replaceSection6Or7InDraft(secDraft, 7, intDraft.slice(range7.start, range7.end));
  }

  const section5Body = extractSection5BodyForMerge(s5Result, baseDraft);
  if (section5Body) {
    finalDraft = replaceMddSection5Body(finalDraft, section5Body);
  }

  const secStructured = secResult.mddStructured ?? state.mddStructured ?? {};
  const intStructured = intResult.mddStructured;
  const mergedStructured: MddStructured = {
    ...(secStructured as MddStructured),
    ...(intStructured?.integracion !== undefined ? { integracion: intStructured.integracion } : {}),
    ...(section5Body ? { logicaEdgeCases: section5Body } : {}),
  } as MddStructured;

  const directives = [
    ...(Array.isArray((s5Result as Record<string, unknown>).internalDirectives)
      ? ((s5Result as Record<string, unknown>).internalDirectives as {
          from: string;
          to: string;
          message: string;
        }[])
      : []),
    ...(Array.isArray((secResult as Record<string, unknown>).internalDirectives)
      ? ((secResult as Record<string, unknown>).internalDirectives as {
          from: string;
          to: string;
          message: string;
        }[])
      : []),
    ...(Array.isArray((intResult as Record<string, unknown>).internalDirectives)
      ? ((intResult as Record<string, unknown>).internalDirectives as {
          from: string;
          to: string;
          message: string;
        }[])
      : []),
  ];

  return {
    mddDraft: finalDraft,
    mddStructured: mergedStructured,
    ...(directives.length > 0 ? { internalDirectives: directives } : {}),
  };
}
