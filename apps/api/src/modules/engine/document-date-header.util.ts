import {
  peelDocumentBodyForPersist,
  THEFORGE_DOC_META_COMMENT_RE,
} from "@theforge/shared-types";
import {
  ensureMddGovernanceSection,
  extractGovernanceSection,
  selectedPatternIdsFromMdd,
} from "@theforge/shared-types/mdd-governance-patterns";

/**
 * Prepend creation / last-regeneration timestamp header to any SDD document.
 *
 * Format (at the very top of the markdown):
 *
 * ```
 * <!-- theforge-doc:created=ISO|updated=ISO -->
 * > 📅 Creado: DD de MMMM de YYYY, HH:MM:SS UTC · Última modificación: DD de MMMM de YYYY, HH:MM:SS UTC
 *
 * ---
 * ```
 *
 * - The HTML comment is machine-parseable and hidden in renderers.
 * - The blockquote is human-visible in Workshop and AI IDE.
 * - `---` separates the header from the document body.
 *
 * On first call, `created = updated = now`. On subsequent calls the original
 * `created` is preserved from the existing content and only `updated` changes.
 */

const LOCALE = "es-MX";

/** Markdown fields that receive the timestamp header on persist. */
export const THEFORGE_STAMPED_MARKDOWN_FIELDS = [
  "dbgaContent",
  "mddContent",
  "brdContent",
  "changeSpecContent",
  "specContent",
  "architectureContent",
  "useCasesContent",
  "userStoriesContent",
  "blueprintContent",
  "tasksContent",
  "apiContractsContent",
  "logicFlowsContent",
  "infraContent",
  "agentGovernanceContent",
  "uxUiGuideContent",
  "uiScreensContent",
  "aemContent",
] as const;

export type TheforgeStampedMarkdownField = (typeof THEFORGE_STAMPED_MARKDOWN_FIELDS)[number];

function formatFullDateTime(d: Date): string {
  const datePart = d.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const timePart = d.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${datePart}, ${timePart} UTC`;
}

/**
 * Parse existing timestamps from the document content.
 * Returns `undefined` dates when the header is absent.
 */
export function extractDocumentTimestamps(content: string): {
  created?: Date;
  updated?: Date;
} {
  const match = content.match(THEFORGE_DOC_META_COMMENT_RE);
  if (!match) return {};
  return {
    created: new Date(match[1].trim()),
    updated: new Date(match[2].trim()),
  };
}

/**
 * Prepend or update the timestamp header on a markdown document.
 *
 * @param content  Current markdown content (may already have a header).
 * @param now      Timestamp to use (defaults to `new Date()`).
 * @returns        Content with fresh header at the top.
 */
export function prependDocumentTimestamps(
  content: string,
  now: Date = new Date(),
): string {
  const existing = extractDocumentTimestamps(content);
  const governanceBeforePeel = extractGovernanceSection(content);
  let body = peelDocumentBodyForPersist(content);
  if (
    governanceBeforePeel?.trim() &&
    selectedPatternIdsFromMdd(content).size > 0 &&
    selectedPatternIdsFromMdd(body).size === 0
  ) {
    body = ensureMddGovernanceSection(body, governanceBeforePeel);
  }

  const created = existing.created ?? now;
  const updated = now;

  const comment = `<!-- theforge-doc:created=${created.toISOString()}|updated=${updated.toISOString()} -->`;
  const human =
    `> 📅 Creado: ${formatFullDateTime(created)} · Última modificación: ${formatFullDateTime(updated)}`;

  return `${comment}\n${human}\n\n---\n\n${body.replace(/^\n+/, "")}`;
}

/** Markdown sin cabecera stamp (comentario HTML + blockquote + `---`). */
export function stripDocumentStampHeader(content: string): string {
  return peelDocumentBodyForPersist(content);
}

export function documentMarkdownBodiesEqual(a: string, b: string): boolean {
  return stripDocumentStampHeader(a).trim() === stripDocumentStampHeader(b).trim();
}

/** Opciones de {@link stampMarkdownIfBodyChanged}. */
export interface StampIfBodyChangedOptions {
  /**
   * Regeneración explícita: reestampa `updated` aunque el cuerpo coincida (conserva `created`
   * y el cuerpo), para que el sondeo del cliente detecte que la operación terminó.
   */
  force?: boolean;
}

/**
 * Re-stampa solo si el cuerpo cambió; evita PATCH en bucle que solo actualizan «Última modificación».
 * Con `opts.force` reestampa siempre (solo para regeneraciones explícitas, no guardados normales).
 */
export function stampMarkdownIfBodyChanged(
  existing: string | null | undefined,
  incoming: string,
  now: Date = new Date(),
  opts?: StampIfBodyChangedOptions,
): string {
  const inc = incoming.trim();
  if (!inc) return inc;
  const ex = (existing ?? "").trim();
  if (ex && documentMarkdownBodiesEqual(ex, inc)) {
    if (!opts?.force) return ex;
    // Reestampa sobre el documento existente: conserva `created` y el cuerpo.
    return prependDocumentTimestamps(ex, now);
  }
  return prependDocumentTimestamps(incoming, now);
}

/** Stamps a single markdown document when it has substantive body text. */
export function stampMarkdownDocumentIfNonEmpty(
  content: string | null | undefined,
  now: Date = new Date(),
): string | null | undefined {
  if (content == null) return content;
  const trimmed = content.trim();
  if (!trimmed) return content;
  return prependDocumentTimestamps(content, now);
}

/**
 * Applies timestamp headers to all known markdown document fields in a patch object.
 */
export function stampMarkdownDocumentFields<T extends Record<string, unknown>>(
  patch: T,
  fields: readonly TheforgeStampedMarkdownField[] = THEFORGE_STAMPED_MARKDOWN_FIELDS,
  now: Date = new Date(),
): T {
  const out = { ...patch };
  for (const key of fields) {
    const val = out[key];
    if (typeof val === "string" && val.trim().length > 0) {
      (out as Record<string, unknown>)[key] = prependDocumentTimestamps(val, now);
    }
  }
  return out;
}
