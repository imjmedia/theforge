/**
 * @fileoverview Nodo preparador de salida — ensamblaje final del MDD completo.
 */

import type { MddStructured } from "../state/mdd-structured.schema.js";
import { repairInlineHorizontalRuleSectionBreaks } from "@theforge/shared-types";
import { mddStructuredToMarkdown } from "../render/mdd-structured-to-markdown.js";
import { injectProposedComponentDiagramIntoSection2 } from "./mdd-component-diagram.util.js";
import {
  injectMddDiagrams,
  regenerateErDiagramFromSql,
  suggestMddDiagrams,
} from "./mdd-diagram-suggestions.js";
import {
  extractSection3Body,
  extractSection4Body,
  extractSection5Body,
  finalizeMddDeliverable,
  getSection6Or7Range,
  hydrateStructuredFromDraft,
  mddHasDuplicateSectionHeadings,
  normalizeMddFormat,
  replaceContextWhenOnlyMetadata,
  replaceMddSection4Body,
  replaceMddSection3Body,
  replaceMddSection5Body,
  replaceArquitecturaSectionBody,
  extractArquitecturaSectionBody,
  sanitizeContextKeyValueAndObject,
  sanitizeContextSection,
  applyPreDeliveryGateFixes,
  deduplicateMddDraftSections,
  detectCrossConsistencyIssues,
  prepareMddMarkdownForPersist,
  deduplicateAndReorderMddSections,
  restoreMddSectionsFromBaselineStrict,
  replaceSection6Or7InDraft,
} from "./mdd-sanitize.js";
import {
  extractContratosSectionBody,
  isContratosSectionRegression,
} from "./mdd-sanitize/contratos-format.js";
import { ensureDocumentFenceParity } from "./mdd-sanitize/section-fence.util.js";
import { extractBestSection5Body } from "./mdd-sanitize/section-merge.js";
import { logMddPersistFenceDiag } from "./mdd-persist-fence-diag.util.js";
import {
  enrichMddWithUiUxDesignIntent,
  reconcileUiUxDesignIntent,
} from "./mdd-enrich-uiux-intent.js";
import {
  heuristicUiComponentResolver,
  type UiComponentResolver,
} from "../../ui-mcp/ui-component-resolver.js";
import { isPlaceholderSeguridad } from "./mdd-security-parse.js";
import {
  draftHasPersistableSection4,
  draftHasSubstantialSection2,
  draftHasSubstantialSection3,
  draftHasSubstantialSection5,
  preserveValidatedSectionsIfSubstantial,
  preserveValidatedSectionsFromSnapshots,
  guardValidatedSectionsForPersist,
  resolveTailPreserveBaseline,
  restoreSections6And7IfRegressed,
} from "./mdd-section-preserve.util.js";
import { ensureMddGovernanceSection, extractGovernanceSection } from "@theforge/shared-types/mdd-governance-patterns";
import { validateMddForDeliveryMemo } from "./mdd-off-graph-memo.util.js";
import type { MddDeliveryGateResult } from "./mdd-delivery-gate.util.js";
import { composeSection3FromStructured } from "./schema-owner.util.js";
import {
  injectUiMcpIntoMddFrontendSection,
} from "./mdd-inject-ui-mcp-frontend.util.js";

export function hasStructuredContent(mdd: MddStructured | null | undefined): boolean {
  if (!mdd || typeof mdd !== "object") return false;
  const keys = Object.keys(mdd) as (keyof MddStructured)[];
  return keys.some((k) => {
    const v = mdd[k];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return Object.keys(v as object).length > 0;
  });
}

export function draftHasSubstantialSection6(draft: string): boolean {
  const trimmed = (draft ?? "").trim();
  const range = getSection6Or7Range(trimmed, 6);
  if (!range) return false;
  const bodyStart = range.start + range.heading.length;
  const body = trimmed.slice(bodyStart, range.end).replace(/^\s*\n+/, "").trim();
  return body.length > 200 && !/^\s*\(Pendiente[^)]*\)\s*$/im.test(body) && !/^\s*\{/.test(body);
}

function draftHasSection3WithCreateTable(draft: string): boolean {
  const section3Body = extractSection3Body(draft);
  return (section3Body?.length ?? 0) > 200 && /\bCREATE\s+TABLE\b/i.test(section3Body ?? "");
}

function countH2Sections(draft: string): number {
  return (draft.match(/^##\s+/gm) ?? []).length;
}

/**
 * Prefiere el borrador markdown cuando reconstruir desde mddStructured perdería §1–§5
 * (p. ej. tras regenerar §6 con structured parcial o solo placeholder en seguridad).
 */
export function shouldPreferDraftOverStructured(
  draft: string,
  structured?: MddStructured | null,
): boolean {
  const trimmed = (draft ?? "").trim();
  if (trimmed.length < 200) return false;
  if (draftHasSubstantialSection6(trimmed)) return true;
  if (draftHasSubstantialSection5(trimmed)) return true;
  // Si el draft tiene §6 pero el structured solo tiene placeholder, preservar draft
  const s6Range = getSection6Or7Range(trimmed, 6);
  if (s6Range) {
    const body = trimmed.slice(s6Range.start + s6Range.heading.length, s6Range.end).replace(/^\s*\n+/, "").trim();
    const hasRealContent = body.length > 15 && !/^\s*\(?Pendiente[^)]*\)?\s*$/im.test(body);
    if (hasRealContent && (!structured?.seguridad?.length || isPlaceholderSeguridad(structured.seguridad))) {
      return true;
    }
  }
  if (draftHasSection3WithCreateTable(trimmed)) return true;
  if (countH2Sections(trimmed) >= 4 && trimmed.length > 500) return true;
  if (!hasStructuredContent(structured)) return trimmed.length > 0;
  try {
    const hydrated = hydrateStructuredFromDraft(structured, trimmed);
    const rebuilt = mddStructuredToMarkdown(hydrated).trim();
    if (rebuilt.length > 0 && rebuilt.length < trimmed.length * 0.85) return true;
  } catch {
    return true;
  }
  return false;
}

/** Detecta heading canónico §6 (semáforo y validación post-/seguridad). */
export function draftHasSection6Heading(draft: string): boolean {
  return getSection6Or7Range((draft ?? "").trim(), 6) != null;
}

/** Fuente para restore post-normalize: dedupe antes de comparar (duplicados no deben saltar restore). */
function resolveSectionRestoreSource(source: string): string {
  const trimmed = (source ?? "").trim();
  if (!trimmed) return trimmed;
  return mddHasDuplicateSectionHeadings(trimmed)
    ? deduplicateMddDraftSections(trimmed)
    : trimmed;
}

/**
 * normalizeMddFormat (deduplicateAndReorderMddSections) puede eliminar §6/§7 recién insertadas.
 * Restaura desde el borrador pre-normalize si desaparecieron.
 */
function restoreSections6And7AfterNormalize(source: string, normalized: string): string {
  const sourceRepaired = repairInlineHorizontalRuleSectionBreaks(resolveSectionRestoreSource(source));
  let out = normalized;
  for (const section of [6, 7] as const) {
    const srcRange = getSection6Or7Range(sourceRepaired, section);
    if (!srcRange) continue;
    if (getSection6Or7Range(out, section)) continue;
    const sectionMd = sourceRepaired.slice(srcRange.start, srcRange.end).trim();
    if (sectionMd.length > 0) out = replaceSection6Or7InDraft(out, section, sectionMd);
  }
  return out;
}

/** Evita que normalizeMddFormat/dedupe dejen §4 en stub tras api_contracts. */
function restoreSection4AfterNormalize(source: string, normalized: string): string {
  const restoreSource = resolveSectionRestoreSource(source);
  const srcBody = extractContratosSectionBody(restoreSource);
  const normBody = extractContratosSectionBody(normalized);
  if (!srcBody?.trim()) return normalized;
  if (isContratosSectionRegression(srcBody, normBody) && srcBody) {
    return replaceMddSection4Body(normalized, srcBody);
  }
  if (draftHasPersistableSection4(restoreSource) && !draftHasPersistableSection4(normalized)) {
    return replaceMddSection4Body(normalized, srcBody);
  }
  return normalized;
}

function restoreSectionBodyAfterNormalize(
  source: string,
  normalized: string,
  extractBody: (draft: string) => string | null,
  replaceBody: (draft: string, body: string) => string,
  hasSubstantial: (draft: string) => boolean,
  sectionLabel?: string,
): string {
  const restoreSource = resolveSectionRestoreSource(source);
  if (sectionLabel === "§5" && mddHasDuplicateSectionHeadings(source)) {
    console.warn("[MDD:PrepareRestore] §5 skip restore — source tiene headings duplicados");
    return normalized;
  }
  const srcBody = extractBody(restoreSource);
  if (!srcBody?.trim() || !hasSubstantial(restoreSource)) return normalized;
  if (hasSubstantial(normalized)) return normalized;
  const normLen = extractBody(normalized)?.length ?? 0;
  const restored = replaceBody(normalized, srcBody);
  if (sectionLabel === "§5" && restored !== normalized) {
    console.warn(`[MDD:PrepareRestore] §5 ${normLen}→${srcBody.length}`);
  }
  return restored;
}

function baselineHasSubstantialCoreSections(draft: string): boolean {
  return (
    draftHasSubstantialSection2(draft) ||
    draftHasSubstantialSection3(draft) ||
    draftHasPersistableSection4(draft)
  );
}

/** Fallback conservador cuando sanitize/dedupe colapsa §2–§4: re-normaliza desde baseline sin pipeline pesado. */
function applyConservativePrepareFromBaseline(baseline: string): string {
  const restoreSource = resolveSectionRestoreSource(baseline);
  const sanitized = replaceContextWhenOnlyMetadata(
    sanitizeContextKeyValueAndObject(sanitizeContextSection(restoreSource)),
  );
  const normalized = restoreCoreSectionsAfterNormalize(
    restoreSource,
    normalizeMddFormat(sanitized),
  );
  return preserveValidatedSectionsIfSubstantial(baseline, applyPreDeliveryGateFixes(normalized));
}

function restoreSection2AfterNormalize(source: string, normalized: string): string {
  return restoreSectionBodyAfterNormalize(
    source,
    normalized,
    extractArquitecturaSectionBody,
    replaceArquitecturaSectionBody,
    draftHasSubstantialSection2,
  );
}

function restoreSection3AfterNormalize(source: string, normalized: string): string {
  return restoreSectionBodyAfterNormalize(
    source,
    normalized,
    extractSection3Body,
    replaceMddSection3Body,
    draftHasSubstantialSection3,
  );
}

function restoreSection5AfterNormalize(source: string, normalized: string): string {
  return restoreSectionBodyAfterNormalize(
    source,
    normalized,
    extractSection5Body,
    replaceMddSection5Body,
    draftHasSubstantialSection5,
    "§5",
  );
}

function restoreCoreSectionsAfterNormalize(source: string, normalized: string): string {
  let out = normalized;
  out = restoreSection2AfterNormalize(source, out);
  out = restoreSection3AfterNormalize(source, out);
  out = restoreSection4AfterNormalize(source, out);
  out = restoreSection5AfterNormalize(source, out);
  out = restoreSections6And7AfterNormalize(source, out);
  return out;
}

/**
 * Fuente del markdown a enviar. Se prefiere mddDraft cuando es sustancial para no reconstruir desde
 * mddStructured (que podría tener §3 desactualizado o solo §6). Luego sanitize, normalize e inyección.
 */
export type PrepareMddForOutputOptions = {
  /** Sección inmutable del wizard; si no se pasa, se extrae del borrador de entrada. */
  preservedGovernance?: string | null;
  /**
   * Resolver de componentes UI para la sección "UI/UX Design Intent". Por defecto heurístico
   * (comportamiento previo). Con un `McpUiComponentResolver` se usan componentes reales del MCP
   * gráfico activo, con fallback por-entidad al heurístico.
   */
  resolver?: UiComponentResolver;
  /** Librería del MCP gráfico activo para §2 Frontend → UI Library. */
  uiMcpLibraryLabel?: string | null;
  /** Recibe el resultado del gate de entrega (no altera el markdown devuelto). */
  deliveryGateRef?: { current?: MddDeliveryGateResult };
  /** BRD/DBGA for domain fidelity blockers inside validateMddForDelivery. */
  brdMarkdown?: string | null;
  dbgaMarkdown?: string | null;
  specMarkdown?: string | null;
  /** Borrador pre-regen / Clarificador para restaurar §1–§2 si el pipeline los omitió. */
  baselineDraft?: string | null;
  mddComplexity?: "LOW" | "MEDIUM" | "HIGH";
  /**
   * true = pipeline de persistencia (`prepareMddMarkdownForPersist`, `formatDocumentMarkdown`).
   * false = evaluación del gate / streaming (conserva formato del borrador del grafo).
   */
  formatForPersist?: boolean;
  /** Snapshots §6/§7 (securitySectionMd, post_critic snapshots) para preserve. */
  tailSnapshotSource?: import("./mdd-section-preserve.util.js").TailSectionSnapshotSource | null;
  /** Secciones a omitir en preserve/guard (p. ej. §5 objetivo + §6/§7 en regen section-pipeline). */
  preserveExcludeSections?: readonly number[];
  /**
   * Vista previa en streaming: omite dedupe reorder, SSOT repair y enriquecimiento UI async.
   * El gate de entrega sigue evaluándose en la pasada final (`formatForPersist: true`).
   */
  streamPreview?: boolean;
};

export async function prepareMddForOutput(
  input: { mddStructured?: MddStructured; mddDraft?: string } | string,
  options?: PrepareMddForOutputOptions,
): Promise<string> {
  const resolver = options?.resolver ?? heuristicUiComponentResolver;
  const inputDraftBaseline =
    typeof input === "string" ? input.trim() : (input.mddDraft ?? "").trim();
  const streamPreview = options?.streamPreview === true;
  const authoritativeBaseline = deduplicateMddDraftSections(
    (options?.baselineDraft?.trim() || inputDraftBaseline).trim(),
  );
  let raw: string;
  if (typeof input === "string") {
    raw = input;
  } else {
    const draft = (input.mddDraft ?? "").trim();
    if (shouldPreferDraftOverStructured(draft, input.mddStructured)) {
      raw = draft;
    } else if (hasStructuredContent(input.mddStructured)) {
      const hydrated = hydrateStructuredFromDraft(input.mddStructured, draft);
      raw = mddStructuredToMarkdown(hydrated);
    } else {
      raw = draft;
    }
  }
  raw = streamPreview ? raw.trim() : deduplicateMddDraftSections(raw.trim());
  if (streamPreview && mddHasDuplicateSectionHeadings(raw)) {
    raw = deduplicateMddDraftSections(raw);
  }
  const formatForPersistEarly = options?.formatForPersist === true;
  const hasTailSnapshot = !!(
    options?.tailSnapshotSource &&
    Object.values(options.tailSnapshotSource).some((v) => typeof v === "string" && v.trim().length > 0)
  );
  console.log(
    `[MDD:PrepareOutput:diag] start formatForPersist=${formatForPersistEarly} hasTailSnapshot=${hasTailSnapshot} §5=${extractSection5Body(raw)?.length ?? 0} draftLen=${raw.length}`,
  );
  const preserved =
    options?.preservedGovernance?.trim() ||
    extractGovernanceSection(raw) ||
    null;
  const sanitized =
    replaceContextWhenOnlyMetadata(sanitizeContextKeyValueAndObject(sanitizeContextSection(raw)));
  const normalized = restoreCoreSectionsAfterNormalize(
    raw,
    normalizeMddFormat(sanitized),
  );
  const structuredForSection3 =
    typeof input === "string" ? undefined : input.mddStructured;
  const withSection3 = composeSection3FromStructured(normalized, structuredForSection3);
  const consistencyIssues = detectCrossConsistencyIssues(withSection3);
  const hasInvalidSqlProse = consistencyIssues.some((i) =>
    i.includes("prosa inválida"),
  );
  const withDiagrams = injectMddDiagrams(withSection3, suggestMddDiagrams(withSection3));
  const withErFromSql = hasInvalidSqlProse
    ? withDiagrams
    : (regenerateErDiagramFromSql(withDiagrams) ?? withDiagrams);
  const withComponentDiagram = injectProposedComponentDiagramIntoSection2(withErFromSql);
  const uiMcpLabel = options?.uiMcpLibraryLabel?.trim();
  const withUiMcpFrontend =
    uiMcpLabel && uiMcpLabel.length > 0
      ? injectUiMcpIntoMddFrontendSection(withComponentDiagram, uiMcpLabel)
      : withComponentDiagram;
  const enriched = streamPreview
    ? withUiMcpFrontend
    : await enrichMddWithUiUxDesignIntent(withUiMcpFrontend, resolver);
  const withGovernance = ensureMddGovernanceSection(enriched, preserved);
  const reconciled = streamPreview
    ? finalizeMddDeliverable(withGovernance, {
        baseline: options?.baselineDraft?.trim() || raw,
      })
    : await reconcileUiUxDesignIntent(
        finalizeMddDeliverable(withGovernance, {
          baseline: options?.baselineDraft?.trim() || raw,
        }),
        resolver,
      );
  const markdown = applyPreDeliveryGateFixes(reconciled);
  let finalMarkdown = markdown;
  const formatForPersist = options?.formatForPersist === true;
  try {
    if (!streamPreview) {
      const { rebuildDomainInventoryPreferringBrd } = await import(
        "../../engine/domain-inventory-persist.util.js"
      );
      const inventory =
        options?.brdMarkdown?.trim() || options?.dbgaMarkdown?.trim()
          ? rebuildDomainInventoryPreferringBrd({
              brdMarkdown: options.brdMarkdown,
              dbgaMarkdown: options.dbgaMarkdown,
              mddMarkdown: markdown,
            })
          : undefined;
      if (formatForPersist) {
        finalMarkdown = prepareMddMarkdownForPersist(finalMarkdown);
      }
      const contratosBeforeSsot = extractContratosSectionBody(finalMarkdown);
      const { reconcileMddSsotBeforeDeliveryGate } = await import(
        "../../engine/mdd-ssot-repair.util.js"
      );
      const repaired = reconcileMddSsotBeforeDeliveryGate(finalMarkdown, {
        brdMarkdown: options?.brdMarkdown,
        dbgaMarkdown: options?.dbgaMarkdown,
        specMarkdown: options?.specMarkdown,
        inventory,
      });
      if (
        repaired.section3Injected.length > 0 ||
        repaired.uatInjected.length > 0 ||
        repaired.section4Injected.length > 0 ||
        repaired.platformAnnotated.length > 0
      ) {
        finalMarkdown = formatForPersist
          ? prepareMddMarkdownForPersist(repaired.markdown)
          : applyPreDeliveryGateFixes(repaired.markdown);
        console.log(
          `[MDD:DeliveryGate] SSOT repair — §3:${repaired.section3Injected.length} UAT:${repaired.uatInjected.length} §4:${repaired.section4Injected.length} platform:${repaired.platformAnnotated.length}`,
        );
      }
      const contratosAfterSsot = extractContratosSectionBody(finalMarkdown);
      if (isContratosSectionRegression(contratosBeforeSsot, contratosAfterSsot) && contratosBeforeSsot) {
        finalMarkdown = replaceMddSection4Body(finalMarkdown, contratosBeforeSsot);
        console.warn(
          `[MDD:DeliveryGate] §4 restaurada tras SSOT repair (len ${contratosAfterSsot?.length ?? 0}→${contratosBeforeSsot.length})`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[MDD:DeliveryGate] SSOT repair skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const preserveBaseline = resolveTailPreserveBaseline(
    (authoritativeBaseline || options?.baselineDraft?.trim() || inputDraftBaseline || raw).trim(),
    options?.tailSnapshotSource,
  );
  let prePreserveMarkdown = finalMarkdown;
  if (!streamPreview && mddHasDuplicateSectionHeadings(prePreserveMarkdown)) {
    const deduped = deduplicateAndReorderMddSections(prePreserveMarkdown);
    if (!mddHasDuplicateSectionHeadings(deduped)) {
      prePreserveMarkdown = restoreSections6And7IfRegressed(prePreserveMarkdown, deduped);
      console.warn(
        "[MDD:PrepareOutput] deduplicateAndReorderMddSections antes de preserve (len %s→%s)",
        finalMarkdown.length,
        deduped.length,
      );
    }
  }
  const preserveBaselineSafe = mddHasDuplicateSectionHeadings(preserveBaseline)
    ? prePreserveMarkdown
    : preserveBaseline;
  const preserveOpts =
    options?.preserveExcludeSections?.length
      ? { excludeSections: options.preserveExcludeSections }
      : undefined;
  const preservedMarkdown = preserveValidatedSectionsFromSnapshots(
    options?.tailSnapshotSource ?? {},
    preserveValidatedSectionsIfSubstantial(preserveBaselineSafe, prePreserveMarkdown, preserveOpts),
  );
  let gatedMarkdown = preservedMarkdown;
  if (!streamPreview && mddHasDuplicateSectionHeadings(gatedMarkdown)) {
    const deduped = deduplicateAndReorderMddSections(gatedMarkdown);
    if (!mddHasDuplicateSectionHeadings(deduped)) {
      gatedMarkdown = restoreSections6And7IfRegressed(gatedMarkdown, deduped);
      console.warn("[MDD:PrepareOutput] dedupe post-preserve eliminó headings duplicados");
    }
  }
  const tailGuard = guardValidatedSectionsForPersist(
    preserveBaselineSafe,
    gatedMarkdown,
    "prepareMddForOutput",
    preserveOpts,
  );
  gatedMarkdown = tailGuard.markdown;
  if (tailGuard.failedSections.length > 0) {
    gatedMarkdown = restoreMddSectionsFromBaselineStrict(
      gatedMarkdown,
      preserveBaselineSafe,
      tailGuard.failedSections,
    );
    const retryGuard = guardValidatedSectionsForPersist(
      preserveBaselineSafe,
      gatedMarkdown,
      "prepareMddForOutput:strict-restore",
      preserveOpts,
    );
    gatedMarkdown = retryGuard.markdown;
    if (
      retryGuard.failedSections.length > 0 &&
      preserveBaselineSafe.length > 0 &&
      gatedMarkdown.length < preserveBaselineSafe.length * 0.75 &&
      baselineHasSubstantialCoreSections(preserveBaselineSafe)
    ) {
      console.warn(
        `[MDD:PrepareOutput] regresión masiva tras sanitize — conservando baseline sustancial (§${retryGuard.failedSections.join("/§")})`,
      );
      gatedMarkdown = applyConservativePrepareFromBaseline(preserveBaselineSafe);
    }
  }
  if (!streamPreview && mddHasDuplicateSectionHeadings(gatedMarkdown)) {
    const deduped = deduplicateAndReorderMddSections(gatedMarkdown);
    if (!mddHasDuplicateSectionHeadings(deduped)) {
      gatedMarkdown = restoreSections6And7IfRegressed(gatedMarkdown, deduped);
      console.warn("[MDD:PrepareOutput] dedupe post-guard eliminó headings duplicados");
    }
  }
  gatedMarkdown = ensureDocumentFenceParity(gatedMarkdown);
  console.log(
    `[MDD:PrepareOutput:diag] pre-gate §4=${extractSection4Body(gatedMarkdown)?.length ?? 0} §5=${extractSection5Body(gatedMarkdown)?.length ?? 0} §5best=${extractBestSection5Body(gatedMarkdown)?.length ?? 0}`,
  );
  logMddPersistFenceDiag("PrepareOutput:pre-gate", gatedMarkdown);
  const deliveryGate = validateMddForDeliveryMemo(gatedMarkdown, {
    brdMarkdown: options?.brdMarkdown,
    dbgaMarkdown: options?.dbgaMarkdown,
    specMarkdown: options?.specMarkdown,
    mddComplexity: options?.mddComplexity,
  });
  if (options?.deliveryGateRef) {
    options.deliveryGateRef.current = deliveryGate;
  }
  if (!deliveryGate.ok) {
    console.warn(
      `[MDD:DeliveryGate] score=${deliveryGate.score} blockers=${deliveryGate.blockers.length}: ${deliveryGate.blockers.slice(0, 3).join("; ")}`,
    );
  }
  return gatedMarkdown;
}
