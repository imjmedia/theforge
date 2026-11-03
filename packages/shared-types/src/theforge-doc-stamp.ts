/**
 * The Forge document timestamp header (creation / last regeneration).
 *
 * Written by API `prependDocumentTimestamps`. Must survive Workshop
 * `formatDocumentMarkdown` / AST `removePreamble`, which otherwise drop
 * everything before the first H1/H2.
 *
 * ```
 * <!-- theforge-doc:created=ISO|updated=ISO -->
 * > 📅 Creado: … · Última regeneración: …
 *
 * ---
 * ```
 */

const META_COMMENT_RE =
  /^<!--\s*theforge-doc:created=([^|]+)\|updated=([^|]+)\s*-->\s*\n?/;

/** Cierre huérfano si falta `<!-- theforge-doc:created=…|updated=` (p. ej. tras formateo parcial). */
const ORPHAN_COMMENT_CLOSE_RE =
  /^[^\n]*(?:\|)?updated=[^\s>]+\s*-->\s*/;

/** Línea humana truncada con ISO y `-->` sin comentario HTML completo. */
const ORPHAN_HUMAN_ISO_CLOSE_RE =
  /^[^\n]*\d{4}-\d{2}-\d{2}T[\d:.+-]+Z\s*-->\s*/;

/**
 * Human line (Creado/… o legacy Generado/…) + separador `---` del stamp.
 * Solo la línea 📅 (sin atravesar el cuerpo): un `\n\n---\n\n` posterior dentro de
 * la sección SSOT de patrones no debe absorberse como cabecera de documento.
 */
const HUMAN_HEADER_WITH_SEP_RE = /^>\s*📅[^\n]*\n\n---\n\n/;

/** Blockquote stamp without `---` (regeneraciones que van directo al H1). */
const HUMAN_BLOCKQUOTE_LINE_RE = /^>\s*📅[^\n]*\n+/;

/** `>> 📅` o `> > 📅` tras residuo `-->` corrupto. */
const MULTI_BLOCKQUOTE_STAMP_RE = /^>+\s*📅[^\n]*(?:\n|$)/;

/** `>> 📅 … --- # Título` pegado en una línea. */
const MULTI_BLOCKQUOTE_GLUE_H1_RE = /^>+\s*📅[^\n]*?\s+---\s+(?=#(?!\#))/;

/** Línea humana sin `>` (stamp pegado al cuerpo). */
const HUMAN_LINE_NO_BLOCKQUOTE_RE = /^📅[^\n]*(?:\n|$)/;

/** `📅 … --- # Título` en una sola línea (no confundir con `--- ##`). */
const HUMAN_GLUE_H1_RE = /^>?\s*📅[^\n]*?\s+---\s+(?=#(?!\#))/;

function stripLeadingHorizontalRuleBeforeHeading(body: string): string {
  return body.replace(/^---\s*(?=#{1,2}\s)/, "").trimStart();
}

/**
 * Convierte `--- ## Sección` pegado en línea (stamp o LLM) en saltos reales de bloque.
 * Típico tras corrupción: `# MDD --- ## 1. Contexto --- ## 2. Stack`.
 */
export function repairInlineHorizontalRuleSectionBreaks(text: string): string {
  if (!text?.trim()) return text;
  let out = text.replace(/\s+---\s+(#{1,6}\s)/g, "\n\n---\n\n$1");
  out = out.replace(/(#{1,6}\s[^\n]+)\s+---\s+(#{1,6}\s)/g, "$1\n\n---\n\n$2");
  return out;
}

/**
 * Título suelto (`Master Design Document`) antes de `---` + H2 → H1.
 * Solo la primera línea del documento (sin flag `m`): un párrafo intermedio seguido de `---` + H2 es prosa,
 * no el título (antes se volvía `# párrafo` y corrompía la jerarquía).
 */
function promoteBareDocumentTitleBeforeH2(body: string): string {
  return body.replace(
    /^([^\n#][^\n]{2,160}?)\n\n---\n\n(##\s)/,
    (full, title: string, h2: string) => {
      const t = title.trim();
      if (/^[-*+]\s/.test(t) || /^\d+\.\s/.test(t)) return full;
      return `# ${t}\n\n---\n\n${h2}`;
    },
  );
}

/** Repara viñetas SSOT promovidas por error a H1 (`# - [X]` → `- [X]`). */
function repairGovernancePatternListHeadings(body: string): string {
  return body.replace(/^#\s+(- \[[ xX]\]\s)/gm, "$1");
}

const STAMP_RESIDUE_MARKERS_RE =
  /📅|theforge-doc:|<!--|\|updated=|Última modificación:|Última regeneración:/;

/** Si quedó basura de stamp, recorta todo lo anterior al primer H1/H2. */
export function stripStampResidueBeforeHeading(body: string): string {
  if (!body.trim()) return body;
  const header = body.match(/^#{1,2}\s+/m);
  if (header?.index != null && header.index > 0) {
    const prefix = body.slice(0, header.index);
    if (STAMP_RESIDUE_MARKERS_RE.test(prefix)) {
      return body.slice(header.index).trimStart();
    }
  }
  return body;
}

/**
 * Recorta prefijo corrupto (stamp + §1–§2 pegados) antes del título canónico del MDD.
 * Último recurso tras `peelTheforgeDocStamp` iterativo.
 */
export function extractCanonicalMddBody(body: string): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return trimmed;
  const head = trimmed.slice(0, 1200);
  if (!STAMP_RESIDUE_MARKERS_RE.test(head)) return trimmed;

  const titleMatch = trimmed.match(/(?:^|\n)(#\s*Master Design Document\b)/im);
  if (titleMatch?.index != null && titleMatch.index > 0) {
    return trimmed.slice(titleMatch.index).trimStart();
  }

  const govMatch = trimmed.match(
    /(?:^|\n)(##\s*\[ARQUITECTURA - SECCIÓN INMUTABLE\])/im,
  );
  if (govMatch?.index != null && govMatch.index > 0) {
    return trimmed.slice(govMatch.index).trimStart();
  }

  const sec1Match = trimmed.match(/(?:^|\n)(##\s*1\.\s[^\n]+)/im);
  if (sec1Match?.index != null && sec1Match.index > 0) {
    return trimmed.slice(sec1Match.index).trimStart();
  }

  // Fallback: solo §2 (regeneración parcial §2–§7 sin §1). Nunca saltar a §3+ — eso elimina §1/§2
  // válidos y deja pasar al gate un MDD que empieza en §3.
  const sec2Match = trimmed.match(/(?:^|\n)(##\s*2\.\s[^\n]+)/im);
  if (sec2Match?.index != null && sec2Match.index > 0) {
    return trimmed.slice(sec2Match.index).trimStart();
  }

  return trimmed;
}

const STAMP_LOCALE = "es-MX";

export type TheforgeDocDateTimeFormatOptions = {
  /** IANA timezone; default `UTC` (API stamp). Web should pass `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  timeZone?: string;
};

function formatTimeZoneSuffix(d: Date, timeZone: string): string {
  if (timeZone === "UTC") return " UTC";
  const parts = new Intl.DateTimeFormat(STAMP_LOCALE, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(d);
  const label = parts.find((p) => p.type === "timeZoneName")?.value;
  return label ? ` ${label}` : ` (${timeZone})`;
}

export type TheforgeDocTimestamps = {
  created: string;
  updated: string;
};

/** ISO timestamps from the HTML comment (machine-readable stamp). */
export function parseTheforgeDocTimestamps(text: string): Partial<TheforgeDocTimestamps> {
  const match = (text ?? "").match(META_COMMENT_RE);
  if (!match) return {};
  const created = match[1]?.trim();
  const updated = match[2]?.trim();
  return {
    ...(created ? { created } : {}),
    ...(updated ? { updated } : {}),
  };
}

/** Human-readable label (seconds). Default UTC for persisted markdown; pass browser TZ in Workshop. */
export function formatTheforgeDocDateTime(
  iso: string,
  options?: TheforgeDocDateTimeFormatOptions,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const timeZone = options?.timeZone ?? "UTC";
  const datePart = d.toLocaleDateString(STAMP_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
  const timePart = d.toLocaleTimeString(STAMP_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  });
  return `${datePart}, ${timePart}${formatTimeZoneSuffix(d, timeZone)}`;
}

export function formatTheforgeDocTimestampsForDisplay(
  raw: Partial<TheforgeDocTimestamps>,
  options?: TheforgeDocDateTimeFormatOptions,
): TheforgeDocTimestamps | null {
  if (!raw.created || !raw.updated) return null;
  return {
    created: formatTheforgeDocDateTime(raw.created, options),
    updated: formatTheforgeDocDateTime(raw.updated, options),
  };
}

export function peelTheforgeDocStamp(text: string): { stamp: string; body: string } {
  if (!text) return { stamp: "", body: text };
  let body = text;
  let stamp = "";

  const meta = body.match(META_COMMENT_RE);
  if (meta?.[0]) {
    stamp += meta[0];
    body = body.slice(meta[0].length);
  }

  const orphanClose = body.match(ORPHAN_COMMENT_CLOSE_RE);
  if (orphanClose?.[0]) {
    stamp += orphanClose[0];
    body = body.slice(orphanClose[0].length);
  }

  const orphanHumanIso = body.match(ORPHAN_HUMAN_ISO_CLOSE_RE);
  if (orphanHumanIso?.[0]) {
    stamp += orphanHumanIso[0];
    body = body.slice(orphanHumanIso[0].length);
  }

  // Fragmento huérfano si el comentario HTML quedó truncado (`--> > 📅 …`).
  if (body.startsWith("-->")) {
    const orphan = body.match(/^-->\s*/);
    if (orphan?.[0]) {
      stamp += orphan[0];
      body = body.slice(orphan[0].length);
    }
  }

  const humanPatterns = [
    HUMAN_HEADER_WITH_SEP_RE,
    HUMAN_GLUE_H1_RE,
    MULTI_BLOCKQUOTE_GLUE_H1_RE,
    /^>\s*📅[^\n]*\n---\s*\n+/,
    /^>\s*📅[^\n]*\s+---\s+/,
    MULTI_BLOCKQUOTE_STAMP_RE,
    HUMAN_BLOCKQUOTE_LINE_RE,
    HUMAN_LINE_NO_BLOCKQUOTE_RE,
  ];
  for (const re of humanPatterns) {
    const human = body.match(re);
    if (human?.[0]) {
      stamp += human[0];
      body = body.slice(human[0].length);
      break;
    }
  }

  body = body.replace(/^---\s*\n+/, "");
  body = stripLeadingHorizontalRuleBeforeHeading(body);
  body = stripStampResidueBeforeHeading(body);
  body = repairInlineHorizontalRuleSectionBreaks(body);
  body = promoteBareDocumentTitleBeforeH2(body);
  body = repairGovernancePatternListHeadings(body);
  body = body.trimStart();

  return { stamp, body };
}

/** Quita stamp(s) corruptos o duplicados hasta dejar solo el cuerpo del documento. */
export function peelDocumentBodyForPersist(text: string): string {
  let body = (text ?? "").trim();
  if (!body) return body;
  for (let i = 0; i < 4; i++) {
    const next = peelTheforgeDocStamp(body).body.trim();
    if (!next || next === body) break;
    body = next;
  }
  // Reparar `--- ##` pegado antes de extractCanonicalMddBody para que los headings §2–§7
  // sean detectables tras residuo de stamp (típico al regenerar secciones sin §1).
  body = repairInlineHorizontalRuleSectionBreaks(body);
  body = extractCanonicalMddBody(body);
  body = repairInlineHorizontalRuleSectionBreaks(body);
  body = promoteBareDocumentTitleBeforeH2(body);
  body = repairGovernancePatternListHeadings(body);
  return body.trim();
}

/** Stamp pegado al cuerpo o headings `--- ##` en la misma línea (zona de fechas / §1–§2). */
export function mddMarkdownNeedsStructuralRepair(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return false;
  if (/[^\n\r]---\s+#{1,6}\s/.test(raw)) return true;
  if (/^#{1,2}\s[^\n]*---\s+#{1,6}\s/m.test(raw)) return true;
  if (STAMP_RESIDUE_MARKERS_RE.test(raw.slice(0, 2000))) {
    return peelDocumentBodyForPersist(raw) !== raw;
  }
  return false;
}

/** Corrupción de formato §4 / headings que el pipeline determinista debe corregir. */
export function mddMarkdownHasKnownFormatCorruption(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return false;
  if (/^#\s+_/m.test(raw)) return true;
  if (/\n```\s*\n\n\*\*(?:Request body|Response\s+\d+)/i.test(raw)) return true;
  const jsonClosedBefore = /```json[\s\S]*?}\s*\n```/;
  if (/```json\n[\s\S]*?\n\*\*(?:Request body|Response\s+\d+)/i.test(raw)) {
    if (!jsonClosedBefore.test(raw)) return true;
  }
  if (/```json\n[\s\S]*?\n###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/i.test(raw)) {
    if (!/```json[\s\S]*?}\s*\n```[\s\S]*?\n###\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/m.test(raw)) {
      return true;
    }
  }
  if (/[^\n]\n##\s+(?:[1-7]\.|UI\/UX\s+Design\s+Intent)/.test(raw)) return true;
  return false;
}

export function reattachTheforgeDocStamp(stamp: string, body: string): string {
  if (!stamp) return body;
  if (!body) return stamp.replace(/\n+$/, "\n");
  return stamp + body.replace(/^\n+/, "");
}
