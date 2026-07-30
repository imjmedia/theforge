/**
 * @fileoverview Nodo arquitecto de seguridad — genera especificaciones de seguridad.
 */

import { z } from "zod";
import type { MddSeguridadItem } from "../state/mdd-structured.schema.js";
import { mddSeguridadItemSchema } from "../state/mdd-structured.schema.js";
import {
  getSection6Or7Range,
  isMddSectionPipelinePlaceholderBody,
  jsonSectionToMarkdown,
  unbulletAndJoinForJson,
} from "./mdd-sanitize.js";
import {
  extractFirstJsonObject,
  parseJsonOrThrow,
  repairTruncatedJsonObject,
} from "./parse-json.js";

export { repairTruncatedJsonObject };

function coerceStringArray(value: unknown): string[] {
  return flattenSecurityContentValue(value);
}

/** Aplana content anidado (heading/details, objetos en array) a strings legibles. */
function flattenSecurityContentValue(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenSecurityContentValue(entry));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const heading = [obj.title, obj.heading].find((h) => typeof h === "string" && h.trim()) as
      | string
      | undefined;
    const nested = obj.content ?? obj.details ?? obj.text ?? obj.body;
    if (nested != null) {
      const lines = flattenSecurityContentValue(nested);
      if (heading?.trim() && lines.length) {
        return [`**${heading.trim()}:** ${lines[0]}`, ...lines.slice(1)];
      }
      if (lines.length) return lines;
    }
    if (heading?.trim()) return [heading.trim()];
    return [JSON.stringify(value, null, 2)];
  }
  const s = String(value).trim();
  return s ? [s] : [];
}

function hasSubstantialSeguridadItems(items: MddSeguridadItem[]): boolean {
  return items.some((item) => {
    const body = (item.content ?? []).join(" ").trim();
    return body.length >= 20 && !/^(fragment|pending|placeholder)/i.test(body);
  });
}

/** Acepta variantes DeepSeek/legacy: content string, heading/details, fences ```json. */
const securityStructuredRawSchema = z.object({
  seguridad: z.array(
    z.object({
      title: z.string().optional(),
      heading: z.string().optional(),
      content: z
        .union([z.array(z.string()), z.string(), z.record(z.unknown()), z.array(z.unknown())])
        .optional(),
      details: z
        .union([z.array(z.string()), z.string(), z.record(z.unknown()), z.array(z.unknown())])
        .optional(),
    }),
  ),
});

function normalizeSeguridadStructuredRaw(
  raw: z.infer<typeof securityStructuredRawSchema>,
): MddSeguridadItem[] {
  return raw.seguridad.map((item) => {
    const rawTitle = (item.title ?? item.heading ?? "Seguridad").trim();
    const title = rawTitle.replace(/^\d+(?:\.\d+)+\.\s*/, "").trim() || rawTitle;
    const content = coerceStringArray(item.content ?? item.details ?? []);
    return mddSeguridadItemSchema.parse({
      title,
      content: content.length ? content : ["(Pendiente de definir.)"],
    });
  });
}

const legacySecurityOutputSchema = z.object({
  securitySection: z
    .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
    .transform((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const obj = x as Record<string, unknown>;
        const key = ["content", "text", "section", "securitySection"].find((k) => typeof obj[k] === "string");
        if (key) return String(obj[key]);
      }
      return typeof x === "object" ? JSON.stringify(x, null, 2) : String(x);
    })
    .pipe(z.string()),
});

/** Patrones típicos de salida corrupta del LLM (thinking, placeholders, JSON a medias). */
export const CORRUPTED_SECURITY_TEXT_PATTERNS: RegExp[] = [
  /\bplaceholder\b/i,
  /\bwill\s+rewrite\b/i,
  /\b(?:todo|tbd)\s*:\s*rewrite/i,
  /<\s*think(?:ing)?\s*>/i,
  /\bthinking\s*:/i,
  /\bhere'?s\s+my\s+thinking\b/i,
  /^\s*\{\s*$/m,
  /^\s*-\s*"\w+"\s*:/m,
];

function lineLooksLikeJsonFragment(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^[\{\}\[\],":]+$/.test(t)) return true;
  if (/^-\s*[\{\["]/.test(t)) return true;
  if (/^"[^"]+"\s*:\s*/.test(t)) return true;
  if (t.startsWith("{") && t.includes('"')) return true;
  return false;
}

/** Detecta texto LLM que no debe usarse como §6 ni como slice estructurado. */
export function isCorruptedSecurityLlmText(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (CORRUPTED_SECURITY_TEXT_PATTERNS.some((re) => re.test(t))) return true;
  const jsonishLineCount = t.split(/\n/).filter((line) => lineLooksLikeJsonFragment(line)).length;
  const lineCount = t.split(/\n/).filter((l) => l.trim()).length;
  if (lineCount >= 4 && jsonishLineCount / lineCount > 0.35) {
    if (t.startsWith("{")) {
      try {
        const extracted = extractFirstJsonObject(t) ?? t;
        const parsed = JSON.parse(extracted) as unknown;
        if (securityStructuredRawSchema.safeParse(parsed).success) return false;
      } catch {
        /* sigue evaluación heurística */
      }
    }
    return true;
  }
  if (t.startsWith("{")) {
    try {
      const extracted = extractFirstJsonObject(t) ?? t;
      const parsed = JSON.parse(extracted) as unknown;
      if (!securityStructuredRawSchema.safeParse(parsed).success && /placeholder|will\s+rewrite|thinking/i.test(t)) {
        return true;
      }
    } catch {
      if (/placeholder|will\s+rewrite|thinking/i.test(t)) return true;
    }
  }
  return false;
}

/** Detecta items de seguridad ya mergeados que siguen siendo basura. */
export function isCorruptedSeguridadSlice(seguridad: MddSeguridadItem[] | undefined | null): boolean {
  if (!seguridad?.length) return false;
  const combined = seguridad
    .map((i) => `${i.title}\n${(i.content ?? []).join("\n")}`)
    .join("\n");
  if (isCorruptedSecurityLlmText(combined)) return true;
  let jsonish = 0;
  let total = 0;
  for (const item of seguridad) {
    if (lineLooksLikeJsonFragment(item.title)) jsonish++;
    total++;
    for (const line of item.content ?? []) {
      total++;
      if (lineLooksLikeJsonFragment(line)) jsonish++;
    }
  }
  if (total >= 3 && jsonish / total > 0.4) return true;
  if (seguridad.length === 1) {
    const only = seguridad[0]!;
    const body = (only.content ?? []).join("\n").trim();
    // Solo JSON crudo sin parsear (1 línea); items multi-viñeta legibles no son corruptos.
    if (
      body.startsWith("{") &&
      body.includes('"seguridad"') &&
      body.length < 4000 &&
      !body.includes("\n- ") &&
      !body.includes("\n###")
    ) {
      return true;
    }
  }
  return false;
}

/** Elimina líneas basura; devuelve null si no queda contenido útil. */
export function sanitizeSeguridadItems(
  items: MddSeguridadItem[],
): MddSeguridadItem[] | null {
  const out: MddSeguridadItem[] = [];
  for (const item of items) {
    const title = (item.title ?? "")
      .replace(/^#+\s*/, "")
      .replace(/^\d+\.\d*\s*/, "")
      .trim();
    if (!title || lineLooksLikeJsonFragment(title)) continue;
    if (CORRUPTED_SECURITY_TEXT_PATTERNS.some((re) => re.test(title))) continue;
    const content = (item.content ?? [])
      .map((c) => c.replace(/^#+\s*/, "").replace(/^-\s*/, "").trim())
      .filter((c) => c.length > 0)
      .filter((c) => !lineLooksLikeJsonFragment(c) || c.length > 80)
      .filter((c) => !CORRUPTED_SECURITY_TEXT_PATTERNS.some((re) => re.test(c)));
    if (content.length) out.push(mddSeguridadItemSchema.parse({ title, content }));
  }
  if (!out.length) return null;
  if (out.length === 1) {
    const only = out[0]!;
    const body = (only.content ?? []).join(" ").trim();
    if (
      /^seguridad$/i.test(only.title) &&
      (body.length < 40 || /^(fragment|pending|placeholder)/i.test(body))
    ) {
      return null;
    }
  }
  return out;
}

function markdownSeguridadToItems(md: string): MddSeguridadItem[] {
  const withoutH2 = md.replace(/^##\s*(?:6\.\s+)?Seguridad\s*/i, "").trim();
  const blocks = withoutH2.split(/\n###\s+/);
  const items: MddSeguridadItem[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const title = lines[0] ?? "Seguridad";
    const content: string[] = [];
    for (let j = 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.startsWith("- ")) content.push(line.slice(2).trim());
      else if (line) content.push(line);
    }
    items.push(mddSeguridadItemSchema.parse({ title, content: content.length ? content : [trimmed] }));
  }
  if (items.length === 0) {
    items.push(mddSeguridadItemSchema.parse({ title: "Seguridad", content: ["(Pendiente de definir.)"] }));
  }
  return items;
}

function markdownToSeguridadItem(md: string): MddSeguridadItem {
  const trimmed = md.replace(/^##\s*(?:6\.\s+)?Seguridad\s*/i, "").trim();
  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const content: string[] = [];
  for (const line of lines) {
    if (line.startsWith("###")) content.push(line.replace(/^###\s*/, "").trim());
    else if (line.startsWith("- ")) content.push(line.slice(2).trim());
    else content.push(line);
  }
  if (content.length === 0) content.push(trimmed || "(Pendiente de definir.)");
  return mddSeguridadItemSchema.parse({ title: "Seguridad", content });
}

function tryStructuredJson(text: string): MddSeguridadItem[] | null {
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/gim, "").trim();
  const jsonStr = extractFirstJsonObject(stripped) ?? (stripped.startsWith("{") ? stripped : null);
  if (!jsonStr?.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr) as unknown;
  } catch {
    const repaired = repairTruncatedJsonObject(jsonStr);
    if (!repaired) return null;
    try {
      parsed = JSON.parse(repaired) as unknown;
    } catch {
      return null;
    }
  }
  const safe = securityStructuredRawSchema.safeParse(parsed);
  if (!safe.success) return null;
  return normalizeSeguridadStructuredRaw(safe.data);
}

/** Fallback: extrae `{ seguridad: [...] }` del texto crudo cuando el parse principal falló. */
export function recoverSeguridadItemsFromRawLlmText(text: string): MddSeguridadItem[] | null {
  const trimmed = stripThinkingTags(text);
  if (!trimmed) return null;
  const structured = tryStructuredJson(trimmed);
  if (structured?.length) {
    const sanitized = sanitizeSeguridadItems(structured);
    const items = sanitized?.length ? sanitized : structured;
    if (hasSubstantialSeguridadItems(items) && !isCorruptedSeguridadSlice(items)) return items;
    if (hasSubstantialSeguridadItems(items)) return items;
  }
  const legacySection = tryLegacyJson(trimmed);
  if (legacySection) {
    const fromLegacy = tryMarkdownSection(
      legacySection.startsWith("##") ? legacySection : `## Seguridad\n\n${legacySection}`,
    );
    if (fromLegacy) return fromLegacy;
  }
  return null;
}

function tryLegacyJson(text: string): string | null {
  try {
    const legacy = parseJsonOrThrow(text, legacySecurityOutputSchema);
    return String(legacy.securitySection ?? "").trim() || null;
  } catch {
    return null;
  }
}

function tryMarkdownSection(text: string): MddSeguridadItem[] | null {
  let section = text.replace(/^```(?:markdown|json)?\s*|\s*```$/gim, "").trim();
  if (!section) return null;
  if (isCorruptedSecurityLlmText(section)) return null;
  if (!section.startsWith("##")) section = "## Seguridad\n\n" + section;
  const trimmedSection = section.trim();
  const looksLikeJson =
    trimmedSection.startsWith("{") ||
    trimmedSection.includes('"6. Seguridad"') ||
    trimmedSection.includes('"6.1');
  if (looksLikeJson) {
    const jsonCandidate = trimmedSection.startsWith("{")
      ? trimmedSection
      : unbulletAndJoinForJson(trimmedSection);
    const markdown = jsonSectionToMarkdown(jsonCandidate, "Seguridad");
    if (markdown === jsonCandidate) return null;
    section = markdown;
  }
  const items =
    section.includes("\n###") || /^###/m.test(section)
      ? markdownSeguridadToItems(section)
      : [markdownToSeguridadItem(section)];
  const sanitized = sanitizeSeguridadItems(items);
  if (!sanitized || isCorruptedSeguridadSlice(sanitized)) return null;
  return sanitized;
}

/** True cuando el slice es solo el placeholder de §6 vacía. */
export function isPlaceholderSeguridad(items: MddSeguridadItem[] | undefined | null): boolean {
  if (!items?.length) return true;
  if (items.length > 1) return false;
  const only = items[0]!;
  const body = [...(only.content ?? []), only.title ?? ""].join(" ").trim();
  return body.length < 120 && /\(Pendiente/i.test(body);
}

/**
 * Extrae items de §6 desde el borrador (p. ej. cuando el LLM falló pero el draft ya tenía contenido).
 * Si el markdown canónico no parsea, conserva el cuerpo como un único bloque.
 */
export function seguridadItemsFromDraftSection6(draft: string): MddSeguridadItem[] | null {
  const trimmed = (draft ?? "").trim();
  const range = getSection6Or7Range(trimmed, 6);
  if (!range) return null;
  const bodyStart = range.start + range.heading.length;
  const body = trimmed.slice(bodyStart, range.end).replace(/^\s*\n+/, "").trim();
  if (body.length < 15 || isMddSectionPipelinePlaceholderBody(body)) return null;
  const parsed = parseSecurityLlmResponse(`## 6. Seguridad\n\n${body}`);
  if (parsed?.length && !isCorruptedSeguridadSlice(parsed) && !isPlaceholderSeguridad(parsed)) {
    return parsed;
  }
  if (isMddSectionPipelinePlaceholderBody(body)) return null;
  return [mddSeguridadItemSchema.parse({ title: "Aspectos generales", content: [body] })];
}

/** True si el borrador ya tiene §6 con contenido real (no placeholder del arquitecto). */
export function draftHasPreservableSection6(draft: string): boolean {
  return !!seguridadItemsFromDraftSection6(draft);
}

/**
 * Parsea la respuesta del LLM de Security a items estructurados.
 * Devuelve null si no hay JSON/markdown válido o si la salida parece corrupta.
 */
/**
 * Strips reasoning/thinking blocks emitted by models:
 * - <think>…</think> / <thinking>…</thinking> (HTML-style)
 * - ```think …``` / ```thinking …``` (Markdown-fenced)
 * - ``` …``` (generic fenced block containing "think")
 * Also normalizes extra blank lines left after stripping.
 */
export function stripThinkingTags(text: string): string {
  let result = (text ?? "")
    // HTML-style think/thinking tags
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, "")
    // Markdown-fenced think blocks (```think ... ``` or ```thinking ... ```)
    .replace(/```think(?:ing)?\s*\n[\s\S]*?\n```\s*/gi, "")
    // Generic fenced code blocks that contain "think"
    .replace(/```[\s\S]*?\b(?:think|thought|reasoning)\b[\s\S]*?```\s*/gi, "")
    // Collapse 3+ consecutive newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return result;
}

export function parseSecurityLlmResponse(text: string): MddSeguridadItem[] | null {
  const trimmed = stripThinkingTags(text);
  if (!trimmed) return null;

  const recovered = recoverSeguridadItemsFromRawLlmText(trimmed);
  if (recovered) return recovered;

  // Corruption check solo para markdown crudo (JSON ya agotado arriba).
  if (isCorruptedSecurityLlmText(trimmed)) return null;

  return tryMarkdownSection(trimmed);
}
