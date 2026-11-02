/**
 * Extracción fence-aware de cuerpos H2 (§1–§7).
 * Evita cortar secciones en `##` dentro de bloques ``` o en subheadings `###`.
 */

/**
 * Primer match de `pattern` que es un heading H2 real: a principio de línea, no parte de un
 * `###…` más largo, y fuera de bloques ```.
 */
export function findH2HeadingMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) {
    const i = m.index;
    if (i > 0 && text[i - 1] !== "\n") {
      if (re.lastIndex === m.index) re.lastIndex++;
      continue;
    }
    if ((text.slice(0, i).match(/```/g) ?? []).length % 2 === 0) return m;
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return null;
}

/** Índice del siguiente ## que NO está dentro de un bloque con fences (```...```). */
export function indexOfNextH2OutsideFenced(text: string, fromIndex: number): number {
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

const CANONICAL_H2_RE = /^##\s+(?:[1-7]\.|UI\/UX)/i;

/** Heading H2 canónico §5 (acepta Logica/Lógica y variantes de casing). */
export const RE_SECTION5_H2 = /##\s*5\.\s*L[oó]gica\s+y\s*Edge\s*Cases/i;

/**
 * Cierra todo fence abierto que se tragaría un H2 canónico (§1–§7, UI/UX).
 *
 * Dos regresiones con la misma causa:
 * - job 84: fence ```sql de §3 sin cerrar ⇒ `getSectionBody(§3)` no encuentra H2 de cierre y
 *   devuelve el resto del documento; el `replace` posterior sepulta §4–§7 dentro de §3.
 * - job 85: fence ```json de §4 sin cerrar ⇒ §5 (extractor fence-aware) mide 0 mientras §6/§7
 *   siguen visibles, y `PersistCheck` tumba el job con «§5 pre=999 post=0».
 *
 * Más agresivo que `closeUnclosedCodeFencesInDraft`: no depende del lenguaje declarado en el
 * fence ni de un lookahead concreto. Idempotente.
 */
export function closeUnclosedFencesBeforeCanonicalH2(draft: string): string {
  const text = draft ?? "";
  if (!text.trim()) return text;

  const out: string[] = [];
  let parity = 0;
  for (const line of text.split("\n")) {
    if (parity === 1 && CANONICAL_H2_RE.test(line)) {
      out.push("```", "");
      parity = 0;
    }
    out.push(line);
    parity = (parity + (line.match(/```/g) ?? []).length) % 2;
  }
  return out.join("\n");
}

/**
 * Cierra un fence ``` abierto al final del documento (paridad impar global).
 *
 * Complementa {@link closeUnclosedFencesBeforeCanonicalH2}: cuando el bloque abierto está en
 * la cola (§4/§7 manifest) y no hay H2 canónico detrás, el gate detecta
 * «Documento truncado: fence ``` sin cerrar al final» (job 98). Idempotente.
 */
export function closeTrailingUnclosedFences(draft: string): string {
  const text = draft ?? "";
  if (!text.trim()) return text;
  const fenceCount = (text.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 0) return text;
  return `${text.trimEnd()}\n\`\`\`\n`;
}

/** Cierra fences antes de H2 canónico y al EOF. Idempotente. */
export function ensureDocumentFenceParity(draft: string): string {
  return closeTrailingUnclosedFences(closeUnclosedFencesBeforeCanonicalH2(draft ?? ""));
}

/** @deprecated usa {@link closeUnclosedFencesBeforeCanonicalH2} (cubre §1–§7, no solo §3). */
export function closeSection3FenceBeforeNextCanonicalH2(draft: string): string {
  return closeUnclosedFencesBeforeCanonicalH2(draft);
}

/** H1 de una línea (`# …`). */
const RE_H1_LINE = /^#(?!#)(?=\s|$)/;
/** H2 de una línea (`## …`; un `###` no es H2). */
const RE_H2_LINE = /^##(?!#)(?=\s|$)/;
/** H2 con número entero al inicio: `## 3. …`, `## 3.1 …`, `## 3 …`, `## 3) …`. */
const RE_H2_INTEGER_NUMBER = /^##[ \t]+(\d+)(?!\d)/;
/** Subencabezado `## N.M …` (sub-sección de la misma sección N). */
const RE_H2_SUBSECTION = /^##[ \t]+\d+\.\d/;

/**
 * Número entero de un heading H2 (`## 3. …`, `## 3.1 …` → 3). `null` si no lleva número
 * (`## Seguridad`).
 */
function numberOfH2Heading(heading: string): number | null {
  const m = /^\s*##[ \t]+(\d+)(?!\d)/.exec(heading ?? "");
  return m ? parseInt(m[1]!, 10) : null;
}

/**
 * ¿La línea abre un heading que cierra la sección `n` (entero)? No considera fences.
 * Cierra: `# ` (H1), `## Título` sin número, `## K.` con K !== n, y un `## n.` repetido.
 * No cierra: `## n.M …` (subencabezado de la misma sección).
 */
function isSectionBoundaryLine(line: string, n: number): boolean {
  if (RE_H1_LINE.test(line)) return true;
  if (!RE_H2_LINE.test(line)) return false;
  const numbered = RE_H2_INTEGER_NUMBER.exec(line);
  if (!numbered) return true;
  if (parseInt(numbered[1]!, 10) !== n) return true;
  return !RE_H2_SUBSECTION.test(line);
}

/**
 * Índice (absoluto en `draft`) del `\n` que precede al siguiente heading que cierra la sección
 * `n`, o -1 si no hay frontera. Fence-aware: los headings dentro de bloques ``` se ignoran.
 *
 * Con `n` = null (heading sin número) se comporta exactamente como
 * {@link indexOfNextH2OutsideFenced}: cualquier `## ` cierra la sección.
 */
export function indexOfNextSectionBoundaryOutsideFenced(
  draft: string,
  fromIndex: number,
  n: number | null,
): number {
  if (n == null) return indexOfNextH2OutsideFenced(draft, fromIndex);
  const text = draft ?? "";
  let insideFence = (text.slice(0, fromIndex).match(/```/g) ?? []).length % 2 === 1;
  let offset = fromIndex;
  const lines = text.slice(fromIndex).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    // i = 0 es el resto de la línea del heading propio: nunca es frontera.
    if (i > 0 && !insideFence && isSectionBoundaryLine(line, n)) return offset - 1;
    if ((line.match(/```/g) ?? []).length % 2 === 1) insideFence = !insideFence;
    offset += line.length + 1;
  }
  return -1;
}

/**
 * Extrae cuerpo de sección H2 (sin heading) hasta la siguiente frontera de sección
 * ({@link indexOfNextSectionBoundaryOutsideFenced}) o fin. El número de sección se infiere del
 * heading que casa con `pattern`, así que los subencabezados `## N.M` (p. ej. `## 3.1 Esquema SQL`)
 * quedan dentro del cuerpo. Si el heading no lleva número, se comporta como antes.
 */
export function getSectionBody(draft: string, pattern: RegExp): string | null {
  const trimmed = (draft ?? "").trim();
  const match = findH2HeadingMatch(trimmed, pattern);
  if (!match || match.index == null) return null;
  const headingEnd = match.index + match[0].length;
  const nextBoundary = indexOfNextSectionBoundaryOutsideFenced(
    trimmed,
    headingEnd,
    numberOfH2Heading(match[0]),
  );
  const bodyEnd = nextBoundary !== -1 ? nextBoundary : trimmed.length;
  const body = trimmed.slice(headingEnd, bodyEnd).replace(/^\s*\n+/, "").trim();
  return body.length > 0 ? body : null;
}
