/**
 * @fileoverview Nodo tail-parallel — ejecuta procesamiento paralelo final.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import type { MDDStateType } from "../state/index.js";
import { mergeSection6AvoidingRegression } from "./mdd-credential-storage.util.js";
import { mergeMddStructured } from "./mdd-merge-structured.js";
import { isPlaceholderSeguridad } from "./mdd-security-parse.js";
import {
  extractArquitecturaSectionBody,
  extractContextSectionBody,
  extractContratosSectionBody,
  extractSection3Body,
  extractSection5Body,
  extractSection6Body,
  extractSection7Body,
  ensureSection6WhenSection7Present,
  getSection6Or7Range,
  integracionToSection7Markdown,
  isMddSectionPipelinePlaceholderBody,
  replaceMddSection5Body,
  replaceSection6Or7InDraft,
  seguridadItemsToSection6Markdown,
} from "./mdd-sanitize.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";

export type TailParallelNodeResult = Partial<MDDStateType>;

/** §4 sin bloques ```json``` — solo tabla de rutas y headings de endpoint. */
export function extractContratosRoutesTableOnly(section4Body: string | null | undefined): string {
  const body = (section4Body ?? "").trim();
  if (!body) return "(§4 pendiente — inferir endpoints desde §3)";

  const withoutJson = body.replace(/```json[\s\S]*?```/gi, "").trim();
  const lines = withoutJson.split("\n");
  const kept: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\|/.test(trimmed)) {
      inTable = true;
      kept.push(line);
      continue;
    }
    if (inTable && !trimmed) {
      kept.push(line);
      continue;
    }
    inTable = false;
    if (/^###\s+(GET|POST|PUT|DELETE|PATCH)\s+/i.test(trimmed)) {
      kept.push(line);
      continue;
    }
    if (/resumen de endpoints/i.test(trimmed)) {
      kept.push(line);
    }
  }

  const compact = kept.join("\n").trim();
  if (compact.length >= 40) return compact;
  return withoutJson.length > 1800 ? `${withoutJson.slice(0, 1800)}\n...(§4 truncado)` : withoutJson;
}

/** Contexto acotado para security/integration en post_critic_parallel (F3). */
export function buildTrimmedTailAgentContext(draft: string): string {
  const trimmed = (draft ?? "").trim();
  const parts: string[] = [
    "**Contexto de referencia (§1–§4 rutas; sin payloads JSON de §4):**",
    "",
  ];
  const s1 = extractContextSectionBody(trimmed);
  const s2 = extractArquitecturaSectionBody(trimmed);
  const s3 = extractSection3Body(trimmed);
  const s4Routes = extractContratosRoutesTableOnly(extractContratosSectionBody(trimmed));

  if (s1) parts.push("### §1 Contexto", "", s1, "");
  if (s2) parts.push("### §2 Arquitectura y Stack", "", s2, "");
  if (s3) parts.push("### §3 Modelo de Datos (DDL)", "", s3, "");
  parts.push("### §4 Contratos (tabla de rutas)", "", s4Routes, "");

  return parts.join("\n");
}

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

/**
 * Combina §4 (api_contracts) con slices §6/§7 (security/integration sliceOnly).
 * No usa mddDraft de security/integration — evita colisión en el reducer LangGraph.
 */
export function mergePostCriticParallelResults(
  state: MDDStateType,
  apiResult: TailParallelNodeResult,
  secResult: TailParallelNodeResult,
  intResult: TailParallelNodeResult,
): Partial<MDDStateType> {
  let finalDraft = (apiResult.mddDraft ?? state.mddDraft ?? "").trim();

  const seguridad = secResult.mddStructured?.seguridad;
  if (seguridad?.length && !isPlaceholderSeguridad(seguridad)) {
    finalDraft = mergeSection6AvoidingRegression(
      finalDraft,
      seguridadItemsToSection6Markdown(seguridad),
    );
  }

  const integracion = intResult.mddStructured?.integracion;
  if (integracion) {
    const integracionForMd = Array.isArray(integracion) ? { subsections: integracion } : integracion;
    const section7Md = integracionToSection7Markdown(integracionForMd);
    const draftWithSection6 = ensureSection6WhenSection7Present(finalDraft);
    finalDraft = replaceSection6Or7InDraft(draftWithSection6, 7, section7Md);
  }

  finalDraft = ensureSection5TailParallelPlaceholder(finalDraft);

  let mergedStructured = mergeMddStructured(
    state.mddStructured ?? undefined,
    apiResult.mddStructured ?? {},
    finalDraft,
  );
  if (seguridad?.length) {
    mergedStructured = mergeMddStructured(mergedStructured, { seguridad }, finalDraft);
  }
  if (integracion) {
    mergedStructured = mergeMddStructured(mergedStructured, { integracion }, finalDraft);
  }

  const directives = [
    ...(Array.isArray((apiResult as Record<string, unknown>).internalDirectives)
      ? ((apiResult as Record<string, unknown>).internalDirectives as {
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
    mddStructured: mergedStructured as MddStructured,
    postCriticParallelDone: true,
    ...(secResult.securitySectionMd ? { securitySectionMd: secResult.securitySectionMd } : {}),
    ...(intResult.integrationSectionMd ? { integrationSectionMd: intResult.integrationSectionMd } : {}),
    ...(directives.length > 0 ? { internalDirectives: directives } : {}),
  };
}
