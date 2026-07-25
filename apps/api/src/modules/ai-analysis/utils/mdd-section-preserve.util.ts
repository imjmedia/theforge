import { extractContratosSectionBody } from "./mdd-sanitize/contratos-format.js";
import {
  extractArquitecturaSectionBody,
  extractSection3Body,
  extractSection5Body,
  extractSection6Body,
  extractSection7Body,
  isMddSectionPipelinePlaceholderBody,
  replaceArquitecturaSectionBody,
  replaceMddSection3Body,
  replaceMddSection4Body,
  replaceMddSection5Body,
  replaceSection6Or7InDraft,
} from "./mdd-sanitize/section-merge.js";

/** Mínimo de chars para considerar §2–§7 sustanciales (alineado con delivery gate). */
export const MIN_SUBSTANTIAL_SECTION2_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION3_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION4_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION5_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION6_BODY_LEN = 200;
export const MIN_SUBSTANTIAL_SECTION7_BODY_LEN = 200;

/** Borrador sustancial: evita Clarifier full-reset y enruta reparación acotada. */
export const MIN_SCOPED_REPAIR_DRAFT_LEN = 15_000;

const DEFAULT_VALIDATED_SECTIONS = [2, 3, 4, 5, 6, 7] as const;

function sectionBodyIsSubstantial(
  body: string | null | undefined,
  minLen: number,
): boolean {
  const trimmed = (body ?? "").trim();
  if (!trimmed || trimmed.length < minLen) return false;
  return !isMddSectionPipelinePlaceholderBody(trimmed);
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

/** True si §4 tiene cuerpo real (no placeholder del pipeline). */
export function draftHasSubstantialSection4(draft: string): boolean {
  return sectionBodyIsSubstantial(
    extractContratosSectionBody((draft ?? "").trim()),
    MIN_SUBSTANTIAL_SECTION4_BODY_LEN,
  );
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
  return preserveSectionBodyIfSubstantial(
    baselineDraft,
    currentDraft,
    extractContratosSectionBody,
    replaceMddSection4Body,
    MIN_SUBSTANTIAL_SECTION4_BODY_LEN,
    "§4",
  );
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
