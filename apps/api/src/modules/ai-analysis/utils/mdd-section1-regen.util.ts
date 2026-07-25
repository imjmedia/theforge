/**
 * @fileoverview Regeneración de contenido de sección 1 del MDD.
 */

import { peelDocumentBodyForPersist, peelTheforgeDocStamp } from "@theforge/shared-types";
import { extractContextSectionBody, isMddSectionPipelinePlaceholderBody } from "./mdd-sanitize/section-merge.js";
import { stripBrdPasteNoiseFromSection1 } from "./mdd-section1-cleanup.util.js";

/** Alineado con DeliveryGate MIN_SECTION_BODY_LENGTH (no-HIGH). */
export const MIN_SECTION1_REGEN_BODY_LENGTH = 200;

const HEADING_FRAGMENT_LINE = /^\s*(?:y|and)\s+alcance\s*(?:del\s+)?mdd\s*\.?\s*$/i;

/** Títulos canónicos que `repairGluedMarkdownHeadings` promovería a `## N.` y partirían §1. */
const BARE_CANONICAL_SECTION_LINE =
  /^\s*(\d+)\.\s+((?:Contexto|Arquitectura(?:\s+y\s*Stack)?|Stack(?:\s+t[eé]cnico)?|Modelo\s+(?:de\s+)?[Dd]atos|Contratos\s+de\s+API|Lógica\s+y\s+Edge\s+Cases|Seguridad|Infraestructura|Integración(?:\s+y\s+DevOps)?|Testing|UI\/UX|Manifest)\b[^\n]*)$/i;

const HASH_CANONICAL_SECTION_LINE =
  /^\s*#{2,6}\s+(\d+)\.\s+((?:Contexto|Arquitectura(?:\s+y\s*Stack)?|Stack(?:\s+t[eé]cnico)?|Modelo\s+(?:de\s+)?[Dd]atos|Contratos\s+de\s+API|Lógica\s+y\s+Edge\s+Cases|Seguridad|Infraestructura|Integración(?:\s+y\s+DevOps)?|Testing|UI\/UX|Manifest)\b[^\n]*)$/i;

/**
 * Evita que líneas tipo `2. Arquitectura y Stack` o `## 2. …` dentro del cuerpo §1
 * se conviertan en H2 reales en prepare (dedupe corta §1 a ~decenas de chars).
 */
export function demoteCanonicalSectionHeadingsInSection1Body(body: string): string {
  return (body ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const bare = line.match(BARE_CANONICAL_SECTION_LINE);
      if (bare) {
        const n = parseInt(bare[1]!, 10);
        if (n >= 2 && n <= 7) return `**${n}. ${bare[2]!.trim()}**`;
      }
      const hashed = line.match(HASH_CANONICAL_SECTION_LINE);
      if (hashed) {
        const n = parseInt(hashed[1]!, 10);
        if (n >= 1 && n <= 7) return `**${n}. ${hashed[2]!.trim()}**`;
      }
      // H2 genérico no canónico también parte dedupe/gate (`\n##\s+`).
      if (/^\s*##\s+/.test(line) && !/^\s*##\s*1\.\s*Contexto\b/i.test(line)) {
        return `**${line.replace(/^\s*#{2,6}\s+/, "").trim()}**`;
      }
      return line;
    })
    .join("\n");
}

function looksLikeFullMddDump(text: string): boolean {
  const t = text.trim();
  if (/^#\s*Master\s+Design\s+Document\b/im.test(t)) return true;
  if (/^##\s*1\.\s*Contexto\b/im.test(t) && /\n##\s+[2-7]\./m.test(t)) return true;
  if (/\n##\s*1\.\s*Contexto\b/im.test(t) && /\n##\s+[2-7]\./m.test(t)) return true;
  return false;
}

/**
 * Peel ligero para respuesta "solo cuerpo §1" del sintetizador.
 * `peelDocumentBodyForPersist` está pensado para MDD completo; sobre prosa corta
 * + residuos de stamp puede dejar basura o HR. Si el LLM volcó el MDD entero,
 * sí usamos peel completo + extract de §1.
 */
export function peelContextSynthesizerLlmOutput(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (looksLikeFullMddDump(trimmed)) {
    return peelDocumentBodyForPersist(trimmed);
  }
  let body = trimmed;
  for (let i = 0; i < 3; i++) {
    const next = peelTheforgeDocStamp(body).body.trim();
    if (!next || next === body) break;
    body = next;
  }
  return body
    .replace(/^#\s*Master\s+Design\s+Document\s*\n+/im, "")
    .trim();
}

function stripSection1Chrome(body: string): string {
  let out = body.trim();
  out = out.replace(/^#\s*Master\s+Design\s+Document\s*\n+/im, "").trim();
  out = out.replace(/^##\s*1\.\s*Contexto(?:\s+y\s+alcance)?\s*\n+/im, "").trim();
  out = out
    .split(/\r?\n/)
    .filter((line) => !HEADING_FRAGMENT_LINE.test(line.trim()))
    .join("\n")
    .replace(/^\s*[\r\n]+/, "")
    .replace(/^```[\w]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  // HR solo / separadores entre secciones no son contenido de §1.
  out = out.replace(/^(?:---|\*\*\*|___)\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  out = out.replace(/^(?:---|\*\*\*|___)\s*\n+/, "").replace(/\n+(?:---|\*\*\*|___)\s*$/, "").trim();
  return out;
}

export type ContextSynthesizerBodyResult = {
  body: string;
  rawLen: number;
  cleanedLen: number;
  truncatedAtOtherSection: boolean;
  fromFullMddDump: boolean;
};

/**
 * Normaliza la salida del sintetizador de §1 a un cuerpo usable para merge.
 * No inventa placeholder largo: si queda vacío, `body` queda "".
 */
export function normalizeContextSynthesizerBody(raw: string): ContextSynthesizerBodyResult {
  const rawLen = (raw ?? "").trim().length;
  const cleanedText = peelContextSynthesizerLlmOutput(raw);
  const fromFullMddDump = looksLikeFullMddDump((raw ?? "").trim());
  let newBody =
    (cleanedText && extractContextSectionBody(cleanedText)) || cleanedText || "";
  let truncatedAtOtherSection = false;
  const firstOtherSection = newBody.search(/(?:^|\n)##\s+(?:2|3|4|5|6|7)[.\s]/);
  if (firstOtherSection !== -1) {
    newBody = newBody.slice(0, firstOtherSection).trim();
    truncatedAtOtherSection = true;
  }
  // H2 genérico (## Actores, ## Objetivos…): corta. No cortar ## 1. Contexto (chrome).
  const anyOtherH2 = newBody.search(/(?:^|\n)##\s+(?!1\.\s*Contexto\b)/i);
  if (anyOtherH2 !== -1) {
    newBody = newBody.slice(0, anyOtherH2).trim();
    truncatedAtOtherSection = true;
  }
  newBody = stripSection1Chrome(newBody);
  newBody = demoteCanonicalSectionHeadingsInSection1Body(newBody);
  newBody = stripBrdPasteNoiseFromSection1(newBody);
  return {
    body: newBody,
    rawLen,
    cleanedLen: newBody.length,
    truncatedAtOtherSection,
    fromFullMddDump,
  };
}

export function isContextSynthesizerBodySubstantial(
  body: string,
  minLength = MIN_SECTION1_REGEN_BODY_LENGTH,
): boolean {
  const b = (body ?? "").trim();
  if (b.length < minLength) return false;
  if (isMddSectionPipelinePlaceholderBody(b)) return false;
  // Solo HR / puntuación
  if (/^(?:[-*_=\s]|---|\*\*\*|___)+$/.test(b)) return false;
  return true;
}

/**
 * Resuelve el cuerpo §1 para upstream-sync a partir de salida Clarifier.
 * Prioriza §1 del `mddDraft` mergeado; no usa dumps markdown crudos (`# …`) como cuerpo.
 * `null` = no hay cuerpo usable (caller debe abortar y preservar §1 previa).
 */
export function resolveUpstreamSyncSection1Body(input: {
  clarifierMddDraft?: string | null;
  clarifiedScope?: string | null;
}): string | null {
  const fromDraft = extractContextSectionBody(input.clarifierMddDraft ?? "");
  if (fromDraft && isContextSynthesizerBodySubstantial(fromDraft)) {
    return fromDraft;
  }

  const scope = (input.clarifiedScope ?? "").trim();
  if (!scope) return null;

  // Dump DBGA/MDD con headings: solo aceptar §1 MDD extraíble y sustancial.
  if (scope.startsWith("#") || /\n##\s+/m.test(scope)) {
    const extracted = extractContextSectionBody(scope);
    if (extracted && isContextSynthesizerBodySubstantial(extracted)) return extracted;
    return null;
  }

  const norm = normalizeContextSynthesizerBody(scope);
  if (isContextSynthesizerBodySubstantial(norm.body)) return norm.body;
  return null;
}
