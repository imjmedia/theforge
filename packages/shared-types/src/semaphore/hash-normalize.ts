import { formatDocumentMarkdown } from "../format-document-markdown.js";
import { peelTheforgeDocStamp } from "../theforge-doc-stamp.js";

/**
 * Normaliza MDD para hashing canónico (snapshot del Auditor, `inputsHash` del sync).
 * Sin `node:crypto` — el digest vive en la API.
 */
export function normalizeMddForHash(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const { body } = peelTheforgeDocStamp(trimmed);
  const formatted = formatDocumentMarkdown(body, { mermaid: "preserve" });
  return formatted.replace(/\s+/g, " ").trim();
}
