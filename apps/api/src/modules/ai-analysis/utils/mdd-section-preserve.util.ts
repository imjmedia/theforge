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
  extractSection4Body,
  extractSection5Body,
  extractBestSection5Body,
  extractSection6Body,
  extractSection7Body,
  isMddSectionPipelinePlaceholderBody,
  mddHasDuplicateSectionHeadings,
  replaceArquitecturaSectionBody,
  replaceMddSection3Body,
  replaceMddSection4Body,
  replaceMddSection5Body,
  replaceSection1BodyFromAnyHeading,
  replaceSection6Or7InDraft,
} from "./mdd-sanitize/section-merge.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "./mdd-tail-parallel.config.js";
import { isPlaceholderSeguridad } from "./mdd-security-parse.js";
import { closeUnclosedFencesBeforeCanonicalH2 } from "./mdd-sanitize/section-fence.util.js";
import {
  integracionToSection7Markdown,
  seguridadItemsToSection6Markdown,
} from "./mdd-sanitize.js";

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

/** True si §5 es baseline válido (no tail placeholder del pipeline). */
function section5BodyIsPreserveBaseline(body: string | null | undefined): boolean {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return false;
  if (trimmed === MDD_SECTION5_TAIL_PLACEHOLDER) return false;
  if (/Pendiente:\s*paso dedicado Lógica/i.test(trimmed)) return false;
  return sectionBodyIsSubstantial(trimmed, MIN_SUBSTANTIAL_SECTION5_BODY_LEN);
}

/** Ratio mínimo (nuevo/baseline) para aceptar merge de §5. */
export const SECTION5_REGRESSION_LENGTH_RATIO = 0.75;

/** §5 duplicada hinchada (cola >> núcleo): no usar como baseline de preserve. */
const SECTION5_INFLATED_DUP_RATIO = 3;

/** Extrae §5 para preserve: tolera baselineDup salvo hinchamiento extremo entre candidatos. */
function resolveSection5PreserveBaselineBody(baseline: string): string | null {
  const trimmed = (baseline ?? "").trim();
  if (!trimmed) return null;
  if (!mddHasDuplicateSectionHeadings(trimmed)) {
    return extractSection5Body(trimmed);
  }

  const re = /\n(##\s+5\.\s*Lógica\s+y\s*Edge\s+Cases[^\n]*)/gi;
  const withNewline = trimmed.startsWith("#") ? `\n${trimmed}` : trimmed;
  const bodies: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(withNewline)) !== null) {
    const start = match.index + match[0].length;
    const rest = withNewline.slice(start);
    const next = rest.search(/\n##\s+/);
    const body = (next >= 0 ? rest.slice(0, next) : rest).replace(/^\s*\n+/, "").trim();
    if (body) bodies.push(body);
  }

  const substantial = bodies.filter((b) => section5BodyIsPreserveBaseline(b));
  if (substantial.length === 0) return extractBestSection5Body(trimmed);

  const minLen = Math.min(...substantial.map((b) => b.length));
  const maxLen = Math.max(...substantial.map((b) => b.length));
  if (substantial.length > 1 && maxLen > minLen * SECTION5_INFLATED_DUP_RATIO) {
    return null;
  }

  return extractBestSection5Body(trimmed);
}

/** Baseline sustancial cuya longitud activa protección anti-regresión §5. */
export const MIN_SECTION5_BASELINE_FOR_REGRESSION_GUARD = 1_200;

/** True si candidato §5 es claramente peor que baseline sustancial. */
export function isSection5SectionRegression(
  baselineBody: string | null | undefined,
  candidateBody: string | null | undefined,
): boolean {
  const baseline = (baselineBody ?? "").trim();
  const candidate = (candidateBody ?? "").trim();
  if (!baseline || !candidate) return false;
  if (!section5BodyIsPreserveBaseline(baseline)) return false;
  if (!sectionBodyIsSubstantial(candidate, MIN_SUBSTANTIAL_SECTION5_BODY_LEN)) return true;
  if (baseline.length < MIN_SECTION5_BASELINE_FOR_REGRESSION_GUARD) return false;
  return candidate.length / baseline.length < SECTION5_REGRESSION_LENGTH_RATIO;
}

export type TailSectionSnapshotSource = {
  securitySectionMd?: string | null;
  integrationSectionMd?: string | null;
  securityArchitectMddDraftSnapshot?: string | null;
  integrationArchitectMddDraftSnapshot?: string | null;
  mddStructured?: { seguridad?: unknown; integracion?: unknown } | null;
  /** Snapshots §1–§4 del pipeline HIGH scoped (clarifier/stack/data_model/api_contracts). */
  clarifierMddDraftSnapshot?: string | null;
  stackArchitectMddDraftSnapshot?: string | null;
  dataModelArchitectMddDraftSnapshot?: string | null;
  apiContractsArchitectMddDraftSnapshot?: string | null;
};

function sectionMdToBaselineDraft(sectionMd: string, sectionNum: 6 | 7): string {
  const trimmed = sectionMd.trim();
  if (trimmed.startsWith("##")) return trimmed;
  const heading = sectionNum === 6 ? "## 6. Seguridad" : "## 7. Infraestructura";
  return `${heading}\n\n${trimmed}`;
}

function resolveSection6BaselineFromSnapshots(source: TailSectionSnapshotSource): string | null {
  const snap = (source.securityArchitectMddDraftSnapshot ?? "").trim();
  if (snap && draftHasSubstantialSection6(snap)) return snap;

  const md = (source.securitySectionMd ?? "").trim();
  if (md.length >= MIN_SUBSTANTIAL_SECTION6_BODY_LEN) {
    const body = extractSection6Body(sectionMdToBaselineDraft(md, 6)) ?? md.replace(/^##[^\n]+\n+/, "").trim();
    if (sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION6_BODY_LEN)) {
      return sectionMdToBaselineDraft(md, 6);
    }
  }

  const seguridad = source.mddStructured?.seguridad;
  if (Array.isArray(seguridad) && seguridad.length && !isPlaceholderSeguridad(seguridad)) {
    return seguridadItemsToSection6Markdown(seguridad);
  }
  return null;
}

function resolveSection7BaselineFromSnapshots(source: TailSectionSnapshotSource): string | null {
  const snap = (source.integrationArchitectMddDraftSnapshot ?? "").trim();
  if (snap && draftHasSubstantialSection7(snap)) return snap;

  const md = (source.integrationSectionMd ?? "").trim();
  if (md.length >= MIN_SUBSTANTIAL_SECTION7_BODY_LEN) {
    const body = extractSection7Body(sectionMdToBaselineDraft(md, 7)) ?? md.replace(/^##[^\n]+\n+/, "").trim();
    if (sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION7_BODY_LEN)) {
      return sectionMdToBaselineDraft(md, 7);
    }
  }

  const integracion = source.mddStructured?.integracion;
  if (integracion) {
    const integracionForMd = Array.isArray(integracion) ? { subsections: integracion } : integracion;
    const section7Md = integracionToSection7Markdown(integracionForMd as Parameters<typeof integracionToSection7Markdown>[0]);
    const body = section7Md.replace(/^##[^\n]+\n+/, "").trim();
    if (sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION7_BODY_LEN)) {
      return section7Md.startsWith("##") ? section7Md : sectionMdToBaselineDraft(section7Md, 7);
    }
  }
  return null;
}

/** Baseline de preserve: draft actual enriquecido con snapshots §6/§7 sustanciales. */
export function resolveTailPreserveBaseline(
  currentDraft: string,
  source?: TailSectionSnapshotSource | null,
): string {
  const draft = (currentDraft ?? "").trim();
  const secBaseline = source ? resolveSection6BaselineFromSnapshots(source) : null;
  const intBaseline = source ? resolveSection7BaselineFromSnapshots(source) : null;
  if (!secBaseline && !intBaseline) return draft;

  let out = draft;
  if (secBaseline) {
    const secBody = extractSection6Body(secBaseline) ?? secBaseline.replace(/^##[^\n]+\n+/, "").trim();
    if (sectionBodyIsSubstantial(secBody, MIN_SUBSTANTIAL_SECTION6_BODY_LEN)) {
      out = replaceSection6Or7InDraft(
        out,
        6,
        secBaseline.startsWith("##") ? secBaseline : sectionMdToBaselineDraft(secBaseline, 6),
      );
    }
  }
  if (intBaseline) {
    const intBody = extractSection7Body(intBaseline) ?? intBaseline.replace(/^##[^\n]+\n+/, "").trim();
    if (sectionBodyIsSubstantial(intBody, MIN_SUBSTANTIAL_SECTION7_BODY_LEN)) {
      out = replaceSection6Or7InDraft(
        out,
        7,
        intBaseline.startsWith("##") ? intBaseline : sectionMdToBaselineDraft(intBaseline, 7),
      );
    }
  }
  return out;
}

/** Restaura §6 desde snapshot del Security/post_critic si format/dedupe la vació. */
export function preserveSection6FromSecuritySnapshot(
  securitySectionMd: string | null | undefined,
  securityDraftSnapshot: string | null | undefined,
  currentDraft: string,
  structured?: TailSectionSnapshotSource["mddStructured"],
): string {
  const baseline =
    resolveSection6BaselineFromSnapshots({
      securitySectionMd,
      securityArchitectMddDraftSnapshot: securityDraftSnapshot,
      mddStructured: structured,
    }) ?? "";
  if (!baseline) return currentDraft;
  const pseudoDraft = baseline.startsWith("#")
    ? baseline
    : replaceSection6Or7InDraft(currentDraft, 6, sectionMdToBaselineDraft(baseline, 6));
  return preserveSection6IfSubstantial(pseudoDraft, currentDraft);
}

/** Restaura §7 desde snapshot del Integration/post_critic si format/dedupe la vació. */
export function preserveSection7FromIntegrationSnapshot(
  integrationSectionMd: string | null | undefined,
  integrationDraftSnapshot: string | null | undefined,
  currentDraft: string,
  structured?: TailSectionSnapshotSource["mddStructured"],
): string {
  const baseline =
    resolveSection7BaselineFromSnapshots({
      integrationSectionMd,
      integrationArchitectMddDraftSnapshot: integrationDraftSnapshot,
      mddStructured: structured,
    }) ?? "";
  if (!baseline) return currentDraft;
  const pseudoDraft = baseline.startsWith("#")
    ? baseline
    : replaceSection6Or7InDraft(currentDraft, 7, sectionMdToBaselineDraft(baseline, 7));
  return preserveSection7IfSubstantial(pseudoDraft, currentDraft);
}

/** Restaura §6/§7 desde snapshots staged en state. */
export function preserveTailSectionsFromSnapshots(
  source: TailSectionSnapshotSource,
  currentDraft: string,
): string {
  let out = currentDraft;
  out = preserveSection6FromSecuritySnapshot(
    source.securitySectionMd,
    source.securityArchitectMddDraftSnapshot,
    out,
    source.mddStructured,
  );
  out = preserveSection7FromIntegrationSnapshot(
    source.integrationSectionMd,
    source.integrationArchitectMddDraftSnapshot,
    out,
    source.mddStructured,
  );
  return out;
}

/**
 * Restaura §1–§7 desde los snapshots por-nodo del pipeline HIGH scoped.
 *
 * Los snapshots §1–§4 (clarifier/stack/data_model/api_contracts) solo se aplicaban dentro de
 * `mdd-software-architect.node` y `mdd-formatter.node`; el ensamblado final (`prepareMddForOutput`)
 * únicamente restauraba §6/§7. Resultado: normalize/dedupe/SSOT del paso final podía vaciar §1–§4
 * ya validadas sin que nada las recuperase, y el gate loop las regeneraba con LLM (caro y
 * destructivo). Cada preserver conserva el borrador actual si ya es bueno, así que esto no
 * pisa contenido nuevo mejor que el snapshot.
 */
export function preserveValidatedSectionsFromSnapshots(
  source: TailSectionSnapshotSource,
  currentDraft: string,
): string {
  let out = currentDraft;
  out = preserveSection1FromClarifierSnapshot(source.clarifierMddDraftSnapshot, out);
  out = preserveSection2FromStackSnapshot(source.stackArchitectMddDraftSnapshot, out);
  out = preserveSection3FromDataModelSnapshot(source.dataModelArchitectMddDraftSnapshot, out);
  out = preserveSection4FromApiContractsSnapshot(source.apiContractsArchitectMddDraftSnapshot, out);
  return preserveTailSectionsFromSnapshots(source, out);
}

/** True si hay §6 y §7 sustanciales en snapshots. */
export function stateHasSubstantialTailSnapshots(source: TailSectionSnapshotSource): boolean {
  return !!resolveSection6BaselineFromSnapshots(source) && !!resolveSection7BaselineFromSnapshots(source);
}

function forceReplaceSection6FromSnapshot(source: TailSectionSnapshotSource, draft: string): string {
  const baseline = resolveSection6BaselineFromSnapshots(source);
  if (!baseline) return draft;
  const sectionMd = baseline.startsWith("##") ? baseline : sectionMdToBaselineDraft(baseline, 6);
  const body = sectionMd.replace(/^##[^\n]+\n+/, "").trim();
  if (!sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION6_BODY_LEN)) return draft;
  return replaceSection6Or7InDraft(draft, 6, sectionMd);
}

function forceReplaceSection7FromSnapshot(source: TailSectionSnapshotSource, draft: string): string {
  const baseline = resolveSection7BaselineFromSnapshots(source);
  if (!baseline) return draft;
  const sectionMd = baseline.startsWith("##") ? baseline : sectionMdToBaselineDraft(baseline, 7);
  const body = sectionMd.replace(/^##[^\n]+\n+/, "").trim();
  if (!sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION7_BODY_LEN)) return draft;
  return replaceSection6Or7InDraft(draft, 7, sectionMd);
}

/** Gate loop integration: re-inyecta §6/§7 desde snapshots sin LLM. */
export function reinjectTailSectionsFromSnapshotsForGateLoop(
  source: TailSectionSnapshotSource & { mddDraft?: string | null },
): { mddDraft: string; securitySectionMd?: string; integrationSectionMd?: string } | null {
  const has6 = !!resolveSection6BaselineFromSnapshots(source);
  const has7 = !!resolveSection7BaselineFromSnapshots(source);
  if (!has6 && !has7) return null;

  let draft = (source.mddDraft ?? "").trim();
  if (has6) draft = forceReplaceSection6FromSnapshot(source, draft);
  if (has7) draft = forceReplaceSection7FromSnapshot(source, draft);

  const out: { mddDraft: string; securitySectionMd?: string; integrationSectionMd?: string } = { mddDraft: draft };
  const secMd = source.securitySectionMd?.trim() || resolveSection6BaselineFromSnapshots(source);
  const intMd = source.integrationSectionMd?.trim() || resolveSection7BaselineFromSnapshots(source);
  if (secMd?.startsWith("##")) out.securitySectionMd = secMd;
  if (intMd?.startsWith("##")) out.integrationSectionMd = intMd;
  return out;
}

/** Restaura §6/§7 si dedupe/normalize las regresó (placeholder, ausente o <50%). */
export function restoreSections6And7IfRegressed(source: string, normalized: string): string {
  let out = normalized;
  out = preserveSection6IfSubstantial(source, out);
  out = preserveSection7IfSubstantial(source, out);
  return out;
}

function sectionBodyIsSubstantial(
  body: string | null | undefined,
  minLen: number,
): boolean {
  const trimmed = (body ?? "").trim();
  if (!trimmed || trimmed.length < minLen) return false;
  return !isMddSectionPipelinePlaceholderBody(trimmed);
}

/** §1 reducida a fallback Clarifier, stamp BRD/DBGA o metadatos sin alcance real. */
export function isContextSectionBoilerplateOnly(body: string | null | undefined): boolean {
  const b = (body ?? "").trim();
  if (!b) return true;
  if (/^\(Basado en:/i.test(b)) return true;
  if (/theforge-doc:created=/i.test(b) && b.length < 600) return true;
  const withoutStamp = b
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^>\s*📅[^\n]*\n?/gm, "")
    .trim();
  if (withoutStamp.length < MIN_SUBSTANTIAL_SECTION1_BODY_LEN && /📅\s*Creado:/i.test(b)) {
    return true;
  }
  return false;
}

/** True si §1 tiene contexto real (no placeholder ni vacío). */
export function draftHasSubstantialSection1(draft: string): boolean {
  const body = extractContextSectionBody((draft ?? "").trim());
  if (isContextSectionBoilerplateOnly(body)) return false;
  return sectionBodyIsSubstantial(body, MIN_SUBSTANTIAL_SECTION1_BODY_LEN);
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
  if (draftHasSubstantialSection2(baseline)) return true;
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

export type ScopedSectionSealSource = {
  mddDraft?: string | null;
  stackArchitectMddDraftSnapshot?: string | null;
  dataModelArchitectMddDraftSnapshot?: string | null;
  apiContractsArchitectMddDraftSnapshot?: string | null;
};

/** True si una pasada scoped (stack/data_model/api_contracts) ya selló la sección con snapshot + sustancia. */
export function isScopedSectionSealed(
  section: 2 | 3 | 4,
  source: ScopedSectionSealSource,
): boolean {
  const draft = (source.mddDraft ?? "").trim();
  switch (section) {
    case 2:
      return !!(
        source.stackArchitectMddDraftSnapshot?.trim() && draftHasSubstantialSection2(draft)
      );
    case 3:
      return !!(
        source.dataModelArchitectMddDraftSnapshot?.trim() && draftHasSubstantialSection3(draft)
      );
    case 4:
      return !!(
        source.apiContractsArchitectMddDraftSnapshot?.trim() && draftHasPersistableSection4(draft)
      );
    default:
      return false;
  }
}

function logSection5ExtractZeroDiag(restored: string, baselineLen: number, context: string): void {
  const s4Len = extractSection4Body(restored)?.length ?? 0;
  const fenceCount = (restored.match(/```/g) ?? []).length;
  console.warn(
    `[MDD:SectionPreserve:diag] §5 ${context} extract=0 baseline=${baselineLen} §4len=${s4Len} fences=${fenceCount}${fenceCount % 2 === 1 ? " IMPAR" : ""}`,
  );
}

function logSection5PreserveSkip(
  reason: string,
  ctx: {
    curSubstantial: boolean;
    curShorter: boolean;
    baselineDup: boolean;
    currentDup: boolean;
    baselineLen: number;
    curLen: number;
  },
): void {
  console.warn(
    `[MDD:SectionPreserve] §5 restore omitido (${reason}) curSubstantial=${ctx.curSubstantial} curShorter=${ctx.curShorter} baselineDup=${ctx.baselineDup} currentDup=${ctx.currentDup} lens=${ctx.curLen}/${ctx.baselineLen}`,
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

  const isSection5 = sectionLabel === "§5";
  const baselineDup = mddHasDuplicateSectionHeadings(baseline);
  if (baselineDup && !isSection5) {
    return current;
  }
  if (baselineDup && isSection5) {
    console.warn(
      `[MDD:SectionPreserve] §5 baseline con headings duplicados — resolveSection5PreserveBaselineBody (lens=${resolveSection5PreserveBaselineBody(baseline)?.length ?? 0})`,
    );
  }

  const prevBody = isSection5 ? resolveSection5PreserveBaselineBody(baseline) : extractBody(baseline);
  if (!sectionBodyIsSubstantial(prevBody, minLen)) return current;

  const curBody = extractBody(current);
  const curSubstantial = sectionBodyIsSubstantial(curBody, minLen);
  const curShorter = (curBody?.length ?? 0) < (prevBody?.length ?? 0) * 0.5;
  const baselineLen = prevBody?.length ?? 0;
  const curLen = curBody?.length ?? 0;
  const currentDup = mddHasDuplicateSectionHeadings(current);
  const skipCtx = {
    curSubstantial,
    curShorter,
    baselineDup: false,
    currentDup,
    baselineLen,
    curLen,
  };

  if (curSubstantial && !curShorter) {
    if (isSection5) logSection5PreserveSkip("current sustancial y no <50% baseline", skipCtx);
    return current;
  }

  if (curSubstantial && baselineLen > curLen * 3) {
    if (isSection5) logSection5PreserveSkip("current sustancial pero baseline >3× current", skipCtx);
    return current;
  }
  if (currentDup && baselineLen > 0 && baselineLen >= curLen * 2.5) {
    if (isSection5) logSection5PreserveSkip("current headings duplicados y baseline ≥2.5× current", skipCtx);
    return current;
  }

  const restored = replaceBody(current, prevBody!);
  if (restored !== current) {
    console.warn(
      `[MDD:SectionPreserve] ${sectionLabel} restaurada (${curLen}→${baselineLen} chars)`,
    );
    if (isSection5) {
      const extractedLen = extractSection5Body(restored)?.length ?? 0;
      if (extractedLen === 0 && baselineLen > 200) {
        logSection5ExtractZeroDiag(restored, baselineLen, "restore merge OK");
      }
    }
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

/** Restaura §3 desde el snapshot de data_model si api_contracts/format/SSOT la vació (pipeline HIGH scoped). */
export function preserveSection3FromDataModelSnapshot(
  dataModelSnapshot: string | null | undefined,
  currentDraft: string,
): string {
  const snap = (dataModelSnapshot ?? "").trim();
  if (!snap || !draftHasSubstantialSection3(snap)) return currentDraft;

  const snapBody = extractSection3Body(snap);
  if (!snapBody) return currentDraft;

  const curBody = extractSection3Body(currentDraft);
  const snapTables = (snapBody.match(/\bCREATE\s+TABLE\b/gi) ?? []).length;
  const curTables = (curBody?.match(/\bCREATE\s+TABLE\b/gi) ?? []).length;

  if (
    draftHasSubstantialSection3(currentDraft) &&
    curTables >= Math.max(1, Math.ceil(snapTables * 0.5))
  ) {
    return currentDraft;
  }

  const restored = replaceMddSection3Body(currentDraft, snapBody);
  if (restored !== currentDraft) {
    console.warn(
      `[MDD:SectionPreserve] §3 restaurada desde data_model snapshot (${curTables}→${snapTables} CREATE TABLE)`,
    );
  }
  return restored;
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
  const baselineGateSubstantial = isContratosSubstantial(prevBody);
  const baselinePersistable = draftHasPersistableSection4(baseline);
  if (!baselineGateSubstantial && !baselinePersistable) return current;

  const curBody = extractContratosSectionBody(current);
  const curGateSubstantial = isContratosSubstantial(curBody);
  const curPersistable = draftHasPersistableSection4(current);
  const curShorter = (curBody?.length ?? 0) < (prevBody?.length ?? 0) * 0.5;

  if (baselinePersistable) {
    const baselineRows = countContratosEndpointRows(stripLeadingContratosPlaceholder(prevBody ?? ""));
    const curRows = countContratosEndpointRows(stripLeadingContratosPlaceholder(curBody ?? ""));
    if (curPersistable && curRows >= Math.max(3, Math.ceil(baselineRows * 0.5))) return current;
  } else if (curGateSubstantial && !curShorter) {
    return current;
  }

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
  const baseline = (baselineDraft ?? "").trim();
  const baselineDup = mddHasDuplicateSectionHeadings(baseline);
  let prevBody = resolveSection5PreserveBaselineBody(baseline);
  if (prevBody == null && baselineDup) {
    return currentDraft;
  }
  if (prevBody == null && !baselineDup) {
    prevBody =
      baseline.match(/##\s*5\.[\s\S]*?\n([\s\S]*?)(?=\n##\s|$)/i)?.[1]?.trim() ?? null;
  }
  if (!section5BodyIsPreserveBaseline(prevBody)) return currentDraft;

  const curBody = extractSection5Body(currentDraft);
  if (
    prevBody &&
    curBody &&
    isSection5SectionRegression(prevBody, curBody) &&
    sectionBodyIsSubstantial(prevBody, MIN_SUBSTANTIAL_SECTION5_BODY_LEN)
  ) {
    const restored = replaceMddSection5Body(currentDraft, prevBody);
    if (restored !== currentDraft) {
      console.warn(
        `[MDD:SectionPreserve] §5 restaurada por regresión (${curBody.length}→${prevBody.length} chars) baselineDup=${mddHasDuplicateSectionHeadings(baseline)}`,
      );
      const extractedLen = extractSection5Body(restored)?.length ?? 0;
      if (extractedLen === 0 && prevBody.length > 200) {
        logSection5ExtractZeroDiag(restored, prevBody.length, "regresión restore OK");
      } else {
        console.log(
          `[MDD:SectionPreserve] §5 regresión verify extract=${extractedLen} (baseline=${prevBody.length})`,
        );
      }
    }
    return restored;
  }

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
 * Restaura §1–§7 sustanciales cuando un paso mecánico las regresó (placeholder o <50% del baseline).
 * §2–§7 se restauran aunque §1 siga fina (p. ej. MDD desde benchmark con BRD corto).
 */
export function preserveValidatedSectionsIfSubstantial(
  baselineDraft: string,
  currentDraft: string,
  options?: PreserveValidatedSectionsOptions,
): string {
  const baseline = (baselineDraft ?? "").trim();
  if (!baseline) return currentDraft;
  const current = (currentDraft ?? "").trim();
  if (mddHasDuplicateSectionHeadings(baseline) && !mddHasDuplicateSectionHeadings(current)) {
    return current;
  }

  let out = currentDraft;
  const sections = resolveValidatedSectionsToPreserve(options);

  if (
    sections.includes(1) &&
    !draftHasSubstantialSection1(out) &&
    draftHasSubstantialSection1(baseline)
  ) {
    out = preserveSectionByNumber(baseline, out, 1);
    if (!draftHasSubstantialSection1(out)) {
      console.warn(
        `[MDD:SectionPreserve] Preserve: §1 no pudo restaurarse → draft corrupto; preservando §2–§7`,
      );
    }
  } else if (
    !draftHasSubstantialSection1(out) &&
    isContextSectionBoilerplateOnly(extractContextSectionBody(out))
  ) {
    console.warn(
      `[MDD:SectionPreserve] Preserve: §1 es boilerplate/stamp — restaurando §2–§7 desde baseline`,
    );
  }

  for (const n of sections) {
    if (n === 1) continue;
    out = preserveSectionByNumber(baseline, out, n);
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
  // Fence abierto (§3 ```sql, §4 ```json) sepulta las secciones siguientes: los extractores
  // fence-aware las miden 0 y el guard tumba el job aunque el contenido siga ahí (job 85, §5).
  const baseline = closeUnclosedFencesBeforeCanonicalH2((prePrepareDraft ?? "").trim());
  const before = closeUnclosedFencesBeforeCanonicalH2((postPrepareMarkdown ?? "").trim());
  if (!baseline) return { markdown: before, restored: false, failedSections: [] };

  if (
    !draftHasSubstantialSection1(before) &&
    (draftHasSubstantialSection1(baseline) ||
      isContextSectionBoilerplateOnly(extractContextSectionBody(before)))
  ) {
    console.warn(
      `[MDD:SectionPreserve] §1 insustancial (${extractContextSectionBody(before)?.length ?? 0} chars) — evaluando §2–§7`,
    );
  }

  const sectionsToCheck = resolveValidatedSectionsToPreserve(options);
  const checks = GUARD_SECTION_CHECKS.filter((c) => {
    if (!sectionsToCheck.includes(c.num)) return false;
    if (c.num === 1 && !draftHasSubstantialSection1(baseline)) return false;
    return true;
  });
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
