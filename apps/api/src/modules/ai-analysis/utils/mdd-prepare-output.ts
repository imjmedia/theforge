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
  finalizeMddDeliverable,
  getSection6Or7Range,
  hydrateStructuredFromDraft,
  mddHasDuplicateSectionHeadings,
  normalizeMddFormat,
  replaceContextWhenOnlyMetadata,
  replaceSection6Or7InDraft,
  replaceMddSection4Body,
  sanitizeContextKeyValueAndObject,
  sanitizeContextSection,
  applyPreDeliveryGateFixes,
  detectCrossConsistencyIssues,
  prepareMddMarkdownForPersist,
} from "./mdd-sanitize.js";
import {
  extractContratosSectionBody,
  isContratosSectionRegression,
} from "./mdd-sanitize/contratos-format.js";
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
  draftHasSubstantialSection5,
  preserveValidatedSectionsIfSubstantial,
  guardValidatedSectionsForPersist,
} from "./mdd-section-preserve.util.js";
import { ensureMddGovernanceSection, extractGovernanceSection } from "@theforge/shared-types/mdd-governance-patterns";
import { validateMddForDelivery, type MddDeliveryGateResult } from "./mdd-delivery-gate.util.js";
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

function draftHasSubstantialSection3(draft: string): boolean {
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
  if (draftHasSubstantialSection3(trimmed)) return true;
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

/**
 * normalizeMddFormat (deduplicateAndReorderMddSections) puede eliminar §6/§7 recién insertadas.
 * Restaura desde el borrador pre-normalize si desaparecieron.
 */
function restoreSections6And7AfterNormalize(source: string, normalized: string): string {
  // No reinyectar desde un borrador con §5/§6/§7 repetidas (evita reintroducir el bucle de duplicación).
  if (mddHasDuplicateSectionHeadings(source)) return normalized;
  const sourceRepaired = repairInlineHorizontalRuleSectionBreaks(source);
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
  if (mddHasDuplicateSectionHeadings(source)) return normalized;
  const srcBody = extractContratosSectionBody(source);
  const normBody = extractContratosSectionBody(normalized);
  if (!srcBody?.trim()) return normalized;
  if (isContratosSectionRegression(srcBody, normBody) && srcBody) {
    return replaceMddSection4Body(normalized, srcBody);
  }
  if (draftHasPersistableSection4(source) && !draftHasPersistableSection4(normalized)) {
    return replaceMddSection4Body(normalized, srcBody);
  }
  return normalized;
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
};

export async function prepareMddForOutput(
  input: { mddStructured?: MddStructured; mddDraft?: string } | string,
  options?: PrepareMddForOutputOptions,
): Promise<string> {
  const resolver = options?.resolver ?? heuristicUiComponentResolver;
  const inputDraftBaseline =
    typeof input === "string" ? input.trim() : (input.mddDraft ?? "").trim();
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
  const preserved =
    options?.preservedGovernance?.trim() ||
    extractGovernanceSection(raw) ||
    null;
  const sanitized =
    replaceContextWhenOnlyMetadata(sanitizeContextKeyValueAndObject(sanitizeContextSection(raw)));
  const normalized = restoreSection4AfterNormalize(
    raw,
    restoreSections6And7AfterNormalize(raw, normalizeMddFormat(sanitized)),
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
  const enriched = await enrichMddWithUiUxDesignIntent(withUiMcpFrontend, resolver);
  const withGovernance = ensureMddGovernanceSection(enriched, preserved);
  const reconciled = await reconcileUiUxDesignIntent(
    finalizeMddDeliverable(withGovernance, {
      baseline: options?.baselineDraft?.trim() || raw,
    }),
    resolver,
  );
  const markdown = applyPreDeliveryGateFixes(reconciled);
  let finalMarkdown = markdown;
  const formatForPersist = options?.formatForPersist === true;
  try {
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
  } catch (err) {
    console.warn(
      `[MDD:DeliveryGate] SSOT repair skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const preserveBaseline = (options?.baselineDraft?.trim() || inputDraftBaseline || raw).trim();
  const preservedMarkdown = preserveValidatedSectionsIfSubstantial(preserveBaseline, finalMarkdown);
  const tailGuard = guardValidatedSectionsForPersist(preserveBaseline, preservedMarkdown, "prepareMddForOutput");
  const gatedMarkdown = tailGuard.markdown;
  const deliveryGate = validateMddForDelivery(gatedMarkdown, {
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
