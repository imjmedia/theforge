/**
 * Promueve fences ```lang dentro de ítems de lista a bloques de nivel raíz.
 * El LLM a veces emite `- ```TechnicalMetadata` indentado; remark lo tolera pero
 * parsers más estrictos (p. ej. TanStack Markdown) no lo reconocen como code block.
 */

/** Ítem de lista cuya línea abre un fence: `- ```sql`, `1. ```mermaid`, etc. */
const LIST_ITEM_FENCE_OPEN =
  /^(\s*)([-*+]|\d+(?:\.\d+)*\.)\s+(`{3,})([\w-]*)\s*$/;

function isFenceLine(trimmed: string): boolean {
  return /^(`{3,}|~{3,})/.test(trimmed);
}

function isClosingFence(trimmed: string): boolean {
  return /^(`{3,}|~{3,})\s*[\w-]*\s*$/.test(trimmed);
}

function stripCommonIndent(lines: string[]): string[] {
  const indents = lines
    .filter((l) => l.trim())
    .map((l) => {
      const m = l.match(/^(\s*)/);
      return m?.[1]?.length ?? 0;
    });
  if (indents.length === 0) return lines.map((l) => l.trimEnd());
  const strip = Math.min(...indents);
  return lines.map((l) => (l.trim() ? l.slice(strip) : ""));
}

export function promoteListItemFences(text: string): string {
  if (!text?.trim()) return text ?? "";

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (isFenceLine(trimmed)) {
      if (inFence && isClosingFence(trimmed)) inFence = false;
      else if (!inFence) inFence = true;
      out.push(line);
      i += 1;
      continue;
    }

    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    const openMatch = line.match(LIST_ITEM_FENCE_OPEN);
    if (openMatch) {
      const fenceTicks = openMatch[3] ?? "```";
      const lang = openMatch[4] ?? "";
      const bodyLines: string[] = [];
      let j = i + 1;
      let closed = false;

      while (j < lines.length) {
        const bodyLine = lines[j]!;
        const bodyTrim = bodyLine.trim();
        if (isClosingFence(bodyTrim)) {
          closed = true;
          j += 1;
          break;
        }
        bodyLines.push(bodyLine);
        j += 1;
      }

      if (closed) {
        const dedented = stripCommonIndent(bodyLines);
        if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
        out.push(`${fenceTicks}${lang}`);
        out.push(...dedented);
        out.push(fenceTicks);
        if (j < lines.length) out.push("");
        i = j;
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  return out.join("\n");
}
