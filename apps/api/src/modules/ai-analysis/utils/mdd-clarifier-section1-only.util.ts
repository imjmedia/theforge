/**
 * @fileoverview Modo §1-only del Clarificador: pedir sólo lo que se va a usar.
 *
 * Por qué existe: cuando el borrador ya es sustancial, el nodo mergea **sólo §1**
 * y preserva §2–§7 del baseline (`mdd-clarifier.node.ts`, rama `hasSubstantialDraft`).
 * Aun así el prompt enviaba hasta 14k chars de borrador y pedía el documento
 * completo, así que el modelo generaba ~12k chars de los que se descartaban ~10k:
 * coste y latencia por trabajo tirado, y §1 peor porque el modelo repartía
 * atención entre siete secciones.
 *
 * En §1-only se manda §1 + un índice de los encabezados existentes (para que no
 * duplique ni contradiga §2–§7) y se pide sólo §1. La salida se reinyecta en el
 * borrador previo, de modo que el resto del nodo sigue trabajando sobre un
 * documento completo y no cambia ninguna rama posterior.
 */

import {
  extractContextSectionBody,
  replaceSection1BodyFromAnyHeading,
} from "./mdd-sanitize/section-merge.js";

/** Longitud máxima de §1 previa que se reinyecta en el prompt. */
const MAX_SECTION1_CONTEXT_CHARS = 6_000;

/** Chars por encabezado en el índice de §2–§7 (título + primera línea). */
const OUTLINE_LINE_CHARS = 160;

/** Delimitadores de salida: evitan escapar el markdown dentro de un string JSON. */
export const CLARIFIER_SCOPE_MARKER = "===CLARIFIED_SCOPE===";
export const CLARIFIER_SECTION1_MARKER = "===SECTION_1===";
export const CLARIFIER_DRAFT_MARKER = "===MDD_DRAFT===";

/** Índice compacto de encabezados `##`/`###` con su primera línea de cuerpo. */
export function buildDraftOutline(draft: string, maxChars = 2_500): string {
  const lines = (draft ?? "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (!heading) continue;
    const level = heading[1]!.length;
    const title = heading[2]!.trim();
    const firstBody =
      lines
        .slice(i + 1, i + 8)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !/^#{1,6}\s/.test(l) && !/^```/.test(l)) ?? "";
    const summary = firstBody.replace(/\*\*/g, "").slice(0, OUTLINE_LINE_CHARS);
    out.push(`${"  ".repeat(level - 2)}- ${title}${summary ? ` — ${summary}` : ""}`);
  }
  const joined = out.join("\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) + "\n- …(índice truncado)" : joined;
}

/**
 * §1-only sólo es seguro si podemos volver a inyectar el resultado en el
 * borrador previo; si §1 no es localizable, se usa el modo documento completo.
 */
export function canUseSection1OnlyMode(draftTrimmed: string, hasSubstantialDraft: boolean): boolean {
  if (!hasSubstantialDraft) return false;
  const trimmed = (draftTrimmed ?? "").trim();
  if (trimmed.length < 200) return false;
  const probe = replaceSection1BodyFromAnyHeading(trimmed, "__probe__");
  return probe !== trimmed && probe.includes("__probe__");
}

/** Contexto acotado para §1-only: §1 actual + índice del resto del documento. */
export function buildSection1OnlyPromptBlock(draftTrimmed: string): string {
  const section1 = (extractContextSectionBody(draftTrimmed) ?? "").trim();
  const section1Block = section1
    ? section1.length > MAX_SECTION1_CONTEXT_CHARS
      ? section1.slice(0, MAX_SECTION1_CONTEXT_CHARS) + "\n\n…(truncada)"
      : section1
    : "(vacía)";
  const outline = buildDraftOutline(draftTrimmed);

  return [
    "",
    "---",
    "**MODO SECCIÓN 1 (alcance acotado).** El resto del MDD (§2–§7) ya está escrito y **no** debes reescribirlo ni devolverlo: el sistema lo conserva intacto. Tu única salida de documento es el cuerpo de **## 1. Contexto**.",
    "",
    "**§1 actual (refínala; no la reemplaces por un resumen más corto):**",
    section1Block,
    "",
    "**Índice del resto del documento (para coherencia; NO lo reescribas ni lo dupliques en §1):**",
    outline || "(sin encabezados)",
  ].join("\n");
}

/**
 * Formato de salida delimitado. Va **al final** del prompt (última instrucción =
 * la que mejor siguen los modelos) y sustituye al envoltorio JSON: meter el MDD
 * markdown dentro de un string JSON obligaba a escapar miles de `\n` y comillas,
 * lo que gastaba tokens de salida y provocaba el reintento por JSON inválido.
 */
export function buildClarifierFormatBlock(mode: "section1-only" | "full"): string {
  const common = [
    "",
    "---",
    "**FORMATO DE SALIDA OBLIGATORIO** — texto plano con estos delimitadores exactos, cada uno solo en su línea. Sin JSON, sin ```json, sin texto fuera de los bloques. Escribe markdown real (saltos de línea reales, no `\\n` escapados).",
    "",
  ];
  if (mode === "section1-only") {
    return [
      ...common,
      CLARIFIER_SCOPE_MARKER,
      "(clarifiedScope aquí: entidades, capacidades, decisiones validadas y a qué secciones afectan)",
      CLARIFIER_SECTION1_MARKER,
      "(markdown del cuerpo de §1 aquí, sin el encabezado `## 1. Contexto`)",
      "",
      "No emitas ningún otro encabezado `## N.` — §2–§7 se conservan intactas.",
    ].join("\n");
  }
  return [
    ...common,
    CLARIFIER_SCOPE_MARKER,
    "(clarifiedScope aquí)",
    CLARIFIER_DRAFT_MARKER,
    "(documento MDD completo en markdown aquí, empezando por `# Master Design Document`)",
  ].join("\n");
}

export type ClarifierDelimitedOutput = {
  clarifiedScope: string;
  /** Documento completo (modo full) o `null` en modo §1-only. */
  mddDraft: string | null;
  /** Cuerpo de §1 (modo §1-only) o `null`. */
  section1Body: string | null;
};

function sliceBetween(text: string, startMarker: string, endMarkers: string[]): string | null {
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const from = start + startMarker.length;
  let end = text.length;
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker, from);
    if (idx >= 0 && idx < end) end = idx;
  }
  return text.slice(from, end).trim();
}

/**
 * Parsea la salida delimitada. Devuelve `null` si no hay ningún delimitador,
 * para que el caller caiga al parser JSON histórico (modelos que ignoran el formato).
 */
export function parseClarifierDelimitedOutput(text: string): ClarifierDelimitedOutput | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const hasScope = raw.includes(CLARIFIER_SCOPE_MARKER);
  const hasSection1 = raw.includes(CLARIFIER_SECTION1_MARKER);
  const hasDraft = raw.includes(CLARIFIER_DRAFT_MARKER);
  if (!hasScope && !hasSection1 && !hasDraft) return null;

  const allMarkers = [CLARIFIER_SCOPE_MARKER, CLARIFIER_SECTION1_MARKER, CLARIFIER_DRAFT_MARKER];
  const scope = hasScope
    ? sliceBetween(raw, CLARIFIER_SCOPE_MARKER, [CLARIFIER_SECTION1_MARKER, CLARIFIER_DRAFT_MARKER])
    : null;
  const section1 = hasSection1
    ? sliceBetween(raw, CLARIFIER_SECTION1_MARKER, allMarkers.filter((m) => m !== CLARIFIER_SECTION1_MARKER))
    : null;
  const draft = hasDraft
    ? sliceBetween(raw, CLARIFIER_DRAFT_MARKER, allMarkers.filter((m) => m !== CLARIFIER_DRAFT_MARKER))
    : null;

  if (!scope && !section1 && !draft) return null;
  return {
    clarifiedScope: scope ?? "",
    mddDraft: draft && draft.length > 0 ? draft : null,
    section1Body: section1 && section1.length > 0 ? section1 : null,
  };
}

/** Umbral mínimo para aceptar una §1 generada en modo acotado. */
export const MIN_SECTION1_ONLY_BODY_LEN = 200;

/**
 * Reinyecta la §1 generada en el borrador previo, devolviendo un documento
 * completo equivalente al que produciría el modo full. `null` si la §1 es
 * insustancial o no se pudo insertar (el caller preserva el borrador previo).
 */
export function applySection1OnlyResult(
  previousDraft: string,
  section1Body: string,
): string | null {
  const body = (section1Body ?? "").trim().replace(/^##\s*1\.\s*Contexto[^\n]*\n+/i, "").trim();
  if (body.length < MIN_SECTION1_ONLY_BODY_LEN) return null;
  const merged = replaceSection1BodyFromAnyHeading((previousDraft ?? "").trim(), body);
  if (!merged || merged === previousDraft.trim()) return null;
  return merged;
}
