import type { MddStructured } from "../../state/mdd-structured.schema.js";
import {
  repairGluedMarkdownHeadings,
  repairInlineHorizontalRuleSectionBreaks,
} from "@theforge/shared-types";
import { collectMddQualityIssues } from "../../../engine/mdd-quality-audit.util.js";
import { isMddTailParallelEnabled } from "../mdd-tail-parallel.config.js";
import { stripBrdPasteNoiseFromSection1 } from "../mdd-section1-cleanup.util.js";
import {
  countContratosEndpointRows,
  isContratosPlaceholder,
  isContratosSectionRegression,
  isContratosSubstantial,
  stripLeadingContratosPlaceholder,
} from "./contratos-format.js";

const RE_SECTION6_H2_LINE = /^##\s+(?:6\.\s+)?Seguridad/i;

/** Bloque anexo § UI/UX (después de §1–§7). */
export const MDD_UI_UX_DESIGN_INTENT_RE = /\n##\s+UI\/UX\s+Design\s+Intent\b[\s\S]*$/i;

/** Separa núcleo canónico (§1–§7) del bloque UI/UX al final. */
export function splitMddUiUxDesignIntentSuffix(markdown: string): {
  core: string;
  uiUxSuffix: string;
} {
  const trimmed = (markdown ?? "").trim();
  const match = trimmed.match(MDD_UI_UX_DESIGN_INTENT_RE);
  if (!match?.index && match?.index !== 0) {
    return { core: trimmed, uiUxSuffix: "" };
  }
  return {
    core: trimmed.slice(0, match.index).trim(),
    uiUxSuffix: match[0].trim(),
  };
}

/** Vuelve a anexar UI/UX tras el núcleo §1–§7. */
export function reattachMddUiUxDesignIntentSuffix(core: string, uiUxSuffix: string): string {
  const body = (core ?? "").trim();
  const suffix = (uiUxSuffix ?? "").trim();
  if (!suffix) return body ? `${body}\n` : "";
  return `${body}\n\n${suffix}\n`;
}

/**
 * Reubica §1–§7 que quedaron después de UI/UX (p. ej. SSOT inyectó §4 al final del doc).
 */
export function repairMisplacedCanonicalSectionsAfterUiUx(draft: string): string {
  const trimmed = (draft ?? "").trim();
  const uiStart = trimmed.search(/\n##\s+UI\/UX\s+Design\s+Intent\b/i);
  if (uiStart < 0) return draft;

  const core = trimmed.slice(0, uiStart).trim();
  const tail = trimmed.slice(uiStart);
  const misplacedMatch = tail.slice(1).match(/\n##\s+[1-7]\.\s+[^\n]+/);
  if (!misplacedMatch?.index && misplacedMatch?.index !== 0) return draft;

  const misplacedStart = misplacedMatch.index + 1;
  const uiUxBlock = tail.slice(0, misplacedStart).trim();
  const misplaced = tail.slice(misplacedStart).trim();
  if (!misplaced) return draft;

  const mergedCore = deduplicateAndReorderMddSections(`${core}\n\n${misplaced}`);
  return reattachMddUiUxDesignIntentSuffix(mergedCore, uiUxBlock);
}

/** Despega subtítulo del H2 (ej. `## 6. SeguridadGestión…:` o `## 6. Seguridad. Autenticación:` → H2 + ###). */
export function fixGluedSection6Heading(draft: string): string {
  let out = repairGluedMarkdownHeadings(draft);
  out = out.replace(
    /^##\s*3\.\s*Modelo\s+de\s+Datos(?=[A-ZÁÉÍÓÚÑ])/gim,
    "## 3. Modelo de Datos\n\n",
  );
  out = out.replace(
    /^##\s*6\.\s*Seguridad([A-ZÁÉÍÓÚÑ][^\n]*?):?\s*$/gim,
    (_m: string, tail: string) => {
      const t = tail.trim().replace(/:$/, "");
      return t ? `## 6. Seguridad\n\n### ${t}` : _m;
    },
  );
  out = out.replace(
    /^##\s*6\.\s*Seguridad\.\s*([^:\n]+):?\s*$/gim,
    "## 6. Seguridad\n\n### $1",
  );
  return out.replace(/\n{3,}/g, "\n\n");
}

/** Cuenta ocurrencias de un heading H2 de sección canónica (§1–§7). */
function countMddSectionH2Occurrences(draft: string, section: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  const patterns: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, RegExp> = {
    1: /^##\s+1\.\s*Contexto/im,
    2: /^##\s+2\.\s*Arquitectura\s+y\s*Stack/im,
    3: /^##\s+3\.\s*Modelo\s+(?:de\s+)?datos/im,
    4: /^##\s+4\.\s*Contratos\s+de\s+API/im,
    5: /^##\s+5\.\s*Lógica\s+y\s*Edge\s+Cases/im,
    6: /^##\s+(?:6\.\s+)?Seguridad/im,
    7: /^##\s+(?:7\.\s+)?(?:Infraestructura|Integraci[oó]n)/im,
  };
  return (draft.match(new RegExp(patterns[section].source, "gm")) ?? []).length;
}

/** True si el borrador repite algún heading canónico §1–§7 (corrupción por acumulación del pipeline). */
export function mddHasDuplicateSectionHeadings(draft: string): boolean {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return false;
  for (const section of [1, 2, 3, 4, 5, 6, 7] as const) {
    if (countMddSectionH2Occurrences(trimmed, section) > 1) return true;
  }
  return false;
}

/**
 * Trunca cola duplicada tras la primera §7 completa (p. ej. §5/§6/§7 repetidas en bucle).
 * Red de seguridad cuando deduplicate no pudo reconstruir por el guard del 50%.
 */
export function stripTrailingDuplicateMddSections(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!trimmed || !mddHasDuplicateSectionHeadings(trimmed)) return draft;
  const range7 = getSection6Or7Range(trimmed, 7);
  if (!range7) return draft;
  const tail = trimmed.slice(range7.end).trim();
  if (!tail) return draft;
  const tailHasRepeatedCore =
    /^##\s+5\.\s*Lógica/im.test(tail) ||
    (tail.match(/^##\s+(?:6\.\s+)?Seguridad/im) ?? []).length >= 1 ||
    (tail.match(/^##\s+(?:7\.\s+)?(?:Infraestructura|Integraci[oó]n)/im) ?? []).length >= 1;
  if (!tailHasRepeatedCore) return draft;
  return trimmed.slice(0, range7.end).trim();
}

/** Dedup §1–§7 tras merge del Architect o reintentos del Clarifier (idempotente). */
export function deduplicateMddDraftSections(draft: string): string {
  let out = stripTrailingDuplicateMddSections((draft ?? "").trim());
  if (mddHasDuplicateSectionHeadings(out)) {
    out = deduplicateAndReorderMddSections(out);
  }
  if (mddHasDuplicateSectionHeadings(out)) {
    out = stripTrailingDuplicateMddSections(out);
  }
  return out;
}

const CONTEXTO_HEADING = "## 1. Contexto y alcance";

/**
 * Localiza el H2 de §1 sin tratar `## 1. Contexto` como prefijo de
 * `## 1. Contexto y Alcance` (indexOf corto rompía el título y vaciaba el cuerpo).
 * Case-insensitive; acepta "alcance" / "Alcance".
 */
export function findSection1HeadingSpan(
  draft: string,
): { headingStart: number; bodyStart: number } | null {
  const re =
    /(^|\n)(##\s*1\.\s*Contexto(?:\s+y\s+alcance)?|##\s*Contexto\s+y\s+alcance)[ \t]*(?=\n|$)/gi;
  const m = re.exec(draft);
  if (!m || m.index == null) return null;
  const prefixLen = m[1]?.length ?? 0;
  const headingStart = m.index + prefixLen;
  const full = m[0];
  const bodyStart = m.index + full.length;
  return { headingStart, bodyStart };
}

/** Extrae el cuerpo de la sección "## 1. Contexto" (hasta el siguiente ## o fin). */
export function extractContextSectionBody(draft: string): string | null {
  const span = findSection1HeadingSpan(draft);
  if (!span) return null;
  const after = draft.slice(span.bodyStart).replace(/^\s*\n+/, "");
  const nextHeading = after.search(/\n##\s+/);
  const body = nextHeading !== -1 ? after.slice(0, nextHeading).trim() : after.trim();
  return body || null;
}

/** Fusiona solo la sección 1 (Contexto y alcance) de newDraft en previousDraft; el resto del documento se mantiene de previousDraft. */
export function mergeSection1IntoDraft(previousDraft: string, newDraft: string): string {
  const rawBody = extractContextSectionBody(newDraft);
  const section1Body = rawBody ? stripBrdPasteNoiseFromSection1(rawBody) : null;
  if (!section1Body?.trim()) return previousDraft;
  return replaceContextSectionBody(previousDraft, section1Body);
}

/** Reemplaza el cuerpo de "## 1. Contexto y alcance" en draft por newBody. */
export function replaceContextSectionBody(draft: string, newBody: string): string {
  const idx = draft.indexOf(CONTEXTO_HEADING);
  if (idx === -1) return draft;
  const sectionStart = idx + CONTEXTO_HEADING.length;
  const rest = draft.slice(sectionStart);
  const nextHeadingInRest = rest.search(/\n##\s+/);
  const endOfSection = nextHeadingInRest !== -1 ? sectionStart + nextHeadingInRest : draft.length;
  const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
  return draft.slice(0, sectionStart) + "\n\n" + newBody.trim() + (afterSection ? "\n\n" + afterSection : "");
}

/** Reemplaza el cuerpo de la sección 1 (cualquier variante de título) por newBody. Para regenerar §1 sin depender del título exacto. */
export function replaceSection1BodyFromAnyHeading(draft: string, newBody: string): string {
  const span = findSection1HeadingSpan(draft);
  if (!span) return draft;
  const rest = draft.slice(span.bodyStart);
  const nextHeadingInRest = rest.search(/\n##\s+/);
  const endOfSection =
    nextHeadingInRest !== -1 ? span.bodyStart + nextHeadingInRest : draft.length;
  const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
  return (
    draft.slice(0, span.bodyStart) +
    "\n\n" +
    newBody.trim() +
    (afterSection ? "\n\n" + afterSection : "")
  );
}

const METADATA_KEYS = /^(section\d|toolPreference|diagramFormat|apiFormat|tool\s*:)$/i;

/** Detecta si el cuerpo de Contexto es solo metadatos (section3, toolPreference, etc.) sin prosa sustancial. */
function isContextOnlyMetadata(body: string): boolean {
  const lines = body.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const bulletKey = /^-\s*\*\*([^*]+)\*\*[::\s]/;
  let allMetadata = true;
  for (const line of lines) {
    const m = line.match(bulletKey);
    if (m && METADATA_KEYS.test(m[1].trim())) continue;
    if (line.length > 80 || !line.startsWith("-")) {
      allMetadata = false;
      break;
    }
  }
  return allMetadata && lines.length > 0;
}

/** Frases que indican que el "contexto" son instrucciones de conversación, no descripción del sistema. */
const CONTEXTO_INSTRUCTION_PATTERNS = [
  /regenerar\s+el\s+(mdd|master\s+design\s+document)/i,
  /incluir\s+metadatos\s*:\s*s[ií]/i,
  /objetivo\s*:\s*regenerar/i,
  /objetivo\s*:\s*generar\s+el\s+mdd/i,
  /instrucciones?\s*(del\s+usuario|de\s+conversaci[oó]n)/i,
];

/** Si "1. Contexto y alcance" contiene instrucciones de chat (regenerar MDD, incluir metadatos, etc.), reemplaza por placeholder para que se regenere. */
export function replaceContextWhenInstructions(draft: string): string {
  const body = extractContextSectionBody(draft);
  if (!body || body.length < 30) return draft;
  const combined = body.replace(/\s+/g, " ");
  const looksLikeInstructions = CONTEXTO_INSTRUCTION_PATTERNS.some((re) => re.test(combined));
  if (!looksLikeInstructions) return draft;
  return replaceContextSectionBody(
    draft,
    "(El contexto debe describir el **sistema**, la **audiencia** y el **alcance técnico**, no las instrucciones de la conversación. En la siguiente iteración el Clarificador/Arquitecto debe rellenar esta sección con el contexto real del proyecto.)",
  );
}

/** Si "1. Contexto y alcance" contiene solo metadatos (section3, toolPreference, diagramFormat, apiFormat), reemplaza por placeholder. */
export function replaceContextWhenOnlyMetadata(draft: string): string {
  const body = extractContextSectionBody(draft);
  if (!body || !isContextOnlyMetadata(body)) return draft;
  return replaceContextSectionBody(draft, "(Contexto pendiente de definir según alcance.)");
}

/** Inserta un bloque ## antes del primer heading núcleo (§2–§7). */
function insertSectionBlockBeforeFirstCoreHeading(
  draft: string,
  heading: string,
  body: string,
): string {
  const coreRe =
    /\n##\s+(?:[2-7]\.\s|Modelo\s+(?:de\s+)?datos|Contratos|Lógica|Seguridad|Infraestructura|Integraci[oó]n)/i;
  const m = draft.match(coreRe);
  const at = m?.index ?? draft.length;
  const block = `\n\n---\n\n${heading}\n\n${body.trim()}\n`;
  return draft.slice(0, at) + block + draft.slice(at);
}

function hasContextSectionHeading(draft: string): boolean {
  return findSection1HeadingSpan(draft) != null;
}

function hasArquitecturaSectionHeading(draft: string): boolean {
  return /^##\s+2\.\s*(?:Arquitectura(?:\s+y\s*Stack)?|Stack)\b/im.test("\n" + draft);
}

const SECTION1_RESTORE_PLACEHOLDER =
  "(Pendiente: Clarificador — contexto y alcance del sistema.)";
const SECTION2_RESTORE_PLACEHOLDER =
  "(Pendiente: Arquitecto de Software — stack y arquitectura.)";

/** Restaura §1 desde baseline cuando el Arquitecto omitió el heading o el cuerpo. */
export function restoreContextSectionFromBaselineIfMissing(
  baseline: string,
  draft: string,
): string {
  const currentBody = extractContextSectionBody(draft);
  if (
    currentBody?.trim() &&
    currentBody.length >= 20 &&
    !isMddSectionPipelinePlaceholderBody(currentBody)
  ) {
    return draft;
  }
  const baselineBody = extractContextSectionBody(baseline);
  const body = baselineBody?.trim() || SECTION1_RESTORE_PLACEHOLDER;
  if (hasContextSectionHeading(draft)) {
    return replaceSection1BodyFromAnyHeading(draft, body);
  }
  return insertSectionBlockBeforeFirstCoreHeading(draft, "## 1. Contexto", body);
}

/** Restaura §2 desde baseline cuando el Arquitecto omitió el heading o el cuerpo. */
export function restoreArquitecturaSectionFromBaselineIfMissing(
  baseline: string,
  draft: string,
): string {
  const currentBody = extractArquitecturaSectionBody(draft);
  if (
    currentBody?.trim() &&
    currentBody.length >= 20 &&
    !isMddSectionPipelinePlaceholderBody(currentBody)
  ) {
    return draft;
  }
  const baselineBody = extractArquitecturaSectionBody(baseline);
  const body = baselineBody?.trim() || SECTION2_RESTORE_PLACEHOLDER;
  if (hasArquitecturaSectionHeading(draft)) {
    return replaceArquitecturaSectionBody(draft, body);
  }
  return insertSectionBlockBeforeFirstCoreHeading(draft, "## 2. Arquitectura y Stack", body);
}

/** Si el draft anterior tiene Contexto sustancial y el nuevo tiene uno peor (metadatos/key-value o más corto), preserva el anterior. */
export function preserveContextSectionIfSubstantial(previousDraft: string, newDraft: string): string {
  const prevBody = extractContextSectionBody(previousDraft);
  const newBody = extractContextSectionBody(newDraft);
  if (!prevBody || prevBody.length < 100) return newDraft;
  if (!newBody) return restoreContextSectionFromBaselineIfMissing(previousDraft, newDraft);
  if (newBody.length >= prevBody.length * 0.8) return newDraft;
  const looksLikeMetadata = /\b(section3|toolPreference|section\d|tool\s*:)\s*[:=]/i.test(newBody) || (newBody.split(/\n/).length <= 3 && newBody.length < 200);
  if (looksLikeMetadata || newBody.length < 80) {
    return replaceContextSectionBody(newDraft, prevBody);
  }
  return newDraft;
}

const ARQUITECTURA_HEADINGS = [
  /^##\s+2\.\s*Arquitectura\s+y\s*Stack\s*$/im,
  /^##\s+2\.\s*Arquitectura\s*$/im,
  /^##\s+2\.\s*Stack(?:\s+t[eé]cnico)?\s*$/im,
];

/** Extrae el cuerpo de la sección "## 2. Arquitectura y Stack" (hasta el siguiente ## o fin). */
export function extractArquitecturaSectionBody(draft: string): string | null {
  for (const re of ARQUITECTURA_HEADINGS) {
    re.lastIndex = 0;
    const match = re.exec(draft);
    if (!match) continue;
    const start = match.index + match[0].length;
    const after = draft.slice(start).replace(/^\s*\n+/, "");
    const nextH2 = after.search(/\n##\s+/);
    const body = nextH2 !== -1 ? after.slice(0, nextH2).trim() : after.trim();
    return body || null;
  }
  return null;
}

/**
 * Si la directiva pide Dokploy / no Kubernetes, actualiza la fila de contenedores en §2.1 de forma determinista.
 */
export function applyDeploymentStackDirectiveToDraft(draft: string, directive: string): string {
  if (!draft?.trim() || !directive?.trim()) return draft;
  const wantsDokploy = /\bdokploy\b/i.test(directive);
  const rejectsK8s =
    (/\b(no\s+se\s+usar[aá]?|sin\s+|reemplaz|sustitu|en\s+lugar\s+de)\b/i.test(directive) &&
      /\b(kubernetes|kubernets|k8s)\b/i.test(directive)) ||
    /\b(kubernetes|kubernets|k8s)\b[\s\S]{0,120}\b(dokploy)\b/i.test(directive);
  if (!wantsDokploy && !rejectsK8s) return draft;

  let body = extractArquitecturaSectionBody(draft);
  if (!body) return draft;

  body = body.replace(/\|\s*Contenedores\s*\|[^|\n]*\|[^|\n]*\|[^|\n]*\|/gi, (row) => {
    if (!/\bkubernetes|kubernets|k8s\b/i.test(row) && !/\bdokploy\b/i.test(row)) return row;
    return "| Contenedores | Docker + Dokploy | — | Despliegue con Dokploy; sin orquestación Kubernetes |";
  });
  body = body.replace(/Docker\s*\+\s*Kubernetes/gi, "Docker + Dokploy");
  body = body.replace(
    /\|\s*Infraestructura\s*\|[^|\n]*\b(?:kubernetes|kubernets|k8s)\b[^|\n]*\|/gi,
    "| Infraestructura | Docker / Dokploy | — |",
  );

  return replaceArquitecturaSectionBody(draft, body);
}

/** Reemplaza el cuerpo de "## 2. Arquitectura y Stack" en draft por newBody. */
export function replaceArquitecturaSectionBody(draft: string, newBody: string): string {
  for (const re of ARQUITECTURA_HEADINGS) {
    re.lastIndex = 0;
    const match = re.exec(draft);
    if (!match) continue;
    const sectionStart = match.index + match[0].length;
    const rest = draft.slice(sectionStart);
    const nextH2InRest = rest.search(/\n##\s+/);
    const endOfSection = nextH2InRest !== -1 ? sectionStart + nextH2InRest : draft.length;
    const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
    return draft.slice(0, sectionStart) + "\n\n" + newBody.trim() + (afterSection ? "\n\n" + afterSection : "");
  }
  return draft;
}

/** Si el draft anterior tiene §2 sustancial y el nuevo tiene (Pendiente) o muy corto, preserva el anterior. */
export function preserveArquitecturaSectionIfSubstantial(previousDraft: string, newDraft: string): string {
  const prevBody = extractArquitecturaSectionBody(previousDraft);
  const newBody = extractArquitecturaSectionBody(newDraft);
  if (!prevBody || prevBody.length < 80) return newDraft;
  if (!newBody) return newDraft;
  const newIsPlaceholder = /^\s*\(?\s*Pendiente\s*\)?\s*$/i.test(newBody.trim()) || newBody.trim().length < 100;
  if (!newIsPlaceholder) return newDraft;
  return replaceArquitecturaSectionBody(newDraft, prevBody);
}

/**
 * Rellena §1 (Contexto) y §2 (Arquitectura) en mddStructured desde el draft cuando el structured no los tiene.
 * Evita que cualquier agente que haga merge + toMarkdown borre Contexto y Arquitectura por no estar en structured.
 */
export function hydrateStructuredFromDraft(
  prev: MddStructured | null | undefined,
  draft: string,
): MddStructured {
  const base = (prev ?? {}) as MddStructured;
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return base;
  const ctx = extractContextSectionBody(draft);
  const arch = extractArquitecturaSectionBody(draft);
  const logic = extractSection5Body(draft);
  const out = { ...base };
  if (ctx && ctx.length >= 80 && !(base.contextoAlcance?.trim())) out.contextoAlcance = ctx;
  if (arch && arch.length >= 80 && !(base.arquitecturaStack?.trim())) out.arquitecturaStack = arch;
  if (
    logic &&
    logic.length >= 100 &&
    !isMddSectionPipelinePlaceholderBody(logic) &&
    !(base.logicaEdgeCases?.trim())
  ) {
    out.logicaEdgeCases = logic;
  }
  return out as MddStructured;
}

export function normalizeCanonicalMddSectionHeadings(draft: string): string {
  if (!draft?.trim()) return draft;
  let out = repairInlineHorizontalRuleSectionBreaks(draft);
  out = out.replace(/^#{3,6}\s+(##\s+[1-7]\.\s+[^\n]+)$/gm, "$1");
  out = out.replace(/^##\s+Contexto(?:\s+y\s*alcance)?\s*$/gim, "## 1. Contexto");
  out = out.replace(
    /^##\s+2\.\s*Arquitectura(?!\s+y\s*Stack)\s*$/gim,
    "## 2. Arquitectura y Stack",
  );
  out = out.replace(/^##\s+2\.\s*Stack(?:\s+t[eé]cnico)?\s*$/gim, "## 2. Arquitectura y Stack");
  out = out.replace(/^##\s+Stack\s*$/gim, "## 2. Arquitectura y Stack");
  return out;
}

export interface ValidateMddStructureResult {
  section3HasPayloads: boolean;
  missingSections: string[];
  hasTechnicalMetadata: boolean;
  sectionOrderCorrect: boolean;
  issues: string[];
}

const SECTION_HEADINGS_CANONICAL = [
  "1. Contexto",
  "2. Arquitectura y Stack",
  "3. Modelo de Datos",
  "4. Contratos de API",
  "5. Lógica y Edge Cases",
  "6. Seguridad",
  "7. Infraestructura",
];

function getSectionBody(draft: string, pattern: RegExp): string | null {
  const trimmed = (draft ?? "").trim();
  pattern.lastIndex = 0;
  const match = pattern.exec(trimmed);
  if (!match || match.index == null) return null;
  const headingEnd = match.index + match[0].length;
  const nextH2 = indexOfNextH2OutsideFenced(trimmed, headingEnd);
  const bodyEnd = nextH2 !== -1 ? nextH2 : trimmed.length;
  const body = trimmed.slice(headingEnd, bodyEnd).replace(/^\s*\n+/, "").trim();
  return body.length > 0 ? body : null;
}

export type MddSection3Status = "sql" | "placeholder" | "empty";

/** Resumen del draft para logs: longitud y estado de §3 (modelo de datos). */
export function getMddDraftSummary(draft: string): {
  length: number;
  section3: MddSection3Status;
  /** @deprecated Usar `section3` — nombre histórico incorrecto (era §3, no §2). */
  section2: MddSection3Status;
} {
  const trimmed = (draft ?? "").trim();
  const body = getSectionBody(trimmed, /##\s*3\.\s*Modelo\s+(?:de\s+)?datos|##\s*2\.\s*Modelo\s+(?:de\s+)?datos/i);
  let section3: MddSection3Status = "empty";
  if (body && body.length > 10) {
    section3 = /CREATE\s+TABLE/i.test(body) ? "sql" : /pendiente|placeholder/i.test(body) ? "placeholder" : "empty";
  }
  return { length: trimmed.length, section3, section2: section3 };
}

export function getSection6Or7Range(
  draft: string,
  section: 6 | 7,
): { start: number; end: number; heading: string } | null {
  const trimmed = fixGluedSection6Heading((draft ?? "").trim());
  const re =
    section === 6
      ? /(?:^|\n)(##\s+(?:6\.\s+)?Seguridad[^\n]*)/im
      : /(?:^|\n)(##\s+(?:7\.\s+)?(?:Infraestructura|Integración)[^\n]*)/im;
  const m = trimmed.match(re);
  if (!m || m.index == null) return null;
  const heading = m[1] ?? (section === 6 ? "## 6. Seguridad" : "## 7. Infraestructura");
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const afterHeading = start + heading.length;
  const rest = trimmed.slice(afterHeading).replace(/^\s*\n+/, "");
  const nextH2 = rest.search(/\n##\s+/);
  const end = nextH2 >= 0 ? afterHeading + nextH2 : trimmed.length;
  return { start, end, heading };
}

/**
 * Reemplaza solo la sección 6 (Seguridad) o 7 (Infraestructura) en el draft por newSectionMarkdown.
 * newSectionMarkdown debe incluir el heading canónico (## 6. Seguridad o ## 7. Infraestructura) y el cuerpo.
 * Si la sección no existe, la inserta antes de la otra (§6 antes de §7) o al final.
 * Preserva §1–§5 del draft entrante (no reconstruye desde mddStructured).
 */
export function replaceSection6Or7InDraft(
  draft: string,
  section: 6 | 7,
  newSectionMarkdown: string,
): string {
  let sectionMd = newSectionMarkdown.trim();
  if (section === 6) {
    sectionMd = sectionMd.replace(/\s*--\s*\n*$/, "").trim();
  }
  const trimmed = (draft ?? "").trim();
  const range = getSection6Or7Range(trimmed, section);
  if (range) {
    const before = trimmed.slice(0, range.start);
    const after = range.end < trimmed.length ? trimmed.slice(range.end).trimStart() : "";
    return (before + sectionMd + (after ? "\n\n" + after : "")).trim();
  }
  const otherRange = getSection6Or7Range(trimmed, section === 6 ? 7 : 6);
  if (section === 6 && otherRange) {
    return (trimmed.slice(0, otherRange.start) + sectionMd + "\n\n" + trimmed.slice(otherRange.start)).trim();
  }
  if (section === 7 && otherRange) {
    return (trimmed.slice(0, otherRange.end) + "\n\n" + sectionMd + (otherRange.end < trimmed.length ? "\n\n" + trimmed.slice(otherRange.end) : "")).trim();
  }
  return (trimmed + "\n\n" + sectionMd).trim();
}

/** Placeholders explícitos del pipeline (sin umbral de longitud). */
export function isMddSectionPipelinePlaceholderBody(body: string | null | undefined): boolean {
  const b = (body ?? "").trim();
  if (!b) return true;
  if (/^\s*\(?\s*(Pendiente|TBD|\[Placeholder|\/\/ TODO)/i.test(b)) return true;
  if (/Pendiente:\s*(?:Arquitecto|Clarificador|Ingeniero|Integraci)/i.test(b)) return true;
  return false;
}

/** Cuerpo de sección MDD que aún no tiene contenido real (placeholders del pipeline). */
export function isMddSectionPlaceholderBody(body: string | null | undefined): boolean {
  const b = (body ?? "").trim();
  if (!b || b.length < 30) return true;
  return isMddSectionPipelinePlaceholderBody(b);
}

export function extractSection6Body(draft: string): string | null {
  const range = getSection6Or7Range((draft ?? "").trim(), 6);
  if (!range) return null;
  const body = draft.slice(range.start + range.heading.length, range.end).replace(/^\s*\n+/, "").trim();
  return isMddSectionPlaceholderBody(body) ? null : body;
}

export function extractSection7Body(draft: string): string | null {
  const range = getSection6Or7Range((draft ?? "").trim(), 7);
  if (!range) return null;
  const body = draft.slice(range.start + range.heading.length, range.end).replace(/^\s*\n+/, "").trim();
  return isMddSectionPlaceholderBody(body) ? null : body;
}

function replaceH2SectionBody(draft: string, headingPattern: RegExp, newBody: string): string {
  headingPattern.lastIndex = 0;
  const match = headingPattern.exec(draft);
  if (!match || match.index == null) return draft;
  const sectionStart = match.index + match[0].length;
  const nextH2 = indexOfNextH2OutsideFenced(draft, sectionStart);
  const endOfSection = nextH2 !== -1 ? nextH2 : draft.length;
  const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
  return draft.slice(0, sectionStart) + "\n\n" + newBody.trim() + (afterSection ? "\n\n" + afterSection : "");
}

function replaceSection3Body(draft: string, newBody: string): string {
  return replaceH2SectionBody(draft, /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i, newBody);
}

function replaceSection4Body(draft: string, newBody: string): string {
  return replaceH2SectionBody(
    draft,
    /##\s*4\.\s*Contratos\s+de\s+API|##\s*3\.\s*Contratos\s+de\s+API|##\s*Contratos\s+de\s*API/i,
    newBody,
  );
}

function replaceSection5Body(draft: string, newBody: string): string {
  return replaceH2SectionBody(draft, /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i, newBody);
}

/** Reemplaza solo el cuerpo de ## 3. Modelo de datos. */
export function replaceMddSection3Body(draft: string, newBody: string): string {
  return replaceSection3Body(draft, newBody);
}

/** Reemplaza solo el cuerpo de ## 4. Contratos de API. */
export function replaceMddSection4Body(draft: string, newBody: string): string {
  return replaceSection4Body(draft, newBody);
}

/** Inserta §5 antes de §6/§7, tras §4, o al final si no existe el heading.canónico. */
function insertMddSection5Block(draft: string, newBody: string): string {
  const sectionMd = `## 5. Lógica y Edge Cases\n\n${newBody.trim()}`;
  const trimmed = (draft ?? "").trim();
  const range6 = getSection6Or7Range(trimmed, 6);
  if (range6) {
    return `${trimmed.slice(0, range6.start).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(range6.start).trimStart()}`.trim();
  }
  const range7 = getSection6Or7Range(trimmed, 7);
  if (range7) {
    return `${trimmed.slice(0, range7.start).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(range7.start).trimStart()}`.trim();
  }
  const s4Match = trimmed.match(/##\s*4\.\s*Contratos\s+de\s+API/i);
  if (s4Match?.index != null) {
    const after4Start = s4Match.index + s4Match[0].length;
    const rest = trimmed.slice(after4Start);
    const nextH2 = rest.search(/\n##\s+/);
    const insertAt = nextH2 >= 0 ? after4Start + nextH2 : trimmed.length;
    return `${trimmed.slice(0, insertAt).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(insertAt).trimStart()}`.trim();
  }
  return `${trimmed}\n\n${sectionMd}`.trim();
}

/** Inserta §4 tras §3 (o antes de §5/§6/§7) si el heading canónico no existía. */
export function insertMddSection4Block(draft: string, newBody: string): string {
  const body = (newBody ?? "").trim();
  if (!body) return draft;
  const sectionMd = body.startsWith("## 4.") ? body : `## 4. Contratos de API\n\n${body}`;
  const trimmed = (draft ?? "").trim();
  if (/##\s*4\.\s*Contratos\s+de\s+API/i.test(trimmed)) {
    return replaceSection4Body(trimmed, body.replace(/^##\s*4\.[^\n]*\n?/i, "").trim() || body);
  }
  const s5Range = trimmed.match(/\n##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases\b/i);
  if (s5Range?.index != null) {
    return `${trimmed.slice(0, s5Range.index).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(s5Range.index).trimStart()}`.trim();
  }
  const range6 = getSection6Or7Range(trimmed, 6);
  if (range6) {
    return `${trimmed.slice(0, range6.start).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(range6.start).trimStart()}`.trim();
  }
  const range7 = getSection6Or7Range(trimmed, 7);
  if (range7) {
    return `${trimmed.slice(0, range7.start).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(range7.start).trimStart()}`.trim();
  }
  const s3Match = trimmed.match(/##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i);
  if (s3Match?.index != null) {
    const after3 = s3Match.index + s3Match[0].length;
    const rest = trimmed.slice(after3);
    const nextH2 = rest.search(/\n##\s+/);
    const insertAt = nextH2 >= 0 ? after3 + nextH2 : trimmed.length;
    return `${trimmed.slice(0, insertAt).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(insertAt).trimStart()}`.trim();
  }
  return `${trimmed}\n\n${sectionMd}`.trim();
}

/** Reescribe §5 o la inserta si el heading canónico no existía (salto §4→§6). */
export function replaceMddSection5Body(draft: string, newBody: string): string {
  const body = (newBody ?? "").trim();
  if (!body) return draft;
  if (/##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i.test(draft)) {
    return replaceSection5Body(draft, body);
  }
  return insertMddSection5Block(draft, body);
}

const MIN_SURGICAL_SECTION_BODY_LEN = 80;

export type MergeArchitectSectionRejectReason = "empty" | "placeholder" | "short" | "regression";

export interface MergeSingleArchitectSectionResult {
  draft: string;
  merged: boolean;
  rejectReason?: MergeArchitectSectionRejectReason;
}

/**
 * Tras Software Architect (que produce §2–§5), aplica SOLO la sección pedida (2|3|4)
 * sobre el draft baseline. Evita que `/arquitectura` / `/modelo-datos` / `/contratos-api`
 * reescriban el bloque §2–§5 entero y borren contenido bueno en las otras.
 * Si el cuerpo extraído es vacío, placeholder o demasiado corto, `merged=false` (no finge éxito).
 */
export function tryMergeSingleArchitectSectionIntoDraft(
  baselineDraft: string,
  architectDraft: string,
  section: 2 | 3 | 4,
): MergeSingleArchitectSectionResult {
  const baseline = (baselineDraft ?? "").trim();
  const fromArchitect = (architectDraft ?? "").trim();
  if (!baseline) {
    return { draft: fromArchitect, merged: !!fromArchitect, rejectReason: fromArchitect ? undefined : "empty" };
  }
  if (!fromArchitect) {
    return { draft: baseline, merged: false, rejectReason: "empty" };
  }

  const body =
    section === 2
      ? extractArquitecturaSectionBody(fromArchitect)
      : section === 3
        ? extractSection3Body(fromArchitect)
        : extractSection4Body(fromArchitect);

  if (!body) {
    return { draft: baseline, merged: false, rejectReason: "empty" };
  }
  if (isMddSectionPipelinePlaceholderBody(body)) {
    return { draft: baseline, merged: false, rejectReason: "placeholder" };
  }
  if (body.trim().length < MIN_SURGICAL_SECTION_BODY_LEN) {
    return { draft: baseline, merged: false, rejectReason: "short" };
  }

  if (section === 4) {
    const baselineBody = extractSection4Body(baseline);
    if (isContratosSectionRegression(baselineBody, body)) {
      return { draft: baseline, merged: false, rejectReason: "regression" };
    }
  }

  if (section === 2) return { draft: replaceArquitecturaSectionBody(baseline, body), merged: true };
  if (section === 3) return { draft: replaceMddSection3Body(baseline, body), merged: true };
  return { draft: replaceMddSection4Body(baseline, body), merged: true };
}

/** Wrapper legacy: devuelve solo el draft (baseline si merge rechazado). */
export function mergeSingleArchitectSectionIntoDraft(
  baselineDraft: string,
  architectDraft: string,
  section: 2 | 3 | 4,
): string {
  return tryMergeSingleArchitectSectionIntoDraft(baselineDraft, architectDraft, section).draft;
}

/** Secciones 1–7 que no serán reescritas por los nodos del plan sections (sin format/diagram/auditor). */
export function getSectionsToPreserveFromExecutorPlan(sectionsToRun: string[] | undefined): number[] {
  if (!sectionsToRun?.length) return [];
  const touched = new Set<number>();
  for (const node of sectionsToRun) {
    if (node === "clarifier" || node === "merge_section1_only") touched.add(1);
    if (node === "stack_architect") touched.add(2);
    if (node === "data_model") touched.add(3);
    if (node === "api_contracts") touched.add(4);
    if (node === "software_architect") {
      touched.add(2);
      touched.add(3);
      touched.add(4);
      if (!isMddTailParallelEnabled()) touched.add(5);
    }
    // Nodo dedicado "section5": regenera SOLO §5. Ver CHANGELOG [Unreleased]
    // → Added → "Dedicated §5 pass".
    if (node === "section5") touched.add(5);
    if (node === "security") touched.add(6);
    if (node === "integration") touched.add(7);
  }
  return [1, 2, 3, 4, 5, 6, 7].filter((n) => !touched.has(n));
}

/**
 * Restaura desde baseline las secciones listadas cuando el draft actual tiene placeholder o cuerpo peor.
 * Usado en planes acotados (executorControlled + sectionsToRun) para no vaciar §3–§6 fuera de alcance.
 */
export function preserveUntouchedMddSectionsFromBaseline(
  currentDraft: string,
  baselineDraft: string,
  sectionsToPreserve: number[],
): string {
  if (!baselineDraft.trim() || !sectionsToPreserve.length) return currentDraft;
  let out = currentDraft;
  for (const n of sectionsToPreserve) {
    const prevBody =
      n === 1
        ? extractContextSectionBody(baselineDraft)
        : n === 2
          ? extractArquitecturaSectionBody(baselineDraft)
          : n === 3
            ? extractSection3Body(baselineDraft)
            : n === 4
              ? extractSection4Body(baselineDraft)
              : n === 5
                ? getSectionBody(baselineDraft.trim(), /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i)
                : n === 6
                  ? extractSection6Body(baselineDraft)
                  : n === 7
                    ? extractSection7Body(baselineDraft)
                    : null;
    if (!prevBody || isMddSectionPlaceholderBody(prevBody)) continue;
    const curBody =
      n === 1
        ? extractContextSectionBody(out)
        : n === 2
          ? extractArquitecturaSectionBody(out)
          : n === 3
            ? extractSection3Body(out)
            : n === 4
              ? extractSection4Body(out)
              : n === 5
                ? getSectionBody(out.trim(), /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i)
                : n === 6
                  ? extractSection6Body(out) ?? getSectionBody(out.trim(), /##\s*6\.\s*Seguridad/i)
                  : n === 7
                    ? extractSection7Body(out) ?? getSectionBody(out.trim(), /##\s*7\.\s*Infraestructura/i)
                    : null;
    const curIsPlaceholder = isMddSectionPlaceholderBody(curBody);
    const curShorter = (curBody?.length ?? 0) < prevBody.length * 0.5;
    if (!curIsPlaceholder && !curShorter) continue;
    if (n === 1) out = replaceContextSectionBody(out, prevBody);
    else if (n === 2) out = replaceArquitecturaSectionBody(out, prevBody);
    else if (n === 3) out = replaceSection3Body(out, prevBody);
    else if (n === 4) out = replaceSection4Body(out, prevBody);
    else if (n === 5) out = replaceSection5Body(out, prevBody);
    else if (n === 6) out = replaceSection6Or7InDraft(out, 6, `## 6. Seguridad\n\n${prevBody}`);
    else if (n === 7) out = replaceSection6Or7InDraft(out, 7, `## 7. Infraestructura\n\n${prevBody}`);
  }
  return out;
}

/**
 * Restaura secciones desde el borrador baseline sin heurística de placeholder.
 * Usado en upstream-sync para no tocar §6 (u otras) fuera del alcance solicitado.
 */
export function restoreMddSectionsFromBaselineStrict(
  currentDraft: string,
  baselineDraft: string,
  sectionsToRestore: readonly number[],
): string {
  if (!baselineDraft.trim() || !sectionsToRestore.length) return currentDraft;
  let out = currentDraft;
  for (const n of sectionsToRestore) {
    const prevBody =
      n === 1
        ? extractContextSectionBody(baselineDraft)
        : n === 2
          ? extractArquitecturaSectionBody(baselineDraft)
          : n === 3
            ? extractSection3Body(baselineDraft)
            : n === 4
              ? extractSection4Body(baselineDraft)
              : n === 5
                ? getSectionBody(baselineDraft.trim(), /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i)
                : n === 6
                  ? extractSection6Body(baselineDraft)
                  : n === 7
                    ? extractSection7Body(baselineDraft)
                    : null;
    if (!prevBody?.trim()) continue;
    if (n === 1) out = replaceContextSectionBody(out, prevBody);
    else if (n === 2) out = replaceArquitecturaSectionBody(out, prevBody);
    else if (n === 3) out = replaceSection3Body(out, prevBody);
    else if (n === 4) out = replaceSection4Body(out, prevBody);
    else if (n === 5) out = replaceSection5Body(out, prevBody);
    else if (n === 6) out = replaceSection6Or7InDraft(out, 6, `## 6. Seguridad\n\n${prevBody}`);
    else if (n === 7) out = replaceSection6Or7InDraft(out, 7, `## 7. Infraestructura\n\n${prevBody}`);
  }
  return out;
}

export function extractSection3Body(draft: string): string | null {
  const body = getSectionBody((draft ?? "").trim(), /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i);
  return body && body.length > 0 ? body : null;
}

const DEBUG_S3_ENV = "DEBUG_MDD_SECTION3";
const DEBUG_S3_PREVIEW_LEN = 800;

/**
 * Si DEBUG_MDD_SECTION3=1, escribe en consola el cuerpo de §3 (longitud + preview) para comparar
 * post-SA vs final y localizar dónde se pierde el contenido.
 */
export function logSection3Debug(label: string, draft: string): void {
  if (process.env[DEBUG_S3_ENV] !== "1" && process.env[DEBUG_S3_ENV] !== "true") return;
  const body = extractSection3Body(draft);
  const len = body?.length ?? 0;
  const preview = body ? body.slice(0, DEBUG_S3_PREVIEW_LEN).replace(/\n/g, " ") + (body.length > DEBUG_S3_PREVIEW_LEN ? "…" : "") : "(sin §3)";
  const tables = body ? (body.match(/CREATE\s+TABLE\s+(\w+)/gi) ?? []).join(", ") : "";
  console.log(`[MDD:§3 DEBUG] ${label} len=${len} tables=[${tables}] preview=${preview}`);
}

/** Extrae el cuerpo de la sección ## 4. Contratos de API (hasta el siguiente ## o fin). */
export function extractSection4Body(draft: string): string | null {
  const body = getSectionBody(
    (draft ?? "").trim(),
    /##\s*4\.\s*Contratos\s+de\s+API|##\s*3\.\s*Contratos\s+de\s*API|##\s*Contratos\s+de\s*API/i,
  );
  return body && body.length > 0 ? body : null;
}

/** Extrae el cuerpo de la sección ## 5. Lógica y Edge Cases (hasta el siguiente ## o fin). */
export function extractSection5Body(draft: string): string | null {
  const body = getSectionBody(
    (draft ?? "").trim(),
    /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i,
  );
  return body && body.length > 0 ? body : null;
}

export function validateMddStructure(draft: string): ValidateMddStructureResult {
  const trimmed = repairInlineHorizontalRuleSectionBreaks((draft || "").trim());
  const issues: string[] = [];
  const missingSections: string[] = [];
  const foundOrder: string[] = [];
  const withNewline = "\n" + (trimmed.startsWith("#") ? trimmed : "# " + trimmed);

  for (let i = 0; i < SECTION_ORDER.length; i++) {
    const { pattern } = SECTION_ORDER[i];
    const re = /\n(##\s+[^\n]+)/gi;
    let match: RegExpExecArray | null = null;
    let sectionFound = false;
    while ((match = re.exec(withNewline)) !== null) {
      if (pattern.test(match[1])) {
        const bodyStart = match.index + match[0].length;
        const rest = withNewline.slice(bodyStart).replace(/^\s*\n+/, "");
        const nextH2 = rest.search(/\n##\s+/);
        const body = (nextH2 !== -1 ? rest.slice(0, nextH2) : rest).trim();
        if (body.length > 0) foundOrder.push(SECTION_HEADINGS_CANONICAL[i]);
        sectionFound = true;
        break;
      }
    }
    if (!sectionFound) missingSections.push(SECTION_HEADINGS_CANONICAL[i]);
  }

  const section4BodyRaw = getSectionBody(trimmed, /##\s*4\.\s*Contratos\s+de\s+API|##\s*3\.\s*Contratos\s+de\s+API|##\s*Contratos\s+de\s+API/i);
  const section4Body = section4BodyRaw ? stripLeadingContratosPlaceholder(section4BodyRaw) : null;
  const section3HasPayloads =
    !!section4Body &&
    section4Body.length >= 100 &&
    !/^\s*\(?\s*(Pendiente|Falta):\s*definir\s+endpoints/i.test(section4Body) &&
    (/```json/i.test(section4Body) || /\b(POST|GET|PUT|DELETE|PATCH)\s+[\"']?\//i.test(section4Body) || /###\s+(POST|GET|PUT|DELETE|PATCH)/i.test(section4Body));

  if (!section3HasPayloads && section4Body !== null) {
    issues.push("Sección 4. Contratos de API: debe incluir tabla de endpoints y al menos 2-3 endpoints con request/response en bloques ```json.");
  }
  if (missingSections.length > 0) {
    issues.push("Secciones faltantes: " + missingSections.join(", "));
  }

  const hasTechnicalMetadata =
    /TechnicalMetadata|\[high_security\]|\[external_api\]|\[multi_tenant\]|\[cicd_pipeline\]|\[real_time\]/i.test(trimmed);

  if (!hasTechnicalMetadata) {
    issues.push("Falta bloque TechnicalMetadata con etiquetas (ej. [high_security], [external_api]) en la sección 3. Modelo de Datos.");
  }

  const sectionOrderCorrect =
    foundOrder.length === 0 ||
    foundOrder.every((h, idx) => h === SECTION_HEADINGS_CANONICAL[idx]);

  if (mddHasDuplicateSectionHeadings(trimmed)) {
    issues.push("MDD repite headings de §5, §6 o §7; deduplicar antes de entregar.");
  }

  for (const q of collectMddQualityIssues(trimmed)) {
    if (!issues.includes(q)) issues.push(q);
  }

  return {
    section3HasPayloads,
    missingSections,
    hasTechnicalMetadata,
    sectionOrderCorrect,
    issues,
  };
}

/** Títulos canónicos en orden para reordenar y deduplicar el MDD (7 secciones). */
const SECTION_ORDER = [
  { pattern: /^##\s+1\.\s*Contexto\b/i, heading: "## 1. Contexto" },
  { pattern: /^##\s+2\.\s*(?:Arquitectura(?:\s+y\s*Stack)?|Stack(?:\s+t[eé]cnico)?)\b/i, heading: "## 2. Arquitectura y Stack" },
  { pattern: /^##\s+3\.\s*Modelo\s+(?:de\s+)?datos/i, heading: "## 3. Modelo de Datos" },
  { pattern: /^##\s+4\.\s*Contratos\s+de\s+API/i, heading: "## 4. Contratos de API" },
  { pattern: /^##\s+5\.\s*Lógica\s+y\s*Edge\s+Cases/i, heading: "## 5. Lógica y Edge Cases" },
  // §6: acepta numbered (## 6. Seguridad) y bare (## Seguridad); sin \b (admite SeguridadGestión pegado)
  { pattern: RE_SECTION6_H2_LINE, heading: "## 6. Seguridad" },
  // §7: acepta Infraestructura o Integración, con o sin número
  { pattern: /^##\s+(?:7\.\s*)?(?:Infraestructura|Integración)\b/i, heading: "## 7. Infraestructura" },
];

/** Safety net: reinserta §1/§2 desde baseline (p. ej. Clarificador) antes del gate/dedupe. */
export function ensureMissingCanonicalSections(draft: string, baseline?: string): string {
  let out = normalizeCanonicalMddSectionHeadings((draft ?? "").trim());
  if (!out) return draft;
  const base = baseline?.trim() ? normalizeCanonicalMddSectionHeadings(baseline) : "";

  let missing = validateMddStructure(out).missingSections;
  if (missing.includes("1. Contexto")) {
    out = base
      ? restoreContextSectionFromBaselineIfMissing(base, out)
      : insertSectionBlockBeforeFirstCoreHeading(out, "## 1. Contexto", SECTION1_RESTORE_PLACEHOLDER);
    missing = validateMddStructure(out).missingSections;
  }
  if (missing.includes("2. Arquitectura y Stack")) {
    out = base
      ? restoreArquitecturaSectionFromBaselineIfMissing(base, out)
      : insertSectionBlockBeforeFirstCoreHeading(out, "## 2. Arquitectura y Stack", SECTION2_RESTORE_PLACEHOLDER);
    missing = validateMddStructure(out).missingSections;
  }
  if (missing.includes("6. Seguridad") && base) {
    const baseRepaired = repairInlineHorizontalRuleSectionBreaks(base);
    const range = getSection6Or7Range(baseRepaired, 6);
    if (range) {
      const sectionMd = baseRepaired.slice(range.start, range.end).trim();
      if (sectionMd.length > 100 && !isMddSectionPipelinePlaceholderBody(sectionMd.replace(/^##[^\n]+\n+/, ""))) {
        out = replaceSection6Or7InDraft(out, 6, sectionMd);
      }
    }
    missing = validateMddStructure(out).missingSections;
  }
  if (missing.includes("7. Infraestructura") && base) {
    const baseRepaired = repairInlineHorizontalRuleSectionBreaks(base);
    const range = getSection6Or7Range(baseRepaired, 7);
    if (range) {
      const sectionMd = baseRepaired.slice(range.start, range.end).trim();
      const bodyOnly = sectionMd.replace(/^##[^\n]+\n+/, "").trim();
      if (bodyOnly.length > 100 && !isMddSectionPipelinePlaceholderBody(bodyOnly)) {
        out = replaceSection6Or7InDraft(out, 7, sectionMd);
      }
    }
  }
  return out;
}

/**
 * Índice del siguiente ## que NO está dentro de un bloque con fences (```...```).
 * Así no cortamos una sección en un ## que sea contenido literal (ej. dentro de ```markdown).
 */
function indexOfNextH2OutsideFenced(text: string, fromIndex: number): number {
  const rest = text.slice(fromIndex);
  const re = /\n##\s+/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(rest)) !== null) {
    const pos = fromIndex + match.index;
    const before = text.slice(0, pos);
    const fences = (before.match(/```/g) || []).length;
    if (fences % 2 === 0) return pos;
  }
  return -1;
}

/**
 * Extrae el contenido de una sección (desde la línea del heading hasta el siguiente ## o fin).
 * No considera ## que estén dentro de bloques ```...``` para no partir en contenido embebido.
 */
function extractSection(draft: string, startIndex: number): { heading: string; body: string } {
  const afterStart = draft.slice(startIndex).replace(/^\s*\n+/, "");
  const firstNewline = afterStart.indexOf("\n");
  const heading = firstNewline !== -1 ? afterStart.slice(0, firstNewline).trim() : afterStart.trim();
  const bodyStartRel = firstNewline !== -1 ? firstNewline + 1 : afterStart.length;
  const rest = afterStart.slice(bodyStartRel);
  const nextH2 = indexOfNextH2OutsideFenced(draft, startIndex + bodyStartRel);
  const bodyEnd = nextH2 !== -1 ? nextH2 - startIndex - bodyStartRel : rest.length;
  const body = rest.slice(0, bodyEnd).replace(/^\s*\n+/, "").trim();
  return { heading, body };
}

/** Si el cuerpo de la sección 2 contiene ## 3, ## 4 (Contratos o Arquitectura Frontend), ### 4.x (frontend) o bloque ```markdown con ##, es contenido desplazado; reemplazar por placeholder. */
function sanitizeArquitecturaStackBody(body: string): string {
  const hasMisplaced =
    /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i.test(body) ||
    /##\s*4\.\s*Contratos\s+de\s+API/i.test(body) ||
    /##\s*4\.\s*Arquitectura\s+Frontend/i.test(body) ||
    /###\s*4\.\d+/i.test(body) ||
    /###\s*4\.\s/i.test(body) ||
    /```markdown\s*[\s\S]*?##\s*[34]\./i.test(body);
  if (hasMisplaced) return "(Pendiente: Arquitecto de Software)";
  return body;
}

/** Número canónico 1–7 a partir del heading ## N. … */
function canonicalSectionNumber(heading: string): number | null {
  const m = heading.match(/^##\s+(\d+)\./);
  if (m) {
    const n = parseInt(m[1]!, 10);
    return n >= 1 && n <= 7 ? n : null;
  }
  if (RE_SECTION6_H2_LINE.test(heading)) return 6;
  if (/^##\s+(?:Infraestructura|Integraci[oó]n)\b/i.test(heading)) return 7;
  return null;
}

const SECTION6_MISSING_PLACEHOLDER = "(Pendiente: Arquitecto de Seguridad)";

/**
 * Si hay §7 (o §5) pero falta el heading canónico ## 6. Seguridad, lo inserta antes de §7.
 * Evita el salto visible 5 → 7 cuando el plan omitió al agente security o el LLM no emitió §6.
 */
export function ensureSection6WhenSection7Present(draft: string): string {
  const trimmed = fixGluedSection6Heading((draft ?? "").trim());
  if (!trimmed || getSection6Or7Range(trimmed, 6)) return draft;
  if (!getSection6Or7Range(trimmed, 7)) return draft;
  if (!/\n##\s+5\.\s*Lógica\s+y\s*Edge\s+Cases\b/i.test(trimmed)) return draft;
  return replaceSection6Or7InDraft(
    trimmed,
    6,
    `## 6. Seguridad\n\n${SECTION6_MISSING_PLACEHOLDER}`,
  );
}

function scoreContratosSectionBody(body: string): number {
  const normalized = stripLeadingContratosPlaceholder((body ?? "").trim());
  if (!normalized) return 0;
  if (isContratosSubstantial(normalized)) return 10_000 + normalized.length;
  const rows = countContratosEndpointRows(normalized);
  if (rows >= 5 && !isContratosPlaceholder(normalized)) return 5_000 + rows * 100 + normalized.length;
  if (isContratosPlaceholder(normalized)) return normalized.length;
  return normalized.length;
}

function scoreSection3Body(body: string): number {
  const normalized = (body ?? "").trim();
  if (!normalized) return 0;
  if (isMddSectionPipelinePlaceholderBody(normalized)) return normalized.length;
  const tables = (normalized.match(/\bCREATE\s+TABLE\b/gi) ?? []).length;
  const hasEr = /```mermaid\s*\nerDiagram/i.test(normalized);
  if (tables >= 2) return 10_000 + tables * 100 + normalized.length;
  if (tables >= 1 || hasEr) return 5_000 + normalized.length;
  return normalized.length;
}

/**
 * Elige la mejor ocurrencia cuando hay headings duplicados: preferir cuerpo sustancial y más largo.
 */
function pickBestMddSectionCandidate(
  candidates: Array<{ heading: string; body: string }>,
): { heading: string; body: string } {
  if (candidates.length === 1) return candidates[0]!;
  const firstNum = canonicalSectionNumber(candidates[0]!.heading);
  if (firstNum === 4) {
    return candidates.reduce((best, cur) =>
      scoreContratosSectionBody(cur.body) >= scoreContratosSectionBody(best.body) ? cur : best,
    );
  }
  if (firstNum === 3) {
    return candidates.reduce((best, cur) =>
      scoreSection3Body(cur.body) >= scoreSection3Body(best.body) ? cur : best,
    );
  }
  return candidates.reduce((best, cur) => {
    const bestPh = isMddSectionPipelinePlaceholderBody(best.body);
    const curPh = isMddSectionPipelinePlaceholderBody(cur.body);
    if (bestPh && !curPh) return cur;
    if (!bestPh && curPh) return best;
    return cur.body.trim().length >= best.body.trim().length ? cur : best;
  });
}

/** Fusiona ocurrencias duplicadas de la misma §N (p. ej. §4 principal + journey core al final). */
function mergeDuplicateSectionCandidates(
  candidates: Array<{ heading: string; body: string }>,
): { heading: string; body: string } {
  if (candidates.length <= 1) return candidates[0]!;
  const best = pickBestMddSectionCandidate(candidates);
  const sectionNum = canonicalSectionNumber(best.heading);
  if (sectionNum !== 4) return best;

  const ranked = [...candidates].sort(
    (a, b) => scoreContratosSectionBody(b.body) - scoreContratosSectionBody(a.body),
  );
  const uniqueBodies: string[] = [];
  for (const candidate of ranked) {
    const body = candidate.body.trim();
    if (!body) continue;
    const sig = body.slice(0, 100);
    if (uniqueBodies.some((existing) => existing.includes(sig) || body.includes(existing.slice(0, 100)))) {
      continue;
    }
    uniqueBodies.push(body);
  }
  if (uniqueBodies.length <= 1) return best;
  return { heading: ranked[0]!.heading, body: uniqueBodies.join("\n\n") };
}

/**
 * Reordena el MDD a 1..7 y elimina secciones duplicadas.
 * No parte en ## que estén dentro de bloques ```. Si la sección 2 contiene ## 3/## 4 embebidos, la reemplaza por placeholder.
 */
export function deduplicateAndReorderMddSections(draft: string): string {
  let trimmed = stripTrailingDuplicateMddSections((draft || "").trim());
  trimmed = fixGluedSection6Heading(trimmed);
  trimmed = ensureSection6WhenSection7Present(trimmed);
  if (!trimmed) return draft;
  const hadDuplicates = mddHasDuplicateSectionHeadings(trimmed);
  // Corregir §6 pegada a ### antes de extraer (evita que extractSection tome "## 6. Seguridad###..." como una sola línea)
  trimmed = trimmed.replace(/(6\.\s*Seguridad)\s*(#{1,6})/gi, "$1\n\n$2");
  const titleMatch = trimmed.match(/^#\s+Master\s+Design\s+Document[^\n]*/i);
  const title = titleMatch ? titleMatch[0] : "# Master Design Document";
  const afterTitle = titleMatch ? trimmed.slice(titleMatch[0].length).replace(/^\s*\n+/, "") : trimmed;
  const withNewline = "\n" + afterTitle;
  const sections: Array<{ heading: string; body: string }> = [];
  for (const { pattern } of SECTION_ORDER) {
    const re = /\n(##\s+[^\n]+)/gi;
    let match: RegExpExecArray | null = null;
    const candidates: Array<{ heading: string; body: string }> = [];
    while ((match = re.exec(withNewline)) !== null) {
      const line = match[1];
      if (pattern.test(line)) {
        const { heading: actualHeading, body } = extractSection(withNewline, match.index);
        let bodyToUse = body;
        if (/^##\s*2\.\s*Arquitectura\s+y\s*Stack/i.test(actualHeading))
          bodyToUse = sanitizeArquitecturaStackBody(body);
        candidates.push({ heading: actualHeading, body: bodyToUse });
      }
    }
  if (candidates.length === 0) continue;
    sections.push(mergeDuplicateSectionCandidates(candidates));
  }
  // El escaneo por SECTION_ORDER puede perder §6/§7 recién insertadas (p. ej. tras /seguridad).
  // Recuperarlas del borrador original con getSection6Or7Range antes de reconstruir.
  for (const sectionNum of [6, 7] as const) {
    const range = getSection6Or7Range(trimmed, sectionNum);
    if (!range) continue;
    const canonical = sectionNum === 6 ? "## 6. Seguridad" : "## 7. Infraestructura";
    const already = sections.some((s) =>
      sectionNum === 6
        ? RE_SECTION6_H2_LINE.test(s.heading)
        : /^##\s+(?:7\.\s+)?(?:Infraestructura|Integraci[oó]n)/i.test(s.heading),
    );
    if (already) continue;
    const body = trimmed
      .slice(range.start + range.heading.length, range.end)
      .replace(/^\s*\n+/, "")
      .trim();
    if (body.length > 0) sections.push({ heading: canonical, body });
  }
  const byNumber = new Map<number, { heading: string; body: string }>();
  for (const s of sections) {
    const num = canonicalSectionNumber(s.heading);
    if (num == null) continue;
    const prev = byNumber.get(num);
    if (!prev || s.body.length >= prev.body.length) byNumber.set(num, s);
  }
  const orderedSections = [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, s]) => s);
  if (orderedSections.length === 0) return draft;
  const out = [title, "", ...orderedSections.flatMap((s) => ["---", s.heading, "", s.body, ""])];
  let result = out.join("\n").trim();
  // Con duplicados conocidos, forzar dedup aunque el resultado sea mucho más corto.
  if (!hadDuplicates && result.length < trimmed.length * 0.5) return draft;
  result = ensureSection6WhenSection7Present(result);
  if (mddHasDuplicateSectionHeadings(result)) {
    result = stripTrailingDuplicateMddSections(result);
  }
  return result;
}
