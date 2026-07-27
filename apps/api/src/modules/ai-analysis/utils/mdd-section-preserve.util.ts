/**
 * @fileoverview Preservación de secciones aprobadas durante regeneración MDD.
 */

import {
  countContratosEndpointRows,
  extractContratosSectionBody,
  isContratosPlaceholder,
  isContratosSubstantial,
  MIN_CONTRATOS_LENGTH,
  stripLeadingContratosPlaceholder,
} from "./mdd-sanitize/contratos-format.js";
import {
  extractArquitecturaSectionBody,
  extractContextSectionBody,
  extractSection3Body,
  extractSection5Body,
  extractSection6Body,
  extractSection7Body,
  isMddSectionPipelinePlaceholderBody,
  replaceArquitecturaSectionBody,
  replaceMddSection3Body,
  replaceMddSection4Body,
  replaceMddSection5Body,
  replaceSection1BodyFromAnyHeading,
  replaceSection6Or7InDraft,
} from "./mdd-sanitize/section-merge.js";

/** Mínimo de chars para considerar §1–§7 sustanciales (alineado con delivery gate). */
export const MIN_SUBSTANTIAL_SECTION1_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION2_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION3_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION4_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION5_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION6_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION7_BODY_LEN = 200;

/** Borrador sustancial: evita Clarifier full-reset y enruta reparación acotada. */
export const MIN_SCOPED_REPAIR_DRAFT_LEN = 15_000;

const DEFAULT_VALIDATED_SECTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

function sectionBodyIsSubstantial(
  body: string | null | undefined,
  minLen: number,
): boolean {
  const trimmed = (body ?? "").trim();
  if (!trimmed || trimmed.length < minLen) return false;
  return !isMddSectionPipelinePlaceholderBody(trimmed);
}

/** True si §1 tiene contexto real (no placeholder ni vacío). */
export function draftHasSubstantialSection1(draft: string): boolean {
  return sectionBodyIsSubstantial(
    extractContextSectionBody((draft ?? "").trim()),
    MIN_SUBSTANTIAL_SECTION1_BODY_LEN,
  );
}

/** True si §2 tiene cuerpo real (no placeholder del pipeline). */
export function draftHasSubstantialSection2(draft: string): boolean {
  return sectionBodyIsSubstantial(
    extractArquitecturaSectionBody((draft ?? "").trim()),
    MIN_SUBSTANTIAL_SECTION2_BODY_LEN,
  );
}

/** True si §3 tiene cuerpo real (no placeholder del pipeline). */
export function draftHasSubstantialSection3(draft: string): boolean {
  const body = extractSection3Body((draft ?? "").trim());
  return sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION3_BODY_LEN);
}

/** True si §4 tiene contratos reales (endpoints/JSON; no stub «Falta: definir endpoints…»). */
export function draftHasSubstantialSection4(draft: string): boolean {
  return isContratosSubstantial(extractContratosSectionBody((draft ?? "").trim()));
}

/**
 * §4 persistible tras api_contracts: JSON completo O tabla densa sin placeholder Auditor.
 * Más permisivo que `draftHasSubstantialSection4` (gate) para no perder catálogos solo-tabla.
 */
export function draftHasPersistableSection4(draft: string): boolean {
  const body = extractContratosSectionBody((draft ?? "").trim());
  if (!body) return false;
  if (isContratosSubstantial(body)) return true;
  const normalized = stripLeadingContratosPlaceholder(body);
  if (!normalized || normalized.length < MIN_CONTRATOS_LENGTH) return false;
  if (isContratosPlaceholder(normalized)) return false;
  return countContratosEndpointRows(normalized) >= 5;
}

/** True si §5 tiene cuerpo real (no placeholder del pipeline). */
export function draftHasSubstantialSection5(draft: string): boolean {
  return sectionBodyIsSubstantial(
    extractSection5Body((draft ?? "").trim()),
    MIN_SUBSTANTIAL_SECTION5_BODY_LEN,
  );
}

export function draftHasSubstantialSection6(draft: string): boolean {
  return sectionBodyIsSubstantial(
    extractSection6Body((draft ?? "").trim()),
    MIN_SUBSTANTIAL_SECTION6_BODY_LEN,
  );
}

export function draftHasSubstantialSection7(draft: string): boolean {
  return sectionBodyIsSubstantial(
    extractSection7Body((draft ?? "").trim()),
    MIN_SUBSTANTIAL_SECTION7_BODY_LEN,
  );
}

/**
 * Baseline válido para merge quirúrgico §2/§3/§4: borrador largo o skeleton post-Clarificador con §1 real.
 * Sin esto, pipeline HIGH rechaza merge cuando el Clarificador dejó <600 chars pero §1 sustancial.
 */
export function canUseSurgicalMergeBaseline(baselineDraft: string, minLength = 600): boolean {
  const baseline = (baselineDraft ?? "").trim();
  if (!baseline) return false;
  if (baseline.length >= minLength) return true;
  if (draftHasSubstantialSection1(baseline)) return true;
  return draftHasSubstantialSection3(baseline);
}

/**
 * True si el borrador ya tiene masa suficiente para reparación acotada (no Clarifier full-reset).
 * Criterio: len ≥15k O §2+§3+§4 sustanciales.
 */
export function draftIsSubstantialForScopedRepair(draft: string): boolean {
  const trimmed = (draft ?? "").trim();
  if (trimmed.length >= MIN_SCOPED_REPAIR_DRAFT_LEN) return true;
  return (
    draftHasSubstantialSection2(trimmed) &&
    draftHasSubstantialSection3(trimmed) &&
    draftHasSubstantialSection4(trimmed)
  );
}

function preserveSectionBodyIfSubstantial(
  baselineDraft: string,
  currentDraft: string,
  extractBody: (draft: string) => string | null,
  replaceBody: (draft: string, body: string) => string,
  minLen: number,
  sectionLabel: string,
): string {
  const baseline = (baselineDraft ?? "").trim();
  const current = (currentDraft ?? "").trim();
  if (!baseline || !current) return current || baseline;

  const prevBody = extractBody(baseline);
  if (!sectionBodyIsSubstantial(prevBody, minLen)) return current;

  const curBody = extractBody(current);
  const curSubstantial = sectionBodyIsSubstantial(curBody, minLen);
  const curShorter = (curBody?.length ?? 0) < (prevBody?.length ?? 0) * 0.5;
  if (curSubstantial && !curShorter) return current;

  const restored = replaceBody(current, prevBody!);
  if (restored !== current) {
    console.warn(
      `[MDD:SectionPreserve] ${sectionLabel} restaurada (${curBody?.length ?? 0}→${prevBody!.length} chars)`,
    );
  }
  return restored;
}

export function preserveSection1IfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractContextSectionBody,
    replaceSection1BodyFromAnyHeading,
    MIN_SUBSTANTIAL_SECTION1_BODY_LEN,
    "§1",
  );
}

/** Restaura §1 desde el snapshot del Clarificador si el borrador actual la vació (pipeline HIGH scoped). */
export function preserveSection1FromClarifierSnapshot(
  clarifierSnapshot: string | null | undefined,
  currentDraft: string,
): string {
  const snap = (clarifierSnapshot ?? "").trim();
  if (!snap || !draftHasSubstantialSection1(snap)) return currentDraft;
  return preserveSection1IfSubstantial(snap, currentDraft);
}

/** Restaura §2 desde el snapshot de stack_architect si un nodo posterior la vació (pipeline HIGH scoped). */
export function preserveSection2FromStackSnapshot(
  stackSnapshot: string | null | undefined,
  currentDraft: string,
): string {
  const snap = (stackSnapshot ?? "").trim();
  if (!snap || !draftHasSubstantialSection2(snap)) return currentDraft;
  return preserveSection2IfSubstantial(snap, currentDraft);
}

/** Restaura §4 desde el snapshot de api_contracts si format/SSOT la vació (pipeline HIGH scoped). */
export function preserveSection4FromApiContractsSnapshot(
  apiContractsSnapshot: string | null | undefined,
  currentDraft: string,
): string {
  const snap = (apiContractsSnapshot ?? "").trim();
  if (!snap || !draftHasPersistableSection4(snap)) return currentDraft;

  const snapBody = extractContratosSectionBody(snap);
  if (!snapBody) return currentDraft;

  const curBody = extractContratosSectionBody(currentDraft);
  const snapRows = countContratosEndpointRows(stripLeadingContratosPlaceholder(snapBody));
  const curRows = countContratosEndpointRows(stripLeadingContratosPlaceholder(curBody ?? ""));

  if (draftHasPersistableSection4(currentDraft) && curRows >= Math.max(3, Math.ceil(snapRows * 0.5))) {
    return currentDraft;
  }

  const restored = replaceMddSection4Body(currentDraft, snapBody);
  if (restored !== currentDraft) {
    console.warn(
      `[MDD:SectionPreserve] §4 restaurada desde api_contracts snapshot (${curRows}→${snapRows} endpoints)`,
    );
  }
  return restored;
}

export function preserveSection2IfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractArquitecturaSectionBody,
    replaceArquitecturaSectionBody,
    MIN_SUBSTANTIAL_SECTION2_BODY_LEN,
    "§2",
  );
}

export function preserveSection3IfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractSection3Body,
    replaceMddSection3Body,
    MIN_SUBSTANTIAL_SECTION3_BODY_LEN,
    "§3",
  );
}

export function preserveSection4IfSubstantial(baselineDraft: string, currentDraft: string): string {
  const baseline = (baselineDraft ?? "").trim();
  const current = (currentDraft ?? "").trim();
  if (!baseline || !current) return current || baseline;

  const prevBody = extractContratosSectionBody(baseline);
  if (!isContratosSubstantial(prevBody)) return current;

  const curBody = extractContratosSectionBody(current);
  const curSubstantial = isContratosSubstantial(curBody);
  const curShorter = (curBody?.length ?? 0) < (prevBody?.length ?? 0) * 0.5;
  if (curSubstantial && !curShorter) return current;

  const restored = replaceMddSection4Body(current, prevBody!);
  if (restored !== current) {
    console.warn(
      `[MDD:SectionPreserve] §4 restaurada (${curBody?.length ?? 0}→${prevBody!.length} chars)`,
    );
  }
  return restored;
}

/**
 * Restaura §5 desde `baselineDraft` cuando `currentDraft` la regresó (placeholder o
 * cuerpo <50% del baseline). Usar tras Formatter, CrossConsistency y normalize.
 */
export function preserveSection5IfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractSection5Body,
    replaceMddSection5Body,
    MIN_SUBSTANTIAL_SECTION5_BODY_LEN,
    "§5",
  );
}

export function preserveSection6IfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractSection6Body,
    (draft, body) => replaceSection6Or7InDraft(draft, 6, `## 6. Seguridad\n\n${body}`),
    MIN_SUBSTANTIAL_SECTION6_BODY_LEN,
    "§6",
  );
}

export function preserveSection7IfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractSection7Body,
    (draft, body) => replaceSection6Or7InDraft(draft, 7, `## 7. Infraestructura\n\n${body}`),
    MIN_SUBSTANTIAL_SECTION7_BODY_LEN,
    "§7",
  );
}

export type PreserveValidatedSectionsOptions = {
  /** Subconjunto de §2–§7 a evaluar (default: todas). */
  sections?: readonly number[];
  /** Secciones a omitir (p. ej. la §N que el Arquitecto acaba de reescribir). */
  excludeSections?: readonly number[];
};

function resolveValidatedSectionsToPreserve(options?: PreserveValidatedSectionsOptions): number[] {
  const exclude = new Set(options?.excludeSections ?? []);
  const base = options?.sections ?? DEFAULT_VALIDATED_SECTIONS;
  return base.filter((n) => !exclude.has(n));
}

function preserveSectionByNumber(
  baselineDraft: string,
  currentDraft: string,
  sectionNum: number,
): string {
  switch (sectionNum) {
    case 1:
      return preserveSection1IfSubstantial(baselineDraft, currentDraft);
    case 2:
      return preserveSection2IfSubstantial(baselineDraft, currentDraft);
    case 3:
      return preserveSection3IfSubstantial(baselineDraft, currentDraft);
    case 4:
      return preserveSection4IfSubstantial(baselineDraft, currentDraft);
    case 5:
      return preserveSection5IfSubstantial(baselineDraft, currentDraft);
    case 6:
      return preserveSection6IfSubstantial(baselineDraft, currentDraft);
    case 7:
      return preserveSection7IfSubstantial(baselineDraft, currentDraft);
    default:
      return currentDraft;
  }
}

/**
 * Restaura §2–§7 sustanciales cuando un paso mecánico las regresó (placeholder o <50% del baseline).
 */
export function preserveValidatedSectionsIfSubstantial(
  baselineDraft: string,
  currentDraft: string,
  options?: PreserveValidatedSectionsOptions,
): string {
  let out = currentDraft;
  if (!draftHasSubstantialSection1(out) && draftHasSubstantialSection1(baselineDraft)) {
    out = preserveSectionByNumber(baselineDraft, out, 1);
    if (!draftHasSubstantialSection1(out)) {
      console.warn(
        `[MDD:SectionPreserve] Preserve: §1 no pudo restaurarse → saltando; draft corrupto`,
      );
      return currentDraft;
    }
  } else if (!draftHasSubstantialSection1(out)) {
    console.warn(
      `[MDD:SectionPreserve] Preserve: §1 insustancial sin baseline → saltando; draft corrupto`,
    );
    return currentDraft;
  }
  for (const n of resolveValidatedSectionsToPreserve(options)) {
    out = preserveSectionByNumber(baselineDraft, out, n);
  }
  return out;
}

/** Alias histórico: ahora cubre §2–§7 (no solo cola). */
export function preserveTailSectionsIfSubstantial(baselineDraft: string, currentDraft: string): string {
  return preserveValidatedSectionsIfSubstantial(baselineDraft, currentDraft);
}

/**
 * Tras merge scoped del Arquitecto: restaura §2–§7 no objetivo si el merge/normalize las vació.
 * No toca la sección que el Arquitecto acaba de escribir intencionalmente.
 */
export function preserveNonTargetValidatedSectionsAfterArchitectMerge(
  mergeBaseline: string,
  mergedDraft: string,
  targetSection: 2 | 3 | 4 | null,
): string {
  return preserveValidatedSectionsIfSubstantial(mergeBaseline, mergedDraft, {
    excludeSections: targetSection != null ? [targetSection] : [],
  });
}

export type ValidatedSectionPersistGuardResult = {
  markdown: string;
  restored: boolean;
  failedSections: number[];
};

/** @deprecated alias de tipo */
export type TailSectionPersistGuardResult = ValidatedSectionPersistGuardResult;

const GUARD_SECTION_CHECKS: Array<{ num: number; has: (d: string) => boolean }> = [
  { num: 1, has: draftHasSubstantialSection1 },
  { num: 2, has: draftHasSubstantialSection2 },
  { num: 3, has: draftHasSubstantialSection3 },
  { num: 4, has: draftHasSubstantialSection4 },
  { num: 5, has: draftHasSubstantialSection5 },
  { num: 6, has: draftHasSubstantialSection6 },
  { num: 7, has: draftHasSubstantialSection7 },
];

/**
 * Guardia dura post-prepare/persist: si §2–§7 eran sustanciales en el borrador
 * pre-paso y dejaron de serlo, reintenta restore desde baseline; si sigue mal, marca fallo.
 */
export function guardValidatedSectionsForPersist(
  prePrepareDraft: string,
  postPrepareMarkdown: string,
  stepLabel = "persist",
  options?: Pick<PreserveValidatedSectionsOptions, "sections" | "excludeSections">,
): ValidatedSectionPersistGuardResult {
  const baseline = (prePrepareDraft ?? "").trim();
  const before = (postPrepareMarkdown ?? "").trim();
  if (!baseline) return { markdown: before, restored: false, failedSections: [] };

  if (!draftHasSubstantialSection1(before)) {
    console.warn(
      `[MDD:SectionPreserve] §1 insustancial (${extractContextSectionBody(before)?.length ?? 0} chars) → saltando restauración; draft corrupto necesita regeneración completa`,
    );
    return { markdown: before, restored: false, failedSections: [] };
  }

  const sectionsToCheck = resolveValidatedSectionsToPreserve(options);
  const checks = GUARD_SECTION_CHECKS.filter((c) => sectionsToCheck.includes(c.num));
  const regressedBefore = checks.filter((c) => c.has(baseline) && !c.has(before)).map((c) => c.num);
  if (regressedBefore.length === 0) {
    return { markdown: before, restored: false, failedSections: [] };
  }

  let markdown = preserveValidatedSectionsIfSubstantial(baseline, before, options);
  const restored = markdown !== before;
  const failedSections = checks.filter((c) => c.has(baseline) && !c.has(markdown)).map((c) => c.num);
  if (failedSections.length > 0) {
    console.warn(
      `[MDD:SectionPreserve] ${stepLabel}: §${failedSections.join("/§")} sustancial perdida tras guard (pre=${baseline.length} post=${markdown.length})`,
    );
  } else if (restored) {
    console.warn(
      `[MDD:SectionPreserve] ${stepLabel}: §${regressedBefore.join("/§")} restaurada(s) tras regresión`,
    );
  }
  return { markdown, restored, failedSections };
}

/** @deprecated alias — cubre §2–§7 desde 2026-07-24 */
export function guardTailSectionsForPersist(
  prePrepareDraft: string,
  postPrepareMarkdown: string,
  stepLabel = "persist",
): ValidatedSectionPersistGuardResult {
  return guardValidatedSectionsForPersist(prePrepareDraft, postPrepareMarkdown, stepLabel);
}
