/**
 * @fileoverview Nodo tail-parallel — ejecuta procesamiento paralelo final.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import type { MDDStateType } from "../state/index.js";
import { mergeSection6AvoidingRegression } from "./mdd-credential-storage.util.js";
import { mergeMddStructured } from "./mdd-merge-structured.js";
import {
  recoverMisplacedContratosFromSection3,
  repairMergeBaselineBeforeApiContractsMerge,
} from "./mdd-api-contracts-merge.util.js";
import { isPlaceholderSeguridad, recoverSeguridadItemsFromRawLlmText } from "./mdd-security-parse.js";
import {
  draftHasPersistableSection4,
  draftHasSubstantialSection6,
  draftHasSubstantialSection7,
  isSection5SectionRegression,
} from "./mdd-section-preserve.util.js";
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
  mddHasDuplicateSectionHeadings,
  deduplicateAndReorderMddSections,
  deduplicateMddDraftSections,
  replaceMddSection5Body,
  replaceSection6Or7InDraft,
  seguridadItemsToSection6Markdown,
} from "./mdd-sanitize.js";
import { normalizeGluedSection4HeadingInDraft } from "./mdd-sanitize/contratos-format.js";
import {
  closeUnclosedFencesBeforeCanonicalH2,
  findH2HeadingMatch,
} from "./mdd-sanitize/section-fence.util.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";

export type TailParallelNodeResult = Partial<MDDStateType> & {
  integrationSectionMd?: string;
};

export function resolveSection7BodyForMerge(
  intResult: TailParallelNodeResult,
  intDraft: string,
): string | null {
  const explicit = (intResult.integrationSectionMd ?? "").trim();
  if (
    explicit.length > 80 &&
    !isMddSectionPipelinePlaceholderBody(explicit) &&
    !/^\(Pendiente/i.test(explicit)
  ) {
    return explicit;
  }

  const fromDraft = extractSection7Body(intDraft);
  if (
    fromDraft &&
    fromDraft.length > 80 &&
    !isMddSectionPipelinePlaceholderBody(fromDraft) &&
    !/^\(Pendiente/i.test(fromDraft)
  ) {
    return fromDraft;
  }

  const range7 = getSection6Or7Range(intDraft, 7);
  if (range7) {
    const slice = intDraft.slice(range7.start, range7.end).trim();
    const body = extractSection7Body(slice) ?? slice.replace(/^##[^\n]+\n+/i, "").trim();
    if (
      body.length > 80 &&
      !isMddSectionPipelinePlaceholderBody(body) &&
      !/^\(Pendiente/i.test(body)
    ) {
      return body;
    }
  }

  const integracion = intResult.mddStructured?.integracion;
  if (integracion) {
    const fromStructured = integracionToSection7Markdown(
      Array.isArray(integracion) ? { subsections: integracion } : integracion,
    ).trim();
    if (
      fromStructured.length > 80 &&
      !isMddSectionPipelinePlaceholderBody(fromStructured) &&
      !/^\(Pendiente/i.test(fromStructured)
    ) {
      return fromStructured;
    }
  }

  return null;
}

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

/** Líneas máximas de DDL §3 incluidas en el contexto LLM de §5. */
export const SECTION5_SECTION3_SQL_MAX_LINES = 45;

export type Section5PreflightResult = {
  draft: string;
  hadDuplicateHeadings: boolean;
  closedOpenFences: boolean;
};

/**
 * Pre-vuelo antes de regenerar §5: cierra fences abiertos y advierte si hay headings duplicados.
 * El borrador saneado se usa para contexto LLM y merge (evita §4 fence abierto tragándose §5–§7).
 */
export function preflightSanitizeDraftForSection5(draft: string): Section5PreflightResult {
  const trimmed = (draft ?? "").trim();
  const hadDuplicateHeadings = mddHasDuplicateSectionHeadings(trimmed);
  if (hadDuplicateHeadings) {
    console.warn(
      "[MDD:Section5:preflight] headings duplicados §1–§7 detectados — el merge puede fallar si persisten",
    );
  }
  const sanitized = closeUnclosedFencesBeforeCanonicalH2(trimmed);
  const closedOpenFences = sanitized !== trimmed;
  if (closedOpenFences) {
    console.warn("[MDD:Section5:preflight] cerrado fence abierto antes de H2 canónico (§4→§5)");
  }
  return { draft: sanitized, hadDuplicateHeadings, closedOpenFences };
}

/** Resume §3 para LLM: primeras N líneas del bloque SQL + indicador de truncado. */
export function truncateSection3SqlForLlmContext(body: string | null | undefined): string {
  const raw = (body ?? "").trim();
  if (!raw) return "(§3 pendiente — inferir entidades desde §1–§2)";

  const sqlMatch = raw.match(/```sql\s*\n([\s\S]*?)```/i);
  if (sqlMatch?.[1]) {
    const lines = sqlMatch[1].split("\n");
    if (lines.length <= SECTION5_SECTION3_SQL_MAX_LINES) return raw;
    const head = lines.slice(0, SECTION5_SECTION3_SQL_MAX_LINES).join("\n");
    const tableCount = (sqlMatch[1].match(/\bCREATE\s+TABLE\b/gi) ?? []).length;
    return `\`\`\`sql\n${head}\n-- ... (${lines.length - SECTION5_SECTION3_SQL_MAX_LINES} líneas omitidas; ~${tableCount} tablas)\n\`\`\``;
  }

  const lines = raw.split("\n");
  if (lines.length <= SECTION5_SECTION3_SQL_MAX_LINES) return raw;
  return `${lines.slice(0, SECTION5_SECTION3_SQL_MAX_LINES).join("\n")}\n...(§3 DDL truncado: ${lines.length} líneas totales)`;
}

/**
 * Contexto estructurado para el LLM de §5: solo §1–§4 (§5/§6/§7 excluidas).
 * §3 resumido; §4 solo tabla de rutas / headings (sin bloques ```json```).
 */
export function buildSection5LlmContext(draft: string): string {
  const { draft: sanitized } = preflightSanitizeDraftForSection5(draft);
  const parts: string[] = [
    "**Contexto estructurado (solo §1–§4; §5, §6 y §7 excluidas del input):**",
    "",
  ];
  const s1 = extractContextSectionBody(sanitized);
  const s2 = extractArquitecturaSectionBody(sanitized);
  const s3 = truncateSection3SqlForLlmContext(extractSection3Body(sanitized));
  const s4Routes = extractContratosRoutesTableOnly(extractContratosSectionBody(sanitized));

  if (s1) parts.push("### §1 Contexto", "", s1, "");
  if (s2) parts.push("### §2 Arquitectura y Stack", "", s2, "");
  parts.push("### §3 Modelo de Datos (DDL resumido)", "", s3, "");
  parts.push("### §4 Contratos (tabla de rutas; sin payloads JSON)", "", s4Routes, "");

  return parts.join("\n");
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

  const hasRealSection5H2 = findH2HeadingMatch(
    trimmed,
    /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i,
  );
  if (hasRealSection5H2) {
    if (mddHasDuplicateSectionHeadings(trimmed)) {
      return deduplicateAndReorderMddSections(trimmed);
    }
    const existing = extractSection5Body(trimmed);
    if (existing && !isMddSectionPipelinePlaceholderBody(existing) && existing.trim().length >= 100) {
      return trimmed;
    }
    return replaceMddSection5Body(trimmed, MDD_SECTION5_TAIL_PLACEHOLDER);
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
  const section7Body = resolveSection7BodyForMerge(intResult, intDraft);
  if (section7Body) {
    finalDraft = replaceSection6Or7InDraft(secDraft, 7, section7Body);
  }

  const section5Body = extractSection5BodyForMerge(s5Result, baseDraft);
  const baselineS5 = extractSection5Body(baseDraft);
  if (section5Body) {
    if (baselineS5 && isSection5SectionRegression(baselineS5, section5Body)) {
      console.warn(
        `[MDD:TailParallel] §5 merge rechazado por regresión (${baselineS5.length}→${section5Body.length} chars)`,
      );
    } else {
      finalDraft = replaceMddSection5Body(finalDraft, section5Body);
    }
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

/** Post-merge: fuerza §6/§7 si los agentes devolvieron contenido pero el draft no lo refleja. */
function assertPostCriticTailSectionsInDraft(
  finalDraft: string,
  secResult: TailParallelNodeResult,
  intResult: TailParallelNodeResult,
): string {
  let out = finalDraft;
  const s6Body = extractSection6Body(out);
  const s6Missing = !s6Body || isMddSectionPipelinePlaceholderBody(s6Body);
  const seguridad = secResult.mddStructured?.seguridad;
  const secMd =
    secResult.securitySectionMd?.trim() ||
    (seguridad?.length && !isPlaceholderSeguridad(seguridad)
      ? seguridadItemsToSection6Markdown(seguridad)
      : "");

  if (s6Missing && secMd.length >= 100) {
    out = mergeSection6AvoidingRegression(out, secMd);
    console.error(
      "[MDD:PostCriticMerge] §6 faltante pese a Security OK — force inject (len=%s)",
      secMd.length,
    );
  }

  const s7Body = extractSection7Body(out);
  const s7Missing = !s7Body || isMddSectionPipelinePlaceholderBody(s7Body);
  const integracion = intResult.mddStructured?.integracion;
  let intMd = intResult.integrationSectionMd?.trim() ?? "";
  if (!intMd && integracion) {
    const integracionForMd = Array.isArray(integracion) ? { subsections: integracion } : integracion;
    intMd = integracionToSection7Markdown(integracionForMd);
  }
  const s7BodyFromMd = intMd.replace(/^##[^\n]+\n+/, "").trim();

  if (s7Missing && s7BodyFromMd.length >= 100 && !isMddSectionPipelinePlaceholderBody(s7BodyFromMd)) {
    const draftWithSection6 = ensureSection6WhenSection7Present(out);
    out = replaceSection6Or7InDraft(draftWithSection6, 7, intMd.startsWith("##") ? intMd : `## 7. Infraestructura\n\n${intMd}`);
    console.error(
      "[MDD:PostCriticMerge] §7 faltante pese a Integration OK — force inject (len=%s)",
      s7BodyFromMd.length,
    );
  }

  return out;
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
  let finalDraft = repairMergeBaselineBeforeApiContractsMerge(
    (apiResult.mddDraft ?? state.mddDraft ?? "").trim(),
  );
  finalDraft = normalizeGluedSection4HeadingInDraft(finalDraft);
  if (!draftHasPersistableSection4(finalDraft)) {
    finalDraft = recoverMisplacedContratosFromSection3(finalDraft);
  }
  finalDraft = ensureSection5TailParallelPlaceholder(finalDraft);

  const seguridad = secResult.mddStructured?.seguridad;
  const seguridadStructuredOk = !!(seguridad?.length && !isPlaceholderSeguridad(seguridad));
  const securitySectionMd = secResult.securitySectionMd?.trim();

  if (seguridadStructuredOk) {
    finalDraft = mergeSection6AvoidingRegression(
      finalDraft,
      seguridadItemsToSection6Markdown(seguridad!),
    );
  } else if (securitySectionMd && securitySectionMd.length >= 100) {
    finalDraft = mergeSection6AvoidingRegression(finalDraft, securitySectionMd);
  } else if (seguridad?.length) {
    const recovered = recoverSeguridadItemsFromRawLlmText(
      seguridadItemsToSection6Markdown(seguridad),
    );
    if (recovered?.length && !isPlaceholderSeguridad(recovered)) {
      finalDraft = mergeSection6AvoidingRegression(
        finalDraft,
        seguridadItemsToSection6Markdown(recovered),
      );
    }
  }

  const s6AfterStructuredMerge = extractSection6Body(finalDraft);
  if (
    (seguridadStructuredOk || securitySectionMd) &&
    (!s6AfterStructuredMerge || isMddSectionPipelinePlaceholderBody(s6AfterStructuredMerge))
  ) {
    const fallbackS6 =
      securitySectionMd ||
      (seguridad?.length ? seguridadItemsToSection6Markdown(seguridad) : "");
    if (fallbackS6 && fallbackS6.length >= 100) {
      finalDraft = mergeSection6AvoidingRegression(finalDraft, fallbackS6);
      console.warn(
        "[MDD:PostCriticMerge] §6 ausente/placeholder pese a seguridad OK — inyectado (len=%s)",
        fallbackS6.length,
      );
    }
  }

  const integracion = intResult.mddStructured?.integracion;
  const integrationSectionMd = intResult.integrationSectionMd?.trim();
  const integracionStructuredOk = !!integracion;

  if (integracionStructuredOk) {
    const integracionForMd = Array.isArray(integracion) ? { subsections: integracion } : integracion;
    const section7Md = integracionToSection7Markdown(integracionForMd);
    const s7Body = section7Md.replace(/^##[^\n]+\n+/, "").trim();
    if (s7Body.length >= 100 && !isMddSectionPipelinePlaceholderBody(s7Body)) {
      const draftWithSection6 = ensureSection6WhenSection7Present(finalDraft);
      finalDraft = replaceSection6Or7InDraft(draftWithSection6, 7, section7Md);
    }
  } else if (integrationSectionMd && integrationSectionMd.length >= 100) {
    const s7Body = integrationSectionMd.replace(/^##[^\n]+\n+/, "").trim();
    if (!isMddSectionPipelinePlaceholderBody(s7Body)) {
      const draftWithSection6 = ensureSection6WhenSection7Present(finalDraft);
      finalDraft = replaceSection6Or7InDraft(
        draftWithSection6,
        7,
        integrationSectionMd.startsWith("##") ? integrationSectionMd : `## 7. Infraestructura\n\n${integrationSectionMd}`,
      );
    }
  }

  finalDraft = assertPostCriticTailSectionsInDraft(finalDraft, secResult, intResult);

  finalDraft = deduplicateMddDraftSections(closeUnclosedFencesBeforeCanonicalH2(finalDraft));
  if (mddHasDuplicateSectionHeadings(finalDraft)) {
    console.warn(
      "[MDD:PostCriticMerge] headings duplicados §1–§7 persisten tras dedupe+fence",
    );
  }

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

  const resolvedSecuritySectionMd =
    secResult.securitySectionMd?.trim() ||
    (draftHasSubstantialSection6(finalDraft)
      ? seguridadItemsToSection6Markdown(mergedStructured.seguridad ?? seguridad ?? [])
      : undefined);
  const resolvedIntegrationSectionMd =
    intResult.integrationSectionMd?.trim() ||
    (draftHasSubstantialSection7(finalDraft) && integracion
      ? integracionToSection7Markdown(
          Array.isArray(integracion) ? { subsections: integracion } : integracion,
        )
      : undefined);

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
    ...(draftHasSubstantialSection6(finalDraft)
      ? { securityArchitectMddDraftSnapshot: finalDraft }
      : {}),
    ...(draftHasSubstantialSection7(finalDraft)
      ? { integrationArchitectMddDraftSnapshot: finalDraft }
      : {}),
    ...(resolvedSecuritySectionMd ? { securitySectionMd: resolvedSecuritySectionMd } : {}),
    ...(resolvedIntegrationSectionMd ? { integrationSectionMd: resolvedIntegrationSectionMd } : {}),
    ...(directives.length > 0 ? { internalDirectives: directives } : {}),
  };
}
