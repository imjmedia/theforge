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
  extractContratosSectionBody,
  isContratosPlaceholder,
  isContratosSectionRegression,
  isContratosSubstantial,
  normalizeGluedSection4HeadingInDraft,
  stripEmbeddedTailSectionsFromContratosBody,
  stripLeadingContratosPlaceholder,
} from "./contratos-format.js";
import { MDD_SECTION5_TAIL_PLACEHOLDER } from "../mdd-tail-parallel.config.js";
import {
  closeUnclosedFencesBeforeCanonicalH2,
  ensureDocumentFenceParity,
  findH2HeadingMatch,
  getSectionBody,
  indexOfNextH2OutsideFenced,
  RE_SECTION5_H2,
} from "./section-fence.util.js";
import { guardCanonicalH2Loss } from "./section-invariant.util.js";

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

/**
 * Primera línea de cuerpo pegada a un H2 canónico como viñeta o negrita.
 *
 * Job 92: `## 6. Seguridad- Autenticación LDAP/AD…` hacía que `extractSection`
 * tomase la línea entera como *heading*, así que al reensamblar con el heading
 * canónico esa primera viñeta desaparecía: §6 pasó de 3 viñetas a 2 (145 chars)
 * y el gate de persist tumbó el job. Se separa como cuerpo, no como `###`: una
 * viñeta no es un subtítulo.
 */
const GLUED_BULLET_AFTER_CANONICAL_H2_RE =
  /^(##\s*[1-7]\.\s*[^\n#*-]*?[^\s#*-])[ \t]*((?:[-*][ \t]+|\*\*)\S[^\n]*)$/gim;

/** Despega subtítulo del H2 (ej. `## 6. SeguridadGestión…:` o `## 6. Seguridad. Autenticación:` → H2 + ###). */
export function fixGluedSection6Heading(draft: string): string {
  let out = repairGluedMarkdownHeadings(draft);
  out = out.replace(GLUED_BULLET_AFTER_CANONICAL_H2_RE, "$1\n\n$2");
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

const MDD_SECTION_H2_PATTERNS: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, RegExp> = {
  1: /^##\s+1\.\s*Contexto/im,
  2: /^##\s+2\.\s*Arquitectura\s+y\s*Stack/im,
  3: /^##\s+3\.\s*Modelo\s+(?:de\s+)?datos/im,
  4: /^##\s+4\.\s*Contratos\s+de\s+API/im,
  5: /^##\s+5\.\s*Lógica\s+y\s*Edge\s+Cases/im,
  6: /^##\s+(?:6\.\s+)?Seguridad/im,
  7: /^##\s+(?:7\.\s+)?(?:Infraestructura|Integraci[oó]n)/im,
};

/** Cuenta ocurrencias de un heading H2 de sección canónica (§1–§7). */
function countMddSectionH2Occurrences(draft: string, section: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  const re = new RegExp(MDD_SECTION_H2_PATTERNS[section].source, "gim");
  let count = 0;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(draft)) !== null) {
    if ((draft.slice(0, m.index).match(/```/g) ?? []).length % 2 === 0) count++;
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return count;
}

/** Índice de la enésima ocurrencia de un heading H2 canónico (1-based), o -1 si no existe. */
function findNthMddSectionHeadingIndex(
  draft: string,
  section: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  occurrence: number,
): number {
  if (occurrence < 1) return -1;
  const re = new RegExp(MDD_SECTION_H2_PATTERNS[section].source, "gm");
  let match: RegExpExecArray | null = null;
  let seen = 0;
  while ((match = re.exec(draft)) !== null) {
    seen += 1;
    if (seen === occurrence && match.index != null) {
      let idx = match.index;
      if (draft[idx] === "\n") idx += 1;
      return idx;
    }
  }
  return -1;
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
 * Trunca cola duplicada de §1–§7 (p. ej. §4–§6 repetidas en bucle del crítico de arquitectura).
 * Con §7 completa: corta tras la primera §7 si la cola repite núcleo.
 * Sin §7 (streaming): corta antes de la 2.ª ocurrencia más temprana de cualquier § duplicada.
 */
export function stripTrailingDuplicateMddSections(draft: string): string {
  const trimmed = (draft ?? "").trim();
  if (!trimmed || !mddHasDuplicateSectionHeadings(trimmed)) return draft;

  const range7 = getSection6Or7Range(trimmed, 7);
  if (range7) {
    const tail = trimmed.slice(range7.end).trim();
    if (tail) {
      const tailHasRepeatedCore =
        /^##\s+4\.\s*Contratos/im.test(tail) ||
        /^##\s+5\.\s*Lógica/im.test(tail) ||
        (tail.match(/^##\s+(?:6\.\s+)?Seguridad/im) ?? []).length >= 1 ||
        (tail.match(/^##\s+(?:7\.\s+)?(?:Infraestructura|Integraci[oó]n)/im) ?? []).length >= 1;
      if (tailHasRepeatedCore) {
        return trimmed.slice(0, range7.end).trim();
      }
    }
  }

  let truncateAt = -1;
  for (const section of [1, 2, 3, 4, 5, 6, 7] as const) {
    if (countMddSectionH2Occurrences(trimmed, section) <= 1) continue;
    const secondIdx = findNthMddSectionHeadingIndex(trimmed, section, 2);
    if (secondIdx >= 0) {
      truncateAt = truncateAt < 0 ? secondIdx : Math.min(truncateAt, secondIdx);
    }
  }
  if (truncateAt >= 0) {
    return trimmed.slice(0, truncateAt).trim();
  }

  return draft;
}

/** Dedup §1–§7 tras merge del Architect o reintentos del Clarifier (idempotente). */
export function deduplicateMddDraftSections(draft: string): string {
  // Cerrar fences antes de dedupe: §4 impar traga §5–§7 y dispara ciclos anti-swallow (job 100/101).
  let out = closeUnclosedFencesBeforeCanonicalH2((draft ?? "").trim());
  if (mddHasDuplicateSectionHeadings(out)) {
    out = deduplicateAndReorderMddSections(out);
  }
  if (mddHasDuplicateSectionHeadings(out)) {
    out = stripTrailingDuplicateMddSections(out);
  }
  return out;
}

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
  if (m && m.index != null) {
    const prefixLen = m[1]?.length ?? 0;
    return { headingStart: m.index + prefixLen, bodyStart: m.index + m[0].length };
  }
  // Fallback (job 96): heading con cuerpo pegado en la MISMA línea, incluso con el
  // título/`---` delante ("# Master Design Document --- ## 1. Contexto y alcance ### Propósito…").
  // El match estricto (ancla de línea + fin de línea tras el título) devolvía null, todo el
  // pipeline medía §1=0 y SectionPreserve la daba por perdida sin poder restaurarla.
  // Sin ancla de línea: solo exige espacio antes de `##` y contenido después del título.
  const glued =
    /(^|\s)(##\s*1\.\s*Contexto(?:\s+y\s+alcance)?|##\s*Contexto\s+y\s+alcance)\b[ \t]+(?=\S)/i.exec(draft);
  if (!glued || glued.index == null) return null;
  const prefixLen = glued[1]?.length ?? 0;
  return { headingStart: glued.index + prefixLen, bodyStart: glued.index + glued[0].length };
}

/** Extrae el cuerpo de la sección "## 1. Contexto" (hasta el siguiente ## fuera de fences o fin). */
export function extractContextSectionBody(draft: string): string | null {
  const span = findSection1HeadingSpan(draft);
  if (!span) return null;
  const nextH2 = indexOfNextH2OutsideFenced(draft, span.bodyStart);
  const bodyEnd = nextH2 !== -1 ? nextH2 : draft.length;
  const body = draft.slice(span.bodyStart, bodyEnd).replace(/^\s*\n+/, "").trim();
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
  const span = findSection1HeadingSpan(draft);
  if (!span) return draft;
  const nextH2 = indexOfNextH2OutsideFenced(draft, span.bodyStart);
  const endOfSection = nextH2 !== -1 ? nextH2 : draft.length;
  const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
  return guardCanonicalH2Loss(
    draft,
    draft.slice(0, span.bodyStart) +
      "\n\n" +
      newBody.trim() +
      (afterSection ? "\n\n" + afterSection : ""),
    "replaceContextSectionBody(§1)",
  );
}

/** Reemplaza el cuerpo de la sección 1 (cualquier variante de título) por newBody. Para regenerar §1 sin depender del título exacto. */
export function replaceSection1BodyFromAnyHeading(draft: string, newBody: string): string {
  const span = findSection1HeadingSpan(draft);
  if (!span) return draft;
  const nextH2 = indexOfNextH2OutsideFenced(draft, span.bodyStart);
  const endOfSection = nextH2 !== -1 ? nextH2 : draft.length;
  const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
  return guardCanonicalH2Loss(
    draft,
    draft.slice(0, span.bodyStart) +
      "\n\n" +
      newBody.trim() +
      (afterSection ? "\n\n" + afterSection : ""),
    "replaceSection1BodyFromAnyHeading(§1)",
  );
}

const METADATA_KEYS =/^(section\d|toolPreference|diagramFormat|apiFormat|tool\s*:)$/i;

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
  // §2 ausente (borrador degradado, p. ej. Clarificador caído): insertar en vez de descartar
  // silenciosamente el trabajo del Arquitecto. Ver insertMddSectionByNumber.
  return insertMddSectionByNumber(draft, 2, newBody);
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
      ? /(?:^|\n)(##(?!#)\s+(?:6\.\s+)?Seguridad[^\n]*)/im
      : /(?:^|\n)(##(?!#)\s+(?:7\.\s+)?(?:Infraestructura|Integración)[^\n]*)/im;
  const m = trimmed.match(re);
  if (!m || m.index == null) return null;
  const heading = m[1] ?? (section === 6 ? "## 6. Seguridad" : "## 7. Infraestructura");
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const afterHeading = start + heading.length;
  // `search` sobre el resto ya recortado desalineaba el índice (end corto por las \n iniciales)
  // y contaba `##` dentro de fences, así que §6/§7 medían distinto que §5 (job 85).
  const nextH2 = indexOfNextH2OutsideFenced(trimmed, afterHeading);
  const end = nextH2 >= 0 ? nextH2 : trimmed.length;
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
  const trimmed = fixGluedSection6Heading((draft ?? "").trim());
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
    return (
      trimmed.slice(0, otherRange.end) +
      "\n\n" +
      sectionMd +
      (otherRange.end < trimmed.length ? "\n\n" + trimmed.slice(otherRange.end) : "")
    ).trim();
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

/** Cuerpo de §6/§7 sobre el mismo texto normalizado que usó el range (evita índices desfasados). */
function extractSection6Or7Body(draft: string, section: 6 | 7): string | null {
  const source = fixGluedSection6Heading((draft ?? "").trim());
  const range = getSection6Or7Range(source, section);
  if (!range) return null;
  const body = source
    .slice(range.start + range.heading.length, range.end)
    .replace(/^\s*\n+/, "")
    .trim();
  return isMddSectionPlaceholderBody(body) ? null : body;
}

export function extractSection6Body(draft: string): string | null {
  return extractSection6Or7Body(draft, 6);
}

export function extractSection7Body(draft: string): string | null {
  return extractSection6Or7Body(draft, 7);
}

const CANONICAL_SECTION_HEADING_TEXT: Record<number, string> = {
  1: "## 1. Contexto y alcance",
  2: "## 2. Arquitectura y Stack",
  3: "## 3. Modelo de Datos",
  4: "## 4. Contratos de API",
  5: "## 5. Lógica y Edge Cases",
  6: "## 6. Seguridad",
  7: "## 7. Infraestructura",
};

/**
 * Inserta una sección canónica ausente en su posición por número.
 *
 * Sin esto, `replaceH2SectionBody` devolvía el borrador intacto cuando el heading no existía:
 * con el Clarificador caído (borrador sin `## 1.`/`## 2.`), cada merge del Arquitecto era un
 * no-op silencioso que además logueaba `merged=true`, así que 7k/14k/23k chars de §2/§3/§4
 * generados por el LLM se evaporaban y el draft se quedaba en ~3k (job 81).
 */
function insertMddSectionByNumber(draft: string, num: number, newBody: string): string {
  const heading = CANONICAL_SECTION_HEADING_TEXT[num];
  const body = (newBody ?? "").trim();
  if (!heading || !body) return draft;
  const trimmed = (draft ?? "").trim();
  const sectionMd = `${heading}\n\n${body}`;
  if (!trimmed) return sectionMd;

  const re = /^##\s+(\d)\./gm;
  let m: RegExpExecArray | null = null;
  let insertAt = -1;
  while ((m = re.exec(trimmed)) !== null) {
    if ((trimmed.slice(0, m.index).match(/```/g) ?? []).length % 2 !== 0) continue;
    if (parseInt(m[1]!, 10) > num) {
      insertAt = m.index;
      break;
    }
  }
  if (insertAt === -1) return `${trimmed}\n\n${sectionMd}`.trim();
  return `${trimmed.slice(0, insertAt).trimEnd()}\n\n${sectionMd}\n\n${trimmed.slice(insertAt).trimStart()}`.trim();
}

function replaceH2SectionBody(
  draft: string,
  headingPattern: RegExp,
  newBody: string,
  sectionNum?: number,
): string {
  const match = findH2HeadingMatch(draft, headingPattern);
  if (!match || match.index == null) {
    return sectionNum != null ? insertMddSectionByNumber(draft, sectionNum, newBody) : draft;
  }
  const sectionStart = match.index + match[0].length;
  const nextH2 = indexOfNextH2OutsideFenced(draft, sectionStart);
  const endOfSection = nextH2 !== -1 ? nextH2 : draft.length;
  const afterSection = endOfSection < draft.length ? draft.slice(endOfSection).trimStart() : "";
  const replaced =
    draft.slice(0, sectionStart) + "\n\n" + newBody.trim() + (afterSection ? "\n\n" + afterSection : "");
  return guardCanonicalH2Loss(draft, replaced, `replaceH2SectionBody(§${sectionNum ?? "?"})`);
}

function replaceSection3Body(draft: string, newBody: string): string {
  return replaceH2SectionBody(draft, /##\s*3\.\s*Modelo\s+(?:de\s+)?datos/i, newBody, 3);
}

function replaceSection4Body(draft: string, newBody: string): string {
  const normalized = normalizeGluedSection4HeadingInDraft(draft);
  return replaceH2SectionBody(
    normalized,
    /##\s*4\.\s*Contratos\s+de\s+API|##\s*3\.\s*Contratos\s+de\s+API|##\s*Contratos\s+de\s*API/i,
    newBody,
    4,
  );
}

function replaceSection5Body(draft: string, newBody: string): string {
  return replaceH2SectionBody(draft, /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i, newBody, 5);
}

/** Reemplaza solo el cuerpo de ## 3. Modelo de datos. */
export function replaceMddSection3Body(draft: string, newBody: string): string {
  return replaceSection3Body(draft, newBody);
}

/** Reemplaza solo el cuerpo de ## 4. Contratos de API. */
export function replaceMddSection4Body(draft: string, newBody: string): string {
  const cleaned = stripEmbeddedTailSectionsFromContratosBody(newBody);
  return replaceSection4Body(draft, cleaned);
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
  const hasRealSection5H2 = findH2HeadingMatch(
    draft,
    /##\s*5\.\s*Lógica\s+y\s*Edge\s+Cases/i,
  );
  const result = hasRealSection5H2
    ? replaceSection5Body(draft, body)
    : insertMddSection5Block(draft, body);
  if (
    result === draft &&
    body.length >= 200 &&
    !isMddSectionPipelinePlaceholderBody(body)
  ) {
    console.warn(
      `[MDD:Section5Merge] replaceMddSection5Body no-op con cuerpo sustancial (${body.length} chars, hasH2=${!!hasRealSection5H2})`,
    );
  }
  return result;
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

/** Extrae el cuerpo de la sección ## 4. Contratos de API (fence-aware; fuente única con gate/preserve). */
export function extractSection4Body(draft: string): string | null {
  return extractContratosSectionBody(draft);
}

/** Extrae el cuerpo de la sección ## 5. Lógica y Edge Cases (hasta el siguiente ## o fin). */
export function extractSection5Body(draft: string): string | null {
  const trimmed = ensureDocumentFenceParity((draft ?? "").trim());
  let body = getSectionBody(trimmed, RE_SECTION5_H2);
  if (body && body.length > 0) return body;
  body = getSectionBody(trimmed, /##\s*5\.\s*L[oó]gica\b/i);
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
 * Extrae el contenido de una sección (desde la línea del heading hasta el siguiente ## o fin).
 * No considera ## que estén dentro de bloques ```...``` para no partir en contenido embebido.
 */
/**
 * Trunca un cuerpo de sección en el primer H2 canónico de *otra* sección embebido.
 *
 * Job 96: un fence impar en §4 hacía que `indexOfNextH2OutsideFenced` no encontrase
 * frontera y el cuerpo extraído de §5 "tragase" §6+§7 (candidatos de 59k cuando §5 real
 * medía 4.9k). El reorder elige el candidato más largo, así que el cuerpo corrupto ganaba
 * siempre; al reensamblar, las secciones tragadas quedaban duplicadas y cada pasada de
 * dedupe multiplicaba el documento (89k→329k→1M). Este saneo cierra los fences locales del
 * cuerpo y corta en el primer `## N.` ajeno: las secciones tragadas no se pierden — sus
 * headings originales siguen en el texto y el escaneo de candidatos ya las recoge aparte.
 */
function truncateBodyAtEmbeddedCanonicalH2(body: string, ownNum: number | null): string {
  const trimmedBody = (body ?? "").trim();
  if (!trimmedBody || !/^##\s+[1-7]\.\s/m.test(trimmedBody)) return trimmedBody;

  const balanced = closeUnclosedFencesBeforeCanonicalH2(trimmedBody);
  const lines = balanced.split("\n");
  let parity = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (parity === 0) {
      const m = line.match(/^##\s+([1-7])\.\s/);
      if (m && parseInt(m[1]!, 10) !== ownNum) {
        const cut = lines.slice(0, i).join("\n").trimEnd();
        console.warn(
          `[MDD:Dedupe] candidato §${ownNum ?? "?"} tragó §${m[1]} — truncado ${trimmedBody.length}→${cut.length} chars`,
        );
        return cut;
      }
    }
    parity = (parity + (line.match(/```/g) ?? []).length) % 2;
  }
  return balanced === trimmedBody ? trimmedBody : balanced;
}

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

/** H2 ajenos embebidos en §2 (§3/§4 desplazados). No incluye ### 4.x legítimo dentro de §2. */
const MISPLACED_SECTION_H2_IN_STACK_RE =
  /\n##\s*3\.\s*Modelo\s+(?:de\s+)?datos|\n##\s*4\.\s*Contratos\s+de\s+API|\n##\s*4\.\s*Arquitectura\s+Frontend/gi;

function findFirstMisplacedSectionH2OutsideFences(body: string): number {
  const re = new RegExp(MISPLACED_SECTION_H2_IN_STACK_RE.source, "gi");
  let match: RegExpExecArray | null;
  let earliest = -1;
  while ((match = re.exec(body)) !== null) {
    const pos = match.index;
    const before = body.slice(0, pos);
    const fences = (before.match(/```/g) || []).length;
    if (fences % 2 === 0 && (earliest === -1 || pos < earliest)) {
      earliest = pos;
    }
  }
  return earliest;
}

function stripMisplacedMarkdownFencedBlocks(body: string): string {
  return body.replace(/```markdown\s*[\s\S]*?```/gi, (block) =>
    /##\s*[34]\./i.test(block) ? "" : block,
  );
}

/**
 * Limpia §2 con secciones ajenas embebidas: trunca antes de ## 3/## 4 H2 o elimina bloques
 * ```markdown con esas secciones. Nunca borra contenido sustancial a placeholder.
 */
function sanitizeArquitecturaStackBody(body: string): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return "(Pendiente: Arquitecto de Software)";
  if (isMddSectionPipelinePlaceholderBody(trimmed)) return trimmed;

  let cleaned = stripMisplacedMarkdownFencedBlocks(trimmed);
  const cutAt = findFirstMisplacedSectionH2OutsideFences(cleaned);
  if (cutAt >= 0) {
    cleaned = cleaned.slice(0, cutAt).trim();
  }

  if (cleaned.length >= 100 && !isMddSectionPipelinePlaceholderBody(cleaned)) {
    return cleaned;
  }
  if (isMddSectionPipelinePlaceholderBody(trimmed) || trimmed.length < 50) {
    return "(Pendiente: Arquitecto de Software)";
  }
  return cleaned.length > 0 ? cleaned : "(Pendiente: Arquitecto de Software)";
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

const MIN_SECTION5_SUBSTANTIAL_SCORE_LEN = 200;

/** §5 real (no stub de heading BDD/AAA sin cuerpo). */
function isSection5SubstantialBody(body: string): boolean {
  const normalized = (body ?? "").trim();
  if (!normalized || normalized.length < MIN_SECTION5_SUBSTANTIAL_SCORE_LEN) return false;
  if (isMddSectionPipelinePlaceholderBody(normalized)) return false;
  if (normalized === MDD_SECTION5_TAIL_PLACEHOLDER) return false;
  if (/Pendiente:\s*paso dedicado Lógica/i.test(normalized)) return false;
  return true;
}

function scoreSection5Body(body: string): number {
  const normalized = (body ?? "").trim();
  if (!normalized) return 0;
  if (isMddSectionPipelinePlaceholderBody(normalized)) return normalized.length;
  if (normalized === MDD_SECTION5_TAIL_PLACEHOLDER) return normalized.length;
  if (/Pendiente:\s*paso dedicado Lógica/i.test(normalized)) return normalized.length;
  // Stubs cortos con «BDD/AAA» en el heading no deben ganar por bonus semántico (job 97).
  if (!isSection5SubstantialBody(normalized)) return normalized.length;
  const hasBdd = /reglas de negocio|BDD|AAA|edge case|casos borde/i.test(normalized);
  const hasSubsections = /^###/m.test(normalized);
  if (hasBdd || hasSubsections) return 10_000 + normalized.length;
  return 5_000 + normalized.length;
}

function pickBestSection5Candidate(
  candidates: Array<{ heading: string; body: string }>,
): { heading: string; body: string } {
  const substantial = candidates.filter((c) => isSection5SubstantialBody(c.body));
  if (substantial.length > 0) {
    return substantial.reduce((best, cur) => {
      const bestLen = best.body.trim().length;
      const curLen = cur.body.trim().length;
      if (curLen !== bestLen) return curLen > bestLen ? cur : best;
      return scoreSection5Body(cur.body) >= scoreSection5Body(best.body) ? cur : best;
    });
  }
  return candidates.reduce((best, cur) =>
    scoreSection5Body(cur.body) >= scoreSection5Body(best.body) ? cur : best,
  );
}

/** Mejor cuerpo §5 aunque el borrador repita headings (p. ej. stub + versión buena). */
export function extractBestSection5Body(draft: string): string | null {
  const trimmed = (draft ?? "").trim();
  if (!trimmed) return null;
  if (mddHasDuplicateSectionHeadings(trimmed)) {
    const deduped = deduplicateAndReorderMddSections(trimmed);
    return extractSection5Body(deduped);
  }
  return extractSection5Body(trimmed);
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
  if (firstNum === 5) {
    return pickBestSection5Candidate(candidates);
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
/** Rutas `### MÉTODO /ruta` de un cuerpo §4, normalizadas para comparar candidatos solapados. */
function extractContratosRouteKeys(body: string): Set<string> {
  const keys = new Set<string>();
  const re = /^###\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/gim;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(body)) !== null) {
    keys.add(`${m[1]!.toUpperCase()} ${m[2]!.replace(/[),.;]+$/, "").toLowerCase()}`);
  }
  return keys;
}

function mergeDuplicateSectionCandidates(
  candidates: Array<{ heading: string; body: string }>,
  allowSection4Concat = true,
): { heading: string; body: string } {
  if (candidates.length <= 1) return candidates[0]!;
  const best = pickBestMddSectionCandidate(candidates);
  const sectionNum = canonicalSectionNumber(best.heading);
  if (sectionNum !== 4 || !allowSection4Concat) {
    return {
      heading: best.heading,
      body: truncateBodyAtEmbeddedCanonicalH2(best.body, sectionNum),
    };
  }

  const ranked = [...candidates].sort(
    (a, b) => scoreContratosSectionBody(b.body) - scoreContratosSectionBody(a.body),
  );
  const uniqueBodies: string[] = [];
  const keptRoutes = new Set<string>();
  for (const candidate of ranked) {
    let body = truncateBodyAtEmbeddedCanonicalH2(candidate.body.trim(), 4);
    if (!body) continue;
    const sig = body.slice(0, 100);
    if (uniqueBodies.some((existing) => existing.includes(sig) || body.includes(existing.slice(0, 100)))) {
      continue;
    }
    // La firma de 100 chars no detecta copias de §4 que empiezan distinto pero documentan
    // los mismos endpoints (p. ej. varias pasadas de api_contracts). Sin este chequeo cada
    // ronda de dedupe reconcatena §4 y el documento crece geométricamente.
    const routes = extractContratosRouteKeys(body);
    if (routes.size > 0 && [...routes].every((r) => keptRoutes.has(r))) continue;
    for (const r of routes) keptRoutes.add(r);
    uniqueBodies.push(body);
  }
  if (uniqueBodies.length <= 1) return best;
  return { heading: ranked[0]!.heading, body: uniqueBodies.join("\n\n") };
}

/**
 * Reordena el MDD a 1..7 y elimina secciones duplicadas.
 * No parte en ## que estén dentro de bloques ```. Si §2 contiene ## 3/## 4 H2 embebidos, trunca antes de ese H2 (conserva §2 sustancial).
 */
export function deduplicateAndReorderMddSections(draft: string): string {
  // NO recortar por posición antes de reordenar: `stripTrailingDuplicateMddSections` borra todo
  // lo posterior a la primera §7 sin mirar calidad, así que una §5 buena regenerada al final se
  // perdía y sobrevivía el stub de arriba (job 80: gate atascado en "§5 36 chars"). El reorder de
  // abajo ya elige el cuerpo más largo por sección; el recorte queda como último recurso al final.
  let trimmed = closeUnclosedFencesBeforeCanonicalH2((draft || "").trim());
  trimmed = fixGluedSection6Heading(trimmed);
  trimmed = ensureSection6WhenSection7Present(trimmed);
  if (!trimmed) return draft;
  // Evaluar el guard sobre el texto YA recortado, como antes de mover el strip al final: si se
  // calcula sobre el texto completo, `hadDuplicates` se vuelve true más a menudo y puentea la
  // protección `result < 50%`, que es lo único que impide tirar secciones no canónicas
  // (p. ej. el bloque de gobernanza inmutable) cuando el borrador viene degradado.
  const hadDuplicates = mddHasDuplicateSectionHeadings(
    stripTrailingDuplicateMddSections(trimmed),
  );
  // Corregir §6 pegada a ### antes de extraer (evita que extractSection tome "## 6. Seguridad###..." como una sola línea)
  trimmed = trimmed.replace(/(6\.\s*Seguridad)\s*(#{1,6})/gi, "$1\n\n$2");
  const titleMatch = trimmed.match(/^#\s+Master\s+Design\s+Document[^\n]*/i);
  const title = titleMatch ? titleMatch[0] : "# Master Design Document";
  const afterTitle = titleMatch ? trimmed.slice(titleMatch[0].length).replace(/^\s*\n+/, "") : trimmed;
  const withNewline = "\n" + afterTitle;
  const assemble = (allowSection4Concat: boolean): string | null => {
    const sections: Array<{ heading: string; body: string }> = [];
    for (const { pattern } of SECTION_ORDER) {
      const re = /\n(##\s+[^\n]+)/gi;
      let match: RegExpExecArray | null = null;
      const candidates: Array<{ heading: string; body: string }> = [];
      while ((match = re.exec(withNewline)) !== null) {
        const line = match[1];
        if (pattern.test(line)) {
          const { heading: actualHeading, body } = extractSection(withNewline, match.index);
          // Anti-swallow: si el cuerpo extraído contiene el H2 canónico de otra sección
          // (fence impar aguas arriba), truncar antes de puntuar — un candidato que tragó
          // la cola siempre gana por longitud y duplica el documento al reensamblar.
          let bodyToUse = truncateBodyAtEmbeddedCanonicalH2(
            body,
            canonicalSectionNumber(actualHeading),
          );
          if (/^##\s*2\.\s*Arquitectura\s+y\s*Stack/i.test(actualHeading))
            bodyToUse = sanitizeArquitecturaStackBody(bodyToUse);
          candidates.push({ heading: actualHeading, body: bodyToUse });
        }
      }
      if (candidates.length === 0) continue;
      if (candidates.length > 1 && /^##\s+5\.\s*Lógica/i.test(candidates[0]!.heading)) {
        const lengths = candidates.map((c) => c.body.trim().length);
        const picked = mergeDuplicateSectionCandidates(candidates, allowSection4Concat);
        console.warn(
          `[MDD:Dedupe] §5 ${candidates.length} candidatos lens=[${lengths.join(",")}] picked=${picked.body.trim().length}`,
        );
        sections.push(picked);
        continue;
      }
      sections.push(mergeDuplicateSectionCandidates(candidates, allowSection4Concat));
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
    if (orderedSections.length === 0) return null;
    // El `---` separador de la sección siguiente queda absorbido al final del cuerpo; sin quitarlo
    // cada pasada re-añade el suyo y el documento deriva al alza indefinidamente (no idempotente).
    const out = [
      title,
      "",
      ...orderedSections.flatMap((s) => [
        "---",
        s.heading,
        "",
        s.body.replace(/\n*-{3,}\s*$/, "").trimEnd(),
        "",
      ]),
    ];
    return out.join("\n").trim();
  };

  let result = assemble(true);
  if (result === null) return draft;
  // Invariante: deduplicar no puede hacer crecer el documento. El merge por concatenación de §4
  // puede reunir copias solapadas y, al repetirse por pasada del pipeline (formatter → prepare →
  // persist), dispara crecimiento geométrico (89 KB → 237 KB → 681 KB → 2.4 MB observado en job 78).
  // Si crece, rehacer quedándose solo con la mejor §4.
  // El 10% de margen absorbe el overhead de reensamblado (`---`, headings canónicos) en
  // documentos pequeños; la explosión real supera el +150%.
  if (result.length > trimmed.length * 1.1) {
    console.warn(
      `[MDD:Dedupe] inflate trimmed=${trimmed.length} result=${result.length} (>${Math.round(trimmed.length * 1.1)})`,
    );
    const withoutConcat = assemble(false);
    if (withoutConcat !== null && withoutConcat.length < result.length) {
      console.warn(
        `[MDD:Dedupe] inflate retry sin concat §4 result=${withoutConcat.length}`,
      );
      result = withoutConcat;
    }
  }
  // Con duplicados conocidos, forzar dedup aunque el resultado sea mucho más corto.
  if (!hadDuplicates && result.length < trimmed.length * 0.5) return draft;
  result = ensureSection6WhenSection7Present(result);
  if (mddHasDuplicateSectionHeadings(result)) {
    result = stripTrailingDuplicateMddSections(result);
  }
  const outLen = result.length;
  const s4Len = extractSection4Body(result)?.length ?? 0;
  const s5Len = extractSection5Body(result)?.length ?? 0;
  const fenceCount = (result.match(/```/g) ?? []).length;
  console.log(
    `[MDD:Dedupe:diag] in=${trimmed.length} out=${outLen} §4=${s4Len} §5=${s5Len} fences=${fenceCount}${fenceCount % 2 === 1 ? " IMPAR" : ""}`,
  );
  return result;
}
