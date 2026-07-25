/** Normalización de borrador MDD: contexto, §6/§7 JSON→markdown, headings, limpieza de artefactos LLM. */
import { findBalancedBrace, findBalancedBraceRespectingStrings } from "./brace.util.js";
import { subsectionsToMarkdown } from "./json-section-to-markdown.js";

/** Misma lógica que `findSection1HeadingSpan` (evitar import circular con section-merge). */
function findSection1HeadingSpanLocal(
  draft: string,
): { headingStart: number; bodyStart: number } | null {
  const re =
    /(^|\n)(##\s*1\.\s*Contexto(?:\s+y\s+alcance)?|##\s*Contexto\s+y\s+alcance)[ \t]*(?=\n|$)/gi;
  const m = re.exec(draft);
  if (!m || m.index == null) return null;
  const prefixLen = m[1]?.length ?? 0;
  const headingStart = m.index + prefixLen;
  const bodyStart = m.index + m[0].length;
  return { headingStart, bodyStart };
}

/** Busca una clave en obj de forma case-insensitive. */
function getKeyIgnoreCase(obj: Record<string, unknown>, key: string): string | undefined {
  const lower = key.toLowerCase();
  const found = Object.keys(obj).find((k) => k.toLowerCase() === lower);
  return found;
}

/**
 * Convierte un objeto JSON a título + viñetas: acepta { section|heading + details } o { title + content }.
 * Lectura de claves case-insensitive (Title, Content, etc.).
 */
function jsonBlockToMarkdownLines(obj: Record<string, unknown>): { title: string; items: string[] } | null {
  const titleKey = getKeyIgnoreCase(obj, "title") ?? getKeyIgnoreCase(obj, "section") ?? getKeyIgnoreCase(obj, "heading");
  const title = titleKey != null && typeof obj[titleKey] === "string" ? String(obj[titleKey]).trim() : null;
  const contentKey = getKeyIgnoreCase(obj, "content") ?? getKeyIgnoreCase(obj, "details");
  const arr = contentKey != null && Array.isArray(obj[contentKey]) ? obj[contentKey] : null;
  if (!title || !arr) return null;
  const items = arr.map((d) => (typeof d === "string" ? d : String(d)).trim()).filter(Boolean);
  return { title, items };
}

/**
 * Convierte bloques JSON con forma { "section"|"heading"|"title": "...", "details"|"content": ["..."] } a markdown (### título, - ítem).
 * También acepta un único objeto { "sections": [ { title, content }, ... ] }.
 * Usado cuando el LLM devuelve Seguridad como varios objetos JSON en lugar de markdown.
 */
function convertSectionDetailsJsonToMarkdown(body: string): string {
  const trimmedBody = body.replace(/^\s*###\s*sections\s*\n+/i, "").trim();

  // Formato: único objeto con clave "sections" (array de { title, content })
  const firstBrace = trimmedBody.indexOf("{");
  if (firstBrace !== -1) {
    const braceEnd = findBalancedBrace(trimmedBody, firstBrace);
    if (braceEnd !== -1) {
      try {
        const singleJson = trimmedBody.slice(firstBrace, braceEnd + 1);
        const obj = JSON.parse(singleJson) as Record<string, unknown>;
        const sectionsKey = getKeyIgnoreCase(obj, "sections");
        const sections = sectionsKey != null && Array.isArray(obj[sectionsKey]) ? obj[sectionsKey] : null;
        if (sections && sections.length > 0) {
          const sectionLines: string[] = [];
          for (const item of sections) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const parsed = jsonBlockToMarkdownLines(item as Record<string, unknown>);
            if (parsed) {
              sectionLines.push("", `### ${parsed.title}`, "");
              for (const i of parsed.items) sectionLines.push(`- ${i}`);
            }
          }
          if (sectionLines.length > 0) return sectionLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        }
      } catch {
        // fall through to per-object parsing
      }
    }
  }

  const result: string[] = [];
  const jsonStart = /\{\s*"(?:section|heading|title)"\s*:/i;
  let remaining = trimmedBody;
  let braceStart = remaining.search(jsonStart);
  while (braceStart !== -1) {
    const before = remaining.slice(0, braceStart).trim();
    if (before) result.push(before);
    const braceEnd = findBalancedBrace(remaining, braceStart);
    if (braceEnd === -1) break;
    try {
      const jsonStr = remaining.slice(braceStart, braceEnd + 1);
      const obj = JSON.parse(jsonStr) as Record<string, unknown>;
      const parsed = jsonBlockToMarkdownLines(obj);
      if (parsed) {
        result.push("", `### ${parsed.title}`, "");
        for (const item of parsed.items) result.push(`- ${item}`);
      }
      remaining = remaining.slice(braceEnd + 1).replace(/^\s*\n+/, "\n");
    } catch {
      remaining = remaining.slice(braceStart + 1);
    }
    braceStart = remaining.search(jsonStart);
  }
  if (remaining.trim()) result.push(remaining.trim());
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Convierte un body que es (o empieza con) un objeto JSON cuyas claves son headings markdown ("### Flujo de integración", etc.)
 * a markdown legible: cada clave → ### Título (sin duplicar ###), valor como párrafo o lista/objeto legible.
 */
function convertIntegrationHeadingKeysObjectToMarkdown(body: string): string {
  let trimmed = body.replace(/^\s*###\s*##\s*Integración\s*\n+/i, "").trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1 || !trimmed.includes('"')) return body;
  const braceEnd = findBalancedBrace(trimmed, firstBrace);
  if (braceEnd === -1) return body;
  try {
    const jsonStr = trimmed.slice(firstBrace, braceEnd + 1);
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const keys = Object.keys(obj);
    const hasHeadingKeys = keys.some((k) => k.includes("###"));
    if (!hasHeadingKeys) return body;
    const lines: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      const heading = key.trim().startsWith("###") ? key.trim() : `### ${key}`;
      lines.push("", heading, "");
      if (typeof val === "string") {
        lines.push(val.trim());
      } else if (Array.isArray(val)) {
        for (const item of val) lines.push(typeof item === "string" ? `- ${item}` : `- ${JSON.stringify(item)}`);
      } else if (val !== null && typeof val === "object") {
        const rec = val as Record<string, unknown>;
        if (rec.stack !== undefined || rec.pending !== undefined) {
          if (Array.isArray(rec.stack)) lines.push("- **stack:** " + (rec.stack.length ? rec.stack.join(", ") : "[]"));
          if (typeof rec.pending === "string" && rec.pending.trim()) lines.push("- **pending:** " + rec.pending.trim());
        } else {
          lines.push("```json\n" + JSON.stringify(val, null, 2) + "\n```");
        }
      }
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return body;
  }
}

/**
 * Detecta si el body está "contaminado": lista de viñetas donde cada línea es un fragmento de JSON
 * (ej. " - {", " - \"title\": \"## Seguridad\",", " - \"content\": [") en vez de un bloque JSON parseable.
 */
function isBulletListAsJsonLines(body: string): boolean {
  const trimmed = body.replace(/^\s*\n+/, "").trim();
  const lines = trimmed.split(/\n/);
  const bulletLines = lines.filter((line) => /^\s*-\s+/.test(line));
  if (bulletLines.length < 3) return false;
  const rest = bulletLines.map((l) => l.replace(/^\s*-\s*/, "").trim()).join(" ");
  const hasTitleOrHeading = /"title"\s*:/i.test(rest) || /"heading"\s*:/i.test(rest);
  const hasContentOrDetails = /"content"\s*:\s*\[/i.test(rest) || /"details"\s*:\s*\[/i.test(rest);
  const hasNestedSectionKeys = /"\s*6\.\s*Seguridad"\s*:\s*\{/i.test(rest) || /"\s*6\.\d+\s+/.test(rest);
  const hasDescriptionMeasures =
    /"description"\s*:/i.test(rest) || /"measures"\s*:\s*\[/i.test(rest) || /"considerations"\s*:\s*\[/i.test(rest);
  return (hasTitleOrHeading && hasContentOrDetails) || hasNestedSectionKeys || (rest.includes("{") && hasDescriptionMeasures);
}

/**
 * Quita el prefijo de viñeta de cada línea y opcionalmente inserta comas para obtener JSON válido
 * (entre } y { o ] y { que suelen faltar cuando el JSON fue volcado línea a línea).
 */
export function unbulletAndJoinForJson(body: string): string {
  const lines = body.split(/\n/);
  const unbulleted = lines.map((line) => line.replace(/^\s*-\s*/, "").trim());
  let joined = unbulleted.join("\n");
  // Insert comma between } or ] and newline and { (array/object elements)
  joined = joined.replace(/\}\s*\n\s*\{/g, "},\n{");
  joined = joined.replace(/\]\s*\n\s*\{/g, "],\n{");
  // Comma between ] or } and newline and " (next key in object)
  joined = joined.replace(/\]\s*\n\s*"/g, "],\n\"");
  joined = joined.replace(/\}\s*\n\s*"/g, "},\n\"");
  return joined;
}

/**
 * Convierte un objeto raíz con "content" como array de objetos { heading/title, details/content }
 * a markdown (### título + viñetas). Usado cuando el JSON contaminado tiene esa forma.
 */
function objectWithContentArrayToMarkdown(obj: Record<string, unknown>): string | null {
  const contentKey = getKeyIgnoreCase(obj, "content");
  const content = contentKey != null ? obj[contentKey] : undefined;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  const isArrayOfObjects =
    typeof first === "object" && first !== null && !Array.isArray(first);
  if (!isArrayOfObjects) return null;
  const sectionLines: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const parsed = jsonBlockToMarkdownLines(rec);
    if (parsed) {
      const heading = parsed.title.replace(/^#+\s*/, "").trim();
      sectionLines.push("", `### ${heading}`, "");
      for (const i of parsed.items) sectionLines.push(`- ${i}`);
    }
  }
  if (sectionLines.length === 0) return null;
  return sectionLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Convierte objeto con claves tipo "6. Seguridad": { "6.1 X": { "A": "texto" }, "6.2 Y": {...} } a markdown (### 6.1 X, - **A**: texto). */
export function nestedSectionKeysToMarkdown(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const heading = key.trim().startsWith("###") ? key.trim() : `### ${key}`;
    lines.push("", heading, "");
    if (Array.isArray(val)) {
      for (const item of val) lines.push(typeof item === "string" ? `- ${item}` : `- ${JSON.stringify(item)}`);
    } else if (typeof val === "string" && val.trim()) {
      lines.push(`- ${val.trim()}`);
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const rec = val as Record<string, unknown>;
      const allStrings = Object.values(rec).every((v) => typeof v === "string");
      if (allStrings && Object.keys(rec).length > 0) {
        for (const [k, v] of Object.entries(rec))
          if (typeof v === "string" && v.trim()) lines.push(`- **${k}**: ${v.trim()}`);
      } else {
        const nested = nestedSectionKeysToMarkdown(rec);
        if (nested) lines.push(nested);
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Convierte objeto con description (string), measures y considerations (array de { name, details }) a markdown.
 * Formato típico del nodo Security cuando devuelve JSON en viñetas.
 */
function descriptionMeasuresConsiderationsToMarkdown(obj: Record<string, unknown>): string | null {
  const lines: string[] = [];
  const desc = obj.description;
  if (typeof desc === "string" && desc.trim()) {
    lines.push(desc.trim(), "");
  }
  const measures = Array.isArray(obj.measures) ? obj.measures : [];
  for (const m of measures) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const rec = m as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "Medida";
    const details = typeof rec.details === "string" ? rec.details : String(rec.details ?? "").trim();
    lines.push("### " + name, "", details ? `- ${details}` : "", "");
  }
  const considerations = Array.isArray(obj.considerations) ? obj.considerations : [];
  for (const c of considerations) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const rec = c as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "Consideración";
    const details = typeof rec.details === "string" ? rec.details : String(rec.details ?? "").trim();
    lines.push("### " + name, "", details ? `- ${details}` : "", "");
  }
  if (lines.length === 0) return null;
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Descontamina un body que es "bullet list as JSON lines": quita prefijo de viñeta, reconstruye JSON,
 * parsea y convierte a markdown. Devuelve null si no aplica o el parse falla.
 */
function unbulletAndParseSectionJson(body: string): string | null {
  const trimmed = body.replace(/^\s*###\s*sections\s*\n+/i, "").trim().replace(/^\s*###\s*Seguridad\s*\n+/i, "").trim();
  const candidate = unbulletAndJoinForJson(trimmed);
  try {
    const firstBrace = candidate.indexOf("{");
    if (firstBrace === -1) return null;
    const braceEnd = findBalancedBraceRespectingStrings(candidate, firstBrace);
    if (braceEnd === -1) return null;
    const jsonStr = candidate.slice(firstBrace, braceEnd + 1);
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const descMeasures = descriptionMeasuresConsiderationsToMarkdown(obj);
    if (descMeasures) return descMeasures;
    const withContentArray = objectWithContentArrayToMarkdown(obj);
    if (withContentArray) return withContentArray;
    const sectionsKey = getKeyIgnoreCase(obj, "sections");
    const sections = sectionsKey != null && Array.isArray(obj[sectionsKey]) ? obj[sectionsKey] : null;
    if (sections && sections.length > 0) {
      const sectionLines: string[] = [];
      for (const item of sections) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const parsed = jsonBlockToMarkdownLines(item as Record<string, unknown>);
        if (parsed) {
          sectionLines.push("", `### ${parsed.title}`, "");
          for (const i of parsed.items) sectionLines.push(`- ${i}`);
        }
      }
      if (sectionLines.length > 0) return sectionLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    const singleBlock = jsonBlockToMarkdownLines(obj);
    if (singleBlock) {
      const lines: string[] = ["", `### ${singleBlock.title}`, ""];
      for (const i of singleBlock.items) lines.push(`- ${i}`);
      return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    if (/"6\.\s*Seguridad"/i.test(jsonStr) || Object.keys(obj).some((k) => /^\d+\.\d+\s/.test(k) || /^6\.\s*Seguridad$/i.test(k))) {
      const nested = nestedSectionKeysToMarkdown(obj);
      if (nested) return nested;
      const inner = obj["6. Seguridad"] ?? obj["6.Seguridad"];
      if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
        const innerMd = nestedSectionKeysToMarkdown(inner as Record<string, unknown>);
        if (innerMd) return innerMd;
      }
    }
  } catch {
    // parse failed
  }
  return null;
}

/** Busca la primera ocurrencia de ## Heading que esté al inicio del documento o tras un salto de línea (evita matchear dentro de sección 2). */
function findSectionStart(draft: string, heading: string): number {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)(${escaped})\\b`);
  const match = draft.match(re);
  if (!match || match.index == null) return -1;
  return match.index + (match[0].startsWith("\n") ? 1 : 0);
}

/** Busca una sección por el primero de varios headings (ej. "## 6. Seguridad" o "## Seguridad"). */
function findSectionStartAny(draft: string, headings: string[]): { index: number; heading: string } | null {
  let best: { index: number; heading: string } | null = null;
  for (const h of headings) {
    const idx = findSectionStart(draft, h);
    if (idx !== -1 && (best == null || idx < best.index)) best = { index: idx, heading: h };
  }
  return best;
}

/**
 * En secciones ## Seguridad y ## Integración, reemplaza viñetas que son JSON crudo (ej. "- {\"subsections\":[...]}")
 * o bloques { "section"|"heading"|"title": "...", "details"|"content": [...] } por markdown legible (### título, - ítem).
 * Para ## Integración también convierte objeto con claves "### Flujo de integración", etc.
 */
const SEGURIDAD_HEADINGS = ["## 6. Seguridad", "## Seguridad"];
const INTEGRACION_HEADINGS = ["## 7. Infraestructura", "## Integración"];

export function sanitizeSeguridadIntegracionRawJson(draft: string): string {
  let out = draft;
  for (const [headings, isIntegration] of [
    [SEGURIDAD_HEADINGS, false] as const,
    [INTEGRACION_HEADINGS, true] as const,
  ]) {
    const found = findSectionStartAny(out, headings as string[]);
    if (!found) continue;
    const { index: idx, heading } = found;
    const sectionStart = idx + heading.length;
    const rest = out.slice(sectionStart);
    const nextH2 = rest.search(/\n##\s+/);
    const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
    const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";

    if (isIntegration) {
      const bodyTrimmed = body.replace(/^\s*\n+/, "").trim().replace(/^###\s*##\s*Integración\s*\n+/i, "").trim();
      const hasIntegrationHeadingKeysJson =
        bodyTrimmed.startsWith("{") && /"\s*###\s+[^"]+"\s*:/.test(bodyTrimmed);
      if (hasIntegrationHeadingKeysJson) {
        const newBody = convertIntegrationHeadingKeysObjectToMarkdown(body);
        out = out.slice(0, sectionStart) + "\n\n" + newBody + afterSection;
        continue;
      }
    }

    // Bloques JSON: section/heading/details, title/content, { "sections": [...] }, o "### sections" + objetos { title, content }
    const hasSectionHeadingJson = /\{\s*"(?:section|heading)"\s*:/i.test(body);
    const hasTitleContentJson = /\{\s*"title"\s*:/i.test(body) && /\b"content"\s*:\s*\[/.test(body);
    const hasSectionsArrayJson = /\{\s*"sections"\s*:\s*\[/i.test(body);
    const hasSectionsHeadingWithTitleContent =
      /###\s*sections/i.test(body) && /"title"\s*:/.test(body) && /"content"\s*:/.test(body);
    if (hasSectionHeadingJson || hasTitleContentJson || hasSectionsArrayJson || hasSectionsHeadingWithTitleContent) {
      const newBody = convertSectionDetailsJsonToMarkdown(body);
      out = out.slice(0, sectionStart) + "\n\n" + newBody + afterSection;
      continue;
    }
    const bulletStart = body.search(/^-\s*\{\s*"subsections"\s*:/m);
    if (bulletStart !== -1) {
      const braceStart = body.indexOf("{", bulletStart);
      const braceEnd = findBalancedBrace(body, braceStart);
      if (braceEnd !== -1) {
        try {
          const jsonStr = body.slice(braceStart, braceEnd + 1);
          const obj = JSON.parse(jsonStr) as Record<string, unknown>;
          const subMd = subsectionsToMarkdown(obj);
          if (subMd) {
            const newBody = body.slice(0, bulletStart) + subMd + body.slice(braceEnd + 1).replace(/^\s*\n?/, "\n\n");
            out = out.slice(0, sectionStart) + newBody + afterSection;
            continue;
          }
        } catch {
          // fall through to bullet-list-as-JSON-lines
        }
      }
    }

    // Bullet list as JSON lines (contaminated: each line is a bullet with a JSON fragment)
    if (isBulletListAsJsonLines(body)) {
      const newBody = unbulletAndParseSectionJson(body);
      if (newBody != null) {
        out = out.slice(0, sectionStart) + "\n\n" + newBody + afterSection;
      }
    }
  }
  return out;
}

const CONTEXTO_JSON_KEY_LABELS: Record<string, string> = {
  objective: "Objetivo",
  goal: "Objetivo",
  audience: "Audiencia",
  includeMetadata: "Incluir metadatos",
  scope: "Alcance",
  technologies: "Tecnologías",
  techStack: "Stack tecnológico",
  focus: "Enfoque",
  requirements: "Requisitos",
  keyCompetitors: "Competidores de referencia",
  keyFeatures: "Características clave",
  marketOpportunities: "Oportunidades de mercado",
};

/**
 * Si la sección "## 1. Contexto" (o "## 1. Contexto y alcance") contiene un bloque JSON,
 * lo reemplaza por viñetas en markdown. Arrays → sublista con guiones. Evita JSON crudo en §1.
 */
function contextJsonValueToMarkdown(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) {
    return v
      .filter((item) => item != null && String(item).trim() !== "")
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .map((s) => `  - ${s}`)
      .join("\n");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function sanitizeContextSection(draft: string): string {
  const span = findSection1HeadingSpanLocal(draft);
  if (!span) return draft;
  const sectionStart = span.bodyStart;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = (nextH2 !== -1 ? rest.slice(0, nextH2) : rest).replace(/^\s*\n+/, "").trim();
  const braceInBody = body.indexOf("{");
  if (braceInBody === -1 || !body.includes('"')) return draft;
  const endOfSection = nextH2 !== -1 ? sectionStart + nextH2 : draft.length;
  const start = draft.indexOf("{", sectionStart);
  if (start < sectionStart || start >= endOfSection) return draft;
  let depth = 0;
  let end = start;
  for (let i = start; i < endOfSection; i++) {
    const c = draft[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (depth !== 0) return draft;
  try {
    const jsonStr = draft.slice(start, end);
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const bullets = Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        const label = CONTEXTO_JSON_KEY_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, " $1").trim();
        const val = contextJsonValueToMarkdown(v);
        if (val.includes("\n")) return `- **${label}:**\n${val}`;
        return `- **${label}:** ${val}`;
      })
      .join("\n");
    return draft.slice(0, start) + bullets + draft.slice(end);
  } catch {
    return draft;
  }
}

/**
 * En la sección "## 1. Contexto y alcance": reemplaza [object Object] por texto legible y convierte
 * viñetas key: value (objective, technologies, focus, requirements) en prosa breve cuando sea solo metadatos.
 */
export function sanitizeContextKeyValueAndObject(draft: string): string {
  const span = findSection1HeadingSpanLocal(draft);
  if (!span) return draft;
  const sectionStart = span.bodyStart;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = (nextH2 !== -1 ? rest.slice(0, nextH2) : rest).replace(/^\s*\n+/, "").trim();
  const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
  let newBody = body
    .replace(/\[object\s+Object\]/gi, "(stack tecnológico)")
    .replace(/\*\*technologies:\*\*\s*\[object\s+Object\]/gi, "**Tecnologías:** NestJS, PostgreSQL, React (según alcance).");
  const keyValueBullet = /^-\s+\*\*(objective|technologies|focus|requirements|scope)\*\*[:\s]+/im;
  if (keyValueBullet.test(newBody) && newBody.split(/\n/).length <= 8) {
    const lines = newBody.split(/\n/).map((line) => {
      const m = line.match(/^-\s+\*\*(objective|technologies|focus|requirements|scope)\*\*[:\s]+(.*)$/i);
      if (m) return `- **${m[1].charAt(0).toUpperCase() + m[1].slice(1)}:** ${m[2].trim()}`;
      return line;
    });
    newBody = lines.join("\n");
  }
  return draft.slice(0, sectionStart) + "\n\n" + newBody + (afterSection ? "\n\n" + afterSection : "");
}

/**
 * Subtítulos en inglés que el LLM suele copiar del brief del usuario; se reemplazan por español canónico.
 * Orden: frases más largas / específicas primero.
 */
const ENGLISH_SUBHEADING_TO_ES: Array<{ pattern: RegExp; replacement: string }> = [
  // §1
  {
    pattern:
      /\*\*1\.1\.\s*Project\s+Vision\s*(?:&|and)\s*Objectives(?:\s*\([^)]*\))?\s*:\s*\*\*/gi,
    replacement: "**1.1. Visión y objetivos del producto:**",
  },
  {
    pattern: /###\s*1\.1\.\s*Project\s+Vision\s*(?:&|and)\s*Objectives(?:\s*\([^)]*\))?\s*:?/gi,
    replacement: "### 1.1. Visión y objetivos del producto",
  },
  {
    pattern: /\*\*1\.2\.\s*Functional\s+Requirements(?:\s*\([^)]*\))?\s*:\s*\*\*/gi,
    replacement: "**1.2. Requisitos funcionales (formato EARS):**",
  },
  { pattern: /###\s*1\.2\.\s*Functional\s+Requirements(?:\s*\([^)]*\))?\s*:?/gi, replacement: "### 1.2. Requisitos funcionales (formato EARS)" },
  {
    pattern: /\*\*1\.3\.\s*Monetization\s*(?:&|and)\s*Pricing\s+Architecture\s*:\s*\*\*/gi,
    replacement: "**1.3. Monetización y arquitectura de precios:**",
  },
  {
    pattern: /###\s*1\.3\.\s*Monetization\s*(?:&|and)\s*Pricing\s+Architecture\s*:?/gi,
    replacement: "### 1.3. Monetización y arquitectura de precios",
  },
  // §2
  { pattern: /\*\*2\.1\.\s*Technical\s+Architecture\s*:\s*\*\*/gi, replacement: "**2.1. Arquitectura técnica:**" },
  { pattern: /###\s*2\.1\.\s*Technical\s+Architecture\s*:?/gi, replacement: "### 2.1. Arquitectura técnica" },
  { pattern: /\*\*2\.2\.\s*Technical\s+Architecture\s*:\s*\*\*/gi, replacement: "**2.2. Arquitectura técnica (detalle):**" },
  // §6 (seguridad)
  { pattern: /\*\*6\.2\.\s*Identity\s*:\s*\*\*/gi, replacement: "**6.2. Identidad:**" },
  { pattern: /###\s*6\.2\.\s*Identity\s*:?/gi, replacement: "### 6.2. Identidad" },
  { pattern: /\*\*6\.3\.\s*Data\s+Sovereignty\s*:\s*\*\*/gi, replacement: "**6.3. Soberanía de datos:**" },
  { pattern: /###\s*6\.3\.\s*Data\s+Sovereignty\s*:?/gi, replacement: "### 6.3. Soberanía de datos" },
  { pattern: /\*\*6\.4\.\s*Vulnerability\s+Management\s*:\s*\*\*/gi, replacement: "**6.4. Gestión de vulnerabilidades:**" },
  { pattern: /###\s*6\.4\.\s*Vulnerability\s+Management\s*:?/gi, replacement: "### 6.4. Gestión de vulnerabilidades" },
  { pattern: /\*\*6\.5\.\s*Incident\s+Response\s*:\s*\*\*/gi, replacement: "**6.5. Respuesta a incidentes:**" },
  { pattern: /###\s*6\.5\.\s*Incident\s+Response\s*:?/gi, replacement: "### 6.5. Respuesta a incidentes" },
];

/**
 * Normaliza subtítulos frecuentes en inglés (procedentes del brief) a español, sin tocar el cuerpo del texto.
 */
export function normalizeMddEnglishSubheadings(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  let out = draft;
  for (const { pattern, replacement } of ENGLISH_SUBHEADING_TO_ES) {
    out = out.replace(pattern, replacement);
  }
  // `## 6. Seguridad**6.1. Privacidad:**` (H2 pegado a subencabezado en negrita)
  out = out.replace(/(##\s*6\.\s*Seguridad)\*\*(\d+\.\d+)/gi, "$1\n\n**$2");
  return out;
}

/** Títulos canónicos del MDD (7 secciones). */
export const CANONICAL_HEADINGS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /^#+\s*Contexto\s*y\s*alcance\s*$/im, replacement: "## 1. Contexto" },
  { pattern: /^#+\s*Arquitectura\s+y\s*Stack\s*$/im, replacement: "## 2. Arquitectura y Stack" },
  { pattern: /^##\s+2\.\s*Arquitectura\s*$/im, replacement: "## 2. Arquitectura y Stack" },
  { pattern: /^##\s+2\.\s*Stack(?:\s+t[eé]cnico)?\s*$/im, replacement: "## 2. Arquitectura y Stack" },
  { pattern: /^#+\s*schemaSQL\s*$/im, replacement: "## 3. Modelo de Datos" },
  { pattern: /^#+\s*Schema\s*SQL\s*$/im, replacement: "## 3. Modelo de Datos" },
  { pattern: /^#+\s*\d\.\s*Modelo\s+(?:de\s+)?datos\s*$/im, replacement: "## 3. Modelo de Datos" },
  { pattern: /^#+\s*Modelo\s+(?:de\s+)?datos\s*$/im, replacement: "## 3. Modelo de Datos" },
  { pattern: /^#+\s*Contratos\s+de\s+API\s*$/im, replacement: "## 4. Contratos de API" },
  { pattern: /^#+\s*Lógica\s+y\s*Edge\s+Cases\s*$/im, replacement: "## 5. Lógica y Edge Cases" },
  { pattern: /^#+\s*Seguridad\s*$/im, replacement: "## 6. Seguridad" },
  { pattern: /^#+\s*Integración\s*$/im, replacement: "## 7. Infraestructura" },
  { pattern: /^#+\s*Infraestructura\s*$/im, replacement: "## 7. Infraestructura" },
  { pattern: /^#+\s*endpoints\s*$/im, replacement: "### Endpoints" },
];

/**
 * Convierte secuencias literales \\n, \\t y \\" en newline, tab y comilla real.
 * Corrige drafts que llegaron escapados (ej. doble JSON) para que el markdown renderice bien.
 */
export function unescapeLiteralNewlines(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  return draft
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"');
}

/**
 * Elimina del final del documento el bloque "Respuestas del usuario (incorporar al borrador...)"
 * y todo el historial de conversación que el LLM copió. Ese bloque es contexto para los agentes,
 * no parte del MDD que debe ver el usuario.
 */
export function stripUserResponsesAndConversationHistory(draft: string): string {
  if (!draft || typeof draft !== "string") return draft;
  const markers = [
    /\n\s*\*\*Respuestas del usuario\s*\(incorporar al borrador/i,
    /\n\s*\*\*Respuestas acumuladas del usuario\s*\(/i,
  ];
  for (const re of markers) {
    const match = draft.match(re);
    if (match && match.index != null) {
      return draft.slice(0, match.index).replace(/\n{2,}\s*$/, "\n").trim();
    }
  }
  return draft;
}

/** Inicio de párrafos que son instrucciones/feedback interno; no deben quedar en el documento final. */
const INSTRUCTION_STARTS = [
  /^\s*\*\*Feedback del Auditor\s*\(/i,
  /^\s*Aplica las correcciones que afecten a/i,
  /^\s*Unifica el documento y asegura que los gaps/i,
  /^\s*Opcional:\s*Usa la tool validate_mdd_structure/i,
  /^\s*\*\*Opcional:\s*\*\*.*format_section3_endpoints/i,
  /^\s*\*\*Requisitos o petición del usuario\s*\(incorporar en las secciones/i,
  // Bloques que inyectamos en el contexto del SA; el LLM no debe copiarlos en la salida.
  /^\s*\*\*ACCIÓN REQUERIDA\s*\(usuario aceptó esta propuesta\)\s*:\s*\*\*/i,
  /^\s*\*\*Prioridad\s*\(léelo primero\)\s*:\s*\*\*/i,
  /^\s*Requisitos del usuario\s*\(conversación reciente\)\s*:/im,
  /^\s*Debes aplicar esta directiva al MDD/i,
];

function isInstructionBlock(paragraph: string): boolean {
  const firstLine = paragraph.split("\n")[0]?.trim() ?? "";
  return INSTRUCTION_STARTS.some((re) => re.test(firstLine));
}

/**
 * Elimina del texto párrafos que son instrucciones o feedback interno (Feedback del Auditor, Aplica las correcciones..., Unifica el documento..., Opcional: Usa la tool...).
 * Evita que el LLM haya copiado esas instrucciones al output y queden en el MDD final.
 */
export function stripInstructionAndFeedbackBlocks(text: string): string {
  if (!text || typeof text !== "string") return text;
  const paragraphs = text.split(/\n\n+/);
  const kept = paragraphs.filter((p) => !isInstructionBlock(p));
  return stripMeshDirectivesFromDraft(kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim());
}

/**
 * Elimina directivas internas del mesh (`[DIRECTIVE: nodo] …`) que el LLM copió al markdown entregable.
 */
export function stripMeshDirectivesFromDraft(draft: string): string {
  return (draft ?? "")
    .replace(/^\s*-\s*\[DIRECTIVE:\s*[\w.]+\]\s*/gim, "- ")
    .replace(/\[DIRECTIVE:\s*[\w.]+\]\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const REAL_SECTION_RE =
  /\n##\s+(?:1\.\s*Contexto|2\.\s*Modelo|3\.\s*Contratos|4\.\s*Arquitectura\s+Frontend|Seguridad|Integración)\b/i;

/** Si el draft empieza con useMermaidForDiagrams/document, recorta todo hasta la primera sección real y reconstruye. */
export function forceStripBrokenPrefix(draft: string): string {
  const trimmed = (draft || "").trim();
  if (!trimmed || trimmed.length < 100) return draft;
  const hasBroken = /useMermaidForDiagrams|##\s+document\b/i.test(trimmed.slice(0, 2000));
  if (!hasBroken) return draft;
  const match = trimmed.match(REAL_SECTION_RE);
  if (!match || match.index == null) return draft;
  const fromSection = trimmed.slice(match.index).replace(/^\s*\n+/, "");
  if (fromSection.length < 200) return draft;
  return ("# Master Design Document\n\n---\n" + fromSection).trim();
}

/**
 * Convierte sección "## TechnicalMetadata" con viñetas (- [tag]) en bloque de código
 * ```TechnicalMetadata\n[tag1] [tag2]\n``` para que no se muestre como encabezado roto.
 */
function convertTechnicalMetadataSectionToBlock(draft: string): string {
  const heading = "## TechnicalMetadata";
  const idx = draft.indexOf(heading);
  if (idx === -1) return draft;
  const sectionStart = idx + heading.length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = (nextH2 !== -1 ? rest.slice(0, nextH2) : rest).replace(/^\s*\n+/, "").trim();
  const tagMatches = body.match(/-\s*\[([^\]]+)\]/g);
  const tags = tagMatches ? tagMatches.map((m) => "[" + m.replace(/^-\s*\[|\]$/g, "").trim() + "]") : [];
  const blockContent = tags.length > 0 ? tags.join(" ") : "[high_security]";
  const codeBlock = "\n\n```TechnicalMetadata\n" + blockContent + "\n```\n\n";
  const afterSection = nextH2 !== -1 ? rest.slice(nextH2) : "";
  return draft.slice(0, idx) + codeBlock + (afterSection ? afterSection : "");
}

/**
 * Convierte metadata en cursiva (*Metadata: [high_security]*) a bloque ```TechnicalMetadata.
 */
function convertItalicMetadataToBlock(draft: string): string {
  return draft.replace(
    /\*Metadata:\s*([^*]+)\*/gi,
    (_match, tags) => "```TechnicalMetadata\n" + tags.trim().replace(/\s*,\s*/g, " ") + "\n```"
  );
}

/** Elimina bloques "## useMermaidForDiagrams" / "## leaveUncovered" / "## document" cuando hay una sección real después. Repite hasta que no queden. */
export function stripBrokenMetadataDocumentBlock(draft: string): string {
  let out = draft;
  out = convertItalicMetadataToBlock(out);
  out = convertTechnicalMetadataSectionToBlock(out);
  let changed = true;
  while (changed) {
    changed = false;
    const idx = out.search(/\n##\s+useMermaidForDiagrams\b/i);
    if (idx === -1) break;
    const afterBroken = out.slice(idx);
    const match = afterBroken.match(REAL_SECTION_RE);
    if (!match || match.index == null) break;
    const startRemove = out.slice(0, idx).replace(/\n---\s*\n?$/, "");
    const rest = afterBroken.slice(match.index).replace(/^\n+/, "");
    out = (startRemove + "\n\n---\n" + rest).trim();
    changed = true;
  }
  return out;
}

/** Elimina repeticiones de "# Master Design Document"; deja solo la primera y quita el bloque duplicado (y --- siguiente si existe). */
export function collapseDuplicateMainTitle(draft: string): string {
  const mainTitleRe = /^#\s+Master\s+Design\s+Document[^\n]*/im;
  const first = draft.match(mainTitleRe);
  if (!first) return draft;
  const firstEnd = draft.indexOf(first[0]) + first[0].length;
  const afterFirst = draft.slice(firstEnd);
  const withoutDuplicates = afterFirst.replace(/(\n\s*)#\s+Master\s+Design\s+Document[^\n]*(\s*\n---\s*\n?)?/gi, "$1");
  return draft.slice(0, firstEnd) + withoutDuplicates;
}
