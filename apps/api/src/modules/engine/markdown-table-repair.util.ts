/** Helpers compartidos para detectar y reparar tablas Markdown (GFM). */

/** Fila separadora GFM: `| --- |`, `| :--- |`, `| :----- |`, etc. */
export function isMarkdownTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const cells = trimmed.slice(1, -1).split("|");
  if (cells.length < 2) return false;
  return cells.every((cell) => {
    const c = cell.trim();
    return c.length > 0 && /^:?-+:?$/.test(c);
  });
}

/** ¿Alguna tabla del documento tiene fila separadora tras la cabecera? */
export function contentHasMarkdownTableSeparator(content: string): boolean {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed.startsWith("|")) continue;
    if (isMarkdownTableSeparatorLine(trimmed)) continue;
    const next = lines[i + 1]?.trim() ?? "";
    if (isMarkdownTableSeparatorLine(next)) return true;
  }
  return false;
}

function countMarkdownTableColumns(line: string): number {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return 0;
  const parts = trimmed.split("|").map((p) => p.trim());
  const cells =
    parts.length >= 2 && parts[0] === "" && parts[parts.length - 1] === ""
      ? parts.slice(1, -1)
      : parts.filter(Boolean);
  return cells.length;
}

/** Inserta fila `| --- |` tras cabeceras sin separador (determinista, sin LLM). */
export function repairMarkdownTableSeparators(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      out.push(line);
      i++;
      continue;
    }

    const block: string[] = [];
    while (i < lines.length && lines[i]!.trim().startsWith("|")) {
      block.push(lines[i]!);
      i++;
    }

    if (block.length >= 2 && !isMarkdownTableSeparatorLine(block[1]!.trim())) {
      const colCount = countMarkdownTableColumns(block[0]!);
      if (colCount >= 2) {
        const sep = "| " + Array(colCount).fill("---").join(" | ") + " |";
        out.push(block[0]!, sep, ...block.slice(1));
        continue;
      }
    }
    out.push(...block);
  }
  return out.join("\n");
}
